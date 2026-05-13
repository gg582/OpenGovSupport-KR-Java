"use client";

import { useGraphStore } from "../lib/store";

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `목록 ${v.length}건`;
  if (typeof v === "object") return `데이터 ${Object.keys(v).length}항`;
  return String(v);
}

const EASY_KIND: Record<string, string> = {
  input: "입력값",
  manual: "고정값",
  formula: "계산식",
  conditional: "조건분기",
  threshold: "기준판단",
  lookup: "표조회",
  legal: "법령근거",
  output: "최종결과",
  pdf: "출력서식",
};

export default function EasyExecPanel() {
  const selectedId = useGraphStore((s) => s.selectedId);
  const node = useGraphStore((s) =>
    selectedId ? s.doc.nodes.find((n) => n.id === selectedId) : null,
  );

  if (!node) {
    return (
      <aside className="dash-exec easy-exec">
        <div className="easy-exec-hint">
          <strong>그래프를 확인하세요</strong>
          <p>노드를 클릭하면 계산 결과가 여기에 표시됩니다.</p>
        </div>
      </aside>
    );
  }

  const rt = node.data.runtime;

  return (
    <aside className="dash-exec easy-exec">
      <div className="easy-exec-card">
        <div className="easy-exec-header">
          <span className="easy-exec-kind">{EASY_KIND[node.data.kind] ?? node.data.kind}</span>
          <span className="easy-exec-name">{node.data.label}</span>
        </div>

        {rt?.error ? (
          <div className="easy-exec-result easy-exec-error">
            <span className="easy-exec-result-label">오류</span>
            <span className="easy-exec-result-value">{rt.error}</span>
          </div>
        ) : rt ? (
          <div className="easy-exec-result">
            <span className="easy-exec-result-label">
              {node.data.kind === "output" || node.data.kind === "pdf" ? "최종 결과" : "계산 결과"}
            </span>
            <span className="easy-exec-result-value">{fmt(rt.output)}</span>
          </div>
        ) : (
          <div className="easy-exec-result easy-exec-idle">
            <span className="easy-exec-result-label">계산 결과</span>
            <span className="easy-exec-result-value">아직 실행되지 않았습니다</span>
          </div>
        )}

        {rt?.legalBasis && (
          <div className="easy-exec-basis">
            <span>근거 법령</span>
            <p>{rt.legalBasis}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
