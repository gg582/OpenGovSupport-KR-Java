package com.opengov.support.welfare;

import com.opengov.support.domain.Standards;
import com.opengov.support.primitive.StatutoryPrimitive;
import com.opengov.support.primitive.StatutoryResult;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

/**
 * Primitive 6 — 소득인정액 산출 엔진.
 * 「국민기초생활 보장법」제2조 제8호·제9호 + 「국민기초생활보장사업안내」(보건복지부 고시).
 *
 * <pre>
 * income_eval =
 *     salary + business_income + financial_income + rental_income + transfer_income
 *
 * property_eval =
 *     (general_property − basic_property_deduction) × property_conversion_rate
 *   + (financial_assets − financial_deduction)      × financial_conversion_rate
 *   + (vehicle_assets)                              × vehicle_conversion_rate
 *   − debt
 *
 * recognized_income = income_eval + property_eval
 * </pre>
 *
 * <p>모든 산술은 {@link BigDecimal}. 부동소수점 사용 금지. 결과는 1원 단위 반올림.
 *
 * <p>{@link Region} 으로 일반재산 기본공제·환산율을 지역별로 분기. 자동차 환산율은
 * 「사업안내」 기준 100%/월 — 생계용·장애인용 자동차 예외는 호출자에서 미리 차감해 입력.
 */
@Component
public class RecognizedIncomeEngine {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    /** 일반재산 환산율 적용 모드. 주거용·일반(주거외) 별도. */
    public enum PropertyMode {
        HOUSING(Standards.PROPERTY_CONVERSION_RATE_HOUSING, "주거용 1.04%/월"),
        GENERAL(Standards.PROPERTY_CONVERSION_RATE_GENERAL, "일반 4.17%/월");

        public final double rate;
        public final String label;

        PropertyMode(double rate, String label) {
            this.rate = rate;
            this.label = label;
        }
    }

    /** 거주 지역. 일반재산 기본공제는 「사업안내」별표 — 지역별 차등. */
    public enum Region {
        SEOUL("서울"),
        GYEONGGI("경기"),
        METRO_SEJONG_CHANGWON("광역세종창원"),
        OTHER_CITY("그외도시"),
        RURAL("농어촌");

        public final String key;

        Region(String key) { this.key = key; }

        public long basicDeduction() {
            Long v = Standards.BASIC_PROPERTY_DEDUCTION.get(key);
            return v == null ? Standards.BASIC_PROPERTY_DEDUCTION_DEFAULT : v;
        }
    }

    /** 입력 변수 묶음 — 단위: 원. 음수 입력은 호출자 검증 책임. */
    public record Input(
            BigDecimal salary,
            BigDecimal businessIncome,
            BigDecimal financialIncome,
            BigDecimal rentalIncome,
            BigDecimal transferIncome,
            BigDecimal generalProperty,
            BigDecimal financialAssets,
            BigDecimal vehicleAssets,
            BigDecimal debt,
            Region region,
            PropertyMode mode) {

        public static Input zero() {
            return new Input(
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                    Region.OTHER_CITY, PropertyMode.GENERAL);
        }
    }

    public StatutoryResult evaluate(Input in) {
        // 6-1 소득평가액
        BigDecimal incomeEval =
                nz(in.salary)
                        .add(nz(in.businessIncome), MC)
                        .add(nz(in.financialIncome), MC)
                        .add(nz(in.rentalIncome), MC)
                        .add(nz(in.transferIncome), MC);

        // 6-2 재산의 소득환산
        BigDecimal basicDeduction = BigDecimal.valueOf(in.region.basicDeduction());
        BigDecimal generalNet = nz(in.generalProperty).subtract(basicDeduction, MC).max(BigDecimal.ZERO);
        BigDecimal generalConverted =
                generalNet.multiply(BigDecimal.valueOf(in.mode.rate), MC);

        BigDecimal financialDeduction = BigDecimal.valueOf(Standards.FINANCIAL_DEDUCTION);
        BigDecimal financialNet = nz(in.financialAssets).subtract(financialDeduction, MC).max(BigDecimal.ZERO);
        BigDecimal financialConverted =
                financialNet.multiply(BigDecimal.valueOf(Standards.FINANCIAL_CONVERSION_RATE), MC);

        BigDecimal vehicleConverted =
                nz(in.vehicleAssets).multiply(BigDecimal.valueOf(Standards.VEHICLE_CONVERSION_RATE), MC);

        BigDecimal propertyEval =
                generalConverted
                        .add(financialConverted, MC)
                        .add(vehicleConverted, MC)
                        .subtract(nz(in.debt), MC)
                        .max(BigDecimal.ZERO);

        // 6-3 소득인정액
        BigDecimal recognized = incomeEval.add(propertyEval, MC).setScale(0, RoundingMode.HALF_UP);

        String formula =
                "recognized_income = (salary + business_income + financial_income + rental_income + transfer_income) "
                        + "+ max((general_property − basic_property_deduction) × pcr "
                        + "+ (financial_assets − financial_deduction) × fcr "
                        + "+ vehicle_assets × vcr − debt, 0)";

        return StatutoryResult.builder(StatutoryPrimitive.RECOGNIZED_INCOME)
                .formula(formula)
                .legalBasis("「국민기초생활 보장법」제2조 제8호·제9호 + 「국민기초생활보장사업안내」(보건복지부 고시) 별표")
                .var("salary", nz(in.salary))
                .var("business_income", nz(in.businessIncome))
                .var("financial_income", nz(in.financialIncome))
                .var("rental_income", nz(in.rentalIncome))
                .var("transfer_income", nz(in.transferIncome))
                .var("general_property", nz(in.generalProperty))
                .var("financial_assets", nz(in.financialAssets))
                .var("vehicle_assets", nz(in.vehicleAssets))
                .var("debt", nz(in.debt))
                .var("region", in.region.key)
                .var("basic_property_deduction", basicDeduction)
                .var("financial_deduction", financialDeduction)
                .var("property_conversion_rate", BigDecimal.valueOf(in.mode.rate))
                .var("financial_conversion_rate", BigDecimal.valueOf(Standards.FINANCIAL_CONVERSION_RATE))
                .var("vehicle_conversion_rate", BigDecimal.valueOf(Standards.VEHICLE_CONVERSION_RATE))
                .mid("incomeEval", incomeEval.setScale(0, RoundingMode.HALF_UP))
                .mid("generalConverted", generalConverted.setScale(0, RoundingMode.HALF_UP))
                .mid("financialConverted", financialConverted.setScale(0, RoundingMode.HALF_UP))
                .mid("vehicleConverted", vehicleConverted.setScale(0, RoundingMode.HALF_UP))
                .mid("propertyEval", propertyEval.setScale(0, RoundingMode.HALF_UP))
                .mid("propertyMode", in.mode.label)
                .output(recognized)
                .qualified("산식 평가 — 자격 분기는 후행 primitive (MEDIAN_INCOME_RATIO) 에서 수행")
                .build();
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }
}
