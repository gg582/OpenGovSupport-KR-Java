import type { FormulaRule, NodeKind, Port } from "./types";

/**
 * 9가지 노드 유형 + 각 유형의 입출력 포트 + (formula 의 경우) 백엔드 ruleId 매핑.
 * Java 백엔드의 statutory primitive 와 1:1 대응 — WASM 미사용.
 */
export type NodeTemplate = {
  kind: NodeKind;
  label: string;
  /** 좌측 팔레트 그룹 분류. */
  group: "io" | "data" | "compute" | "control" | "meta" | "output";
  inputs: Port[];
  outputs: Port[];
  /** formula 일 때만 — 백엔드 ruleId / endpoint. */
  rule?: FormulaRule;
  /** UI 표시용 단축 설명. */
  hint?: string;
  /** legal 노드 디폴트 인용. */
  citation?: string;
};

const p = (id: string, label: string): Port => ({ id, name: id, label });

/** Formula 노드별 — 백엔드 endpoint + 변수명. */
export const FORMULA_RULES: Record<
  FormulaRule,
  {
    label: string;
    endpoint: string;
    inputs: Port[];
    outputs: Port[];
    legalBasis: string;
    /**
     * 입력 포트명 → 백엔드 variable name. 그래프에서 흘러들어온 값을
     * 이 키로 백엔드 요청 본문에 매핑한다.
     */
    inputMap: Record<string, string>;
  }
> = {
  "earned-income-deduction": {
    label: "근로소득공제",
    endpoint: "/api/tax/earned-income-deduction",
    inputs: [p("grossSalary", "총급여")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제47조",
    inputMap: { grossSalary: "grossSalary" },
  },
  "comprehensive-income-tax": {
    label: "종합소득세 산출세액",
    endpoint: "/api/tax/comprehensive-income-tax",
    inputs: [p("taxableIncome", "과세표준")],
    outputs: [p("amount", "산출세액")],
    legalBasis: "「소득세법」 제55조",
    inputMap: { taxableIncome: "taxableIncome" },
  },
  "corporate-tax": {
    label: "법인세",
    endpoint: "/api/tax/corporate-tax",
    inputs: [p("taxableIncome", "과세표준")],
    outputs: [p("amount", "산출세액")],
    legalBasis: "「법인세법」 제55조",
    inputMap: { taxableIncome: "taxableIncome" },
  },
  "inheritance-tax": {
    label: "상속세",
    endpoint: "/api/tax/inheritance-tax",
    inputs: [p("inheritanceBase", "과세표준")],
    outputs: [p("amount", "산출세액")],
    legalBasis: "「상속세 및 증여세법」 제26조",
    inputMap: { inheritanceBase: "inheritanceBase" },
  },
  "gift-tax": {
    label: "증여세",
    endpoint: "/api/tax/gift-tax",
    inputs: [p("giftBase", "과세표준")],
    outputs: [p("amount", "산출세액")],
    legalBasis: "「상속세 및 증여세법」 제56조",
    inputMap: { giftBase: "giftBase" },
  },
  "medical-expense-credit": {
    label: "의료비 세액공제",
    endpoint: "/api/tax/medical-expense-credit",
    inputs: [p("salary", "총급여"), p("medicalExpense", "의료비")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의4 ①",
    inputMap: { salary: "salary", medicalExpense: "medicalExpense" },
  },
  "education-credit": {
    label: "교육비 세액공제",
    endpoint: "/api/tax/education-credit",
    inputs: [p("educationExpense", "교육비")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의4 ②",
    inputMap: { educationExpense: "educationExpense" },
  },
  "rent-credit": {
    label: "월세 세액공제",
    endpoint: "/api/tax/rent-credit",
    inputs: [p("salary", "총급여"), p("rentPaid", "월세")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「조세특례제한법」 제95조의2",
    inputMap: { salary: "salary", rentPaid: "rentPaid" },
  },
  "pension-credit": {
    label: "연금계좌 세액공제",
    endpoint: "/api/tax/pension-credit",
    inputs: [p("salary", "총급여"), p("pensionContribution", "납입액")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의3",
    inputMap: { salary: "salary", pensionContribution: "pensionContribution" },
  },
  "donation-credit": {
    label: "기부금 세액공제",
    endpoint: "/api/tax/donation-credit",
    inputs: [p("donation", "기부금")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의4 ④",
    inputMap: { donation: "donation" },
  },
  "child-credit": {
    label: "자녀 세액공제",
    endpoint: "/api/tax/child-credit",
    inputs: [p("childCount", "자녀수")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의2",
    inputMap: { childCount: "childCount" },
  },
  "earned-income-credit": {
    label: "근로장려금",
    endpoint: "/api/tax/earned-income-credit",
    inputs: [p("householdIncome", "가구합산소득")],
    outputs: [p("amount", "장려금")],
    legalBasis: "「조세특례제한법」 제100조의3",
    inputMap: { householdIncome: "householdIncome" },
  },
  "simple-expense-rate": {
    label: "단순경비율",
    endpoint: "/api/tax/simple-expense-rate",
    inputs: [p("revenue", "수입금액")],
    outputs: [p("amount", "필요경비")],
    legalBasis: "「소득세법 시행령」 제143조",
    inputMap: { revenue: "revenue" },
  },
  "vat-payable": {
    label: "부가가치세 (룰 기반)",
    endpoint: "/api/tax/vat-payable",
    inputs: [p("supplyValue", "매출"), p("purchaseValue", "매입")],
    outputs: [p("amount", "납부세액")],
    legalBasis: "「부가가치세법」 제30·37·38조",
    inputMap: { supplyValue: "supplyValue", purchaseValue: "purchaseValue" },
  },
  "recognized-income": {
    label: "소득인정액",
    endpoint: "/api/statutory/recognized-income",
    inputs: [
      p("salary", "근로소득"),
      p("businessIncome", "사업소득"),
      p("financialIncome", "재산소득"),
      p("rentalIncome", "임대소득"),
      p("transferIncome", "이전소득"),
      p("generalProperty", "일반재산"),
      p("financialAssets", "금융재산"),
      p("vehicleAssets", "자동차"),
      p("debt", "부채"),
    ],
    outputs: [p("recognizedIncome", "소득인정액")],
    legalBasis: "「국민기초생활 보장법」 제2조 제8·9호",
    inputMap: {
      salary: "salary",
      businessIncome: "businessIncome",
      financialIncome: "financialIncome",
      rentalIncome: "rentalIncome",
      transferIncome: "transferIncome",
      generalProperty: "generalProperty",
      financialAssets: "financialAssets",
      vehicleAssets: "vehicleAssets",
      debt: "debt",
    },
  },
  "median-ratio": {
    label: "중위소득 비율",
    endpoint: "/api/statutory/median-ratio",
    inputs: [
      p("recognizedIncome", "소득인정액"),
      p("householdSize", "가구원수"),
    ],
    outputs: [p("ratio", "비율(%)"), p("eligibility", "자격")],
    legalBasis: "「국민기초생활 보장법」 제8조의2",
    inputMap: {
      recognizedIncome: "recognizedIncome",
      householdSize: "householdSize",
    },
  },
  "eligibility-flow": {
    label: "복지 자격 통합",
    endpoint: "/api/statutory/eligibility-flow",
    inputs: [
      p("salary", "근로소득"),
      p("householdSize", "가구원수"),
      p("overseasDays", "해외체류"),
    ],
    outputs: [p("qualified", "자격여부")],
    legalBasis: "복지 자격 + 해외체류 기준",
    inputMap: {
      salary: "salary",
      householdSize: "householdSize",
      overseasDays: "overseasDays",
    },
  },
  "inheritance-priority": {
    label: "상속 우선순위",
    endpoint: "/api/statutory/inheritance-priority",
    inputs: [
      p("totalEstate", "상속재산"),
      p("spouseCount", "배우자수"),
      p("childCount", "자녀수"),
      p("parentCount", "부모수"),
    ],
    outputs: [p("shares", "분배")],
    legalBasis: "「민법」 제1000~1112조",
    inputMap: {
      totalEstate: "totalEstate",
      spouseCount: "spouseCount",
      childCount: "childCount",
      parentCount: "parentCount",
    },
  },
  "vat-delta": {
    label: "부가가치세 차분",
    endpoint: "/api/statutory/vat-delta",
    inputs: [
      p("salesSupplyAmount", "매출"),
      p("purchaseSupplyAmount", "매입"),
    ],
    outputs: [p("payable", "납부/환급")],
    legalBasis: "「부가가치세법」 제30·37·38조",
    inputMap: {
      salesSupplyAmount: "salesSupplyAmount",
      purchaseSupplyAmount: "purchaseSupplyAmount",
    },
  },
  "deduction-ladder/earned-income": {
    label: "근로소득공제 사다리",
    endpoint: "/api/statutory/deduction-ladder/earned-income",
    inputs: [p("salary", "총급여")],
    outputs: [p("deduction", "공제액")],
    legalBasis: "「소득세법」 제47조 (5단계 piecewise-linear)",
    inputMap: { salary: "salary" },
  },
  "marriage-credit": {
    label: "결혼 세액공제",
    endpoint: "/api/tax/marriage-credit",
    inputs: [
      p("isMarriedInPeriod", "혼인해당"),
      p("claimedBefore", "이전공제"),
      p("spouseClaim", "배우자공제"),
    ],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의4 ⑩",
    inputMap: {
      isMarriedInPeriod: "isMarriedInPeriod",
      claimedBefore: "claimedBefore",
      spouseClaim: "spouseClaim",
    },
  },
  "sports-credit": {
    label: "체육시설 이용료 공제",
    endpoint: "/api/tax/sports-credit",
    inputs: [p("sportsExpense", "체육이용료")],
    outputs: [p("amount", "공제액")],
    legalBasis: "「소득세법」 제59조의4 ⑪",
    inputMap: { sportsExpense: "sportsExpense" },
  },
};

/** 좌측 팔레트에 표시할 노드 템플릿 — kind 별 1개 + formula 는 ruleId 별. */
export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    kind: "input",
    label: "입력",
    group: "io",
    inputs: [],
    outputs: [p("v", "값")],
    hint: "사용자 입력값",
  },
  {
    kind: "manual",
    label: "상수",
    group: "data",
    inputs: [],
    outputs: [p("v", "값")],
    hint: "고정 상수 / 한도",
  },
  {
    kind: "lookup",
    label: "표 조회",
    group: "data",
    inputs: [p("key", "키")],
    outputs: [p("v", "값")],
    hint: "중위소득·임계 표",
  },
  {
    kind: "threshold",
    label: "임계",
    group: "control",
    inputs: [p("v", "값")],
    outputs: [p("pass", "통과"), p("block", "차단")],
    hint: "x op limit",
  },
  {
    kind: "conditional",
    label: "조건",
    group: "control",
    inputs: [p("v", "값")],
    outputs: [p("then", "참"), p("else", "거짓")],
    hint: "if/elif/else",
  },
  {
    kind: "legal",
    label: "법령 인용",
    group: "meta",
    inputs: [],
    outputs: [],
    hint: "근거 법령 메모",
    citation: "「소득세법」 제○○조",
  },
  {
    kind: "output",
    label: "출력",
    group: "output",
    inputs: [p("v", "값")],
    outputs: [],
    hint: "최종 결과",
  },
  {
    kind: "pdf",
    label: "PDF 출력",
    group: "output",
    inputs: [p("v", "값")],
    outputs: [],
    hint: "결과 PDF 출력",
  },
  // formula 는 ruleId 별로 따로 추가됨 — 아래에서 expand.
];

export function allFormulaTemplates(): NodeTemplate[] {
  return (Object.keys(FORMULA_RULES) as FormulaRule[]).map((rule) => {
    const r = FORMULA_RULES[rule];
    return {
      kind: "formula",
      label: r.label,
      group: "compute" as const,
      inputs: r.inputs,
      outputs: r.outputs,
      rule,
      hint: r.legalBasis,
    };
  });
}

export const ALL_TEMPLATES: NodeTemplate[] = [
  ...NODE_TEMPLATES,
  ...allFormulaTemplates(),
];
