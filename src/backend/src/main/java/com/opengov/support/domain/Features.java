package com.opengov.support.domain;

import com.opengov.support.domain.Feature.Input;
import com.opengov.support.tax.TaxFeatures;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Feature 매니페스트 (UI 폼 자동 생성용) — 트리 구조. */
public final class Features {

    private Features() {}

    private static List<String> yearOptions() {
        return Standards.SUPPORTED_YEARS.stream().map(Object::toString).toList();
    }

    public static List<Feature> all() {
        List<Feature> all = new ArrayList<>();
        all.addAll(welfareFeatures());
        all.addAll(TaxFeatures.all());
        return List.copyOf(all);
    }

    public static List<Feature> welfareFeatures() {
        int year = Standards.currentYear();
        String yearStr = Integer.toString(year);
        String w = Feature.SECTION_WELFARE;

        return List.of(
                // ── 01 사적이전소득 ──
                Feature.group("welfare/private-income", w,
                        "01_사적이전소득", "사적이전소득",
                        "사적이전소득", "월별 입금 내역에서 사적이전소득을 산출 및 상담일지 변환.",
                        List.of(
                                Feature.leaf("private-income/calc", w,
                                        "01_사적이전소득", "사적이전소득",
                                        "계산", "월별 입금 내역에서 사적이전소득을 산출합니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("household", "가구원 수", "number")
                                                        .defaultValue("1").help("법정 기준 중위소득 50% / 15% 표를 자동 적용합니다.").build(),
                                                Input.of("altLabel", "특수 가구 라벨", "select")
                                                        .options(List.of("차상위", "기초생활", "기초연금", "장애인연금", "맞춤형", "일반", "그외"))
                                                        .defaultValue("차상위").help("B열 가구구분이 이 라벨과 같으면 횟수초과(15%) 기준 적용.").build(),
                                                Input.of("rows", "입력 데이터", "rows")
                                                        .columns(List.of(
                                                                Input.of("household", "B 가구구분", "select")
                                                                        .options(List.of("차상위", "기초생활", "기초연금", "장애인연금", "맞춤형", "일반", "그외"))
                                                                        .defaultValue("차상위").build(),
                                                                Input.of("month", "C 입금월", "text").defaultValue("2026-01").build(),
                                                                Input.of("depositor", "D 입금자", "text").defaultValue("김모씨").build(),
                                                                Input.of("amount", "E 입금액", "number").defaultValue("500000").build(),
                                                                Input.of("exclude", "F 제외액", "number").defaultValue("0").build()
                                                        )).build()
                                        )),
                                Feature.leaf("private-income/record", w,
                                        "01_사적이전소득", "사적이전소득",
                                        "상담기록 텍스트", "계산 결과를 상담일지용 텍스트로 변환합니다.",
                                        List.of(
                                                Input.of("rows", "계산 결과 행", "rows")
                                                        .columns(List.of(
                                                                Input.of("household", "가구구분", "text").build(),
                                                                Input.of("month", "입금월", "text").build(),
                                                                Input.of("depositor", "입금자", "text").build(),
                                                                Input.of("amount", "입금액", "number").build(),
                                                                Input.of("income", "사적이전소득", "number").build()
                                                        )).build()
                                        ))
                        )),

                // ── 02 이자소득 ──
                Feature.group("welfare/interest-income", w,
                        "02_이자소득", "이자소득",
                        "이자소득", "계좌별 이자소득 누적 차감 및 상담일지 변환.",
                        List.of(
                                Feature.leaf("interest-income/calc", w,
                                        "02_이자소득", "이자소득",
                                        "계산", "계좌별 이자소득의 누적 차감 후 잔액을 계산합니다.",
                                        List.of(
                                                Input.of("category", "급여 항목", "select")
                                                        .options(List.of("맞춤형", "기초연금", "타법"))
                                                        .defaultValue("맞춤형")
                                                        .help("선택 시 연 한도(맞춤형 20,000 / 기초연금 40,000 / 타법 10,000원)를 자동 적용.").build(),
                                                Input.of("deductionCap", "월별 차감 한도 (수동 보정)", "number")
                                                        .defaultValue("0").help("0이면 위 항목별 법정 한도를 사용합니다.").build(),
                                                Input.of("rows", "이자 입력", "rows")
                                                        .columns(List.of(
                                                                Input.of("account", "계좌", "text").build(),
                                                                Input.of("startMonth", "시작월(YYYY-MM)", "text").build(),
                                                                Input.of("endMonth", "종료월(YYYY-MM)", "text").build(),
                                                                Input.of("amount", "이자 금액", "number").build()
                                                        )).build()
                                        )),
                                Feature.leaf("interest-income/record", w,
                                        "02_이자소득", "이자소득",
                                        "상담기록 텍스트", "이자소득 결과를 상담일지 텍스트로 변환합니다.",
                                        List.of(
                                                Input.of("category", "급여 항목", "select")
                                                        .options(List.of("맞춤형", "기초연금", "타법"))
                                                        .defaultValue("맞춤형").build(),
                                                Input.of("deductionCap", "월별 차감 한도 (수동 보정)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("rows", "이자 입력", "rows")
                                                        .columns(List.of(
                                                                Input.of("account", "계좌", "text").build(),
                                                                Input.of("month", "월", "text").build(),
                                                                Input.of("amount", "이자", "number").build()
                                                        )).build()
                                        ))
                        )),

                // ── 03 재산상담 ──
                Feature.group("welfare/property", w,
                        "03_재산상담", "재산변동상담",
                        "재산변동상담", "재산 변동(금융/일반/주택조사) 상담 메시지 생성.",
                        List.of(
                                Feature.leaf("property/consult", w,
                                        "03_재산상담", "재산변동상담",
                                        "상담생성", "재산 변동(금융/일반/주택조사)에 대한 상담 메시지를 만듭니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("mode", "구분", "select")
                                                        .options(List.of("금융재산", "일반재산", "주택조사결과"))
                                                        .required(true).build(),
                                                Input.of("previous", "직전 금액", "number").build(),
                                                Input.of("current", "금회 금액", "number").build(),
                                                Input.of("baselineDate", "기준일", "date").build(),
                                                Input.of("currentDate", "조사일", "date").build(),
                                                Input.of("category", "세부 항목", "text")
                                                        .help("예: 예금, 토지, 단독주택 등").build(),
                                                Input.of("deductionRate", "차감율 (수동 보정)", "number")
                                                        .defaultValue("0").help("0이면 연도별 기타증여재산 공제율(50%)을 자동 적용.").build(),
                                                Input.of("monthlyDeduction", "월 차감액 (수동)", "number")
                                                        .defaultValue("0").build()
                                        ))
                        )),

                // ── 04 상속상담 ──
                Feature.group("welfare/inheritance", w,
                        "04_상속상담", "상속분상담",
                        "상속분상담", "법정 상속분 계산 및 우선순위 트리.",
                        List.of(
                                Feature.leaf("inheritance/consult", w,
                                        "04_상속상담", "상속분상담",
                                        "상담생성", "「민법」 제1009조 법정 상속분에 따라 배우자/자녀/부모 분배를 자동 계산합니다.",
                                        List.of(
                                                Input.of("target", "대상물건", "text").defaultValue("").build(),
                                                Input.of("totalAmount", "상속가액", "number").defaultValue("0").build(),
                                                Input.of("spouseCount", "배우자 수", "number").defaultValue("0").build(),
                                                Input.of("childCount", "자녀 수", "number").defaultValue("0")
                                                        .help("자녀가 1인 이상이면 부모는 후순위로 0이 됩니다.").build(),
                                                Input.of("parentCount", "부모 수", "number").defaultValue("0").build()
                                        )),
                                Feature.leaf("statutory/inheritance-priority", w,
                                        "04_상속상담", "상속분상담",
                                        "상속 우선순위 트리 (대습·유류분)",
                                        "「민법」 제1000조 (순위) · 제1001조 (대습) · 제1003조 (배우자) · 제1009조 (분) · 제1112조 (유류분) — 1~4순위 트리 + 유류분 1/2·1/3 자동 적용.",
                                        List.of(
                                                Input.of("totalEstate", "상속재산 총액 (원)", "number").defaultValue("0").required(true).build(),
                                                Input.of("spouseCount", "배우자 수", "number").defaultValue("0").build(),
                                                Input.of("childCount", "자녀(직접) 수", "number").defaultValue("0").build(),
                                                Input.of("parentCount", "부모 수", "number").defaultValue("0").build(),
                                                Input.of("siblingCount", "형제자매 수", "number").defaultValue("0").build(),
                                                Input.of("fourthDegreeCount", "4촌 이내 방계혈족 수", "number").defaultValue("0").build(),
                                                Input.of("substitute", "대습상속 발생 (true/false)", "select")
                                                        .options(List.of("false", "true")).defaultValue("false")
                                                        .help("자녀가 상속개시 전 사망·결격 시 그 자녀(손자녀)가 대습. 「민법」 제1001조.").build(),
                                                Input.of("substituteCount", "대습상속인 수", "number").defaultValue("0").build()
                                        ))
                        )),

                // ── 04-2 정통 산식 ──
                Feature.group("welfare/statutory", w,
                        "04-2_정통산식", "정통 산식",
                        "정통 산식", "소득인정액·중위소득 비율·통합 자격 평가.",
                        List.of(
                                Feature.leaf("statutory/recognized-income", w,
                                        "04-2_정통산식", "정통 산식",
                                        "소득인정액 산출",
                                        "「국민기초생활 보장법」제2조 — 소득평가액 + 재산의 소득환산. 일반/금융/자동차 환산율 + 지역별 기본공제 자동 적용.",
                                        List.of(
                                                Input.of("salary", "근로소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("businessIncome", "사업소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("financialIncome", "재산소득(이자·배당) (원/월)", "number").defaultValue("0").build(),
                                                Input.of("rentalIncome", "임대소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("transferIncome", "이전소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("generalProperty", "일반재산 (원)", "number").defaultValue("0").build(),
                                                Input.of("financialAssets", "금융재산 (원)", "number").defaultValue("0").build(),
                                                Input.of("vehicleAssets", "자동차 (원)", "number").defaultValue("0")
                                                        .help("생계용·장애인용 차량 예외는 호출자가 미리 차감해 입력.").build(),
                                                Input.of("debt", "부채 (원)", "number").defaultValue("0").build(),
                                                Input.of("region", "거주 지역", "select")
                                                        .options(List.of("서울", "경기", "광역세종창원", "그외도시", "농어촌"))
                                                        .defaultValue("그외도시")
                                                        .help("「사업안내」 별표 — 일반재산 기본공제 지역별 차등.").build(),
                                                Input.of("propertyMode", "일반재산 환산율 모드", "select")
                                                        .options(List.of("일반", "주거"))
                                                        .defaultValue("일반")
                                                        .help("주거용 1.04%/월 · 일반(주거외) 4.17%/월.").build()
                                        )),
                                Feature.leaf("statutory/median-ratio", w,
                                        "04-2_정통산식", "정통 산식",
                                        "중위소득 비율 자격 분기",
                                        "「국민기초생활 보장법」제8조의2 — 소득인정액 ÷ 가구원수별 기준중위소득 → 생계 32% / 의료 40% / 주거 48% / 교육 50%.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("householdSize", "가구원 수", "number").defaultValue("1").required(true).build(),
                                                Input.of("recognizedIncome", "소득인정액 (원/월)", "number").defaultValue("0").required(true)
                                                        .help("위 [소득인정액 산출]의 결과를 그대로 입력.").build()
                                        )),
                                Feature.leaf("statutory/eligibility-flow", w,
                                        "04-2_정통산식", "정통 산식",
                                        "통합 자격 평가 (소득인정액 → 비율 → 해외체류)",
                                        "소득인정액 비율 + 해외체류 정지 임계 검토.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("householdSize", "가구원 수", "number").defaultValue("1").required(true).build(),
                                                Input.of("salary", "근로소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("businessIncome", "사업소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("financialIncome", "재산소득(이자·배당) (원/월)", "number").defaultValue("0").build(),
                                                Input.of("rentalIncome", "임대소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("transferIncome", "이전소득 (원/월)", "number").defaultValue("0").build(),
                                                Input.of("generalProperty", "일반재산 (원)", "number").defaultValue("0").build(),
                                                Input.of("financialAssets", "금융재산 (원)", "number").defaultValue("0").build(),
                                                Input.of("vehicleAssets", "자동차 (원)", "number").defaultValue("0").build(),
                                                Input.of("debt", "부채 (원)", "number").defaultValue("0").build(),
                                                Input.of("region", "거주 지역", "select")
                                                        .options(List.of("서울", "경기", "광역세종창원", "그외도시", "농어촌"))
                                                        .defaultValue("그외도시").build(),
                                                Input.of("propertyMode", "일반재산 환산율", "select")
                                                        .options(List.of("일반", "주거")).defaultValue("일반").build(),
                                                Input.of("overseasDays", "해외체류 누적 일수", "number").defaultValue("0").build(),
                                                Input.of("overseasRuleKey", "해외체류 임계 룰", "select")
                                                        .options(List.of("기초생활_신규", "기초생활_기존", "기초생활_누적",
                                                                "기초연금", "장애인연금", "차상위_본인부담경감"))
                                                        .defaultValue("기초생활_기존").build()
                                        )),
                                Feature.leaf("statutory/deduction-ladder/earned-income", w,
                                        "04-2_정통산식", "정통 산식",
                                        "근로소득공제 사다리",
                                        "「소득세법」제47조 — 5단계 piecewise-linear (≤500만 70%·≤1500만 47.5%·≤4500만 15%·≤1억 5%·>1억 2%).",
                                        List.of(
                                                Input.of("salary", "총급여 (원, 연간)", "number").defaultValue("0").required(true).build()
                                        )),
                                Feature.leaf("statutory/vat-delta", w,
                                        "04-2_정통산식", "정통 산식",
                                        "부가가치세 차분",
                                        "「부가가치세법」제30·37·38조 — payable = (sales − purchase) × 10%. 음수 결과는 환급세액.",
                                        List.of(
                                                Input.of("salesSupplyAmount", "매출 공급가액 (원)", "number").defaultValue("0").required(true).build(),
                                                Input.of("purchaseSupplyAmount", "매입 공급가액 (원)", "number").defaultValue("0").build()
                                        ))
                        )),

                // ── 05 긴급공제설명 ──
                Feature.group("welfare/emergency", w,
                        "05_긴급공제설명", "긴급공제설명",
                        "긴급공제설명", "긴급 지원 대상자 기간별 공제표와 안내문 생성.",
                        List.of(
                                Feature.leaf("emergency/explain", w,
                                        "05_긴급공제설명", "긴급공제설명",
                                        "공제 설명 생성", "긴급 지원 대상자의 기간별 공제표와 안내문을 생성합니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("startDate", "지원 시작일", "date").required(true).build(),
                                                Input.of("endDate", "지원 종료일", "date").required(true).build(),
                                                Input.of("householdSize", "가구원 수", "number")
                                                        .defaultValue("1").help("기준 중위소득과 생계급여 비율(32%)을 자동 적용합니다.").build(),
                                                Input.of("monthlyAmount", "월 지원금액", "number").defaultValue("0").build(),
                                                Input.of("incomeBaseline", "기준 중위소득 (수동 보정)", "number")
                                                        .defaultValue("0").help("0이면 연도/가구원 수로 자동 조회.").build(),
                                                Input.of("deductionRate", "차감율 (수동 보정)", "number")
                                                        .defaultValue("0").help("0이면 생계급여 선정기준(32%)을 자동 적용.").build()
                                        ))
                        )),

                // ── 06 해외체류 ──
                Feature.group("welfare/overseas", w,
                        "06_해외체류", "해외체류",
                        "해외체류", "신규·기존 수급자 및 연금 수급자 해외체류 규정 검토.",
                        List.of(
                                Feature.leaf("overseas/new", w,
                                        "06_해외체류", "해외체류",
                                        "신규 신청자", "신청일 기준 출입국 내역으로 61일 룰을 검토합니다.",
                                        List.of(
                                                Input.of("applicationDate", "신청일", "date").required(true).build(),
                                                Input.of("trips", "출입국 내역", "rows")
                                                        .columns(List.of(
                                                                Input.of("departure", "출국일", "date").build(),
                                                                Input.of("arrival", "입국일", "date").build()
                                                        )).build()
                                        )),
                                Feature.leaf("overseas/existing", w,
                                        "06_해외체류", "해외체류",
                                        "기존 수급자", "기준일(180일 전) 이후 해외체류일을 합산합니다.",
                                        List.of(
                                                Input.of("baselineDate", "조사 기준일", "date").required(true).build(),
                                                Input.of("trips", "출입국 내역", "rows")
                                                        .columns(List.of(
                                                                Input.of("departure", "출국일", "date").build(),
                                                                Input.of("arrival", "입국일", "date").build()
                                                        )).build()
                                        )),
                                Feature.leaf("overseas/pension", w,
                                        "06_해외체류", "해외체류",
                                        "기초/장애인 연금 수급자", "출국 후 60일 초과 시점의 안내문을 생성합니다.",
                                        List.of(
                                                Input.of("departureDate", "출국일", "date").required(true).build(),
                                                Input.of("pensionType", "연금 종류", "select")
                                                        .options(List.of("기초연금", "장애인연금", "기초+장애인 모두"))
                                                        .required(true).build()
                                        )),
                                Feature.leaf("overseas/care", w,
                                        "06_해외체류", "해외체류",
                                        "차상위 본인부담경감", "출국 후 3개월 초과 시 자격 정지 안내를 생성합니다.",
                                        List.of(
                                                Input.of("departureDate", "출국일", "date").required(true).build()
                                        ))
                        )),

                // ── 99 공용 ──
                Feature.group("welfare/shared", w,
                        "99_공용", "공용 유틸",
                        "공용 유틸", "개월수 계산 및 초기 차감금액 계산.",
                        List.of(
                                Feature.leaf("shared/months", w,
                                        "99_공용", "공용 유틸",
                                        "개월수 계산", "두 날짜 사이의 개월 수를 계산합니다 (종료월 포함).",
                                        List.of(
                                                Input.of("startDate", "시작일", "date").required(true).build(),
                                                Input.of("endDate", "종료일", "date").required(true).build()
                                        )),
                                Feature.leaf("shared/initial-deduction", w,
                                        "99_공용", "공용 유틸",
                                        "초기 차감금액 계산",
                                        "기준일~조사일 사이의 누적 차감 금액을 항목별·연도별 법정 비율로 계산합니다.",
                                        List.of(
                                                Input.of("category", "항목", "select")
                                                        .options(List.of(
                                                                "기타증여재산", "맞춤형 1인", "맞춤형 2인", "맞춤형 3인",
                                                                "맞춤형 4인", "맞춤형 5인", "맞춤형 6인", "맞춤형 7인",
                                                                "맞춤형 8인", "기초연금 1인", "기초연금 2인"))
                                                        .defaultValue("기타증여재산")
                                                        .help("기준 표의 항목 중 하나. 기타증여재산은 월 50% 비율, 맞춤형/기초연금 N인은 가구원수별 월 기준액.").build(),
                                                Input.of("baselineDate", "기준일", "date").required(true).build(),
                                                Input.of("currentDate", "조사일", "date").required(true).build(),
                                                Input.of("principal", "원금 (기타증여재산일 때만)", "number")
                                                        .defaultValue("0")
                                                        .help("맞춤형/기초연금 항목 선택 시에는 무시되고 표의 월 기준액이 직접 사용됩니다.").build()
                                        ))
                        )),

                // ── 00 통합문서 이벤트 ──
                Feature.group("welfare/events", w,
                        "00_workbook_events", "이벤트 핸들러",
                        "이벤트 핸들러", "통합문서 시트 변경 이벤트 시뮬레이션.",
                        List.of(
                                Feature.leaf("events/property-sheet", w,
                                        "00_workbook_events", "이벤트 핸들러",
                                        "재산변동 시트 변경 시뮬레이션",
                                        "재산변동상담생성 화면의 행 숨김 + 차액 자동계산을 시뮬레이션합니다.",
                                        List.of(
                                                Input.of("mode", "C3 모드", "select")
                                                        .options(List.of("금융재산", "일반재산", "주택조사결과", "선택"))
                                                        .required(true).build(),
                                                Input.of("c8", "C8 (금융 금회)", "number").defaultValue("0").build(),
                                                Input.of("c9", "C9 (금융 직전)", "number").defaultValue("0").build(),
                                                Input.of("c13", "C13 (주택 금회)", "number").defaultValue("0").build(),
                                                Input.of("c14", "C14 (주택 직전)", "number").defaultValue("0").build()
                                        ))
                        ))
        );
    }

    /** 모든 children을 재귀적으로 탐색해 id로 Feature를 찾는다. */
    public static Optional<Feature> byId(String id) {
        return byId(all(), id);
    }

    private static Optional<Feature> byId(List<Feature> features, String id) {
        for (Feature f : features) {
            if (f.id().equals(id)) return Optional.of(f);
            if (f.children() != null) {
                Optional<Feature> found = byId(f.children(), id);
                if (found.isPresent()) return found;
            }
        }
        return Optional.empty();
    }
}
