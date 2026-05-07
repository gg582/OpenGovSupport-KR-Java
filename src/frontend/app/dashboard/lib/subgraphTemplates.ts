/**
 * 정형 패턴 (subgraph templates).
 *
 * 좌측 팔레트에서 클릭하면 — 일반 노드를 끌어두는 것과 동일하게 — 캔버스에 통째로
 * 들어가는 작은 워크플로우. 이미 그려둔 그래프를 지우지 않고 옆에 붙는다.
 *
 * 위치는 그리드 셀(`{cx, cy}`) 단위로 상대 정의 — 드롭 시점의 오프셋으로 평행이동.
 * ID 는 모두 자리표시자(`p:*`) — 스토어가 드롭 시 새 ID 를 생성하고 엣지의 source/target
 * 도 그에 맞게 다시 결선한다.
 */

import type { GraphEdge, GraphNode, NodeData, NodeKind } from "./types";
import type { FormulaRule } from "./types";
import { FORMULA_RULES } from "./registry";

export type SubgraphTemplate = {
  id: string;
  name: string;            // 「법령」 §조항 정형 패턴 — 사용자에게 표시되는 이름
  group: "tax" | "welfare" | "inheritance" | "vat" | "compose";
  description: string;     // 1줄 설명 (chip hover)
  legalBasis?: string;     // 근거 법령 (참고)
  /** 노드 — 자리표시자 ID `p:*`, 상대 그리드 좌표(cx,cy). */
  nodes: Array<{
    placeholderId: string;
    cx: number;
    cy: number;
    data: Omit<NodeData, "runtime"> & { kind: NodeKind };
  }>;
  /** 엣지 — source/target 가 자리표시자 ID. */
  edges: Array<{
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
};

// 짧은 헬퍼 — formula 노드를 한 줄로 만든다 (registry 의 inputs/outputs 그대로).
function formulaNode(
  rule: FormulaRule,
  placeholderId: string,
  cx: number,
  cy: number,
  overrideLabel?: string,
) {
  const r = FORMULA_RULES[rule];
  return {
    placeholderId,
    cx,
    cy,
    data: {
      kind: "formula" as const,
      label: overrideLabel ?? r.label,
      rule,
      inputs: r.inputs,
      outputs: r.outputs,
    },
  };
}

function inputNode(
  placeholderId: string,
  cx: number,
  cy: number,
  label: string,
  value: number,
) {
  return {
    placeholderId,
    cx,
    cy,
    data: {
      kind: "input" as const,
      label,
      value,
      outputs: [{ id: "v", name: "v", label: "값" }],
    },
  };
}

function outputNode(placeholderId: string, cx: number, cy: number, label: string) {
  return {
    placeholderId,
    cx,
    cy,
    data: {
      kind: "output" as const,
      label,
      inputs: [{ id: "v", name: "v", label: "값" }],
    },
  };
}

function legalNode(placeholderId: string, cx: number, cy: number, citation: string) {
  return {
    placeholderId,
    cx,
    cy,
    data: {
      kind: "legal" as const,
      label: citation,
      citation,
    },
  };
}

export const SUBGRAPH_TEMPLATES: SubgraphTemplate[] = [
  // ───────────────────────────────────────── 세무 — 단일 정형 ─────
  {
    id: "tax-earned-deduction",
    name: "「소득세법」 §47 근로소득공제 (사다리)",
    group: "tax",
    description: "총급여 → 5단계 piecewise 공제액 → 출력",
    legalBasis: "「소득세법」 제47조",
    nodes: [
      inputNode("p:in", 0, 1, "총급여", 60_000_000),
      formulaNode("deduction-ladder/earned-income", "p:f", 8, 1),
      outputNode("p:out", 18, 1, "근로소득공제"),
      legalNode("p:law", 8, 6, "「소득세법」 §47"),
    ],
    edges: [
      { source: "p:in", target: "p:f", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:f", target: "p:out", sourceHandle: "deduction", targetHandle: "v" },
    ],
  },
  {
    id: "tax-comprehensive",
    name: "「소득세법」 §55 종합소득세 산출",
    group: "tax",
    description: "과세표준 → 8단계 누진세율 → 산출세액",
    legalBasis: "「소득세법」 제55조",
    nodes: [
      inputNode("p:in", 0, 1, "과세표준", 88_000_000),
      formulaNode("comprehensive-income-tax", "p:f", 8, 1),
      outputNode("p:out", 18, 1, "산출세액"),
    ],
    edges: [
      { source: "p:in", target: "p:f", sourceHandle: "v", targetHandle: "taxableIncome" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
  {
    id: "tax-medical-credit",
    name: "「소득세법」 §59-4① 의료비 세액공제",
    group: "tax",
    description: "총급여 + 의료비 → 3% 임계 → 15% 공제",
    legalBasis: "「소득세법」 제59조의4 ①",
    nodes: [
      inputNode("p:salary", 0, 0, "총급여", 50_000_000),
      inputNode("p:med", 0, 6, "의료비", 3_000_000),
      formulaNode("medical-expense-credit", "p:f", 8, 3),
      outputNode("p:out", 18, 3, "의료비 공제"),
    ],
    edges: [
      { source: "p:salary", target: "p:f", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:med", target: "p:f", sourceHandle: "v", targetHandle: "medicalExpense" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
  {
    id: "tax-rent-credit",
    name: "「조특법」 §95-2 월세 세액공제",
    group: "tax",
    description: "총급여 + 연 월세 → 17%/15% 분기 → 1,000만 한도",
    legalBasis: "「조세특례제한법」 제95조의2",
    nodes: [
      inputNode("p:salary", 0, 0, "총급여", 50_000_000),
      inputNode("p:rent", 0, 6, "연 월세", 8_400_000),
      formulaNode("rent-credit", "p:f", 8, 3),
      outputNode("p:out", 18, 3, "월세 공제"),
    ],
    edges: [
      { source: "p:salary", target: "p:f", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:rent", target: "p:f", sourceHandle: "v", targetHandle: "rentPaid" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
  {
    id: "tax-pension-credit",
    name: "「소득세법」 §59-3 연금계좌 세액공제",
    group: "tax",
    description: "총급여 + 연금저축·IRP → 15%/12% 분기 → 900만 한도",
    legalBasis: "「소득세법」 제59조의3",
    nodes: [
      inputNode("p:salary", 0, 0, "총급여", 50_000_000),
      inputNode("p:pen", 0, 6, "연금계좌 납입", 7_000_000),
      formulaNode("pension-credit", "p:f", 8, 3),
      outputNode("p:out", 18, 3, "연금 공제"),
    ],
    edges: [
      { source: "p:salary", target: "p:f", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:pen", target: "p:f", sourceHandle: "v", targetHandle: "pensionContribution" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
  {
    id: "tax-child-credit",
    name: "「소득세법」 §59-2 자녀 세액공제",
    group: "tax",
    description: "자녀 수 → 1~2번째 25만 + 3번째↑ 40만",
    legalBasis: "「소득세법」 제59조의2",
    nodes: [
      inputNode("p:n", 0, 1, "자녀 수", 2),
      formulaNode("child-credit", "p:f", 8, 1),
      outputNode("p:out", 18, 1, "자녀 공제"),
    ],
    edges: [
      { source: "p:n", target: "p:f", sourceHandle: "v", targetHandle: "childCount" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
  {
    id: "tax-eitc-single",
    name: "「조특법」 §100-3 근로장려금 (단독가구)",
    group: "tax",
    description: "가구합산소득 → phase-in / plateau / phase-out",
    legalBasis: "「조세특례제한법」 제100조의3",
    nodes: [
      inputNode("p:in", 0, 1, "가구합산소득", 8_000_000),
      formulaNode("earned-income-credit", "p:f", 8, 1),
      outputNode("p:out", 18, 1, "근로장려금"),
    ],
    edges: [
      { source: "p:in", target: "p:f", sourceHandle: "v", targetHandle: "householdIncome" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },

  // ───────────────────────────────────────── 부가세 ─────
  {
    id: "vat-general",
    name: "「부가가치세법」 §30·37 일반과세 부가세",
    group: "vat",
    description: "매출 − 매입 → 10% 차분 → 납부 / 환급",
    legalBasis: "「부가가치세법」 제30·37·38조",
    nodes: [
      inputNode("p:sale", 0, 0, "매출 공급가액", 100_000_000),
      inputNode("p:pur", 0, 6, "매입 공급가액", 60_000_000),
      formulaNode("vat-delta", "p:f", 8, 3),
      outputNode("p:out", 18, 3, "납부세액"),
    ],
    edges: [
      { source: "p:sale", target: "p:f", sourceHandle: "v", targetHandle: "salesSupplyAmount" },
      { source: "p:pur", target: "p:f", sourceHandle: "v", targetHandle: "purchaseSupplyAmount" },
      { source: "p:f", target: "p:out", sourceHandle: "payable", targetHandle: "v" },
    ],
  },

  // ───────────────────────────────────────── 복지 ─────
  {
    id: "welfare-recognized",
    name: "「국기법」 §2 소득인정액 합산",
    group: "welfare",
    description: "5종 소득 + 일반/금융재산 → 소득인정액",
    legalBasis: "「국민기초생활 보장법」 제2조 제8·9호",
    nodes: [
      inputNode("p:salary", 0, 0, "근로소득(월)", 1_500_000),
      inputNode("p:biz", 0, 4, "사업소득(월)", 0),
      inputNode("p:fin", 0, 8, "재산소득(월)", 0),
      inputNode("p:rent", 0, 12, "임대소득(월)", 0),
      inputNode("p:tr", 0, 16, "이전소득(월)", 0),
      inputNode("p:gp", 0, 20, "일반재산", 50_000_000),
      inputNode("p:fa", 0, 24, "금융재산", 5_000_000),
      formulaNode("recognized-income", "p:f", 14, 12),
      outputNode("p:out", 28, 12, "소득인정액"),
    ],
    edges: [
      { source: "p:salary", target: "p:f", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:biz", target: "p:f", sourceHandle: "v", targetHandle: "businessIncome" },
      { source: "p:fin", target: "p:f", sourceHandle: "v", targetHandle: "financialIncome" },
      { source: "p:rent", target: "p:f", sourceHandle: "v", targetHandle: "rentalIncome" },
      { source: "p:tr", target: "p:f", sourceHandle: "v", targetHandle: "transferIncome" },
      { source: "p:gp", target: "p:f", sourceHandle: "v", targetHandle: "generalProperty" },
      { source: "p:fa", target: "p:f", sourceHandle: "v", targetHandle: "financialAssets" },
      { source: "p:f", target: "p:out", sourceHandle: "recognizedIncome", targetHandle: "v" },
    ],
  },
  {
    id: "welfare-eligibility",
    name: "「국기법」 §8-2 중위소득 비율 자격",
    group: "welfare",
    description: "소득인정액 + 가구원수 → 비율 → 4급여 자격",
    legalBasis: "「국민기초생활 보장법」 제8조의2",
    nodes: [
      inputNode("p:ri", 0, 1, "소득인정액(월)", 1_200_000),
      inputNode("p:hh", 0, 7, "가구원 수", 3),
      formulaNode("median-ratio", "p:f", 10, 4),
      outputNode("p:out", 22, 4, "급여 자격"),
    ],
    edges: [
      { source: "p:ri", target: "p:f", sourceHandle: "v", targetHandle: "recognizedIncome" },
      { source: "p:hh", target: "p:f", sourceHandle: "v", targetHandle: "householdSize" },
      { source: "p:f", target: "p:out", sourceHandle: "ratio", targetHandle: "v" },
    ],
  },
  {
    id: "welfare-flow",
    name: "「국기법」 §2+§8-2 자격 통합 + 해외체류",
    group: "compose",
    description: "소득·재산 + 가구원수 + 해외체류 → eligibility-flow 단일 호출",
    legalBasis: "「국민기초생활 보장법」 제2·8조의2 + 「사업안내」 별표 (해외체류)",
    nodes: [
      inputNode("p:salary", 0, 0, "근로소득(월)", 1_500_000),
      inputNode("p:hh", 0, 6, "가구원 수", 3),
      inputNode("p:os", 0, 12, "해외체류 일수", 0),
      formulaNode("eligibility-flow", "p:f", 14, 6),
      outputNode("p:out", 28, 6, "자격 (qualified)"),
      legalNode("p:law", 14, 16, "「사업안내」 별표 — 60일 임계"),
    ],
    edges: [
      { source: "p:salary", target: "p:f", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:hh", target: "p:f", sourceHandle: "v", targetHandle: "householdSize" },
      { source: "p:os", target: "p:f", sourceHandle: "v", targetHandle: "overseasDays" },
      { source: "p:f", target: "p:out", sourceHandle: "qualified", targetHandle: "v" },
    ],
  },

  // ───────────────────────────────────────── 상속 / 증여 ─────
  {
    id: "inh-priority",
    name: "「민법」 §1009 법정 상속분 (배우자+자녀)",
    group: "inheritance",
    description: "재산 + 가족 구성 → 1순위 직계비속 분배 + 유류분",
    legalBasis: "「민법」 제1000~1112조",
    nodes: [
      inputNode("p:est", 0, 0, "상속재산 총액", 1_500_000_000),
      inputNode("p:sp", 0, 5, "배우자 수", 1),
      inputNode("p:ch", 0, 10, "자녀 수", 2),
      inputNode("p:par", 0, 15, "부모 수", 0),
      formulaNode("inheritance-priority", "p:f", 14, 7),
      outputNode("p:out", 28, 7, "분배"),
    ],
    edges: [
      { source: "p:est", target: "p:f", sourceHandle: "v", targetHandle: "totalEstate" },
      { source: "p:sp", target: "p:f", sourceHandle: "v", targetHandle: "spouseCount" },
      { source: "p:ch", target: "p:f", sourceHandle: "v", targetHandle: "childCount" },
      { source: "p:par", target: "p:f", sourceHandle: "v", targetHandle: "parentCount" },
      { source: "p:f", target: "p:out", sourceHandle: "shares", targetHandle: "v" },
    ],
  },
  {
    id: "inh-tax",
    name: "「상증법」 §26 상속세 산출",
    group: "inheritance",
    description: "과세표준 → 5단계 누진 → 산출세액",
    legalBasis: "「상속세 및 증여세법」 제26조",
    nodes: [
      inputNode("p:base", 0, 1, "상속세 과세표준", 1_000_000_000),
      formulaNode("inheritance-tax", "p:f", 8, 1),
      outputNode("p:out", 18, 1, "산출세액"),
    ],
    edges: [
      { source: "p:base", target: "p:f", sourceHandle: "v", targetHandle: "inheritanceBase" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
  {
    id: "gift-tax",
    name: "「상증법」 §56 증여세 산출",
    group: "inheritance",
    description: "과세표준 → 5단계 누진 → 산출세액",
    legalBasis: "「상속세 및 증여세법」 제56조",
    nodes: [
      inputNode("p:base", 0, 1, "증여세 과세표준", 200_000_000),
      formulaNode("gift-tax", "p:f", 8, 1),
      outputNode("p:out", 18, 1, "산출세액"),
    ],
    edges: [
      { source: "p:base", target: "p:f", sourceHandle: "v", targetHandle: "giftBase" },
      { source: "p:f", target: "p:out", sourceHandle: "amount", targetHandle: "v" },
    ],
  },

  // ───────────────────────────────────────── 합성 정형 ─────
  {
    id: "compose-yearend-mini",
    name: "연말정산 미니 — 근로공제 + 종합세 + 의료비",
    group: "compose",
    description: "총급여 → 공제 → (직접 입력 과세표준 가정) → 산출세액 + 의료비 공제",
    legalBasis: "「소득세법」 §47·§55·§59-4 결합 — 절차 시연",
    nodes: [
      inputNode("p:gross", 0, 0, "총급여", 60_000_000),
      formulaNode("deduction-ladder/earned-income", "p:fd", 10, 0, "근로공제"),
      inputNode("p:base", 0, 8, "과세표준 (가정)", 40_000_000),
      formulaNode("comprehensive-income-tax", "p:ft", 10, 8, "산출세액"),
      inputNode("p:med", 0, 16, "의료비", 3_000_000),
      formulaNode("medical-expense-credit", "p:fm", 10, 16, "의료비 공제"),
      outputNode("p:od", 22, 0, "근로공제"),
      outputNode("p:ot", 22, 8, "산출세액"),
      outputNode("p:om", 22, 16, "의료비 공제"),
    ],
    edges: [
      { source: "p:gross", target: "p:fd", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:fd", target: "p:od", sourceHandle: "deduction", targetHandle: "v" },
      { source: "p:base", target: "p:ft", sourceHandle: "v", targetHandle: "taxableIncome" },
      { source: "p:ft", target: "p:ot", sourceHandle: "amount", targetHandle: "v" },
      { source: "p:gross", target: "p:fm", sourceHandle: "v", targetHandle: "salary" },
      { source: "p:med", target: "p:fm", sourceHandle: "v", targetHandle: "medicalExpense" },
      { source: "p:fm", target: "p:om", sourceHandle: "amount", targetHandle: "v" },
    ],
  },
];

export const SUBGRAPH_GROUP_LABEL: Record<SubgraphTemplate["group"], string> = {
  tax: "세무 정형",
  vat: "부가세 정형",
  welfare: "복지 정형",
  inheritance: "상속·증여 정형",
  compose: "결합 정형",
};
