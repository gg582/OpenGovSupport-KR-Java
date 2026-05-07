package com.opengov.support.welfare;

import com.opengov.support.primitive.StatutoryPrimitive;
import com.opengov.support.primitive.StatutoryResult;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Primitive 8 — 법정 상속 우선순위 트리.
 *
 * <p>「민법」 제1000조 (상속의 순위)
 * <ol>
 *   <li>1순위: 피상속인의 직계비속 (자녀·손자녀)</li>
 *   <li>2순위: 피상속인의 직계존속 (부모·조부모)</li>
 *   <li>3순위: 피상속인의 형제자매</li>
 *   <li>4순위: 피상속인의 4촌 이내의 방계혈족</li>
 * </ol>
 *
 * <p>「민법」 제1003조 — 배우자의 상속순위:
 * 1순위 또는 2순위 와 공동상속, 그들이 없으면 단독.
 *
 * <p>「민법」 제1009조 — 법정 상속분: 동순위 균분, 배우자는 직계 1.0 대비 1.5.
 *
 * <p>「민법」 제1001조 — 대습상속(substitute): 상속개시 전 사망·결격 시 그 직계비속이 대신.
 *
 * <p>「민법」 제1112조 — 유류분(reserved share):
 * 직계비속·배우자 → 법정상속분의 1/2,
 * 직계존속·형제자매 → 법정상속분의 1/3.
 *
 * <p>이 엔진은 트리 구조의 결정적 해소 — 수치 산식 아님. 결과는 후순위 0 처리 + 분배.
 */
@Component
public class LegalPriorityTreeEngine {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);
    private static final BigDecimal SPOUSE_WEIGHT = new BigDecimal("1.5");
    private static final BigDecimal BLOOD_WEIGHT  = BigDecimal.ONE;
    private static final BigDecimal RESERVED_DESCENDANT_SPOUSE = new BigDecimal("0.5");  // 1/2
    private static final BigDecimal RESERVED_ASCENDANT_SIBLING = new BigDecimal("1").divide(new BigDecimal("3"), MC); // 1/3

    /** 피상속인을 둘러싼 가족 구성. {@code substitute}=대습 발생 (1순위 사망 → 그 자녀 대체). */
    public record Input(
            BigDecimal totalEstate,
            int spouseCount,
            int childCount,
            int parentCount,
            int siblingCount,
            int fourthDegreeCount,
            boolean substitute,
            int substituteCount) {}

    public StatutoryResult evaluate(Input in) {
        BigDecimal total = nz(in.totalEstate);
        int spouse = nn(in.spouseCount);

        // 「민법」 제1000조 우선순위 결정.
        Tier tier = resolveTier(in);

        Map<String, Object> shares = new LinkedHashMap<>();
        Map<String, Object> reserved = new LinkedHashMap<>();
        BigDecimal heirCountWeighted = BigDecimal.ZERO;
        int activeBlood = 0;
        String tierLabel = tier.label;

        switch (tier) {
            case DESCENDANT -> {
                int n = in.substitute ? in.childCount + in.substituteCount : in.childCount;
                activeBlood = n;
                heirCountWeighted = BigDecimal.valueOf(n).multiply(BLOOD_WEIGHT)
                        .add(BigDecimal.valueOf(spouse).multiply(SPOUSE_WEIGHT));
            }
            case ASCENDANT -> {
                activeBlood = in.parentCount;
                heirCountWeighted = BigDecimal.valueOf(in.parentCount).multiply(BLOOD_WEIGHT)
                        .add(BigDecimal.valueOf(spouse).multiply(SPOUSE_WEIGHT));
            }
            case SIBLING -> {
                // 「민법」 제1003조 ② — 배우자가 형제자매와 공동상속 하지 않음. 배우자 단독.
                if (spouse > 0) {
                    BigDecimal perSpouse = total.divide(BigDecimal.valueOf(spouse), MC);
                    shares.put("배우자", Map.of(
                            "count", spouse,
                            "perPerson", round(perSpouse),
                            "total", round(perSpouse.multiply(BigDecimal.valueOf(spouse), MC))));
                    return finalize(StatutoryPrimitive.LEGAL_PRIORITY_TREE, in, "배우자 단독 상속",
                            shares, reserved, total, "배우자가 있어 형제자매(3순위)는 상속 불가");
                }
                activeBlood = in.siblingCount;
                heirCountWeighted = BigDecimal.valueOf(in.siblingCount).multiply(BLOOD_WEIGHT);
            }
            case FOURTH_DEGREE -> {
                if (spouse > 0) {
                    BigDecimal perSpouse = total.divide(BigDecimal.valueOf(spouse), MC);
                    shares.put("배우자", Map.of(
                            "count", spouse,
                            "perPerson", round(perSpouse),
                            "total", round(perSpouse.multiply(BigDecimal.valueOf(spouse), MC))));
                    return finalize(StatutoryPrimitive.LEGAL_PRIORITY_TREE, in, "배우자 단독 상속",
                            shares, reserved, total, "배우자가 있어 4촌 방계(4순위)는 상속 불가");
                }
                activeBlood = in.fourthDegreeCount;
                heirCountWeighted = BigDecimal.valueOf(in.fourthDegreeCount).multiply(BLOOD_WEIGHT);
            }
            case SPOUSE_ONLY -> {
                if (spouse > 0) {
                    BigDecimal perSpouse = total.divide(BigDecimal.valueOf(spouse), MC);
                    shares.put("배우자", Map.of(
                            "count", spouse,
                            "perPerson", round(perSpouse),
                            "total", round(perSpouse.multiply(BigDecimal.valueOf(spouse), MC))));
                    reserved.put("배우자", round(perSpouse.multiply(RESERVED_DESCENDANT_SPOUSE, MC)));
                }
                return finalize(StatutoryPrimitive.LEGAL_PRIORITY_TREE, in, "배우자 단독 상속",
                        shares, reserved, total, "1~4순위 혈족 부재");
            }
            case NONE -> {
                return StatutoryResult.builder(StatutoryPrimitive.LEGAL_PRIORITY_TREE)
                        .formula("priority(1순위 직계비속 → 2순위 직계존속 → 3순위 형제자매 → 4순위 4촌 방계)")
                        .legalBasis("「민법」 제1000조")
                        .var("totalEstate", total)
                        .var("spouseCount", spouse)
                        .var("childCount", in.childCount)
                        .var("parentCount", in.parentCount)
                        .var("siblingCount", in.siblingCount)
                        .var("fourthDegreeCount", in.fourthDegreeCount)
                        .blocked("법정 상속인이 없음 — 상속재산은 「민법」제1058조에 따라 국가에 귀속")
                        .build();
            }
        }

        if (heirCountWeighted.signum() <= 0) {
            return StatutoryResult.builder(StatutoryPrimitive.LEGAL_PRIORITY_TREE)
                    .formula("share = total / Σweight")
                    .legalBasis("「민법」 제1009조")
                    .blocked("상속분 산정 불가 — 분모 0")
                    .build();
        }

        BigDecimal unit = total.divide(heirCountWeighted, MC);
        BigDecimal perBlood = unit.multiply(BLOOD_WEIGHT, MC);
        BigDecimal perSpouse = unit.multiply(SPOUSE_WEIGHT, MC);

        if (spouse > 0) {
            shares.put("배우자", Map.of(
                    "count", spouse,
                    "perPerson", round(perSpouse),
                    "total", round(perSpouse.multiply(BigDecimal.valueOf(spouse), MC))));
            // 유류분 — 배우자는 법정의 1/2.
            reserved.put("배우자", round(perSpouse.multiply(RESERVED_DESCENDANT_SPOUSE, MC)));
        }

        BigDecimal reservedRate = (tier == Tier.DESCENDANT)
                ? RESERVED_DESCENDANT_SPOUSE
                : RESERVED_ASCENDANT_SIBLING;

        switch (tier) {
            case DESCENDANT -> {
                if (in.substitute) {
                    int direct = in.childCount;
                    int subs = in.substituteCount;
                    if (direct > 0) {
                        shares.put("자녀(직접)", Map.of(
                                "count", direct,
                                "perPerson", round(perBlood),
                                "total", round(perBlood.multiply(BigDecimal.valueOf(direct), MC))));
                        reserved.put("자녀(직접)", round(perBlood.multiply(reservedRate, MC)));
                    }
                    if (subs > 0) {
                        shares.put("대습상속인", Map.of(
                                "count", subs,
                                "perPerson", round(perBlood),
                                "total", round(perBlood.multiply(BigDecimal.valueOf(subs), MC)),
                                "근거", "「민법」 제1001조"));
                        reserved.put("대습상속인", round(perBlood.multiply(reservedRate, MC)));
                    }
                } else {
                    shares.put("자녀", Map.of(
                            "count", activeBlood,
                            "perPerson", round(perBlood),
                            "total", round(perBlood.multiply(BigDecimal.valueOf(activeBlood), MC))));
                    reserved.put("자녀", round(perBlood.multiply(reservedRate, MC)));
                }
            }
            case ASCENDANT -> {
                shares.put("부모", Map.of(
                        "count", activeBlood,
                        "perPerson", round(perBlood),
                        "total", round(perBlood.multiply(BigDecimal.valueOf(activeBlood), MC))));
                reserved.put("부모", round(perBlood.multiply(reservedRate, MC)));
            }
            case SIBLING -> {
                shares.put("형제자매", Map.of(
                        "count", activeBlood,
                        "perPerson", round(perBlood),
                        "total", round(perBlood.multiply(BigDecimal.valueOf(activeBlood), MC))));
                reserved.put("형제자매", round(perBlood.multiply(reservedRate, MC)));
            }
            case FOURTH_DEGREE -> {
                shares.put("4촌 방계혈족", Map.of(
                        "count", activeBlood,
                        "perPerson", round(perBlood),
                        "total", round(perBlood.multiply(BigDecimal.valueOf(activeBlood), MC)),
                        "유류분", "없음 — 「민법」 제1112조 4촌은 유류분권자 아님"));
            }
            default -> { /* unreachable */ }
        }

        return finalize(StatutoryPrimitive.LEGAL_PRIORITY_TREE, in, tierLabel,
                shares, reserved, total, reasonOf(tier));
    }

    private StatutoryResult finalize(StatutoryPrimitive p, Input in, String tierLabel,
                                     Map<String, Object> shares, Map<String, Object> reserved,
                                     BigDecimal total, String reason) {
        BigDecimal allocated = shares.values().stream()
                .filter(v -> v instanceof Map<?, ?>)
                .map(v -> (Map<?, ?>) v)
                .map(m -> {
                    Object t = m.get("total");
                    return t instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
                })
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        return StatutoryResult.builder(p)
                .formula("priority(1→2→3→4) ∧ 배우자 공동(1·2순위만) ∧ 동순위 균분 ∧ 배우자=직계×1.5")
                .legalBasis("「민법」 제1000조 (순위) · 제1001조 (대습) · 제1003조 (배우자) · 제1009조 (분) · 제1112조 (유류분)")
                .var("totalEstate", total)
                .var("spouseCount", in.spouseCount)
                .var("childCount", in.childCount)
                .var("parentCount", in.parentCount)
                .var("siblingCount", in.siblingCount)
                .var("fourthDegreeCount", in.fourthDegreeCount)
                .var("substitute", in.substitute)
                .var("substituteCount", in.substituteCount)
                .mid("appliedTier", tierLabel)
                .mid("shares", shares)
                .mid("reservedShare", reserved)
                .mid("allocatedTotal", allocated)
                .output(shares)
                .qualified(reason)
                .build();
    }

    private Tier resolveTier(Input in) {
        boolean hasDescendant = in.childCount > 0 || (in.substitute && in.substituteCount > 0);
        if (hasDescendant) return Tier.DESCENDANT;
        if (in.parentCount > 0) return Tier.ASCENDANT;
        if (in.siblingCount > 0) return Tier.SIBLING;
        if (in.fourthDegreeCount > 0) return Tier.FOURTH_DEGREE;
        if (in.spouseCount > 0) return Tier.SPOUSE_ONLY;
        return Tier.NONE;
    }

    private static String reasonOf(Tier t) {
        return switch (t) {
            case DESCENDANT -> "1순위 직계비속 적용 — 「민법」 제1000조 제1항 제1호";
            case ASCENDANT -> "1순위 부재 → 2순위 직계존속 적용 — 「민법」 제1000조 제1항 제2호";
            case SIBLING -> "1·2순위 부재 → 3순위 형제자매 적용 — 「민법」 제1000조 제1항 제3호";
            case FOURTH_DEGREE -> "1·2·3순위 부재 → 4순위 4촌 방계혈족 적용 — 「민법」 제1000조 제1항 제4호";
            case SPOUSE_ONLY -> "혈족 상속인 부재 → 배우자 단독 상속 — 「민법」 제1003조";
            case NONE -> "법정 상속인 부재 — 「민법」 제1058조 (국가 귀속)";
        };
    }

    private enum Tier {
        DESCENDANT("1순위 직계비속"),
        ASCENDANT("2순위 직계존속"),
        SIBLING("3순위 형제자매"),
        FOURTH_DEGREE("4순위 4촌 이내 방계혈족"),
        SPOUSE_ONLY("배우자 단독"),
        NONE("상속인 부재");

        final String label;
        Tier(String l) { this.label = l; }
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static int nn(int v) { return Math.max(v, 0); }
    private static BigDecimal round(BigDecimal v) { return v.setScale(0, RoundingMode.HALF_UP); }
}
