package com.opengov.support.welfare;

import com.opengov.support.domain.Standards;
import com.opengov.support.primitive.StatutoryPrimitive;
import com.opengov.support.primitive.StatutoryResult;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Primitive 7 — 중위소득 비율 산출 + 급여 자격 분기.
 *
 * <pre>
 * ratio = (recognized_income / median_income_for_household_size) × 100
 *
 * if ratio ≤ 32 → 생계급여
 * if ratio ≤ 40 → 의료급여
 * if ratio ≤ 48 → 주거급여
 * if ratio ≤ 50 → 교육급여
 * </pre>
 *
 * <p>「국민기초생활 보장법」제8조의2 및 시행령. 비율 표는 {@link Standards#WELFARE_TIER_RATIO}.
 *
 * <p>Recognized income 은 월(月) 단위로 입력되어야 하며 — {@link RecognizedIncomeEngine}
 * 의 결과가 월 환산 (재산의 소득환산율 자체가 월 단위) 이므로 그대로 통과시키면 된다.
 */
@Component
public class MedianIncomeRatioEngine {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);
    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100");

    public record Input(int year, int householdSize, BigDecimal recognizedIncomeMonthly) {}

    public StatutoryResult evaluate(Input in) {
        int year = in.year > 0 ? in.year : Standards.currentYear();
        int hh = clampHousehold(in.householdSize);

        Map<Integer, Integer> table = Standards.MEDIAN_INCOME.get(year);
        if (table == null) {
            return StatutoryResult.builder(StatutoryPrimitive.MEDIAN_INCOME_RATIO)
                    .formula("ratio = recognized_income / median_income(household) × 100")
                    .legalBasis("「국민기초생활 보장법」제8조의2 — 보건복지부장관 고시 기준 중위소득")
                    .var("year", year)
                    .var("householdSize", hh)
                    .var("recognized_income", nz(in.recognizedIncomeMonthly))
                    .blocked("해당 연도(" + year + ") 기준 중위소득 표가 없습니다.")
                    .build();
        }
        Integer median = table.get(hh);
        if (median == null) {
            return StatutoryResult.builder(StatutoryPrimitive.MEDIAN_INCOME_RATIO)
                    .formula("ratio = recognized_income / median_income(household) × 100")
                    .legalBasis("「국민기초생활 보장법」제8조의2")
                    .var("year", year)
                    .var("householdSize", hh)
                    .blocked("가구원 수 " + hh + "에 해당하는 중위소득이 없습니다.")
                    .build();
        }

        BigDecimal recognized = nz(in.recognizedIncomeMonthly);
        BigDecimal medianBd = BigDecimal.valueOf(median);

        BigDecimal ratio = medianBd.signum() == 0
                ? BigDecimal.ZERO
                : recognized.divide(medianBd, MC).multiply(ONE_HUNDRED, MC).setScale(2, RoundingMode.HALF_UP);

        // 자격 분기 — Standards.WELFARE_TIER_RATIO 표 기반.
        Set<String> qualifiedFor = new LinkedHashSet<>();
        Map<String, Object> tierBreakdown = new LinkedHashMap<>();
        for (Map.Entry<String, Double> e : Standards.WELFARE_TIER_RATIO.entrySet()) {
            BigDecimal cutoffPct = BigDecimal.valueOf(e.getValue()).multiply(ONE_HUNDRED);
            BigDecimal cutoffWon = medianBd.multiply(BigDecimal.valueOf(e.getValue()), MC)
                    .setScale(0, RoundingMode.HALF_UP);
            boolean ok = ratio.compareTo(cutoffPct) <= 0;
            if (ok) qualifiedFor.add(e.getKey());
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("cutoffPct", cutoffPct);
            entry.put("cutoffWon", cutoffWon);
            entry.put("qualified", ok);
            tierBreakdown.put(e.getKey(), entry);
        }

        StatutoryResult.Eligibility elig = qualifiedFor.isEmpty()
                ? new StatutoryResult.Eligibility(false, List.of(),
                        List.of(String.format(
                                "비율 %s%% 이 4개 급여 상한(50%%)을 초과 — 자격 없음",
                                ratio.toPlainString())))
                : new StatutoryResult.Eligibility(true,
                        new ArrayList<>(List.of(
                                String.format("자격 급여: %s", String.join(", ", qualifiedFor)),
                                String.format("비율: %s%%", ratio.toPlainString()))),
                        List.of());

        return StatutoryResult.builder(StatutoryPrimitive.MEDIAN_INCOME_RATIO)
                .formula("ratio = (recognized_income / median_income(household_size)) × 100")
                .legalBasis(String.format(
                        "「국민기초생활 보장법」제8조의2 + %d년 보건복지부 고시 기준 중위소득", year))
                .var("year", year)
                .var("householdSize", hh)
                .var("recognized_income", recognized)
                .var("median_income", medianBd)
                .mid("ratioPct", ratio)
                .mid("tiers", tierBreakdown)
                .mid("qualifiedFor", new ArrayList<>(qualifiedFor))
                .output(ratio)
                .eligibility(elig)
                .build();
    }

    /** 가구원 수가 표의 최대치를 넘으면 가장 큰 정의된 키를 사용. */
    private int clampHousehold(int hh) {
        if (hh <= 0) return 1;
        if (hh >= 8) return 8;
        return hh;
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }
}
