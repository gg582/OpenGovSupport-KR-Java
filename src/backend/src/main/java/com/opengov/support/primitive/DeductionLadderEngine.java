package com.opengov.support.primitive;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Primitive 2 — 공제 사다리 (piecewise-linear).
 *
 * <p>구간별 {@code base + (x − threshold) × slope} 의 누적 piecewise-linear 함수.
 * 「소득세법」제47조 근로소득공제 (5단계) 등을 표현. Type A 누진세와 달리
 * 여러 구간이 누적 가산되며 각 구간의 시작점 base 가 명시된다.
 *
 * <p>사용자 명세 그대로 — 5단계 근로소득공제:
 * <pre>
 * x ≤ 5,000,000   : x × 0.70
 * x ≤ 15,000,000  : 3,500,000 + (x − 5M) × 0.475
 * x ≤ 45,000,000  : 8,250,000 + (x − 15M) × 0.15
 * x ≤ 100,000,000 : 12,750,000 + (x − 45M) × 0.05
 * x > 100,000,000 : 15,500,000 + (x − 100M) × 0.02
 * </pre>
 *
 * <p>각 사다리는 {@link Step#threshold}(상한, 0이면 무한)·{@code base}·{@code slope}·{@code anchor} 로
 * 정규화. 호출자가 표를 제공하면 어떤 piecewise-linear 사다리도 평가 가능.
 */
@Component
public class DeductionLadderEngine {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    /** 한 구간의 정의. {@code threshold} 가 0 이하면 무한 구간 (마지막). */
    public record Step(BigDecimal threshold, BigDecimal base, BigDecimal slope, BigDecimal anchor) {}

    public record Input(String varName, BigDecimal x, List<Step> steps,
                        String legalBasis, String formulaText) {}

    /** 「소득세법」제47조 — 사용자 명세 기준 근로소득공제 사다리. */
    public static final List<Step> EARNED_INCOME_DEDUCTION_LADDER = List.of(
            new Step(bd("5000000"),  bd("0"),         bd("0.70"),  bd("0")),
            new Step(bd("15000000"), bd("3500000"),   bd("0.475"), bd("5000000")),
            new Step(bd("45000000"), bd("8250000"),   bd("0.15"),  bd("15000000")),
            new Step(bd("100000000"),bd("12750000"),  bd("0.05"),  bd("45000000")),
            new Step(bd("0"),        bd("15500000"),  bd("0.02"),  bd("100000000"))
    );

    public StatutoryResult evaluate(Input in) {
        BigDecimal x = nz(in.x);
        List<Step> steps = in.steps == null ? Collections.emptyList() : in.steps;
        if (steps.isEmpty()) {
            return StatutoryResult.builder(StatutoryPrimitive.DEDUCTION_LADDER)
                    .formula(in.formulaText == null ? "" : in.formulaText)
                    .legalBasis(in.legalBasis == null ? "" : in.legalBasis)
                    .var(in.varName, x)
                    .blocked("사다리 단계 정의 없음")
                    .build();
        }

        Step applied = steps.get(steps.size() - 1);
        for (Step s : steps) {
            if (s.threshold.signum() <= 0 || x.compareTo(s.threshold) <= 0) {
                applied = s;
                break;
            }
        }

        BigDecimal delta = x.subtract(nz(applied.anchor), MC).max(BigDecimal.ZERO);
        BigDecimal deduction = nz(applied.base)
                .add(delta.multiply(nz(applied.slope), MC), MC)
                .setScale(0, RoundingMode.HALF_UP);

        List<Map<String, Object>> ladderTrace = new ArrayList<>();
        for (Step s : steps) {
            ladderTrace.add(Map.of(
                    "threshold", s.threshold,
                    "base", s.base,
                    "slope", s.slope,
                    "anchor", s.anchor,
                    "applied", s == applied));
        }

        return StatutoryResult.builder(StatutoryPrimitive.DEDUCTION_LADDER)
                .formula(in.formulaText == null
                        ? "deduction = base_i + (x − anchor_i) × slope_i (단, x ≤ threshold_i 인 첫 i)"
                        : in.formulaText)
                .legalBasis(in.legalBasis == null ? "" : in.legalBasis)
                .var(in.varName, x)
                .mid("appliedThreshold", applied.threshold)
                .mid("appliedBase", applied.base)
                .mid("appliedSlope", applied.slope)
                .mid("appliedAnchor", applied.anchor)
                .mid("ladder", ladderTrace)
                .mid("evaluation",
                        String.format("%s + (%s − %s) × %s = %s",
                                won(applied.base), won(x), won(applied.anchor),
                                applied.slope.toPlainString(), won(deduction)))
                .output(deduction)
                .qualified("산식 평가 — 자격 조건 별도 분기 없음")
                .build();
    }

    /** 명세서 사다리로 즉시 평가 (편의 메서드). */
    public StatutoryResult earnedIncomeDeduction(BigDecimal grossSalary) {
        return evaluate(new Input(
                "salary",
                grossSalary,
                EARNED_INCOME_DEDUCTION_LADDER,
                "「소득세법」제47조 — 근로소득공제 (5단계 piecewise-linear)",
                "deduction = base_i + (salary − anchor_i) × slope_i"));
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    private static String won(BigDecimal v) {
        BigDecimal r = v.setScale(0, RoundingMode.HALF_UP);
        return String.format("%,d원", r.toBigInteger());
    }
}
