package com.opengov.support.primitive;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

/**
 * Primitive 5 — 부가가치세 차분 엔진.
 *
 * <pre>
 * output_vat  = sales_supply_amount × 0.10
 * input_vat   = purchase_supply_amount × 0.10
 * payable_vat = output_vat − input_vat
 * </pre>
 *
 * <p>「부가가치세법」제30조·제37조·제38조. 음수 결과(매입세액 초과)는 환급 대상으로 보존.
 */
@Component
public class VatDeltaEngine {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);
    private static final BigDecimal RATE = new BigDecimal("0.10");

    public record Input(BigDecimal salesSupplyAmount, BigDecimal purchaseSupplyAmount) {}

    public StatutoryResult evaluate(Input in) {
        BigDecimal sales = nz(in.salesSupplyAmount);
        BigDecimal purchase = nz(in.purchaseSupplyAmount);

        BigDecimal outputVat = sales.multiply(RATE, MC).setScale(0, RoundingMode.HALF_UP);
        BigDecimal inputVat  = purchase.multiply(RATE, MC).setScale(0, RoundingMode.HALF_UP);
        BigDecimal payable   = outputVat.subtract(inputVat, MC).setScale(0, RoundingMode.HALF_UP);

        String label = payable.signum() < 0 ? "환급세액" : "납부세액";

        return StatutoryResult.builder(StatutoryPrimitive.VAT_DELTA)
                .formula("payable_vat = (sales_supply_amount × 0.10) − (purchase_supply_amount × 0.10)")
                .legalBasis("「부가가치세법」제30조 (세율) · 제37조 (납부세액) · 제38조 (공제하는 매입세액)")
                .var("sales_supply_amount", sales)
                .var("purchase_supply_amount", purchase)
                .var("rate", RATE)
                .mid("outputVat", outputVat)
                .mid("inputVat", inputVat)
                .mid("label", label)
                .mid("evaluation",
                        String.format("(%s × 10%%) − (%s × 10%%) = %s (%s)",
                                won(sales), won(purchase), won(payable.abs()), label))
                .output(payable)
                .qualified("일반과세자 산식 평가 — 간이과세자·면세사업자는 별도 룰")
                .build();
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }

    private static String won(BigDecimal v) {
        return String.format("%,d원", v.setScale(0, RoundingMode.HALF_UP).toBigInteger());
    }
}
