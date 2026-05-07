import type { Feature, Result } from "./api";

/**
 * 모든 feature 결과를 A4 portrait 인쇄/PDF 용 HTML 로 변환.
 * 백엔드에서 별도 PDF 엔드포인트를 두지 않고 클라이언트가 result.text + result.data 만으로
 * 인쇄용 페이지를 생성해 새 탭으로 연다.
 */
export function buildPrintableHtml(feature: Feature, result: Result): string {
  const title = result.title || feature.title;
  const sub = `${feature.domainTitle} · ${feature.section === "tax" ? "개인세무" : "사회복지"}`;
  const stamp = new Date().toLocaleString("ko-KR", { hour12: false });

  const stepsHtml = renderExplanationSteps(result);
  const textHtml = stepsHtml || renderText(result.text);
  const dataHtml = renderDataTable(result.data);

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${escape(title)}</title>
<style>
@page { size: A4 portrait; margin: 18mm 14mm; }
body { font-family: "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif; color:#111; margin:0; padding:24px; }
header { border-bottom: 2px solid #1a2747; padding-bottom: 10px; margin-bottom: 16px; }
h1 { font-size: 18pt; margin: 0 0 4px; color:#1a2747; }
.sub { font-size: 10pt; color:#555; }
.meta { font-size: 9pt; color:#777; margin-top:4px; }
section { margin: 14px 0; }
.section-title { font-size: 11pt; font-weight: bold; color:#1a2747; border-left: 3px solid #1a2747; padding-left: 8px; margin-bottom: 8px; }
table { width:100%; border-collapse: collapse; font-size: 10pt; }
th, td { border:1px solid #888; padding:5px 8px; text-align:left; vertical-align: top; }
th { background:#f3efe3; font-weight: 600; }
td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
.body { white-space: pre-wrap; line-height: 1.55; font-size: 10pt; padding: 8px 4px; }
.kv th { width: 32%; }
.steps th { width: 18%; white-space: nowrap; }
.disclaimer { margin-top: 24px; padding: 8px 10px; background:#fff8e6; border-left: 3px solid #d4a017; font-size: 9pt; color:#5a4500; }
@media print { body { padding:0; } button.print { display:none; } }
button.print { float:right; padding:6px 14px; font-size: 10pt; cursor: pointer; }
</style></head>
<body>
<button class="print" onclick="window.print()">인쇄 / PDF 저장</button>
<header>
  <h1>${escape(title)}</h1>
  <div class="sub">${escape(sub)}</div>
  <div class="meta">출력 ${escape(stamp)} · 산식 ID: ${escape(feature.id)}</div>
</header>
<section>
  <div class="section-title">계산 결과</div>
  ${textHtml}
</section>
${dataHtml}
<div class="disclaimer">
  본 출력본은 법령의 공개 산식을 코드로 평가한 참고 자료이며, 신고·납부·수급의 효력을 갖지 않습니다.
  실제 신고는 홈택스(국세청) 또는 복지로(보건복지부)·관할 주민센터·세무전문가를 통해 확정하십시오.
</div>
</body></html>`;
}

function renderText(text: string | undefined): string {
  if (!text) return '<div class="body">(결과 텍스트 없음)</div>';
  return `<div class="body">${escape(text)}</div>`;
}

function renderExplanationSteps(result: Result): string | null {
  const steps = result.data?.explanationSteps as { label: string; body: string }[] | undefined;
  if (!steps || steps.length === 0) return null;
  const rows = steps
    .map(
      (s) =>
        `<tr><th>${escape(s.label)}</th><td>${escape(s.body)}</td></tr>`,
    )
    .join("");
  return `<table class="steps"><tbody>${rows}</tbody></table>`;
}

function renderDataTable(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const entries = Object.entries(data).filter(
    ([k]) => k !== "explanationSteps",
  );
  if (entries.length === 0) return "";

  const rows = entries
    .map(([k, v]) => {
      const valueHtml = formatValue(v);
      return `<tr><th>${escape(k)}</th><td>${valueHtml}</td></tr>`;
    })
    .join("");
  return `<section><div class="section-title">구조화 데이터</div><table class="kv"><tbody>${rows}</tbody></table></section>`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "<i>—</i>";
  if (typeof v === "number") return escape(formatNumber(v));
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "string") return escape(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "<i>(없음)</i>";
    if (v.every((x) => typeof x === "object" && x !== null)) {
      return renderArrayOfObjects(v as Record<string, unknown>[]);
    }
    return v
      .map((x) => formatValue(x))
      .map((s) => `<div>· ${s}</div>`)
      .join("");
  }
  if (typeof v === "object") {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `<tr><th>${escape(k)}</th><td>${formatValue(x)}</td></tr>`)
      .join("");
    return `<table class="kv"><tbody>${inner}</tbody></table>`;
  }
  return escape(String(v));
}

function renderArrayOfObjects(arr: Record<string, unknown>[]): string {
  const cols = Array.from(
    arr.reduce((acc, o) => {
      Object.keys(o).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const head = `<tr>${cols.map((c) => `<th>${escape(c)}</th>`).join("")}</tr>`;
  const body = arr
    .map(
      (row) =>
        `<tr>${cols
          .map((c) => `<td>${formatValue(row[c])}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString("ko-KR");
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 새 탭에서 인쇄용 페이지를 연다. */
export function openPrintable(feature: Feature, result: Result): void {
  const html = buildPrintableHtml(feature, result);
  const w = window.open("", "_blank");
  if (!w) {
    alert("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.");
    return;
  }
  w.document.write(html);
  w.document.close();
}
