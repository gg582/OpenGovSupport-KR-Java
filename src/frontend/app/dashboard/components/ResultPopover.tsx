"use client";

import { NodeToolbar, Position } from "reactflow";
import type { NodeData } from "../lib/types";
import StructuredValue from "./StructuredValue";

/**
 * 노드 위(또는 아래) 에 떠오르는 결과 팝업.
 * 노드를 클릭(=selected) 했을 때만 표시. JSON 패널이 아니라 구조화된 표.
 *
 * - ReactFlow 의 NodeToolbar 는 노드의 화면 위치를 자동 추적 (zoom/pan 따라 이동).
 * - 팝업 안의 표는 ExecPanel 사이드바와 같은 데이터지만 행/열 형태로 압축 표시.
 */
export default function ResultPopover({
  nodeId,
  data,
  isSelected,
}: {
  nodeId: string;
  data: NodeData;
  isSelected: boolean;
}) {
  const r = data.runtime;

  return (
    <NodeToolbar
      isVisible={isSelected}
      position={Position.Top}
      offset={10}
      // 노드 자체의 클릭/드래그 이벤트와 분리 — 팝업 내 입력은 캔버스로 새지 않음.
      className="result-popover nodrag nopan"
    >
      <div className="rp-card" onClick={(e) => e.stopPropagation()}>
        <div className="rp-head">
          <span className="rp-id">{nodeId}</span>
          <span className="rp-kind">{data.kind.toUpperCase()}</span>
          {data.rule && <span className="rp-rule">{data.rule}</span>}
        </div>

        {!r ? (
          <div className="rp-empty">아직 실행되지 않았습니다.</div>
        ) : r.error ? (
          <div className="rp-error">ERROR: {r.error}</div>
        ) : (
          <table className="rp-table">
            <colgroup>
              <col style={{ width: "32%" }} />
              <col />
            </colgroup>
            <tbody>
              <Row label="라벨" value={data.label} />
              {r.rawFormula && <Row label="산식" value={r.rawFormula} mono />}
              {r.legalBasis && <Row label="근거" value={r.legalBasis} />}
              <SectionRow title="입력 변수" />
              {kvRows(r.substituted)}
              {r.intermediate && Object.keys(r.intermediate).length > 0 && (
                <>
                  <SectionRow title="중간 계산" />
                  {kvRows(r.intermediate)}
                </>
              )}
              {r.eligibility && (
                <>
                  <SectionRow title="자격 판정" />
                  <Row
                    label="qualified"
                    value={r.eligibility.qualified ? "예" : "아니오"}
                    accent={r.eligibility.qualified ? "ok" : "no"}
                  />
                  {r.eligibility.reasons?.length ? (
                    <Row label="사유" value={r.eligibility.reasons.join(" / ")} />
                  ) : null}
                  {r.eligibility.blockers?.length ? (
                    <Row label="블록" value={r.eligibility.blockers.join(" / ")} />
                  ) : null}
                </>
              )}
              <SectionRow title="최종 출력" />
              <tr className={isPrimitive(r.output) ? "rp-final" : "rp-final rp-final-block"}>
                <th>output</th>
                <td>
                  <StructuredValue value={r.output} />
                </td>
              </tr>
              {r.durationMs != null && (
                <Row label="duration" value={`${r.durationMs}ms · epoch ${r.epoch}`} />
              )}
            </tbody>
          </table>
        )}
      </div>
    </NodeToolbar>
  );
}

function Row({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "ok" | "no";
}) {
  return (
    <tr className={accent ? `rp-row rp-${accent}` : "rp-row"}>
      <th>{label}</th>
      <td className={mono ? "mono" : undefined}>{value}</td>
    </tr>
  );
}

function SectionRow({ title }: { title: string }) {
  return (
    <tr className="rp-section">
      <th colSpan={2}>{title}</th>
    </tr>
  );
}

function kvRows(obj: Record<string, unknown> | undefined) {
  if (!obj || Object.keys(obj).length === 0) {
    return (
      <tr className="rp-row rp-dim">
        <th>—</th>
        <td>없음</td>
      </tr>
    );
  }
  return Object.entries(obj).map(([k, v]) => (
    <tr key={k} className="rp-row">
      <th>{k}</th>
      <td>{fmt(v)}</td>
    </tr>
  ));
}

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "예" : "아니오";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function isPrimitive(v: unknown): boolean {
  return v == null || typeof v !== "object";
}
