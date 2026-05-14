package com.opengov.support.tax.formula;

import com.opengov.support.tax.rule.TaxRule;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 정규화된 산식 평가기. 4가지 유형(A/B/C/D)에 대해 결정적·순수 함수로 평가.
 * 모든 산술은 {@link BigDecimal} 임의정밀 — 부동소수점 오차 없음.
 *
 * <p>입력 룰의 {@code params} 맵에서 유형별 파라미터를 꺼내 사용한다:
 * <ul>
 *   <li>A: {@code params.brackets} = [{max, rate, qd}, …] + {@code params.variable}</li>
 *   <li>B: {@code params.variable} +
 *     {@code params.cap | capVariable | capMap} +
 *     {@code params.rate | rateBands | rateMap}</li>
 *   <li>C: {@code params.variable, thresholdVariable, thresholdRate, rate} (+ optional {@code cap})</li>
 *   <li>D: {@code params.variable, p1, p2, a, M, b}</li>
 * </ul>
 *
 * <p>결과 {@code amount}는 1원 단위 반올림(HALF_UP)으로 정규화.
 */
@Component
public class FormulaEngine {

    /** 중간 산술 정밀도 (충분히 큼). */
    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    public FormulaResult evaluate(TaxRule rule, FormulaContext ctx) {
        return switch (FormulaType.parse(rule.formulaType())) {
            case A -> evalProgressive(rule, ctx);
            case B -> evalCapped(rule, ctx);
            case C -> evalThreshold(rule, ctx);
            case D -> evalPiecewise(rule, ctx);
        };
    }

    /** Type A — 누진세: 적용구간을 찾아 {@code tax = x*r - c}. */
    private FormulaResult evalProgressive(TaxRule rule, FormulaContext ctx) {
        Map<String, Object> p = params(rule);
        String varName = str(p, "variable");
        BigDecimal x = ctx.num(varName);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> brackets = (List<Map<String, Object>>) p.get("brackets");
        if (brackets == null || brackets.isEmpty()) {
            throw new IllegalStateException("Type A 룰에 brackets 파라미터가 없습니다: " + rule.ruleId());
        }
        BigDecimal appliedRate = BigDecimal.ZERO;
        BigDecimal appliedQd = BigDecimal.ZERO;
        BigDecimal appliedMax = BigDecimal.ZERO;
        for (Map<String, Object> b : brackets) {
            BigDecimal max = bd(b, "max");
            BigDecimal rate = bd(b, "rate");
            BigDecimal qd = bd(b, "qd");
            appliedRate = rate;
            appliedQd = qd;
            appliedMax = max;
            if (max.signum() <= 0 || x.compareTo(max) <= 0) break; // max<=0 → 최상위 무한구간
        }
        BigDecimal raw = x.multiply(appliedRate, MC).subtract(appliedQd, MC);
        BigDecimal tax = raw.signum() < 0 ? BigDecimal.ZERO : raw;
        tax = tax.setScale(0, RoundingMode.HALF_UP);

        Map<String, Object> mid = new LinkedHashMap<>();
        mid.put("x", x);
        mid.put("appliedMax", appliedMax);
        mid.put("appliedRate", appliedRate);
        mid.put("appliedQuickDeduction", appliedQd);
        mid.put("formula", "tax = x*r - c");
        String qdTerm = appliedQd.signum() >= 0
                ? "− " + won(appliedQd)
                : "+ " + won(appliedQd.negate());
        mid.put("evaluation",
                String.format("%s × %s %s = %s",
                        won(x), rateStr(appliedRate), qdTerm, won(tax)));
        return new FormulaResult(tax, mid);
    }

    /** Type B — 한도성 비율: {@code credit = min(x, cap) * r}. cap/rate 모두 다양한 해석 옵션. */
    private FormulaResult evalCapped(TaxRule rule, FormulaContext ctx) {
        Map<String, Object> p = params(rule);
        String varName = str(p, "variable");
        BigDecimal x = ctx.num(varName);

        // 이전 공제 이력이 있으면 0원
        if (p.containsKey("claimedBefore")) {
            BigDecimal claimed = ctx.num(str(p, "claimedBefore"));
            if (claimed.signum() != 0) {
                Map<String, Object> mid = new LinkedHashMap<>();
                mid.put("claimedBefore", claimed);
                mid.put("formula", "credit = 0 (이전 공제 이력)");
                return new FormulaResult(BigDecimal.ZERO, mid);
            }
        }

        BigDecimal cap = resolveCap(p, ctx);
        BigDecimal rate = resolveRate(p, ctx);
        BigDecimal base = cap.signum() > 0 ? x.min(cap) : x;
        BigDecimal credit = base.multiply(rate, MC).setScale(0, RoundingMode.HALF_UP);

        // 배우자 공제 추가
        if (p.containsKey("spouseRate")) {
            String spouseVar = str(p, "spouseClaim");
            BigDecimal spouse = ctx.num(spouseVar);
            if (spouse.signum() != 0) {
                BigDecimal spouseCredit = spouse.multiply(bd(p, "spouseRate"), MC).setScale(0, RoundingMode.HALF_UP);
                credit = credit.add(spouseCredit, MC);
            }
        }

        Map<String, Object> mid = new LinkedHashMap<>();
        mid.put("x", x);
        mid.put("cap", cap);
        mid.put("rate", rate);
        mid.put("base", base);
        mid.put("formula", cap.signum() > 0 ? "credit = min(x, cap) × r" : "credit = x × r");
        mid.put("evaluation", cap.signum() > 0
                ? String.format("min(%s, %s) × %s = %s", won(x), won(cap), rateStr(rate), won(credit))
                : String.format("%s × %s = %s", won(x), rateStr(rate), won(credit)));
        return new FormulaResult(credit, mid);
    }

    /** Type C — 임계공제: {@code eligible = max(x − threshold, 0); credit = eligible × r}. */
    private FormulaResult evalThreshold(TaxRule rule, FormulaContext ctx) {
        Map<String, Object> p = params(rule);
        String varName = str(p, "variable");
        String thresholdVar = str(p, "thresholdVariable");
        BigDecimal thresholdRate = bd(p, "thresholdRate");
        BigDecimal rate = bd(p, "rate");
        BigDecimal cap = bd(p, "cap");

        BigDecimal x = ctx.num(varName);
        BigDecimal base = ctx.num(thresholdVar);
        BigDecimal threshold = base.multiply(thresholdRate, MC);
        BigDecimal eligible = x.subtract(threshold, MC).max(BigDecimal.ZERO);
        if (cap.signum() > 0) eligible = eligible.min(cap);
        BigDecimal credit = eligible.multiply(rate, MC).setScale(0, RoundingMode.HALF_UP);

        Map<String, Object> mid = new LinkedHashMap<>();
        mid.put("x", x);
        mid.put("baseVariable", thresholdVar);
        mid.put("baseAmount", base);
        mid.put("thresholdRate", thresholdRate);
        mid.put("threshold", threshold);
        mid.put("eligible", eligible);
        mid.put("rate", rate);
        mid.put("cap", cap);
        mid.put("formula", "credit = max(x − base*tr, 0) × r");
        mid.put("evaluation",
                String.format("max(%s − %s×%s, 0) × %s = %s",
                        won(x), won(base), rateStr(thresholdRate), rateStr(rate), won(credit)));
        return new FormulaResult(credit, mid);
    }

    /** Type D — 구간 인센티브 (근로장려금형). b 가 음수면 phase-out 대신 phase-in 연속. */
    private FormulaResult evalPiecewise(TaxRule rule, FormulaContext ctx) {
        Map<String, Object> p = params(rule);
        String varName = str(p, "variable");
        BigDecimal x = ctx.num(varName);
        BigDecimal p1 = bd(p, "p1");
        BigDecimal p2 = bd(p, "p2");
        BigDecimal a = bd(p, "a");
        BigDecimal M = bd(p, "M");
        BigDecimal b = bd(p, "b");

        BigDecimal credit;
        String region;
        if (x.compareTo(p1) <= 0) {
            credit = a.multiply(x, MC);
            region = "phase-in";
        } else if (x.compareTo(p2) <= 0) {
            credit = M;
            region = "plateau";
        } else {
            BigDecimal raw = M.subtract(b.multiply(x.subtract(p2, MC), MC), MC);
            credit = raw.signum() < 0 ? BigDecimal.ZERO : raw;
            region = b.signum() >= 0 ? "phase-out" : "phase-in (확장)";
        }
        credit = credit.setScale(0, RoundingMode.HALF_UP);

        Map<String, Object> mid = new LinkedHashMap<>();
        mid.put("x", x);
        mid.put("region", region);
        mid.put("p1", p1);
        mid.put("p2", p2);
        mid.put("a", a);
        mid.put("M", M);
        mid.put("b", b);
        mid.put("formula", "if x≤p1: a·x | elif x≤p2: M | else: max(M − b·(x−p2), 0)");
        mid.put("evaluation",
                switch (region) {
                    case "phase-in" -> String.format("%s × %s = %s", rateStr(a), won(x), won(credit));
                    case "plateau" -> String.format("M = %s", won(M));
                    default -> b.signum() >= 0
                            ? String.format("max(%s − %s×(%s−%s), 0) = %s",
                                    won(M), rateStr(b), won(x), won(p2), won(credit))
                            : String.format("%s + %s×(%s−%s) = %s",
                                    won(M), rateStr(b.negate()), won(x), won(p2), won(credit));
                });
        return new FormulaResult(credit, mid);
    }

    /** Type B용 — 단일 cap / 변수 cap / 텍스트 매핑 cap 중 첫 값을 채택. */
    @SuppressWarnings("unchecked")
    private BigDecimal resolveCap(Map<String, Object> p, FormulaContext ctx) {
        if (p.containsKey("cap")) return bd(p, "cap");
        if (p.containsKey("capVariable")) return ctx.num(str(p, "capVariable"));
        if (p.get("capMap") instanceof Map<?, ?> map) {
            Map<String, Object> cm = (Map<String, Object>) map;
            String key = ctx.text(str(cm, "key"));
            Map<String, Object> values = (Map<String, Object>) cm.get("values");
            if (values != null && values.containsKey(key)) {
                return bdValue(values.get(key));
            }
            throw new IllegalStateException(
                    "capMap 에서 키 '" + key + "' 를 찾을 수 없습니다.");
        }
        throw new IllegalStateException(
                "Type B 룰에 cap, capVariable, capMap 중 하나가 필요합니다.");
    }

    /** Type B용 — 단일 rate / 변수 조건부 rate / 텍스트 매핑 rate 중 첫 값을 채택. */
    @SuppressWarnings("unchecked")
    private BigDecimal resolveRate(Map<String, Object> p, FormulaContext ctx) {
        if (p.containsKey("rate")) return bd(p, "rate");
        if (p.get("rateBands") instanceof List<?> list) {
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> raw)) continue;
                Map<String, Object> band = (Map<String, Object>) raw;
                if (Boolean.TRUE.equals(band.get("default"))) return bd(band, "rate");
                String var = str(band, "ifVar");
                String op = str(band, "op");
                BigDecimal value = bd(band, "value");
                BigDecimal actual = ctx.num(var);
                if (test(op, actual, value)) return bd(band, "rate");
            }
            throw new IllegalStateException(
                    "rateBands 에서 조건을 만족하는 rate 를 찾을 수 없습니다.");
        }
        if (p.get("rateMap") instanceof Map<?, ?> map) {
            Map<String, Object> rm = (Map<String, Object>) map;
            String key = ctx.text(str(rm, "key"));
            Map<String, Object> values = (Map<String, Object>) rm.get("values");
            if (values != null && values.containsKey(key)) {
                return bdValue(values.get(key));
            }
            throw new IllegalStateException(
                    "rateMap 에서 키 '" + key + "' 를 찾을 수 없습니다.");
        }
        throw new IllegalStateException(
                "Type B 룰에 rate, rateBands, rateMap 중 하나가 필요합니다.");
    }

    private static boolean test(String op, BigDecimal v, BigDecimal t) {
        if (op == null) return true;
        int cmp = v.compareTo(t);
        return switch (op) {
            case "lt" -> cmp < 0;
            case "lte" -> cmp <= 0;
            case "gt" -> cmp > 0;
            case "gte" -> cmp >= 0;
            case "eq" -> cmp == 0;
            case "ne" -> cmp != 0;
            default -> false;
        };
    }

    private static Map<String, Object> params(TaxRule rule) {
        Map<String, Object> p = rule.params();
        if (p == null) throw new IllegalStateException("룰 params 누락: " + rule.ruleId());
        return p;
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? "" : v.toString();
    }

    private static BigDecimal bd(Map<String, Object> m, String k) {
        return bdValue(m.get(k));
    }

    private static BigDecimal bdValue(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        try {
            return new BigDecimal(v.toString().replace(",", "").trim());
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    /** 정수 원화 포맷 (콤마 + 원). 음수도 안전. */
    private static String won(BigDecimal v) {
        BigDecimal rounded = v.setScale(0, RoundingMode.HALF_UP);
        return String.format("%,d원", rounded.toBigInteger());
    }

    /** 비율 표시 — trailing zero 제거 후 plain 표기 (0.17 / 0.4125 등). */
    private static String rateStr(BigDecimal v) {
        BigDecimal stripped = v.stripTrailingZeros();
        if (stripped.scale() <= 0) {
            return stripped.toPlainString();
        }
        return stripped.toPlainString();
    }
}
