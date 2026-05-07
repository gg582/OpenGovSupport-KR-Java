"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { useGraphStore } from "../lib/store";
import type { NodeData } from "../lib/types";

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

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "object") return "{…}";
  return String(v).slice(0, 20);
}

export default function EasyStatNode({ id, data, selected }: NodeProps<NodeData>) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const runFrom = useGraphStore((s) => s.runFrom);

  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];

  const onValueChange = (v: string) => {
    const num = Number(v);
    updateNodeData(id, { value: Number.isFinite(num) ? num : v });
    queueMicrotask(() => runFrom(id));
  };

  const isEditable = data.kind === "input" || data.kind === "manual";
  const showResult = data.runtime != null;

  return (
    <>
      <div
        className={`easy-stat-node ${selected ? "selected" : ""}`}
        data-kind={data.kind}
      >
        <div className="easy-head">
          <span className="easy-dot" />
          <span className="easy-ttl">{data.label}</span>
          <span className="easy-kind">{EASY_LABELS[data.kind] ?? data.kind}</span>
        </div>

        <div className="easy-body">
          {isEditable && (
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
                {data.runtime!.error ? "계산 오류" : fmt(data.runtime!.output)}
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
