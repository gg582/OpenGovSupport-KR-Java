"use client";

import { useMemo, useState } from "react";
import { callFeature, type Feature, type Input, type Result } from "../lib/api";

function emptyRow(columns: Input[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const c of columns) o[c.name] = c.default ?? "";
  return o;
}

function defaultValues(inputs: Input[]): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const i of inputs) {
    if (i.kind === "rows") {
      const cols = i.columns ?? [];
      v[i.name] = [emptyRow(cols), emptyRow(cols)];
    } else if (i.kind === "select") {
      v[i.name] = i.default ?? (i.options?.[0] ?? "");
    } else {
      v[i.name] = i.default ?? "";
    }
  }
  return v;
}

export default function FeatureForm({ feature }: { feature: Feature }) {
  const initial = useMemo(() => defaultValues(feature.inputs), [feature]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function setScalar(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }
  function setRowCell(name: string, idx: number, col: string, value: string) {
    setValues((v) => {
      const rows = [...((v[name] as Record<string, string>[]) ?? [])];
      rows[idx] = { ...rows[idx], [col]: value };
      return { ...v, [name]: rows };
    });
  }
  function addRow(input: Input) {
    setValues((v) => {
      const rows = [...((v[input.name] as Record<string, string>[]) ?? [])];
      rows.push(emptyRow(input.columns ?? []));
      return { ...v, [input.name]: rows };
    });
  }
  function removeRow(name: string, idx: number) {
    setValues((v) => {
      const rows = [...((v[name] as Record<string, string>[]) ?? [])];
      rows.splice(idx, 1);
      return { ...v, [name]: rows };
    });
  }
  function reset() {
    setValues(initial);
    setResult(null);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await callFeature(feature.id, values);
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openPreview() {
    if (!result?.html) return;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(result.html);
      w.document.close();
    }
  }

  // separate row-kind inputs (which render as full-width tables)
  // from scalar inputs (which render in the key-value form table).
  const scalarInputs = feature.inputs.filter((i) => i.kind !== "rows");
  const rowInputs = feature.inputs.filter((i) => i.kind === "rows");

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        {scalarInputs.length > 0 && (
          <section className="panel">
            <div className="panel-header">입력 정보</div>
            <div className="form-grid">
              {scalarInputs.map((input) => (
                <div className="form-row" key={input.name}>
                  <div className="label">
                    <span>{input.label}</span>
                    {input.required && <span className="text-red-600">*</span>}
                  </div>
                  <div className="value space-y-1">
                    {renderField(input, values, setScalar)}
                    {input.help && <div className="text-xs text-navy/55">{input.help}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {rowInputs.map((input) => (
          <section className="panel" key={input.name}>
            <div className="panel-header">
              {input.label}
              <span className="ml-auto text-xs font-mono text-navy/50 font-normal">
                {((values[input.name] as Record<string, string>[]) ?? []).length} 행
              </span>
            </div>
            {input.help && (
              <div className="px-4 pt-3 text-xs text-navy/60">{input.help}</div>
            )}
            <div className="px-4 pb-4 pt-3 overflow-x-auto">
              <RowsField
                input={input}
                rows={(values[input.name] as Record<string, string>[]) ?? []}
                onSet={(idx, col, val) => setRowCell(input.name, idx, col, val)}
                onAdd={() => addRow(input)}
                onRemove={(idx) => removeRow(input.name, idx)}
              />
            </div>
          </section>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "계산 중…" : "■ 계산 실행"}
          </button>
          <button type="button" className="btn-secondary" onClick={reset}>
            입력 초기화
          </button>
          <span className="ml-auto text-xs font-mono text-navy/50">
            POST /api/{feature.id}
          </span>
        </div>
      </form>

      {error && (
        <div className="panel border-red-300 bg-red-50">
          <div className="panel-header text-red-700">오류</div>
          <div className="px-4 py-3 text-sm font-mono text-red-700">{error}</div>
        </div>
      )}

      {result && (
        <section className="panel">
          <div className="panel-header">
            {result.title || "계산 결과"}
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={copy}>
                {copied ? "✓ 복사됨" : "텍스트 복사"}
              </button>
              {result.html && (
                <button type="button" className="btn-secondary text-xs" onClick={openPreview}>
                  인쇄/PDF 미리보기
                </button>
              )}
            </span>
          </div>
          {result.notes && result.notes.length > 0 && (
            <div className="px-4 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-900">
              {result.notes.map((n, i) => (
                <div key={i}>· {n}</div>
              ))}
            </div>
          )}
          <pre className="px-4 py-4 m-0 text-sm leading-relaxed font-mono text-navy whitespace-pre-wrap break-words bg-page border-b border-line">
{result.text}
          </pre>
          {result.data && Object.keys(result.data).length > 0 && (
            <details className="px-4 py-3 text-xs">
              <summary className="cursor-pointer text-navy/70 hover:text-accent select-none">
                ▶ 구조화 데이터 (JSON)
              </summary>
              <pre className="mt-2 p-3 bg-navy text-white/90 font-mono text-xs leading-relaxed overflow-x-auto rounded-sm">
{JSON.stringify(result.data, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function renderField(
  input: Input,
  values: Record<string, unknown>,
  setScalar: (n: string, v: string) => void,
) {
  if (input.kind === "select") {
    return (
      <select
        id={input.name}
        className="field-input"
        value={(values[input.name] as string) ?? ""}
        onChange={(e) => setScalar(input.name, e.target.value)}
      >
        {(input.options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (input.kind === "textarea") {
    return (
      <textarea
        id={input.name}
        className="field-input"
        value={(values[input.name] as string) ?? ""}
        onChange={(e) => setScalar(input.name, e.target.value)}
        placeholder={input.placeholder}
      />
    );
  }
  return (
    <input
      id={input.name}
      type={input.kind === "date" ? "date" : input.kind === "number" ? "number" : "text"}
      step={input.kind === "number" ? "any" : undefined}
      className="field-input"
      value={(values[input.name] as string) ?? ""}
      onChange={(e) => setScalar(input.name, e.target.value)}
      placeholder={input.placeholder}
      required={input.required}
    />
  );
}

function RowsField({
  input,
  rows,
  onSet,
  onAdd,
  onRemove,
}: {
  input: Input;
  rows: Record<string, string>[];
  onSet: (idx: number, col: string, val: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  const cols = input.columns ?? [];
  return (
    <>
      <table className="gov-table">
        <thead>
          <tr>
            <th className="w-[40px] text-center">No.</th>
            {cols.map((c) => <th key={c.name}>{c.label}</th>)}
            <th className="w-[60px]" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 2} className="text-center text-navy/55 py-6">
                입력된 데이터가 없습니다. 아래 [+ 행 추가] 버튼으로 시작하세요.
              </td>
            </tr>
          )}
          {rows.map((row, idx) => (
            <tr key={idx}>
              <td className="text-center font-mono text-navy/70">{String(idx + 1).padStart(2, "0")}</td>
              {cols.map((c) => (
                <td key={c.name}>
                  <input
                    type={c.kind === "date" ? "date" : c.kind === "number" ? "number" : "text"}
                    step={c.kind === "number" ? "any" : undefined}
                    className="field-input"
                    value={row[c.name] ?? ""}
                    onChange={(e) => onSet(idx, c.name, e.target.value)}
                    placeholder={c.placeholder}
                  />
                </td>
              ))}
              <td className="text-center">
                <button type="button" className="btn-ghost" onClick={() => onRemove(idx)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary" onClick={onAdd}>
          + 행 추가
        </button>
      </div>
    </>
  );
}
