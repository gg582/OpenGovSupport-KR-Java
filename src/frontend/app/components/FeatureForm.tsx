"use client";

import { useMemo, useState } from "react";
import { callFeature, type Feature, type Input, type Result } from "../lib/api";
import { openPrintable } from "../lib/printable";

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

/** 근로소득공제 composite 의 세액공제 상세 필드 목록. */
const CREDIT_FIELDS = new Set([
  "medicalExpense",
  "educationExpense",
  "rentPaid",
  "pensionContribution",
  "donation",
  "childCount",
  "isMarriedInPeriod",
  "claimedBefore",
  "spouseClaim",
  "sportsExpense",
]);

export default function FeatureForm({ feature }: { feature: Feature }) {
  const initial = useMemo(() => defaultValues(feature.inputs), [feature]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isEarnedComposite = feature.id === "tax/earned-income-deduction";
  const grossSalaryVal = Number(values["grossSalary"] || 0);
  const hasGrossSalary = grossSalaryVal > 0;

  function validate(name: string, value: string): string | undefined {
    if (!isEarnedComposite) return undefined;
    if (name === "grossSalary") {
      const n = Number(value);
      if (!value || n <= 0) return "총급여를 0보다 큰 값으로 입력해야 합니다.";
    }
    const input = feature.inputs.find((i) => i.name === name);
    if (input?.kind === "number") {
      const n = Number(value);
      if (value !== "" && value !== undefined && Number.isFinite(n) && n < 0) {
        return "유효하지 않은 값입니다. 0 이상을 입력하세요.";
      }
    }
    return undefined;
  }

  function setScalar(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
    const err = validate(name, value);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[name] = err;
      else delete next[name];
      return next;
    });
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
    setFieldErrors({});
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    // ── 클라이언트 사이드 검증 ──
    if (isEarnedComposite) {
      if (!hasGrossSalary) {
        setError("총급여를 먼저 입력해야 계산할 수 있습니다.");
        return;
      }
      const firstInvalid = feature.inputs.find((i) => {
        if (i.kind !== "number") return false;
        const v = Number(values[i.name]);
        return (
          values[i.name] !== "" &&
          values[i.name] !== undefined &&
          Number.isFinite(v) &&
          v < 0
        );
      });
      if (firstInvalid) {
        setError(
          `유효하지 않은 값입니다. ${firstInvalid.label}는 0 이상이어야 합니다.`
        );
        return;
      }
    }

    setLoading(true);
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
    if (!result) return;
    openPrintable(feature, result);
  }

  const scalarInputs = feature.inputs.filter((i) => i.kind !== "rows");
  const rowInputs = feature.inputs.filter((i) => i.kind === "rows");

  const creditSectionHeader = isEarnedComposite ? (
    <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
      값을 입력하면 해당 세액공제가 활성화됩니다. 총급여를 먼저 입력해야 세액공제 항목을 입력할 수 있습니다.
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-5">
        {/* ── 단일 입력 항목 ── */}
        {scalarInputs.length > 0 && (
          <section className="panel">
            <div className="panel-header">입력 정보</div>
            {creditSectionHeader}
            <div className="px-4 py-4 space-y-4">
              {scalarInputs.map((input) => {
                const disabled =
                  isEarnedComposite &&
                  CREDIT_FIELDS.has(input.name) &&
                  !hasGrossSalary;
                return (
                  <ScalarField
                    key={input.name}
                    input={input}
                    value={(values[input.name] as string) ?? ""}
                    onChange={(v) => setScalar(input.name, v)}
                    disabled={disabled}
                    error={fieldErrors[input.name]}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* ── 표(행) 입력 항목 ── */}
        {rowInputs.map((input) => (
          <section className="panel" key={input.name}>
            <div className="panel-header flex items-center justify-between">
              <span>{input.label}</span>
              <span className="text-xs font-mono text-navy/50 font-normal">
                {((values[input.name] as Record<string, string>[]) ?? []).length}건 등록
              </span>
            </div>
            {input.help && (
              <div className="px-4 pt-3 text-xs text-navy/60">{input.help}</div>
            )}
            <div className="px-4 pb-4 pt-3 space-y-3">
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
              <button type="button" className="btn-secondary text-xs" onClick={openPreview}>
                PDF 출력본
              </button>
            </span>
          </div>
          {result.notes && result.notes.length > 0 && (
            <div className="px-4 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-900">
              {result.notes.map((n, i) => (
                <div key={i}>· {n}</div>
              ))}
            </div>
          )}

          <div className="bg-page">
            {result.data?.explanationSteps ? (
              <table className="result-table">
                <tbody>
                  {(result.data.explanationSteps as any[]).map((step, i) => (
                    <tr key={i}>
                      <th>{step.label}</th>
                      <td className="whitespace-pre-wrap leading-relaxed">{step.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre className="px-4 py-4 m-0 text-sm leading-relaxed font-mono text-navy whitespace-pre-wrap break-words bg-page border-b border-line">
                {result.text}
              </pre>
            )}
          </div>

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

          <div className="px-4 py-3 border-t border-line flex flex-wrap items-center gap-2 bg-page">
            <button type="button" className="btn-primary" onClick={openPreview}>
              📄 PDF 출력본 열기
            </button>
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? "✓ 복사됨" : "텍스트 복사"}
            </button>
            <span className="ml-auto text-xs text-navy/55">
              새 탭에서 인쇄·PDF 저장
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

/* ── 단일 입력 필드 (라벨 위, 입력 아래, 도움말 하단) ── */
function ScalarField({
  input,
  value,
  onChange,
  disabled,
  error,
}: {
  input: Input;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className={`scalar-field ${disabled ? "opacity-50" : ""}`}>
      <label htmlFor={input.name} className="scalar-label">
        {input.label}
        {input.required && <span className="text-red-600 ml-1">*</span>}
      </label>
      <div className="scalar-input-wrap">
        {input.kind === "select" ? (
          <select
            id={input.name}
            className="field-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          >
            {(input.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : input.kind === "textarea" ? (
          <textarea
            id={input.name}
            className="field-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={input.placeholder}
            rows={3}
            disabled={disabled}
          />
        ) : (
          <input
            id={input.name}
            type={input.kind === "date" ? "date" : input.kind === "number" ? "number" : "text"}
            step={input.kind === "number" ? "1" : undefined}
            min={input.kind === "number" ? "0" : undefined}
            className="field-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={input.placeholder}
            required={input.required}
            disabled={disabled}
          />
        )}
      </div>
      {input.help && !error && (
        <p className="scalar-help">{input.help}</p>
      )}
      {error && (
        <p className="text-red-600 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}

/* ── 행(카드) 입력 필드 ── */
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

  // 컬럼명에서 은행/계좌/금액 패턴을 감지하면 카드 헤더를 다르게 표시
  const hasBank = cols.some((c) => /은행|bank/i.test(c.name + c.label));
  const hasAccount = cols.some((c) => /계좌|account|계좌번호/i.test(c.name + c.label));
  const hasAmount = cols.some((c) => /금액|이자|amount|interest/i.test(c.name + c.label));

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <div className="text-center text-navy/55 py-6 bg-page rounded border border-line">
          입력된 데이터가 없습니다. 아래 [+ 추가] 버튼으로 시작하세요.
        </div>
      )}

      {rows.map((row, idx) => {
        // 은행/계좌/금액 패턴이면 "계좌 1" 식으로 표시
        let cardTitle = `${input.label} ${idx + 1}`;
        if (hasBank && hasAccount) {
          const bankVal = row[cols.find((c) => /은행|bank/i.test(c.name + c.label))?.name ?? ""];
          cardTitle = bankVal ? `${bankVal} 계좌` : `계좌 ${idx + 1}`;
        } else if (hasAmount) {
          cardTitle = `${input.label.replace(/입력|등록/g, "").trim()} ${idx + 1}`;
        }

        return (
          <div key={idx} className="row-card">
            <div className="row-card-header">
              <span className="row-card-title">{cardTitle}</span>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => onRemove(idx)}
              >
                삭제
              </button>
            </div>
            <div className="row-card-body">
              {cols.map((c) => (
                <div key={c.name} className="row-card-cell">
                  <label className="row-card-label">{c.label}</label>
                  {c.kind === "select" ? (
                    <select
                      className="field-input"
                      value={row[c.name] ?? ""}
                      onChange={(e) => onSet(idx, c.name, e.target.value)}
                    >
                      {(c.options ?? []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={c.kind === "date" ? "date" : c.kind === "number" ? "number" : "text"}
                      step={c.kind === "number" ? "1" : undefined}
                      min={c.kind === "number" ? "0" : undefined}
                      className="field-input"
                      value={row[c.name] ?? ""}
                      onChange={(e) => onSet(idx, c.name, e.target.value)}
                      placeholder={c.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <button type="button" className="btn-secondary" onClick={onAdd}>
        + {input.label.replace(/입력|등록/g, "").trim() || "항목"} 추가
      </button>
    </div>
  );
}
