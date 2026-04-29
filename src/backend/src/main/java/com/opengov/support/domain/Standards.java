package com.opengov.support.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 법령에 근거한 공개 기준값. 보건복지부 고시(중위소득·기초연금·재산공제 등)와
 * 「민법」(상속분), 국민기초생활보장법 시행령(사적이전소득 산정·이자소득 공제)
 * 의 수치를 코드에 직접 박아 둔다. 수치 근거가 변경될 경우 이 파일만 갱신한다.
 */
public final class Standards {

    private Standards() {}

    /** 표가 보유한 연도 (최신연도가 앞). */
    public static final List<Integer> SUPPORTED_YEARS = List.of(2026, 2025);

    /** MedianIncome[년도][가구원수] = 가구원수별 기준 중위소득 (월, 원). */
    public static final Map<Integer, Map<Integer, Integer>> MEDIAN_INCOME = Map.of(
            2026, Map.of(
                    1, 2_564_238, 2, 4_199_292, 3, 5_359_036, 4, 6_494_738,
                    5, 7_556_719, 6, 8_555_952, 7, 9_573_575, 8, 10_591_197),
            2025, Map.of(
                    1, 2_392_013, 2, 3_932_658, 3, 5_025_353, 4, 6_097_773,
                    5, 7_108_192, 6, 8_064_805, 7, 8_988_428, 8, 9_912_051)
    );

    /** 생계급여 선정기준 (기준 중위소득 대비 비율). */
    public static final Map<Integer, Double> LIVING_BENEFIT_RATE = Map.of(
            2026, 0.32,
            2025, 0.32
    );

    /** 사적이전소득 횟수 기준. 횟수 미만(<7)이면 50% 공제, 이상이면 15% 공제. */
    public static final int PRIVATE_INCOME_FREQ_THRESHOLD = 7;
    public static final double PRIVATE_INCOME_RATE_UNDER = 0.50;
    public static final double PRIVATE_INCOME_RATE_OVER = 0.15;

    /** 사적이전소득 적용 기준액 = (기준 중위소득 × 50%) × 가구원수 비율. */
    public static int privateIncomeMonthly(int year, int household) {
        Integer mi = nested(MEDIAN_INCOME, year, household);
        if (mi == null) return 0;
        return (int) (mi * PRIVATE_INCOME_RATE_UNDER);
    }

    /** 차상위 등 특수가구(횟수 초과) 적용 기준액. */
    public static int privateIncomeAlt(int year, int household) {
        Integer mi = nested(MEDIAN_INCOME, year, household);
        if (mi == null) return 0;
        return (int) (mi * PRIVATE_INCOME_RATE_OVER);
    }

    /** 「국민기초생활보장사업안내」기타증여재산 공제율 (월). */
    public static final Map<Integer, Double> OTHER_GIFT_RATE = Map.of(
            2026, 0.50,
            2025, 0.50
    );

    /** 맞춤형 급여 가구원수별 기준액 (생계급여 + 의료/주거/교육 통합). 단위: 원/월. */
    public static final Map<Integer, Map<Integer, Integer>> CUSTOM_BASE_AMOUNT = Map.of(
            2026, Map.of(
                    1, 1_282_119, 2, 2_099_646, 3, 2_679_518, 4, 3_247_369,
                    5, 3_778_360, 6, 4_277_976, 7, 4_786_787, 8, 5_295_599),
            2025, Map.of(
                    1, 1_196_007, 2, 1_966_329, 3, 2_512_677, 4, 3_048_887,
                    5, 3_554_096, 6, 4_032_403, 7, 4_494_214, 8, 4_956_026)
    );

    /** 기초연금 단독/부부 가구별 월 기준액. */
    public record PensionAmount(int single, int couple, int stipend, int basicDeduction) {}

    public static final Map<Integer, PensionAmount> BASIC_PENSION = Map.of(
            2026, new PensionAmount(2_470_000, 3_952_000, 349_700, 1_160_000),
            2025, new PensionAmount(2_228_000, 3_648_000, 342_510, 1_120_000)
    );

    /** 장애인연금 단독/부부 가구별 월 기준액. */
    public static final Map<Integer, PensionAmount> DISABILITY_PENSION = Map.of(
            2026, new PensionAmount(1_400_000, 2_240_000, 349_700, 950_000),
            2025, new PensionAmount(1_380_000, 2_208_000, 342_510, 920_000)
    );

    /** 별도가구 인정 기준 (지역별 일반재산 한도, 단위: 만원). */
    public static final Map<String, Integer> SEPARATE_HOUSEHOLD_LIMIT = separateHouseholdLimit();

    private static Map<String, Integer> separateHouseholdLimit() {
        LinkedHashMap<String, Integer> m = new LinkedHashMap<>();
        m.put("대도시", 35_000);
        m.put("중소도시", 25_000);
        m.put("농어촌", 22_000);
        m.put("서울", 36_400);
        m.put("경기", 29_400);
        m.put("광역세종창원", 28_400);
        m.put("그외도시", 19_500);
        return m;
    }

    /** 소득평가액 산정 시 가구별 차감 비율. */
    public record AssessmentRate(double recipient, double supporter) {}

    public static final Map<String, AssessmentRate> INCOME_ASSESSMENT_RATES = incomeAssessmentRates();

    private static Map<String, AssessmentRate> incomeAssessmentRates() {
        LinkedHashMap<String, AssessmentRate> m = new LinkedHashMap<>();
        m.put("기본", new AssessmentRate(0.40, 1.00));
        m.put("지생보 심의기준", new AssessmentRate(0.40, 1.00));
        m.put("수급자 취약계층", new AssessmentRate(0.40, 0.74));
        m.put("별도가구", new AssessmentRate(0.0, 1.40));
        m.put("별도가구(장애인)", new AssessmentRate(0.0, 1.70));
        m.put("자립지원", new AssessmentRate(0.0, 1.70));
        m.put("의료자립지원", new AssessmentRate(0.40, 1.00));
        m.put("혼인한 딸", new AssessmentRate(0.0, 1.00));
        return m;
    }

    /** 재산을 소득으로 환산할 때의 비율(월). */
    public static final Map<String, Double> PROPERTY_CONVERSION_RATE = Map.of(
            "기본", 0.18,
            "지생보 심의기준", 0.60
    );

    /** 차상위 본인부담경감 가구원수별 가산 비율. */
    public static final Map<Integer, Double> CARE_REDUCTION_RATIO = Map.of(
            1, 1.2, 2, 1.3, 3, 1.4, 4, 1.5, 5, 1.6, 6, 1.7, 7, 1.8
    );

    /** 이자소득 추가공제 기준(연 한도, 원). 항목별: 맞춤형 / 기초연금 / 타법. */
    public static final Map<String, Integer> INTEREST_DEDUCTION_CAP = Map.of(
            "맞춤형", 20_000,
            "기초연금", 40_000,
            "타법", 10_000
    );

    /** 부양의무자 기본재산공제액 (지역별, 만원). 별도가구 한도와 동일. */
    public static final Map<String, Integer> SUPPORTER_BASE_DEDUCTION = SEPARATE_HOUSEHOLD_LIMIT;

    /** 임차가구 주거급여 가구원수·급지별 월 상한액 (원). HousingBenefitLimit[년도][가구원수][급지]. */
    public static final Map<Integer, Map<Integer, Map<Integer, Integer>>> HOUSING_BENEFIT_LIMIT = Map.of(
            2026, housing2026(),
            2025, housing2025()
    );

    private static Map<Integer, Map<Integer, Integer>> housing2026() {
        Map<Integer, Map<Integer, Integer>> m = new LinkedHashMap<>();
        m.put(1, Map.of(1, 369_000, 2, 300_000, 3, 247_000, 4, 212_000));
        m.put(2, Map.of(1, 414_000, 2, 335_000, 3, 275_000, 4, 238_000));
        m.put(3, Map.of(1, 492_000, 2, 401_000, 3, 327_000, 4, 283_000));
        m.put(4, Map.of(1, 571_000, 2, 463_000, 3, 381_000, 4, 329_000));
        m.put(5, Map.of(1, 591_000, 2, 479_000, 3, 394_000, 4, 340_000));
        m.put(6, Map.of(1, 699_000, 2, 568_000, 3, 463_000, 4, 402_000));
        m.put(7, Map.of(1, 768_900, 2, 624_800, 3, 509_300, 4, 442_200));
        return m;
    }

    private static Map<Integer, Map<Integer, Integer>> housing2025() {
        Map<Integer, Map<Integer, Integer>> m = new LinkedHashMap<>();
        m.put(1, Map.of(1, 352_000, 2, 281_000, 3, 228_000, 4, 191_000));
        m.put(2, Map.of(1, 395_000, 2, 314_000, 3, 254_000, 4, 215_000));
        m.put(3, Map.of(1, 470_000, 2, 375_000, 3, 302_000, 4, 256_000));
        m.put(4, Map.of(1, 545_000, 2, 433_000, 3, 351_000, 4, 297_000));
        m.put(5, Map.of(1, 564_000, 2, 448_000, 3, 363_000, 4, 307_000));
        m.put(6, Map.of(1, 667_000, 2, 531_000, 3, 428_000, 4, 363_000));
        m.put(7, Map.of(1, 733_000, 2, 584_000, 3, 470_000, 4, 399_000));
        return m;
    }

    /** 「민법」제1009조에 따른 상속분. */
    public record InheritanceShare(
            double spouseShare,
            double childPer,
            double childTotal,
            double parentPer,
            double parentTotal) {}

    /** 총상속가액·구성원 수로부터 법정 상속분을 산출. 자녀가 1인 이상이면 부모는 후순위로 0. */
    public static InheritanceShare computeInheritance(
            double total, int spouseCount, int childCount, int parentCount) {
        double spouseShare = 0, childPer = 0, childTotal = 0, parentPer = 0, parentTotal = 0;
        if (childCount > 0) {
            double denom = childCount + 1.5 * spouseCount;
            if (denom > 0) {
                double unit = total / denom;
                childPer = unit;
                childTotal = unit * childCount;
                if (spouseCount > 0) spouseShare = unit * 1.5;
            }
        } else if (parentCount > 0) {
            double denom = parentCount + 1.5 * spouseCount;
            if (denom > 0) {
                double unit = total / denom;
                parentPer = unit;
                parentTotal = unit * parentCount;
                if (spouseCount > 0) spouseShare = unit * 1.5;
            }
        } else if (spouseCount > 0) {
            spouseShare = total / spouseCount;
        }
        return new InheritanceShare(spouseShare, childPer, childTotal, parentPer, parentTotal);
    }

    /** 표가 가지고 있는 가장 최신 연도. */
    public static int currentYear() {
        return SUPPORTED_YEARS.get(0);
    }

    private static <K, V> V nested(Map<K, Map<Integer, V>> m, K k1, int k2) {
        Map<Integer, V> sub = m.get(k1);
        return sub == null ? null : sub.get(k2);
    }
}
