package com.opengov.support.tax;

import com.opengov.support.domain.Feature;
import com.opengov.support.domain.Feature.Input;

import java.util.List;

/**
 * 개인세무 섹션의 Feature 매니페스트 — 계층 트리 구조.
 *
 * <p>각 leaf 는 {@code resources/tax-rules/{year}/{ruleId}.json} 의 룰과 1:1 대응.
 * <p>그룹/합성 노드는 UI 상하위 및 실행 의존성을 표현한다.
 */
public final class TaxFeatures {

    private TaxFeatures() {}

    private static List<String> yearOptions() {
        return TaxStandards.SUPPORTED_YEARS.stream().map(Object::toString).toList();
    }

    public static List<Feature> all() {
        String yearStr = Integer.toString(TaxStandards.currentYear());
        String s = Feature.SECTION_TAX;

        return List.of(
                // ── 11 종합소득세 ──
                Feature.group("tax/comprehensive-income", s,
                        "11_종합소득세", "종합소득세",
                        "종합소득세", "과세표준 산출 → 산출세액 → 환급/추징 전체 흐름.",
                        List.of(
                                Feature.leaf("tax/comprehensive-income-tax", s,
                                        "11_종합소득세", "종합소득세",
                                        "산출세액 (누진세율)",
                                        "「소득세법」제55조 8단계 누진세율로 종합소득 과세표준의 산출세액을 계산합니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("taxableIncome", "과세표준 (원)", "number")
                                                        .defaultValue("0")
                                                        .help("총수입금액에서 필요경비·소득공제를 차감한 금액. 8단계 누진세율표가 자동 적용됩니다.")
                                                        .required(true).build()
                                        )),
                                Feature.leaf("tax/comprehensive-income-refund", s,
                                        "11_종합소득세", "종합소득세",
                                        "환급/추징 시뮬레이터",
                                        "산출세액에서 기납부세액(원천징수·중간예납)을 차감해 환급액 또는 추가납부액을 계산합니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("taxableIncome", "과세표준 (원)", "number")
                                                        .defaultValue("0")
                                                        .help("8단계 누진세율로 산출세액이 자동 계산됩니다.")
                                                        .required(true).build(),
                                                Input.of("prepaidTax", "기납부세액 (원)", "number")
                                                        .defaultValue("0")
                                                        .help("원천징수 + 중간예납 + 수시부과 합계.")
                                                        .required(true).build()
                                        ))
                        )),

                // ── 12 근로소득 ──
                Feature.group("tax/earned-income", s,
                        "12_근로소득", "근로소득",
                        "근로소득", "근로소득공제 및 연말정산 세액공제.",
                        List.of(
                                Feature.leaf("tax/earned-income-deduction", s,
                                        "12_근로소득", "근로소득",
                                        "근로소득공제",
                                        "「소득세법」제47조 5단계 누진율표로 총급여에서 차감할 근로소득공제액을 계산합니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("grossSalary", "총급여 (원, 연간)", "number")
                                                        .defaultValue("0")
                                                        .help("비과세소득을 제외한 연간 총급여. 5,000만원 이하 70%부터 1억 초과 2%까지 5단계.")
                                                        .required(true).build()
                                        )),
                                Feature.composite("tax/year-end-settlement", s,
                                        "12_근로소득", "근로소득",
                                        "연말정산 통합 시뮬레이터",
                                        "근로소득공제 → 종합소득공제 → 산출세액 → 세액공제 합계 → 결정세액 → 환급/추징의 전체 흐름을 한 번에 평가합니다.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("grossSalary", "총급여 (원, 연간)", "number")
                                                        .defaultValue("0").required(true).build(),
                                                Input.of("dependentCount", "기본공제 대상 인원수", "number")
                                                        .defaultValue("1").help("본인 포함. 1인당 150만원 인적공제.").build(),
                                                Input.of("childCount", "기본공제대상 자녀 수", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("insurancePremium", "국민연금·건강보험 본인부담 합계 (원)", "number")
                                                        .defaultValue("0").help("종합소득공제로 전액 반영.").build(),
                                                Input.of("medicalExpense", "의료비 지출액 (원)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("educationExpense", "교육비 지출액 (원)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("rentPaid", "월세 지출액 (원, 연간)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("pensionContribution", "연금계좌 납입액 (원)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("donation", "기부금 (원)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("prepaidTax", "기납부세액(원천징수 합계, 원)", "number")
                                                        .defaultValue("0").build(),
                                                Input.of("isMarriedInPeriod", "혼인신고 시기 해당", "select")
                                                        .options(List.of("해당", "미해당")).defaultValue("미해당")
                                                        .help("2024.1.1.~2026.12.31. 사이 혼인신고 시 해당. 해당 시 연말정산 세액공제에 반영.").build(),
                                                Input.of("claimedBefore", "결혼세액공제 이전 수령 이력", "select")
                                                        .options(List.of("아니오", "예")).defaultValue("아니오")
                                                        .help("생애 1회 한도. 이전에 받은 적 있으면 0원.").build(),
                                                Input.of("spouseClaim", "배우자 결혼세액공제 여부", "select")
                                                        .options(List.of("본인만", "배우자도")).defaultValue("본인만")
                                                        .help("배우자도 2024~2026년 혼인신고 시 합산 최대 100만원.").build()
                                        ),
                                        List.of(
                                                Feature.leaf("tax/settlement/personal", s,
                                                        "12_근로소득", "연말정산",
                                                        "인적공제",
                                                        "본인 포함 1인당 150만원 인적공제.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/insurance", s,
                                                        "12_근로소득", "연말정산",
                                                        "보험료공제",
                                                        "국민연금·건강보험 본인부담액 종합소득공제.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/medical", s,
                                                        "12_근로소득", "연말정산",
                                                        "의료비 세액공제",
                                                        "「소득세법」제59조의4 ① — 총급여 3% 초과분 15%.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/education", s,
                                                        "12_근로소득", "연말정산",
                                                        "교육비 세액공제",
                                                        "「소득세법」제59조의4 ② — 교육비의 15%.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/rent", s,
                                                        "12_근로소득", "연말정산",
                                                        "월세 세액공제",
                                                        "「조세특례제한법」제95조의2 — 무주택 세대주.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/pension", s,
                                                        "12_근로소득", "연말정산",
                                                        "연금계좌 세액공제",
                                                        "「소득세법」제59조의3 — 연금저축·IRP.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/donation", s,
                                                        "12_근로소득", "연말정산",
                                                        "기부금 세액공제",
                                                        "「소득세법」제59조의4 ④ — 1,000만원 이하 15% + 초과분 30%.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/child", s,
                                                        "12_근로소득", "연말정산",
                                                        "자녀 세액공제",
                                                        "「소득세법」제59조의2 — 1~2번째 25만원 + 3번째 이상 40만원.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/marriage", s,
                                                        "12_근로소득", "연말정산",
                                                        "결혼 세액공제",
                                                        "「소득세법」제59조의4 ⑩ — 2024~2026 혼인신고 1인당 50만원.",
                                                        List.of()),
                                                Feature.leaf("tax/settlement/sports", s,
                                                        "12_근로소득", "연말정산",
                                                        "체육시설 이용료 공제",
                                                        "「소득세법」제59조의4 ③ — 9세 미만·초등 2학년 이하 15%.",
                                                        List.of())
                                        ))
                        )),

                // ── 13 특별세액공제 ──
                Feature.group("tax/special-credit", s,
                        "13_특별세액공제", "특별세액공제",
                        "특별세액공제", "의료비·교육비·월세·연금·기부금 개별 공제.",
                        List.of(
                                Feature.leaf("tax/medical-expense-credit", s,
                                        "13_특별세액공제", "특별세액공제",
                                        "의료비 세액공제",
                                        "「소득세법」제59조의4 ① — 총급여 3% 초과분의 15%를 산출세액에서 공제 (일반 700만원 한도).",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("salary", "총급여 (원, 연간)", "number")
                                                        .defaultValue("0")
                                                        .help("의료비 임계 산정 기준 (총급여 × 3%).")
                                                        .required(true).build(),
                                                Input.of("medicalExpense", "의료비 지출액 (원, 연간)", "number")
                                                        .defaultValue("0")
                                                        .help("본인·기본공제대상 부양가족이 지출한 의료비 합계. 연말정산 간소화 기준.")
                                                        .required(true).build()
                                        )),
                                Feature.leaf("tax/education-credit", s,
                                        "13_특별세액공제", "특별세액공제",
                                        "교육비 세액공제",
                                        "「소득세법」제59조의4 ② — 단계별 한도 내에서 교육비의 15%를 세액공제.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("stage", "교육 단계", "select")
                                                        .options(List.of("미취학·초중고", "대학·대학원", "본인(직장인 재교육)"))
                                                        .defaultValue("대학·대학원")
                                                        .help("단계별 1인당 한도: 미취학·초중고 300만원, 대학/본인 900만원.").build(),
                                                Input.of("educationExpense", "교육비 지출액 (원, 연간)", "number")
                                                        .defaultValue("0").required(true).build()
                                        )),
                                Feature.leaf("tax/rent-credit", s,
                                        "13_특별세액공제", "특별세액공제",
                                        "월세 세액공제",
                                        "「조세특례제한법」제95조의2 — 무주택 세대주, 총급여 8천만원 이하. 5,500만원 이하 17% / 그 외 15%.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("salary", "총급여 (원, 연간)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("총급여 5,500만원을 기준으로 공제율이 자동 분기됩니다.").build(),
                                                Input.of("rentPaid", "연 월세 지출액 (원)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("연 1,000만원 한도. 한도 초과분은 자동 절사.").build()
                                        )),
                                Feature.leaf("tax/pension-credit", s,
                                        "13_특별세액공제", "특별세액공제",
                                        "연금계좌 세액공제",
                                        "「소득세법」제59조의3 — 연금저축·IRP 납입액 900만원 한도. 5,500만원 이하 15% / 그 외 12%.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("salary", "총급여 (원, 연간)", "number")
                                                        .defaultValue("0").required(true).build(),
                                                Input.of("pensionContribution", "연금계좌 납입액 (원, 연금저축+IRP)", "number")
                                                        .defaultValue("0").required(true).build()
                                        )),
                                Feature.leaf("tax/donation-credit", s,
                                        "13_특별세액공제", "특별세액공제",
                                        "기부금 세액공제",
                                        "「소득세법」제59조의4 ④ — 1,000만원 이하 15% + 초과분 30% (Type A 정규형).",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("donation", "기부금 합계 (원, 연간)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("법정·지정 기부금 합계.").build()
                                        ))
                        )),

                // ── 14 기타세액공제 ──
                Feature.group("tax/etc-credit", s,
                        "14_기타세액공제", "기타세액공제",
                        "기타세액공제", "자녀·체육시설 이용료 공제.",
                        List.of(
                                Feature.leaf("tax/child-credit", s,
                                        "14_기타세액공제", "기타세액공제",
                                        "자녀 세액공제",
                                        "「소득세법」제59조의2 — 1~2번째 자녀 1인 25만원 + 3번째 이상 1인 40만원 (8세 이상).",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("childCount", "기본공제대상 자녀 수", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("만 8세 이상 ~ 20세 이하 자녀.").build()
                                        )),
                                Feature.leaf("tax/sports-credit", s,
                                        "14_기타세액공제", "기타세액공제",
                                        "체육시설 이용료 세액공제",
                                        "「소득세법」제59조의4 ③ — 2025년 귀속~ 9세 미만·초등학교 2학년 이하 자녀 체육시설 이용료의 15%, 연 300만원 한도.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("sportsExpense", "체육시설 이용료 (원, 연간)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("헬스장·수영장·태권도장 등 이용료.").build()
                                        ))
                        )),

                // ── 15 사업소득 ──
                Feature.group("tax/business-income", s,
                        "15_사업소득", "사업소득",
                        "사업소득", "단순경비율 추정 등 사업소득 관련.",
                        List.of(
                                Feature.leaf("tax/simple-expense-rate", s,
                                        "15_사업소득", "사업소득",
                                        "단순경비율 추정 필요경비",
                                        "「소득세법 시행령」제143조 — 업종별 단순경비율로 필요경비를 추정. 신규/소규모 사업자 대상.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("industry", "업종", "select")
                                                        .options(List.of("도소매업", "제조업", "음식점업", "건설업", "전문서비스업", "서비스업(인적)"))
                                                        .defaultValue("서비스업(인적)").build(),
                                                Input.of("revenue", "수입금액 (원, 연간)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("직전 과세기간 수입금액 기준. 단순경비율 적용 한도 미만이어야 함.").build()
                                        ))
                        )),

                // ── 16 근로장려금 ──
                Feature.group("tax/eitc", s,
                        "16_근로장려금", "근로장려금",
                        "근로장려금", "단독가구 근로장려금(EITC) 산출.",
                        List.of(
                                Feature.leaf("tax/earned-income-credit", s,
                                        "16_근로장려금", "근로장려금",
                                        "근로장려금 (단독가구)",
                                        "「조세특례제한법」제100조의3 — 단독가구 phase-in/plateau/phase-out 곡선 (최대 165만원).",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("householdIncome", "총급여 등 가구합산소득 (원)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("단독가구 기준. 0~400만 phase-in, 400~900만 평탄, 900~2,200만 phase-out.").build()
                                        ))
                        )),

                // ── 17 법인세 ──
                Feature.group("tax/corporate", s,
                        "17_법인세", "법인세",
                        "법인세", "법인세 산출세액 (4단계 누진).",
                        List.of(
                                Feature.leaf("tax/corporate-tax", s,
                                        "17_법인세", "법인세",
                                        "산출세액 (4단계 누진)",
                                        "「법인세법」제55조 — 9% / 19% / 21% / 24% 4단계 누진세율로 법인세 산출세액 계산.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("taxableIncome", "각 사업연도 과세표준 (원)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("결산상 당기순이익에 세무조정사항을 가감한 금액. 200,000,000원 이하 9% / 200억 이하 19% / 3000억 이하 21% / 초과 24%.").build()
                                        ))
                        )),

                // ── 18 상속세 ──
                Feature.group("tax/inheritance", s,
                        "18_상속세", "상속세",
                        "상속세", "상속세 산출세액 (5단계 누진).",
                        List.of(
                                Feature.leaf("tax/inheritance-tax", s,
                                        "18_상속세", "상속세",
                                        "상속세 산출세액 (5단계 누진)",
                                        "「상속세 및 증여세법」제26조 — 10% ~ 50% 5단계 누진세율로 상속세 산출세액 계산.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("inheritanceBase", "상속세 과세표준 (원)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("상속세과세가액에서 일괄공제(5억) 또는 기초공제 + 인적공제 등을 차감한 금액.").build()
                                        ))
                        )),

                // ── 19 증여세 ──
                Feature.group("tax/gift", s,
                        "19_증여세", "증여세",
                        "증여세", "증여세 산출세액 (5단계 누진).",
                        List.of(
                                Feature.leaf("tax/gift-tax", s,
                                        "19_증여세", "증여세",
                                        "증여세 산출세액 (5단계 누진)",
                                        "「상속세 및 증여세법」제56조 — 상속세 동일 5단계 누진세율로 증여세 산출세액 계산.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("giftBase", "증여세 과세표준 (원)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("증여세과세가액에서 증여재산공제(배우자 6억 / 직계존비속 5천만 등)를 차감한 금액.").build()
                                        ))
                        )),

                // ── 20 부가가치세 ──
                Feature.group("tax/vat", s,
                        "20_부가가치세", "부가가치세",
                        "부가가치세", "일반과세자 납부세액 계산.",
                        List.of(
                                Feature.leaf("tax/vat-payable", s,
                                        "20_부가가치세", "부가가치세",
                                        "납부세액 (매출세액 − 매입세액)",
                                        "「부가가치세법」제30·37·38조 — 일반과세자 납부세액 = (매출 공급가액 − 매입 공급가액) × 10%.",
                                        List.of(
                                                Input.of("year", "기준 연도", "select")
                                                        .options(yearOptions()).defaultValue(yearStr).build(),
                                                Input.of("supplyValue", "매출 공급가액 (원, 분기별)", "number")
                                                        .defaultValue("0").required(true)
                                                        .help("부가세 별도 공급가액. 매출세액 = 공급가액 × 10%.").build(),
                                                Input.of("purchaseValue", "매입 공급가액 (원, 분기별)", "number")
                                                        .defaultValue("0")
                                                        .help("세금계산서 수취분 공급가액. 매입세액 = 공급가액 × 10%.").build()
                                        ))
                        ))
        );
    }
}
