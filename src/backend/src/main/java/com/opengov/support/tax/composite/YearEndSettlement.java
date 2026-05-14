package com.opengov.support.tax.composite;

import com.opengov.support.tax.TaxCalculation;
import com.opengov.support.tax.TaxStandards;
import com.opengov.support.web.Result;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 연말정산 통합 시뮬레이터 (합성 시나리오).
 *
 * <p>흐름: 근로소득공제 → 종합소득공제(인적+보험료) → 과세표준 → 산출세액
 * → 특별세액공제 합계 vs 표준세액공제 비교 → 자녀세액공제 → 결정세액
 * → 기납부세액 차감 → 환급/추징.
 *
 * <p>각 단계는 기존 룰을 호출(자격 미충족 시 0원 처리)하여 합성하므로
 * 룰엔진과 분리된 상수 산식이 없다. 모든 산술은 {@link BigDecimal} 임의정밀.
 *
 * <p>주의: 본 시뮬레이터는 핵심 흐름만 포함 — 표준세액공제(13만원) 비교 + 자녀공제만 별도 처리.
 * 근로소득세액공제·정치자금공제·신용카드공제 등 부수 항목은 포함하지 않으며,
 * 실제 결정세액과 차이가 있을 수 있다.
 */
@Component
public class YearEndSettlement {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);
    private static final BigDecimal PERSONAL_DEDUCTION_PER_HEAD = new BigDecimal("1500000");

    private final TaxCalculation calc;

    public YearEndSettlement(TaxCalculation calc) {
        this.calc = calc;
    }

    public Result run(int year, Map<String, Object> input) {
        BigDecimal salary       = num(input, "grossSalary");
        BigDecimal dependents   = num(input, "dependentCount");
        BigDecimal children     = num(input, "childCount");
        BigDecimal insurance    = num(input, "insurancePremium");
        BigDecimal medical      = num(input, "medicalExpense");
        BigDecimal education    = num(input, "educationExpense");
        BigDecimal rent         = num(input, "rentPaid");
        BigDecimal pension      = num(input, "pensionContribution");
        BigDecimal donation     = num(input, "donation");
        BigDecimal prepaidTax   = num(input, "prepaidTax");
        String isMarried        = text(input, "isMarriedInPeriod");
        String claimedBefore    = text(input, "claimedBefore");
        String spouseClaim      = text(input, "spouseClaim");

        // 1) 근로소득공제 → 근로소득금액
        BigDecimal earnedDeduction = TaxStandards.earnedIncomeDeduction(salary);
        BigDecimal earnedIncome = salary.subtract(earnedDeduction).max(BigDecimal.ZERO);

        // 2) 종합소득공제 = 인적공제(150만원/인) + 보험료
        BigDecimal headcount = dependents.max(BigDecimal.ONE);
        BigDecimal personalDeduction = PERSONAL_DEDUCTION_PER_HEAD.multiply(headcount, MC);
        BigDecimal comprehensiveDeduction = personalDeduction.add(insurance);
        BigDecimal taxableIncome = earnedIncome.subtract(comprehensiveDeduction).max(BigDecimal.ZERO);

        // 3) 산출세액 (Type A 누진세)
        BigDecimal tax = amountOf(year, "comprehensive-income-tax",
                Map.of("taxableIncome", taxableIncome));

        // 4) 특별세액공제 합계 vs 표준세액공제(13만원) 비교
        BigDecimal medicalCredit = amountOf(year, "medical-expense-credit",
                Map.of("salary", salary, "medicalExpense", medical));
        BigDecimal educationCredit = amountOf(year, "education-credit",
                Map.of("educationExpense", education, "stage", "대학·대학원"));
        BigDecimal rentCredit = amountOf(year, "rent-credit",
                Map.of("salary", salary, "rentPaid", rent));
        BigDecimal pensionCredit = amountOf(year, "pension-credit",
                Map.of("salary", salary, "pensionContribution", pension));
        BigDecimal donationCredit = amountOf(year, "donation-credit",
                Map.of("donation", donation));

        BigDecimal specialCreditsSum = medicalCredit
                .add(educationCredit).add(rentCredit).add(pensionCredit).add(donationCredit);
        BigDecimal standardCredit = BigDecimal.valueOf(TaxStandards.STANDARD_TAX_CREDIT);
        boolean useStandard = specialCreditsSum.compareTo(standardCredit) < 0;
        BigDecimal effectiveCredits = useStandard ? standardCredit : specialCreditsSum;

        // 5) 자녀세액공제 (별도)
        BigDecimal childCredit = amountOf(year, "child-credit",
                Map.of("childCount", children));

        // 5.5) 결혼 세액공제 — 「소득세법」제59조의4 ⑩
        // 2024.1.1.~2026.12.31. 혼인신고 시 1인당 연 50만원(생애 1회).
        // 배우자도 동일 기간 혼인신고 시 추가 50만원.
        BigDecimal marriageCredit = BigDecimal.ZERO;
        if ("해당".equals(isMarried) && !"예".equals(claimedBefore)) {
            BigDecimal marriageRate = new BigDecimal("500000");
            marriageCredit = marriageCredit.add(marriageRate); // 본인 50만원
            if ("배우자도".equals(spouseClaim)) {
                marriageCredit = marriageCredit.add(marriageRate); // 배우자 추가 50만원
            }
        }

        // 6) 결정세액 + 환급/추징
        BigDecimal determinedTax = tax.subtract(effectiveCredits).subtract(childCredit).subtract(marriageCredit)
                .max(BigDecimal.ZERO)
                .setScale(0, RoundingMode.HALF_UP);
        BigDecimal refundOrDue = prepaidTax.subtract(determinedTax)
                .setScale(0, RoundingMode.HALF_UP); // +환급 / −추가납부

        // 7) 텍스트 합성
        StringBuilder b = new StringBuilder();
        b.append("[면책] 본 산출은 법령의 공개 산식을 코드로 평가한 참고 자료이며, ")
                .append("신고·납부의 효력을 갖지 않습니다. 실제 신고는 홈택스(국세청) 또는 ")
                .append("세무전문가를 통해 확정하십시오.\n");
        b.append("[근거 법령] 「소득세법」제47·55·59조의2~4 + 「조세특례제한법」제95조의2 (연말정산 합성)\n");
        b.append("[항목] 연말정산 통합 시뮬레이터\n");
        b.append("[적용 가정] 표준세액공제(13만원) vs 특별세액공제 합계 자동 비교, 자녀공제 별도 가산.\n");
        b.append('\n');
        b.append("[1단계 근로소득공제] (소득세법 §47)\n");
        b.append(String.format("  · 총급여 %s − 근로소득공제 %s = 근로소득금액 %s%n",
                won(salary), won(earnedDeduction), won(earnedIncome)));
        b.append("[2단계 종합소득공제] (소득세법 §50·51·52)\n");
        b.append(String.format("  · 인적공제 %s × %s인 = %s%n",
                won(PERSONAL_DEDUCTION_PER_HEAD), countStr(headcount), won(personalDeduction)));
        b.append(String.format("  · 보험료 등 공제 %s%n", won(insurance)));
        b.append(String.format("  · 종합소득공제 합계 %s%n", won(comprehensiveDeduction)));
        b.append("[3단계 과세표준]\n");
        b.append(String.format("  · 근로소득금액 %s − 종합소득공제 %s = 과세표준 %s%n",
                won(earnedIncome), won(comprehensiveDeduction), won(taxableIncome)));
        b.append("[4단계 산출세액] (소득세법 §55)\n");
        b.append(String.format("  · 누진세율 적용 산출세액 %s%n", won(tax)));
        b.append("[5단계 세액공제]\n");
        b.append(String.format("  · 의료비 %s, 교육비 %s, 월세 %s, 연금 %s, 기부금 %s%n",
                won(medicalCredit), won(educationCredit),
                won(rentCredit), won(pensionCredit), won(donationCredit)));
        b.append(String.format("  · 특별세액공제 합계 %s, 표준세액공제 %s%n",
                won(specialCreditsSum), won(standardCredit)));
        b.append(String.format("  · 적용: %s = %s%n",
                useStandard ? "표준세액공제" : "특별세액공제 합계", won(effectiveCredits)));
        b.append(String.format("  · 자녀세액공제 %s%n", won(childCredit)));
        b.append(String.format("  · 결혼세액공제 %s (조건: %s / 이전수령: %s / 배우자: %s)%n",
                won(marriageCredit), isMarried, claimedBefore, spouseClaim));
        b.append("[6단계 결정세액]\n");
        b.append(String.format("  · max(0, 산출세액 %s − 세액공제 %s − 자녀공제 %s − 결혼공제 %s) = %s%n",
                won(tax), won(effectiveCredits), won(childCredit), won(marriageCredit), won(determinedTax)));
        b.append("[7단계 환급/추징]\n");
        b.append(String.format("  · 기납부세액 %s − 결정세액 %s = %s%n",
                won(prepaidTax), won(determinedTax),
                refundOrDue.signum() >= 0
                        ? "환급 예상 " + won(refundOrDue)
                        : "추가납부 예상 " + won(refundOrDue.negate())));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("year", year);
        data.put("grossSalary", salary);
        data.put("earnedDeduction", earnedDeduction);
        data.put("earnedIncome", earnedIncome);
        data.put("comprehensiveDeduction", comprehensiveDeduction);
        data.put("taxableIncome", taxableIncome);
        data.put("calculatedTax", tax);
        data.put("specialCredits", Map.of(
                "medical", medicalCredit,
                "education", educationCredit,
                "rent", rentCredit,
                "pension", pensionCredit,
                "donation", donationCredit,
                "sum", specialCreditsSum));
        data.put("standardTaxCredit", standardCredit);
        data.put("effectiveCredits", effectiveCredits);
        data.put("childCredit", childCredit);
        data.put("marriageCredit", marriageCredit);
        data.put("determinedTax", determinedTax);
        data.put("prepaidTax", prepaidTax);
        data.put("refundOrDue", refundOrDue);

        return Result.of("연말정산 통합 시뮬레이터", b.toString(), data);
    }

    /** 룰 호출 → amount 추출. 자격 미충족 시 0. */
    private BigDecimal amountOf(int year, String ruleId, Map<String, Object> input) {
        try {
            Result r = calc.run(year, ruleId, input);
            Object amount = r.data() == null ? null : r.data().get("amount");
            if (amount instanceof BigDecimal bd) return bd;
            if (amount instanceof Number n) return new BigDecimal(n.toString());
            return BigDecimal.ZERO;
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    private static BigDecimal num(Map<String, Object> m, String k) {
        Object v = m == null ? null : m.get(k);
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        try {
            return new BigDecimal(v.toString().replace(",", "").trim());
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private static String won(BigDecimal v) {
        BigDecimal rounded = v.setScale(0, RoundingMode.HALF_UP);
        return String.format("%,d원", rounded.toBigInteger());
    }

    private static String text(Map<String, Object> m, String k) {
        Object v = m == null ? null : m.get(k);
        return v == null ? "" : v.toString();
    }

    private static String countStr(BigDecimal v) {
        return v.stripTrailingZeros().scale() <= 0
                ? v.toBigInteger().toString()
                : v.toPlainString();
    }
}
