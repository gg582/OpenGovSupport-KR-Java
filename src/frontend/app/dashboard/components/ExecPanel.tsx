"use client";

import { useGraphStore } from "../lib/store";
import StructuredValue from "./StructuredValue";

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function isPrimitive(v: unknown): boolean {
  return v == null || typeof v !== "object";
}

export default function ExecPanel() {
  const selectedId = useGraphStore((s) => s.selectedId);
  const node = useGraphStore((s) =>
    selectedId ? s.doc.nodes.find((n) => n.id === selectedId) : null,
  );

  if (!node) {
    return (
      <aside className="dash-exec">
        <h3>EXECUTION</h3>
        <div className="empty">노드를 클릭하면 산식·자격·법령·결과가 여기에 표시됩니다.</div>
        <h3>HINT</h3>
        <div className="empty">
          좌측 팔레트에서 노드를 캔버스에 추가하고, 노드 변의 핸들을 드래그해 연결하세요.
          입력값이 변경되면 하류 노드가 자동 재실행됩니다 (Java 백엔드 호출).
        </div>
      </aside>
    );
  }

  const rt = node.data.runtime;
  const r = rt;

  return (
    <aside className="dash-exec">
      <h3>NODE</h3>
      <dl className="kv">
        <dt>id</dt>
        <dd>{node.id}</dd>
        <dt>kind</dt>
        <dd>{node.data.kind}</dd>
        <dt>label</dt>
        <dd>{node.data.label}</dd>
        {node.data.rule && (
          <>
            <dt>rule</dt>
            <dd>{node.data.rule}</dd>
          </>
        )}
      </dl>

      <h3>RAW FORMULA</h3>
      <div className={r?.rawFormula ? "formula" : "empty"}>
        {r?.rawFormula ?? "(아직 실행되지 않았습니다)"}
      </div>

      <h3>RESOLVED VARIABLES</h3>
      {r?.substituted && Object.keys(r.substituted).length > 0 ? (
        <dl className="kv">
          {Object.entries(r.substituted).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{fmt(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="empty">없음</div>
      )}

      <h3>LEGAL CITATION</h3>
      <div className={r?.legalBasis ? "citation" : "empty"}>
        {r?.legalBasis ?? "(미기재)"}
      </div>

      <h3>FINAL OUTPUT</h3>
      {r?.error ? (
        <div className="empty" style={{ color: "#ee7d7d" }}>
          ERROR: {r.error}
        </div>
      ) : r ? (
        isPrimitive(r.output) ? (
          <div className="out-amount">{fmt(r.output)}</div>
        ) : (
          <div className="out-struct">
            <StructuredValue value={r.output} />
          </div>
        )
      ) : (
        <div className="empty">(미실행)</div>
      )}
      {r?.durationMs != null && (
        <dl className="kv" style={{ marginTop: 4 }}>
          <dt>duration</dt>
          <dd>{r.durationMs}ms</dd>
          <dt>epoch</dt>
          <dd>{r.epoch}</dd>
        </dl>
      )}

      <h3>ELIGIBILITY</h3>
      {r?.eligibility ? (
        <dl className="kv">
          <dt>qualified</dt>
          <dd>{r.eligibility.qualified ? "예 (적용 가능)" : "아니오 (차단)"}</dd>
          {r.eligibility.reasons && r.eligibility.reasons.length > 0 && (
            <>
              <dt>사유</dt>
              <dd>{r.eligibility.reasons.join(" / ")}</dd>
            </>
          )}
          {r.eligibility.blockers && r.eligibility.blockers.length > 0 && (
            <>
              <dt>블록</dt>
              <dd>{r.eligibility.blockers.join(" / ")}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className="empty">(자격 분기 없음)</div>
      )}

      <h3>INTERMEDIATE</h3>
      {r?.intermediate && Object.keys(r.intermediate).length > 0 ? (
        <dl className="kv">
          {Object.entries(r.intermediate).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{fmt(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="empty">없음</div>
      )}

      <h3>RAW JSON</h3>
      {r ? (
        <pre className="raw-json">{JSON.stringify(r, null, 2)}</pre>
      ) : (
        <div className="empty">(미실행)</div>
      )}
    </aside>
  );
}
