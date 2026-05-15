/**
 * JSON / XML / XLSX 산출물 추출
 * — 모든 필드명을 한국식 한자어(한국어)로 치환하여 납보.
 */

import type { GraphDoc, GraphNode } from "./types";

const KEY_MAP: Record<string, string> = {
  amount: "금액",
  taxableIncome: "과세표준금액",
  taxAmount: "산출세액",
  taxCredit: "세액공제",
  deduction: "공제액",
  income: "소득금액",
  totalIncome: "총소득금액",
  substituted: "치환값",
  intermediate: "중간계산값",
  output: "산출결과",
  durationMs: "실행시간",
  epoch: "시각",
  qualified: "적격여부",
  reasons: "판정사유",
  blockers: "미충족조건",
  formula: "산식",
  inputs: "입력변수",
  outputs: "출력변수",
  value: "입력값",
  label: "항목명",
  kind: "유형",
  error: "오류",
  citation: "근거법령",
  runtime: "실행결과",
  id: "식별자",
  position: "위치",
  data: "데이터",
  edges: "연결선",
  nodes: "노드",
  name: "명칭",
  year: "기준연도",
  source: "출발",
  target: "도착",
  sourceHandle: "출발포트",
  targetHandle: "도착포트",
  rule: "규칙",
  threshold: "임계값",
  conditional: "조건",
  lookup: "조회",
  direction: "방향",
  reverseSweepVar: "역산변수",
  targetOutput: "목표산출값",
  // --- 입력 / 중간 변수 ---
  marriedChildCount: "자녀수",
  grossSalary: "총급여",
  medicalExpense: "의료비",
  educationExpense: "교육비",
  rentPaid: "월세",
  pensionContribution: "연금납입",
  donation: "기부금",
  childCount: "자녀수",
  sportsExpense: "체육이용료",
  isMarriedInPeriod: "혼인해당",
  claimedBefore: "이전수령",
  spouseClaim: "배우자공제",
  dependentCount: "인원수",
  insurancePremium: "보험료",
  prepaidTax: "기납부세액",
  salary: "총급여",
  householdIncome: "가구합산소득",
  revenue: "수입금액",
  industry: "업종",
  supplyValue: "매출",
  purchaseValue: "매입",
  giftBase: "과세표준",
  inheritanceBase: "과세표준",
  businessIncome: "사업소득",
  financialIncome: "재산소득",
  rentalIncome: "임대소득",
  transferIncome: "이전소득",
  generalProperty: "일반재산",
  financialAssets: "금융재산",
  vehicleAssets: "자동차",
  debt: "부채",
  householdSize: "가구원수",
  overseasDays: "해외체류",
  totalEstate: "상속재산",
  spouseCount: "배우자수",
  parentCount: "부모수",
  salesSupplyAmount: "매출",
  purchaseSupplyAmount: "매입",
  stage: "교육단계",
  recognizedIncome: "소득인정액",
  // --- 결과 키 ---
  earnedDeduction: "근로소득공제액",
  earnedDed: "근로소득공제액",
  earnedIncome: "근로소득금액",
  totalCredits: "세액공제합계",
  refund: "환급/추징액",
  medicalCredit: "의료비세액공제",
  educationCredit: "교육비세액공제",
  rentCredit: "월세세액공제",
  pensionCredit: "연금계좌세액공제",
  donationCredit: "기부금세액공제",
  childCredit: "자녀세액공제",
  marriageCredit: "결혼세액공제",
  sportsCredit: "체육시설세액공제",
  overseasThresholdDays: "해외체류기준일수",
  payable: "납부/환급세액",
  shares: "상속분배",
  ratio: "비율(%)",
  ratioPct: "중위소득비율(%)",
  eligible: "해당여부",
  eligibility: "자격",
};

function translateKeys(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(translateKeys);
  const entries = Object.entries(obj).map(([k, v]) => {
    const kk = KEY_MAP[k] ?? k;
    return [kk, translateKeys(v)] as [string, unknown];
  });
  return Object.fromEntries(entries);
}

function downloadBlob(content: string | Blob, filename: string, type: string) {
  const blob =
    typeof content === "string"
      ? new Blob([content], { type })
      : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXml(obj: unknown, tag = "item", depth = 0): string {
  const indent = "  ".repeat(depth);
  if (obj == null) return `${indent}<${tag} />`;
  if (typeof obj !== "object") {
    return `${indent}<${tag}>${sanitizeXml(String(obj))}</${tag}>`;
  }
  if (Array.isArray(obj)) {
    return obj
      .map((v, i) => toXml(v, `${tag}-${i}`, depth))
      .join("\n");
  }
  const children = Object.entries(obj)
    .map(([k, v]) => toXml(v, k, depth + 1))
    .join("\n");
  return `${indent}<${tag}>\n${children}\n${indent}</${tag}>`;
}

function flattenNodes(nodes: GraphNode[]): Record<string, unknown>[] {
  return nodes.map((n) => {
    const base: Record<string, unknown> = {
      항목명: n.data.label,
      유형: n.data.kind,
      입력값: n.data.value,
      산출결과: n.data.runtime?.output,
      오류: n.data.runtime?.error,
      근거법령: n.data.citation || (n.data.runtime as Record<string, unknown> | undefined)?.legalBasis,
    };
    if (n.data.runtime && typeof n.data.runtime === "object") {
      for (const [k, v] of Object.entries(n.data.runtime)) {
        if (k === "output" || k === "error") continue;
        const kk = KEY_MAP[k] ?? k;
        base[kk] = v;
      }
    }
    return base;
  });
}

export function exportGraphToJson(doc: GraphDoc) {
  const payload = {
    명칭: doc.name,
    기준연도: doc.year,
    노드목록: doc.nodes.map((n) => ({
      식별자: n.id,
      항목명: n.data.label,
      유형: n.data.kind,
      위치: n.position,
      데이터: translateKeys(n.data),
    })),
    연결선목록: doc.edges.map((e) => ({
      식별자: e.id,
      출발: e.source,
      도착: e.target,
      출발포트: e.sourceHandle,
      도착포트: e.targetHandle,
    })),
  };
  const json = JSON.stringify(payload, null, 2);
  downloadBlob(json, `${doc.name || "graph"}.json`, "application/json");
}

export function exportGraphToXml(doc: GraphDoc) {
  const payload = {
    name: doc.name,
    year: doc.year,
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      kind: n.data.kind,
      position: n.position,
      data: translateKeys(n.data),
    })),
    edges: doc.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<graph>\n${toXml(payload, "document", 1)}\n</graph>`;
  downloadBlob(xml, `${doc.name || "graph"}.xml`, "application/xml");
}

export async function exportGraphToXlsx(doc: GraphDoc) {
  const rows = flattenNodes(doc.nodes);
  const xlsx = await import("xlsx");
  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "산출결과");
  const buf = xlsx.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/octet-stream" }),
    `${doc.name || "graph"}.xlsx`,
    "application/octet-stream",
  );
}
