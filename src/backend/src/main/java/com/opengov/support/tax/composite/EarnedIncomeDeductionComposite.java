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
 * 근로소득공제 + 선택적 세액공제 항목 composite.
 *
 * <p>근로소득공제는 필수이며, 세액공제 항목들은 <b>값이 0보다 크면 자동 활성화</b>됩니다.
 * 총급여가 입력되지 않으면(0 이하) 모든 세액공제는 0원으로 처리되며 계산 자체가 거부됩니다.
 */
@Component
public class EarnedIncomeDeductionComposite {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    private final TaxCalculation calc;

    public EarnedIncomeDeductionComposite(TaxCalculation calc) {
        this.calc = calc;
    }

    public Result run(int year, Map<String, Object> input) {
        BigDecimal salary = num(input, "grossSalary");

        if (salary.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("총급여(grossSalary)를 0보다 큰 값으로 입력해야 합니다.");
        }

        // 1) 근로소득공제
        BigDecimal earnedDeduction = TaxStandards.earnedIncomeDeduction(salary);
        BigDecimal earnedIncome = salary.subtract(earnedDeduction).max(BigDecimal.ZERO);

        // 2) 선택적 세액공제 — 값 > 0 이면 활성화
        BigDecimal medicalCredit = positive(input, "medicalExpense")
                ? amountOf(year, "medical-expense-credit",
                        Map.of("salary", salary, "medicalExpense", num(input, "medicalExpense")))
                : BigDecimal.ZERO;

        BigDecimal educationCredit = positive(input, "educationExpense")
                ? amountOf(year, "education-credit",
                        Map.of("educationExpense", num(input, "educationExpense"), "stage", "대학·대학원"))
                : BigDecimal.ZERO;

        BigDecimal rentCredit = positive(input, "rentPaid")
                ? amountOf(year, "rent-credit",
                        Map.of("salary", salary, "rentPaid", num(input, "rentPaid")))
                : BigDecimal.ZERO;

        BigDecimal pensionCredit = positive(input, "pensionContribution")
                ? amountOf(year, "pension-credit",
                        Map.of("salary", salary, "pensionContribution", num(input, "pensionContribution")))
                : BigDecimal.ZERO;

        BigDecimal donationCredit = positive(input, "donation")
                ? amountOf(year, "donation-credit",
                        Map.of("donation", num(input, "donation")))
                : BigDecimal.ZERO;

        BigDecimal childCredit = positive(input, "childCount")
                ? amountOf(year, "child-credit",
                        Map.of("childCount", num(input, "childCount")))
                : BigDecimal.ZERO;

        BigDecimal sportsCredit = positive(input, "sportsExpense")
                ? amountOf(year, "sports-credit",
                        Map.of("sportsExpense", num(input, "sportsExpense")))
                : BigDecimal.ZERO;

        // 결혼 세액공제 — 혼인해당 + 이전수령 아님
        BigDecimal marriageCredit = BigDecimal.ZERO;
        String isMarried = text(input, "isMarriedInPeriod");
        String claimedBefore = text(input, "claimedBefore");
        String spouseClaim = text(input, "spouseClaim");
        if ("해당".equals(isMarried) && !"예".equals(claimedBefore)) {
            BigDecimal rate = new BigDecimal("500000");
            marriageCredit = marriageCredit.add(rate);
            if ("배우자도".equals(spouseClaim)) {
                marriageCredit = marriageCredit.add(rate);
            }
        }

        BigDecimal totalCredits = medicalCredit.add(educationCredit).add(rentCredit)
                .add(pensionCredit).add(donationCredit).add(childCredit)
                .add(marriageCredit).add(sportsCredit);

        // 3) 텍스트 합성
        StringBuilder b = new StringBuilder();
        b.append("[면책] 본 산출은 법령의 공개 산식을 코드로 평가한 참고 자료이며, ")
                .append("신고·납부의 효력을 갖지 않습니다.\n");
        b.append("[근거 법령] 「소득세법」제47조(근로소득공제) · 제59조의2~4(세액공제)\n");
        b.append("\n");
        b.append("[근로소득공제]\n");
        b.append(String.format("  · 총급여 %s − 근로소득공제 %s = 근로소득금액 %s%n",
                won(salary), won(earnedDeduction), won(earnedIncome)));
        b.append("[세액공제 항목] (값을 입력한 항목만 활성화)\n");
        b.append(String.format("  · 의료비 %s | 교육비 %s | 월세 %s | 연금 %s | 기부금 %s%n",
                won(medicalCredit), won(educationCredit), won(rentCredit),
                won(pensionCredit), won(donationCredit)));
        b.append(String.format("  · 자녀 %s | 결혼 %s | 체육시설 %s%n",
                won(childCredit), won(marriageCredit), won(sportsCredit)));
        b.append(String.format("  · 세액공제 합계 %s%n", won(totalCredits)));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("year", year);
        data.put("grossSalary", salary);
        data.put("earnedDeduction", earnedDeduction);
        data.put("earnedIncome", earnedIncome);
        data.put("medicalCredit", medicalCredit);
        data.put("educationCredit", educationCredit);
        data.put("rentCredit", rentCredit);
        data.put("pensionCredit", pensionCredit);
        data.put("donationCredit", donationCredit);
        data.put("childCredit", childCredit);
        data.put("marriageCredit", marriageCredit);
        data.put("sportsCredit", sportsCredit);
        data.put("totalCredits", totalCredits);

        return Result.of("근로소득공제 및 선택적 세액공제", b.toString(), data);
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

    private static String text(Map<String, Object> m, String k) {
        Object v = m == null ? null : m.get(k);
        return v == null ? "" : v.toString();
    }

    /** 값이 0보다 큰지 확인 — 세액공제 활성화 기준. */
    private static boolean positive(Map<String, Object> m, String k) {
        return num(m, k).compareTo(BigDecimal.ZERO) > 0;
    }

    private static String won(BigDecimal v) {
        BigDecimal rounded = v.setScale(0, RoundingMode.HALF_UP);
        return String.format("%,d원", rounded.toBigInteger());
    }
}
