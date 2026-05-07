"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { useGraphStore } from "../lib/store";
import type { NodeData } from "../lib/types";

const KIND_LABEL: Record<string, string> = {
  input: "INPUT",
  manual: "MANUAL",
  formula: "FORMULA",
  conditional: "COND",
  threshold: "THRESH",
  lookup: "LOOKUP",
  legal: "LEGAL",
  output: "OUTPUT",
  pdf: "PDF",
};

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "object") return "{…}";
  return String(v).slice(0, 20);
}

export default function StatNode({ id, data, selected }: NodeProps<NodeData>) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const runFrom = useGraphStore((s) => s.runFrom);
  const toggleNodeDirection = useGraphStore((s) => s.toggleNodeDirection);

  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];
  const reverseMode = data.direction === "reverse";

  const onValueChange = (v: string) => {
    const num = Number(v);
    updateNodeData(id, { value: Number.isFinite(num) ? num : v });
    // 입력값이 바뀌면 곧바로 incremental 재실행.
    queueMicrotask(() => runFrom(id));
  };

  const onLimitChange = (v: string) => {
    const num = Number(v);
    if (!data.threshold) return;
    updateNodeData(id, { threshold: { ...data.threshold, limit: num } });
    queueMicrotask(() => runFrom(id));
  };

  const onOpChange = (op: string) => {
    if (data.threshold) {
      updateNodeData(id, { threshold: { ...data.threshold, op: op as never } });
    } else if (data.conditional) {
      updateNodeData(id, { conditional: { ...data.conditional, op: op as never } });
    }
    queueMicrotask(() => runFrom(id));
  };

  return (
    <div
      className={`stat-node ${selected ? "selected" : ""} ${reverseMode ? "reverse" : ""}`}
      data-kind={data.kind}
    >
      {/* head */}
      <div className="head">
        <span className="dot" />
        <span className="ttl">{data.label}</span>
        <span className="kind">{KIND_LABEL[data.kind] ?? data.kind}</span>
        {data.kind === "formula" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleNodeDirection(id);
              queueMicrotask(() => runFrom(id));
            }}
            className="nodrag"
            title={reverseMode ? "Reverse 모드 — 출력 → 입력 역산" : "Forward 모드"}
            style={{
              background: reverseMode ? "#7546b8" : "#1d2330",
              border: "1px solid",
              borderColor: reverseMode ? "#a883da" : "#2a313e",
              color: reverseMode ? "#fff" : "#97a3b9",
              cursor: "pointer",
              padding: "0 6px",
              font: "inherit",
              fontSize: 9,
              letterSpacing: "0.08em",
              gridColumn: "3",
              marginLeft: 6,
            }}
          >
            {reverseMode ? "REV" : "FWD"}
          </button>
        )}
      </div>

      {/* body */}
      <div className="body">
        {(data.kind === "input" || data.kind === "manual") && (
          <input
            type="number"
            value={typeof data.value === "number" ? data.value : (data.value as string) ?? ""}
            onChange={(e) => onValueChange(e.target.value)}
            className="nodrag"
          />
        )}
        {data.kind === "threshold" && data.threshold && (
          <>
            <select
              value={data.threshold.op}
              onChange={(e) => onOpChange(e.target.value)}
              className="nodrag"
            >
              <option value="gt">&gt;</option>
              <option value="gte">&gt;=</option>
              <option value="lt">&lt;</option>
              <option value="lte">&lt;=</option>
              <option value="eq">=</option>
            </select>
            <input
              type="number"
              value={data.threshold.limit}
              onChange={(e) => onLimitChange(e.target.value)}
              className="nodrag"
              placeholder="limit"
            />
          </>
        )}
        {data.kind === "conditional" && data.conditional && (
          <>
            <select
              value={data.conditional.op}
              onChange={(e) => onOpChange(e.target.value)}
              className="nodrag"
            >
              <option value="gt">&gt;</option>
              <option value="gte">&gt;=</option>
              <option value="lt">&lt;</option>
              <option value="lte">&lt;=</option>
              <option value="eq">=</option>
            </select>
            <input
              type="number"
              value={data.conditional.value}
              onChange={(e) => {
                const num = Number(e.target.value);
                updateNodeData(id, {
                  conditional: { ...data.conditional!, value: num },
                });
                queueMicrotask(() => runFrom(id));
              }}
              className="nodrag"
              placeholder="value"
            />
          </>
        )}
        {data.kind === "legal" && (
          <input
            type="text"
            value={data.citation ?? ""}
            onChange={(e) => updateNodeData(id, { citation: e.target.value })}
            className="nodrag"
            placeholder="「소득세법」 제○○조"
          />
        )}

        {/* Reverse 모드 — formula 노드 한정 — 목표 출력값 + 풀 변수 선택 */}
        {data.kind === "formula" && reverseMode && (
          <>
            <input
              type="number"
              value={data.targetOutput ?? ""}
              onChange={(e) =>
                updateNodeData(id, {
                  targetOutput: Number(e.target.value),
                })
              }
              className="nodrag"
              placeholder="목표 출력값 (target)"
            />
            <select
              value={data.reverseSweepVar ?? inputs[0]?.id ?? ""}
              onChange={(e) =>
                updateNodeData(id, { reverseSweepVar: e.target.value })
              }
              className="nodrag"
              title="역산할 입력 변수"
            >
              {inputs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}

        {(inputs.length > 0 || outputs.length > 0) && (
          <div className="ports">
            <div className="col">
              <span className="lab">in</span>
              {inputs.map((p) => (
                <span key={p.id}>· {p.label}</span>
              ))}
              {inputs.length === 0 && <span style={{ opacity: 0.4 }}>—</span>}
            </div>
            <div className="col" style={{ textAlign: "right" }}>
              <span className="lab">out</span>
              {outputs.map((p) => (
                <span key={p.id}>{p.label} ·</span>
              ))}
              {outputs.length === 0 && <span style={{ opacity: 0.4 }}>—</span>}
            </div>
          </div>
        )}
      </div>

      {/* foot */}
      <div className={footClass(data)}>
        <span className="key">out</span>
        <span className="val">{footValue(data)}</span>
      </div>

      {/* React Flow handles — left for inputs, right for outputs. */}
      {inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{
            top: portTop(i, inputs.length),
            left: -5,
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
          }}
        />
      ))}
    </div>
  );
}

function footClass(d: NodeData): string {
  if (!d.runtime) return "foot idle";
  if (d.runtime.error) return "foot err";
  return "foot";
}

function footValue(d: NodeData): string {
  if (!d.runtime) return "(미실행)";
  if (d.runtime.error) return d.runtime.error.slice(0, 24);
  return fmt(d.runtime.output);
}

/** 포트가 노드 변에 균등 분포되도록 top% 계산. */
function portTop(index: number, total: number): string {
  if (total <= 1) return "50%";
  const span = 100 - 24; // 위 12% / 아래 12% 여유
  const step = span / (total - 1);
  return `${12 + index * step}%`;
}
