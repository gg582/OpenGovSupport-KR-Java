/**
 * Explainability export — 그래프 전체의 reasoning 을 PDF/JSON/PNG/audit 으로 직렬화.
 * PDF 는 새 탭으로 인쇄용 HTML 을 열고, JSON/Audit 는 download 트리거.
 */

import type { GraphDoc } from "./types";

function escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v, null, 2).slice(0, 400);
  return String(v);
}

export function buildExplainHtml(doc: GraphDoc): string {
  const stamp = new Date().toLocaleString("ko-KR", { hour12: false });
  const rows = doc.nodes.map((n) => {
    const r = n.data.runtime;
    const sub = r?.substituted
      ? Object.entries(r.substituted)
          .map(([k, v]) => `${escape(k)} = ${escape(formatVal(v))}`)
          .join("\n")
      : "";
    return `
      <section>
        <div class="hd">
          <span class="lbl">${escape(n.data.label)}</span>
          <span class="kind">${escape(n.data.kind)}${
      n.data.rule ? ` · ${escape(n.data.rule)}` : ""
    }${
      n.data.direction === "reverse" ? " · REVERSE" : ""
    }</span>
        </div>
        <table>
          <tbody>
            <tr><th>id</th><td>${escape(n.id)}</td></tr>
            <tr><th>raw formula</th><td><pre>${escape(r?.rawFormula ?? "—")}</pre></td></tr>
            <tr><th>substituted</th><td><pre>${escape(sub)}</pre></td></tr>
            <tr><th>output</th><td class="amt">${escape(formatVal(r?.output))}</td></tr>
            <tr><th>legal basis</th><td class="legal">${escape(r?.legalBasis ?? "—")}</td></tr>
            ${
              r?.eligibility
                ? `<tr><th>eligibility</th><td>${
                    r.eligibility.qualified ? "적용 가능" : "적용 불가"
                  } ${escape((r.eligibility.reasons ?? []).join(" / "))}</td></tr>`
                : ""
            }
            <tr><th>duration</th><td>${r?.durationMs ?? 0} ms</td></tr>
          </tbody>
        </table>
      </section>
    `;
  });

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>실행 reasoning — ${escape(doc.name)}</title>
<style>
@page { size: A4 portrait; margin: 16mm 12mm; }
body { font-family: ui-monospace, Menlo, monospace; color:#111; margin:0; padding:18px; }
h1 { font-size: 16pt; margin: 0 0 4px; color:#1a3258; }
.sub { font-size: 10pt; color:#555; margin-bottom: 10px; }
section { margin: 10px 0; border: 1px solid #888; }
.hd { background:#f3efe3; padding: 5px 8px; display:flex; gap:8px; align-items:baseline; border-bottom: 1px solid #888; }
.hd .lbl { font-weight: 700; font-size: 11pt; }
.hd .kind { font-size: 9pt; color:#555; letter-spacing: 0.06em; }
table { width:100%; border-collapse: collapse; font-size: 9.5pt; }
th, td { border-top: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; }
th { width: 22%; background: #f8f8f5; font-weight: 600; color:#444; }
td.amt { font-weight: 700; color: #1a3258; font-variant-numeric: tabular-nums; }
td.legal { color: #134075; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; }
.disclaimer { margin-top: 18px; padding: 6px 10px; font-size: 9pt; background:#fff8e6; border-left: 3px solid #d4a017; color:#5a4500; }
@media print { body { padding: 0; } button.print { display:none; } }
button.print { float:right; padding: 4px 12px; }
</style></head>
<body>
<button class="print" onclick="window.print()">인쇄 / PDF 저장</button>
<h1>${escape(doc.name)} — 실행 reasoning</h1>
<div class="sub">출력 ${escape(stamp)} · year ${escape(String(doc.year ?? "—"))} · 노드 ${doc.nodes.length}개 · 엣지 ${doc.edges.length}개</div>
${rows.join("\n")}
<div class="disclaimer">
  본 reasoning 은 결정적 산식 평가 기록이며 신고·납부·수급의 효력을 갖지 않습니다.
  실제 신고는 홈택스 / 복지로 / 정부24 / 세무전문가를 통해 확정하십시오.
</div>
</body></html>`;
}

export function openExplainPdf(doc: GraphDoc): void {
  const w = window.open("", "_blank");
  if (!w) {
    alert("팝업이 차단되었습니다.");
    return;
  }
  w.document.write(buildExplainHtml(doc));
  w.document.close();
}

export function exportExplainJson(doc: GraphDoc): void {
  const out = {
    graphId: doc.id,
    name: doc.name,
    kind: doc.kind,
    year: doc.year,
    exportedAt: new Date().toISOString(),
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      rule: n.data.rule,
      direction: n.data.direction ?? "forward",
      runtime: n.data.runtime,
    })),
    edges: doc.edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };
  download(`${doc.name || "graph"}.reasoning.json`, JSON.stringify(out, null, 2));
}

export function exportAuditTrail(doc: GraphDoc, logs: { ts: number; nodeId: string; nodeLabel: string; status: string; message: string }[]): void {
  const lines = [
    `# audit-trail`,
    `graph: ${doc.id || "(unsaved)"}`,
    `name: ${doc.name}`,
    `year: ${doc.year ?? "—"}`,
    `exportedAt: ${new Date().toISOString()}`,
    `nodes: ${doc.nodes.length}, edges: ${doc.edges.length}`,
    ``,
    `# execution log`,
  ];
  for (const l of logs) {
    const ts = new Date(l.ts).toISOString();
    lines.push(`${ts} [${l.status.padEnd(7)}] ${l.nodeLabel.padEnd(20)} ${l.message}`);
  }
  download(`${doc.name || "graph"}.audit.txt`, lines.join("\n"));
}

function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
