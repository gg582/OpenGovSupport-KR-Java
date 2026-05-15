"use client";

import { useEffect, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { useGraphStore } from "../lib/store";
import type { NodeData } from "../lib/types";
import { debounce } from "../lib/debounce";

const EASY_LABELS: Record<string, string> = {
  input: "입력",
  manual: "수치",
  formula: "계산",
  conditional: "조건",
  threshold: "기준",
  lookup: "조회",
  legal: "법령",
  output: "결과",
  pdf: "출력",
};

/** 객체 키 → 한국어 라벨 규칙 매핑 */
const KEY_LABELS: Record<string, string> = {
  perPerson: "1인당 분배액",
  count: "인원수",
  total: "합계액",
  근거: "근거",
  shares: "상속분",
  reservedShare: "유류분",
  allocatedTotal: "배정 총액",
  appliedTier: "적용 순위",
  error: "오류",
  durationMs: "소요시간(ms)",
  rawFormula: "산식",
  legalBasis: "근거법령",
  substituted: "치환변수",
  intermediate: "중간값",
  eligibility: "자격",
  qualified: "충족여부",
  reasons: "통과사유",
  blockers: "미충족사유",
  amount: "금액",
  deduction: "공제액",
  payable: "납부세액",
  ratio: "비율(%)",
  recognizedIncome: "소득인정액",
  eligible: "해당여부",
  stage: "교육단계",
  industry: "업종",
  year: "기준연도",
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
  taxableIncome: "과세표준",
  salary: "총급여",
  householdIncome: "가구합산소득",
  revenue: "수입금액",
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
};

function FmtValue({ v }: { v: unknown }) {
  if (v == null) return <span>—</span>;
  if (typeof v === "number") return <span>{v.toLocaleString("ko-KR")}</span>;
  if (typeof v === "boolean") return <span>{v ? "예" : "아니오"}</span>;
  if (typeof v === "string") return <span>{v}</span>;
  if (Array.isArray(v)) {
    return (
      <div className="easy-array">
        {v.map((item, i) => (
          <div key={i} className="easy-array-item">
            <FmtValue v={item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return <span>—</span>;
    return (
      <div className="easy-object">
        {entries.map(([key, val]) => (
          <div key={key} className="easy-object-row">
            <span className="easy-object-key">{KEY_LABELS[key] ?? key}</span>
            <span className="easy-object-sep">:</span>
            <span className="easy-object-value">
              <FmtValue v={val} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(v)}</span>;
}

export default function EasyStatNode({ id, data, selected }: NodeProps<NodeData>) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const runFrom = useGraphStore((s) => s.runFrom);
  const execState = useGraphStore((s) => s.execState);

  const edges = useGraphStore((s) => s.doc.edges);
  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];
  const hasUpstream = edges.some((e) => e.target === id);
  const isActive = data.kind === "input" || data.kind === "manual" || hasUpstream;

  const debouncedRun = useMemo(
    () => debounce((nodeId: string) => runFrom(nodeId), 320),
    [runFrom],
  );
  useEffect(() => () => debouncedRun.cancel(), [debouncedRun]);

  const onValueChange = (v: string) => {
    const num = Number(v);
    updateNodeData(id, { value: Number.isFinite(num) ? num : v });
    debouncedRun(id);
  };

  const isEditable = data.kind === "input" || data.kind === "manual";
  const showResult = data.runtime != null;
  const isRunning = execState === "running";
  const hasOptions = Array.isArray(data.options) && data.options.length > 0;

  return (
    <>
      <div
        className={`easy-stat-node ${selected ? "selected" : ""} ${isRunning ? "running" : ""} ${isActive ? "" : "inactive"}`}
        data-kind={data.kind}
      >
        <div className="easy-head">
          <span className="easy-dot" />
          <span className="easy-ttl">{data.label}</span>
          <span className="easy-kind">{EASY_LABELS[data.kind] ?? data.kind}</span>
        </div>

        <div className="easy-body">
          {isEditable && hasOptions && (
            <div className="easy-field">
              <label>값 선택</label>
              <select
                value={typeof data.value === "string" ? data.value : (data.options![0] ?? "")}
                onChange={(e) => onValueChange(e.target.value)}
                className="nodrag"
              >
                {data.options!.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isEditable && !hasOptions && (
            <div className="easy-field">
              <label>값 입력</label>
              <input
                type="number"
                value={typeof data.value === "number" ? data.value : (data.value as string) ?? ""}
                onChange={(e) => onValueChange(e.target.value)}
                className="nodrag"
              />
            </div>
          )}

          {showResult && (
            <div className="easy-result">
              <span className="easy-result-label">
                {data.kind === "output" || data.kind === "pdf" ? "최종 결과" : "계산 결과"}
              </span>
              <span className="easy-result-value">
                {data.runtime!.error ? "계산 오류" : <FmtValue v={data.runtime!.output} />}
              </span>
            </div>
          )}
        </div>
      </div>

      {inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{
            top: portTop(i, inputs.length),
            left: -5,
            opacity: 0,
            width: 1,
            height: 1,
          }}
        />
      ))}
      {outputs.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          style={{
            top: portTop(i, outputs.length),
            right: -5,
            opacity: 0,
            width: 1,
            height: 1,
          }}
        />
      ))}
    </>
  );
}

function portTop(index: number, total: number): string {
  if (total <= 1) return "50%";
  const span = 100 - 24;
  const step = span / (total - 1);
  return `${12 + index * step}%`;
}
