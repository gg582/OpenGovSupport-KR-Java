package com.opengov.support.tax;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;

/**
 * 세무 기준값. 「소득세법」·「조세특례제한법」 및 관련 시행령에 근거한 공개 수치를
 * 코드에 직접 박아 둔다. 새 연도 고시값이 나오면 이 파일 + {@code resources/tax-rules/{year}/}
 * 디렉터리를 갱신.
 */
public final class TaxStandards {

    private TaxStandards() {}

    /** 세무 룰이 보유한 연도 (최신연도가 앞). */
    public static final List<Integer> SUPPORTED_YEARS = List.of(2026, 2025, 2024, 2023);

    public static int currentYear() {
        return SUPPORTED_YEARS.get(0);
    }

    /**
     * 「소득세법」제55조 종합소득세 기본세율 (8단계 누진).
     * 정규화 형태: {@code tax = x * rate − quickDeduction}.
     * 단위: 원 / 비율은 소수.
     *
     * <p>연도별 적용:
     * <ul>
     *   <li>2021~2022년 귀속: 1,200만/4,600만/8,800만 구간 (누진공제 108만/522만/1,490만...)</li>
     *   <li>2023년 귀속 이후~: 1,400만/5,000만/8,800만 구간 (누진공제 126만/576만/1,544만...)</li>
     * </ul>
     */
    public static final List<Map<String, Object>> COMPREHENSIVE_INCOME_BRACKETS_2023_2026 = List.of(
            Map.of("max", 14_000_000L,    "rate", 0.06, "qd", 0L),
            Map.of("max", 50_000_000L,    "rate", 0.15, "qd", 1_260_000L),
            Map.of("max", 88_000_000L,    "rate", 0.24, "qd", 5_760_000L),
            Map.of("max", 150_000_000L,   "rate", 0.35, "qd", 15_440_000L),
            Map.of("max", 300_000_000L,   "rate", 0.38, "qd", 19_940_000L),
            Map.of("max", 500_000_000L,   "rate", 0.40, "qd", 25_940_000L),
            Map.of("max", 1_000_000_000L, "rate", 0.42, "qd", 35_940_000L),
            Map.of("max", 0L,             "rate", 0.45, "qd", 65_940_000L) // 10억 초과 (max=0 = 무한구간)
    );

    /** 2021~2022년 귀속 종합소득세 세율표 (구간 하한이 낮았던 시기). */
    public static final List<Map<String, Object>> COMPREHENSIVE_INCOME_BRACKETS_2021_2022 = List.of(
            Map.of("max", 12_000_000L,    "rate", 0.06, "qd", 0L),
            Map.of("max", 46_000_000L,    "rate", 0.15, "qd", 1_080_000L),
            Map.of("max", 88_000_000L,    "rate", 0.24, "qd", 5_220_000L),
            Map.of("max", 150_000_000L,   "rate", 0.35, "qd", 14_900_000L),
            Map.of("max", 300_000_000L,   "rate", 0.38, "qd", 19_400_000L),
            Map.of("max", 500_000_000L,   "rate", 0.40, "qd", 25_400_000L),
            Map.of("max", 1_000_000_000L, "rate", 0.42, "qd", 35_400_000L),
            Map.of("max", 0L,             "rate", 0.45, "qd", 65_400_000L)
    );

    /** 산술 정밀도. */
    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    private static final BigDecimal R_70 = new BigDecimal("0.70");
    private static final BigDecimal R_40 = new BigDecimal("0.40");
    private static final BigDecimal R_15 = new BigDecimal("0.15");
    private static final BigDecimal R_05 = new BigDecimal("0.05");
    private static final BigDecimal R_02 = new BigDecimal("0.02");

    private static final BigDecimal B_5M = new BigDecimal("5000000");
    private static final BigDecimal B_15M = new BigDecimal("15000000");
    private static final BigDecimal B_45M = new BigDecimal("45000000");
    private static final BigDecimal B_100M = new BigDecimal("100000000");
    private static final BigDecimal D_3_5M = new BigDecimal("3500000");
    private static final BigDecimal D_7_5M = new BigDecimal("7500000");
    private static final BigDecimal D_12M = new BigDecimal("12000000");
    private static final BigDecimal D_14_75M = new BigDecimal("14750000");

    /**
     * 「소득세법」제47조 근로소득공제 (총급여 구간별).
     * 본 시스템은 "총급여 구간 → 공제액" 산식을 그대로 코드로 평가.
     * (룰엔진에는 단일화된 Type B로 표현하기 어려우므로 컨트롤러에서 직접 계산.)
     *
     * <p>모든 산술은 {@link BigDecimal} 임의정밀로 수행하여 부동소수점 오차 없음.
     */
    public static BigDecimal earnedIncomeDeduction(BigDecimal grossSalary) {
        if (grossSalary.compareTo(B_5M) <= 0) {
            return grossSalary.multiply(R_70, MC).setScale(0, RoundingMode.HALF_UP);
        }
        if (grossSalary.compareTo(B_15M) <= 0) {
            return D_3_5M.add(grossSalary.subtract(B_5M).multiply(R_40, MC), MC)
                    .setScale(0, RoundingMode.HALF_UP);
        }
        if (grossSalary.compareTo(B_45M) <= 0) {
            return D_7_5M.add(grossSalary.subtract(B_15M).multiply(R_15, MC), MC)
                    .setScale(0, RoundingMode.HALF_UP);
        }
        if (grossSalary.compareTo(B_100M) <= 0) {
            return D_12M.add(grossSalary.subtract(B_45M).multiply(R_05, MC), MC)
                    .setScale(0, RoundingMode.HALF_UP);
        }
        return D_14_75M.add(grossSalary.subtract(B_100M).multiply(R_02, MC), MC)
                .setScale(0, RoundingMode.HALF_UP);
    }

    /** 「소득세법」제59조의4 ① 의료비 세액공제율(일반). */
    public static final double MEDICAL_CREDIT_RATE = 0.15;

    /** 의료비 공제 임계: 총급여의 3% 초과분만 공제 대상. */
    public static final double MEDICAL_THRESHOLD_RATE = 0.03;

    /** 의료비 공제 한도 (일반 의료비, 연 700만원). */
    public static final double MEDICAL_GENERAL_CAP = 7_000_000;

    /** 「조세특례제한법」제95조의2 월세 세액공제율(총급여 5,500만원 이하 17%, 그 외 15%). */
    public static final double RENT_CREDIT_RATE_HIGH = 0.17;
    public static final double RENT_CREDIT_RATE_LOW = 0.15;
    public static final double RENT_CREDIT_HIGH_RATE_SALARY_CAP = 55_000_000;
    public static final double RENT_CREDIT_CAP = 10_000_000; // 연 1,000만원

    /** 「소득세법」제59조의3 연금계좌 세액공제율(총급여 5,500만원 이하 15%, 그 외 12%). */
    public static final double PENSION_CREDIT_RATE_HIGH = 0.15;
    public static final double PENSION_CREDIT_RATE_LOW = 0.12;
    public static final double PENSION_CREDIT_HIGH_RATE_SALARY_CAP = 55_000_000;
    public static final double PENSION_CREDIT_CAP = 9_000_000; // 연금저축 600 + IRP 추가 300 = 900만원

    /** 「소득세법」제59조의4 ② 교육비 세액공제율 + 1인당 한도. */
    public static final double EDUCATION_CREDIT_RATE = 0.15;
    public static final double EDUCATION_CAP_PRESCHOOL_ELEMENTARY = 3_000_000;
    public static final double EDUCATION_CAP_HIGHER = 9_000_000;

    /** 「소득세법」제59조의4 ④ 기부금 세액공제율 (1천만원 이하 15%, 초과분 30%). */
    public static final double DONATION_CREDIT_RATE_LOW = 0.15;
    public static final double DONATION_CREDIT_RATE_HIGH = 0.30;
    public static final double DONATION_THRESHOLD = 10_000_000;

    /** 「소득세법」제59조의2 자녀 세액공제 단가 (2025년~). */
    public static final long CHILD_CREDIT_FIRST_2025 = 250_000;
    public static final long CHILD_CREDIT_SECOND_2025 = 250_000;
    public static final long CHILD_CREDIT_THIRD_PLUS_2025 = 400_000;

    /** 2024년 이전 자녀 세액공제 단가. */
    public static final long CHILD_CREDIT_FIRST_2024 = 150_000;
    public static final long CHILD_CREDIT_SECOND_2024 = 150_000;
    public static final long CHILD_CREDIT_THIRD_PLUS_2024 = 300_000;

    /** 연도별 자녀 세액공제 단가 선택. */
    public static long childCreditFirst(int year) {
        return year >= 2025 ? CHILD_CREDIT_FIRST_2025 : CHILD_CREDIT_FIRST_2024;
    }
    public static long childCreditSecond(int year) {
        return year >= 2025 ? CHILD_CREDIT_SECOND_2025 : CHILD_CREDIT_SECOND_2024;
    }
    public static long childCreditThirdPlus(int year) {
        return year >= 2025 ? CHILD_CREDIT_THIRD_PLUS_2025 : CHILD_CREDIT_THIRD_PLUS_2024;
    }

    /** 「소득세법」제59조의4 ⑨ 표준세액공제 (특별세액공제 미신청 시). */
    public static final long STANDARD_TAX_CREDIT = 130_000;

    /** 「법인세법」제55조 법인세 세율표 (2026년 이후). */
    public static final List<Map<String, Object>> CORPORATE_TAX_BRACKETS_2026 = List.of(
            Map.of("max", 200_000_000L,      "rate", 0.10, "qd", 0L),
            Map.of("max", 20_000_000_000L,   "rate", 0.20, "qd", 20_000_000L),
            Map.of("max", 300_000_000_000L,  "rate", 0.22, "qd", 420_000_000L),
            Map.of("max", 0L,                "rate", 0.25, "qd", 9_420_000_000L)
    );

    /** 「법인세법」제55조 법인세 세율표 (2023년~2025년). */
    public static final List<Map<String, Object>> CORPORATE_TAX_BRACKETS_2023_2025 = List.of(
            Map.of("max", 200_000_000L,      "rate", 0.09, "qd", 0L),
            Map.of("max", 20_000_000_000L,   "rate", 0.19, "qd", 20_000_000L),
            Map.of("max", 300_000_000_000L,  "rate", 0.21, "qd", 420_000_000L),
            Map.of("max", 0L,                "rate", 0.24, "qd", 9_420_000_000L)
    );

    /** 「법인세법」제55조 법인세 세율표 (2022년 이전). */
    public static final List<Map<String, Object>> CORPORATE_TAX_BRACKETS_2022_AND_BEFORE = List.of(
            Map.of("max", 200_000_000L,      "rate", 0.10, "qd", 0L),
            Map.of("max", 20_000_000_000L,   "rate", 0.20, "qd", 20_000_000L),
            Map.of("max", 300_000_000_000L,  "rate", 0.22, "qd", 420_000_000L),
            Map.of("max", 0L,                "rate", 0.25, "qd", 9_420_000_000L)
    );

    /** 「상속세 및 증여세법」제26조 상속세 세율표 (2026년 이후). */
    public static final List<Map<String, Object>> INHERITANCE_TAX_BRACKETS_2026 = List.of(
            Map.of("max", 200_000_000L,    "rate", 0.10, "qd", 0L),
            Map.of("max", 500_000_000L,    "rate", 0.20, "qd", 20_000_000L),
            Map.of("max", 1_000_000_000L,  "rate", 0.30, "qd", 70_000_000L),
            Map.of("max", 0L,              "rate", 0.40, "qd", 170_000_000L)
    );

    /** 「상속세 및 증여세법」제26조 상속세 세율표 (2023년~2025년). */
    public static final List<Map<String, Object>> INHERITANCE_TAX_BRACKETS_2023_2025 = List.of(
            Map.of("max", 100_000_000L,    "rate", 0.10, "qd", 0L),
            Map.of("max", 500_000_000L,    "rate", 0.20, "qd", 10_000_000L),
            Map.of("max", 1_000_000_000L,  "rate", 0.30, "qd", 60_000_000L),
            Map.of("max", 3_000_000_000L,  "rate", 0.40, "qd", 160_000_000L),
            Map.of("max", 0L,              "rate", 0.50, "qd", 460_000_000L)
    );

    /** 「상속세 및 증여세법」제56조 증여세 세율표 (2026년 이후) — 제26조 준용. */
    public static final List<Map<String, Object>> GIFT_TAX_BRACKETS_2026 = List.of(
            Map.of("max", 200_000_000L,    "rate", 0.10, "qd", 0L),
            Map.of("max", 500_000_000L,    "rate", 0.20, "qd", 20_000_000L),
            Map.of("max", 1_000_000_000L,  "rate", 0.30, "qd", 70_000_000L),
            Map.of("max", 0L,              "rate", 0.40, "qd", 170_000_000L)
    );

    /** 「상속세 및 증여세법」제56조 증여세 세율표 (2023년~2025년). */
    public static final List<Map<String, Object>> GIFT_TAX_BRACKETS_2023_2025 = List.of(
            Map.of("max", 100_000_000L,    "rate", 0.10, "qd", 0L),
            Map.of("max", 500_000_000L,    "rate", 0.20, "qd", 10_000_000L),
            Map.of("max", 1_000_000_000L,  "rate", 0.30, "qd", 60_000_000L),
            Map.of("max", 3_000_000_000L,  "rate", 0.40, "qd", 160_000_000L),
            Map.of("max", 0L,              "rate", 0.50, "qd", 460_000_000L)
    );

    /** 「소득세법」제59조의4 ⑩ 결혼 세액공제 (2024~2026년 혼인신고분). 1인당 50만원, 부부 합산 최대 100만원, 생애 1회. */
    public static final long MARRIAGE_CREDIT_PER_PERSON = 500_000;
    public static final long MARRIAGE_CREDIT_MAX = 1_000_000;

    /** 「소득세법」제59조의4 ③ 체육시설 이용료 세액공제 (2025년 귀속~). 9세 미만·초등2학년 이하 자녀 대상, 연 300만원 한도의 15%. */
    public static final long SPORTS_CREDIT_CAP = 3_000_000;
    public static final double SPORTS_CREDIT_RATE = 0.15;

    /** 「조세특례제한법」시행령 제143조 단순경비율 (대표 업종). */
    public static final Map<String, Double> SIMPLE_EXPENSE_RATE = Map.of(
            "도소매업",       0.86,
            "제조업",         0.78,
            "음식점업",       0.79,
            "서비스업(인적)", 0.61,
            "전문서비스업",   0.60,
            "건설업",         0.79
    );
}
