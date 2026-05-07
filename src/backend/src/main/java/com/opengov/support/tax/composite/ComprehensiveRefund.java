package com.opengov.support.tax.composite;

import com.opengov.support.tax.TaxCalculation;
import com.opengov.support.web.Result;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 종합소득세 환급/추징 시뮬레이터 (합성).
 *
 * <p>과세표준 → 산출세액(Type A) → 환급/추징 = 기납부세액 − 산출세액.
 * 모든 산술 {@link BigDecimal} 임의정밀.
 */
@Component
public class ComprehensiveRefund {

    private final TaxCalculation calc;

    public ComprehensiveRefund(TaxCalculation calc) {
        this.calc = calc;
    }

    public Result run(int year, Map<String, Object> input) {
        BigDecimal taxableIncome = num(input, "taxableIncome");
        BigDecimal prepaidTax = num(input, "prepaidTax");

        Result base = calc.run(year, "comprehensive-income-tax",
                Map.of("taxableIncome", taxableIncome));
        Object amount = base.data() == null ? null : base.data().get("amount");
        BigDecimal tax = amount instanceof BigDecimal bd ? bd
                : amount instanceof Number n ? new BigDecimal(n.toString())
                : BigDecimal.ZERO;

        BigDecimal refundOrDue = prepaidTax.subtract(tax)
                .setScale(0, RoundingMode.HALF_UP);

        StringBuilder b = new StringBuilder();
        b.append("[면책] 본 산출은 법령의 공개 산식을 코드로 평가한 참고 자료이며, ")
                .append("신고·납부의 효력을 갖지 않습니다. 실제 신고는 홈택스(국세청) 또는 ")
                .append("세무전문가를 통해 확정하십시오.\n");
        b.append("[근거 법령] 「소득세법」제55조 (세율) + 제76조 (확정신고 자진납부)\n");
        b.append("[항목] 종합소득세 환급/추징 시뮬레이터\n");
        b.append('\n');
        b.append("[1단계 산출세액]\n");
        b.append(String.format("  · 과세표준 %s 에 대한 산출세액 %s%n",
                won(taxableIncome), won(tax)));
        b.append("[2단계 환급/추징]\n");
        b.append(String.format("  · 기납부세액 %s − 산출세액 %s = %s%n",
                won(prepaidTax), won(tax),
                refundOrDue.signum() >= 0
                        ? "환급 예상 " + won(refundOrDue)
                        : "추가납부 예상 " + won(refundOrDue.negate())));
        b.append('\n');
        b.append("[필요서류] 종합소득세 신고서 + 기납부세액 증빙(원천징수영수증·납부확인서)\n");
        b.append("[제출 채널] 홈택스 전자신고 / 관할세무서 방문\n");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("year", year);
        data.put("taxableIncome", taxableIncome);
        data.put("calculatedTax", tax);
        data.put("prepaidTax", prepaidTax);
        data.put("refundOrDue", refundOrDue);

        return Result.of("종합소득세 환급/추징 시뮬레이터", b.toString(), data);
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
}
