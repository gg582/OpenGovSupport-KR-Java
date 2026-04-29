package com.opengov.support.domain;

import com.opengov.support.domain.Feature.Input;

import java.util.List;
import java.util.Optional;

/** Feature 매니페스트 (UI 폼 자동 생성용). Go의 domain/features.go 와 동일. */
public final class Features {

    private Features() {}

    /** 지원 연도 옵션을 최신연도가 앞에 오도록 String 리스트로 반환. */
    private static List<String> yearOptions() {
        return Standards.SUPPORTED_YEARS.stream().map(Object::toString).toList();
    }

    /** 모든 기능 정의. UI 네비게이션이 이 매니페스트로 자동 생성된다. */
    public static List<Feature> all() {
        int year = Standards.currentYear();
        String yearStr = Integer.toString(year);

        return List.of(
                // ── 01 사적이전소득 ──
                new Feature(
                        "private-income/calc",
                        "01_사적이전소득", "사적이전소득",
                        "계산", "월별 입금 내역에서 사적이전소득을 산출합니다.",
                        List.of(
                                Input.of("year", "기준 연도", "select")
                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                Input.of("household", "가구원 수", "number")
                                        .defaultValue("1").help("법정 기준 중위소득 50% / 15% 표를 자동 적용합니다.").build(),
                                Input.of("altLabel", "특수 가구 라벨", "text")
                                        .defaultValue("차상위").help("B열 가구구분이 이 라벨과 같으면 횟수초과(15%) 기준 적용.").build(),
                                Input.of("rows", "입력 데이터", "rows")
                                        .columns(List.of(
                                                Input.of("household", "B 가구구분", "text").build(),
                                                Input.of("month", "C 입금월", "text").build(),
                                                Input.of("depositor", "D 입금자", "text").build(),
                                                Input.of("amount", "E 입금액", "number").build(),
                                                Input.of("exclude", "F 제외액", "number").build()
                                        )).build()
                        )),
                new Feature(
                        "private-income/record",
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
                        )),
                new Feature(
                        "private-income/pdf",
                        "01_사적이전소득", "사적이전소득",
                        "출력본 (PDF용 HTML)", "브라우저 인쇄/PDF 저장용 페이지를 생성합니다.",
                        List.of(
                                Input.of("title", "문서 제목", "text").defaultValue("사적이전소득 계산서").build(),
                                Input.of("rows", "출력 데이터", "rows")
                                        .columns(List.of(
                                                Input.of("household", "가구구분", "text").build(),
                                                Input.of("month", "입금월", "text").build(),
                                                Input.of("depositor", "입금자", "text").build(),
                                                Input.of("amount", "입금액", "number").build(),
                                                Input.of("income", "사적이전소득", "number").build()
                                        )).build()
                        )),

                // ── 02 이자소득 ──
                new Feature(
                        "interest-income/calc",
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
                new Feature(
                        "interest-income/record",
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
                        )),
                new Feature(
                        "interest-income/pdf",
                        "02_이자소득", "이자소득",
                        "출력본", "브라우저 인쇄/PDF 저장용 페이지를 생성합니다.",
                        List.of(
                                Input.of("title", "문서 제목", "text").defaultValue("이자소득 공제 상담서").build(),
                                Input.of("rows", "출력 데이터", "rows")
                                        .columns(List.of(
                                                Input.of("account", "계좌", "text").build(),
                                                Input.of("month", "월", "text").build(),
                                                Input.of("amount", "이자", "number").build(),
                                                Input.of("deducted", "차감 후", "number").build()
                                        )).build()
                        )),

                // ── 03 재산상담 ──
                new Feature(
                        "property/consult",
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
                        )),

                // ── 04 상속상담 ──
                new Feature(
                        "inheritance/consult",
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

                // ── 05 긴급공제설명 ──
                new Feature(
                        "emergency/explain",
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
                        )),

                // ── 06 해외체류 ──
                new Feature(
                        "overseas/new",
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
                new Feature(
                        "overseas/existing",
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
                new Feature(
                        "overseas/pension",
                        "06_해외체류", "해외체류",
                        "기초/장애인 연금 수급자", "출국 후 60일 초과 시점의 안내문을 생성합니다.",
                        List.of(
                                Input.of("departureDate", "출국일", "date").required(true).build(),
                                Input.of("pensionType", "연금 종류", "select")
                                        .options(List.of("기초연금", "장애인연금", "기초+장애인 모두"))
                                        .required(true).build()
                        )),
                new Feature(
                        "overseas/care",
                        "06_해외체류", "해외체류",
                        "차상위 본인부담경감", "출국 후 3개월 초과 시 자격 정지 안내를 생성합니다.",
                        List.of(
                                Input.of("departureDate", "출국일", "date").required(true).build()
                        )),

                // ── 99 공용 ──
                new Feature(
                        "shared/months",
                        "99_공용", "공용 유틸",
                        "개월수 계산", "두 날짜 사이의 개월 수를 계산합니다 (종료월 포함).",
                        List.of(
                                Input.of("startDate", "시작일", "date").required(true).build(),
                                Input.of("endDate", "종료일", "date").required(true).build()
                        )),
                new Feature(
                        "shared/initial-deduction",
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
                        )),

                // ── 00 통합문서 이벤트 ──
                new Feature(
                        "events/property-sheet",
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
        );
    }

    public static Optional<Feature> byId(String id) {
        return all().stream().filter(f -> f.id().equals(id)).findFirst();
    }
}
