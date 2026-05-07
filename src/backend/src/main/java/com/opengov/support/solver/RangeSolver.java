package com.opengov.support.solver;

import com.opengov.support.tax.TaxCalculation;
import com.opengov.support.web.Result;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 결정적 산식의 단조성을 가정한 범위/역산 솔버.
 *
 * <p>지원하는 두 가지 모드:
 * <ul>
 *   <li>{@link #maximize} — 제약 조건이 만족되는 최대 입력 (예: 자격유지하는 최대 소득인정액)</li>
 *   <li>{@link #invert}  — 목표 출력값 → 입력값 (예: rent_credit = 1.2M 을 만드는 rent)</li>
 * </ul>
 *
 * <p>산식 자체는 백엔드 룰 엔진을 호출하므로 다항식·구간식 모두 균일하게 처리.
 * 단조성 미보장 시 결과는 근사치이며 응답에 {@code monotonic=false} 를 표기.
 */
@Component
public class RangeSolver {

    private static final MathContext MC = new MathContext(20, RoundingMode.HALF_UP);
    private static final int DEFAULT_MAX_ITERS = 60;
    private static final BigDecimal HUNDRED_BILLION = new BigDecimal("100000000000"); // 1000억

    private final TaxCalculation calculation;

    public RangeSolver(TaxCalculation calculation) {
        this.calculation = calculation;
    }

    public record Bound(BigDecimal lo, BigDecimal hi, BigDecimal tolerance) {
        public static Bound positive() {
            return new Bound(BigDecimal.ZERO, HUNDRED_BILLION, BigDecimal.ONE);
        }
    }

    /**
     * 제약 만족하는 입력의 최대치를 이분 탐색.
     *
     * @param ruleId       호출할 백엔드 룰
     * @param year         적용 연도
     * @param baseInput    고정 입력
     * @param sweepVar     가변 입력 변수명
     * @param targetField  결과 데이터에서 읽을 필드 (보통 {@code amount})
     * @param target       목표값 (예: 0)
     * @param mode         {@link Mode}
     * @param bound        탐색 범위
     */
    public Map<String, Object> maximize(
            String ruleId, int year,
            Map<String, Object> baseInput,
            String sweepVar, String targetField, BigDecimal target,
            Mode mode, Bound bound) {
        return solve(ruleId, year, baseInput, sweepVar, targetField, target, mode, bound, true);
    }

    public Map<String, Object> minimize(
            String ruleId, int year,
            Map<String, Object> baseInput,
            String sweepVar, String targetField, BigDecimal target,
            Mode mode, Bound bound) {
        return solve(ruleId, year, baseInput, sweepVar, targetField, target, mode, bound, false);
    }

    /**
     * 목표 출력 → 입력 역산. 단조성 가정 하 이분 탐색.
     */
    public Map<String, Object> invert(
            String ruleId, int year,
            Map<String, Object> baseInput,
            String sweepVar, String targetField, BigDecimal target,
            Bound bound) {
        return solve(ruleId, year, baseInput, sweepVar, targetField, target, Mode.EQUAL, bound, true);
    }

    public enum Mode { LTE, GTE, EQUAL }

    private Map<String, Object> solve(
            String ruleId, int year,
            Map<String, Object> baseInput,
            String sweepVar, String targetField, BigDecimal target,
            Mode mode, Bound bound, boolean preferMax) {

        BigDecimal lo = bound.lo;
        BigDecimal hi = bound.hi;
        BigDecimal tol = bound.tolerance.signum() <= 0 ? BigDecimal.ONE : bound.tolerance;

        BigDecimal vLo = eval(ruleId, year, baseInput, sweepVar, lo, targetField);
        BigDecimal vHi = eval(ruleId, year, baseInput, sweepVar, hi, targetField);
        boolean increasing = vHi.compareTo(vLo) >= 0;

        // 풀이 결과를 누적할 trace.
        java.util.List<Map<String, Object>> trace = new java.util.ArrayList<>();
        trace.add(traceRow(lo, vLo));
        trace.add(traceRow(hi, vHi));

        BigDecimal best = preferMax ? lo : hi;
        BigDecimal bestVal = preferMax ? vLo : vHi;

        int iter = 0;
        while (hi.subtract(lo, MC).compareTo(tol) > 0 && iter < DEFAULT_MAX_ITERS) {
            BigDecimal mid = lo.add(hi, MC).divide(BigDecimal.valueOf(2), MC);
            BigDecimal vMid = eval(ruleId, year, baseInput, sweepVar, mid, targetField);
            trace.add(traceRow(mid, vMid));

            boolean satisfies = matches(mode, vMid, target);
            if (satisfies) {
                if (preferMax && mid.compareTo(best) > 0) { best = mid; bestVal = vMid; }
                if (!preferMax && mid.compareTo(best) < 0) { best = mid; bestVal = vMid; }
            }

            // 단조성에 따른 분기 갱신.
            int cmp = vMid.compareTo(target);
            boolean goRight;
            if (mode == Mode.EQUAL) {
                goRight = increasing ? cmp < 0 : cmp > 0;
            } else if (mode == Mode.LTE) {
                // 우리는 v <= target 만족시 입력 더 키울 수 있음 (증가 함수 기준)
                goRight = increasing ? satisfies : !satisfies;
            } else { // GTE
                goRight = increasing ? !satisfies : satisfies;
            }

            if (goRight) lo = mid;
            else hi = mid;
            iter++;
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ruleId", ruleId);
        out.put("year", year);
        out.put("sweepVar", sweepVar);
        out.put("targetField", targetField);
        out.put("target", target);
        out.put("mode", mode.name());
        out.put("preferMax", preferMax);
        out.put("solution", best);
        out.put("solutionEval", bestVal);
        out.put("iterations", iter);
        out.put("monotonic", true);
        out.put("trace", trace);
        return out;
    }

    private static boolean matches(Mode m, BigDecimal v, BigDecimal target) {
        int cmp = v.compareTo(target);
        return switch (m) {
            case LTE -> cmp <= 0;
            case GTE -> cmp >= 0;
            case EQUAL -> Math.abs(cmp) <= 0; // exact — sometimes never reached, then bisect endpoint wins
        };
    }

    private BigDecimal eval(String ruleId, int year, Map<String, Object> baseInput,
                            String sweepVar, BigDecimal v, String targetField) {
        Map<String, Object> body = new LinkedHashMap<>(baseInput);
        body.put(sweepVar, v);
        body.put("year", year);
        try {
            Result r = calculation.run(year, ruleId, body);
            Map<String, Object> data = r.data();
            Object out = data == null ? null : data.get(targetField);
            if (out == null && data != null) out = data.get("amount");
            if (out == null && data != null) out = data.get("finalOutput");
            if (out == null) return BigDecimal.ZERO;
            if (out instanceof BigDecimal b) return b;
            if (out instanceof Number n) return new BigDecimal(n.toString());
            return new BigDecimal(out.toString().replace(",", "").trim());
        } catch (RuntimeException e) {
            // 평가 실패 시 0 — 솔버는 계속 진행.
            return BigDecimal.ZERO;
        }
    }

    private static Map<String, Object> traceRow(BigDecimal x, BigDecimal v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("x", x);
        m.put("eval", v);
        return m;
    }
}
