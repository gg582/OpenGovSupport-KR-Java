"use client";

/**
 * 임의 JSON-like 값을 표 형태로 펼친다.
 *  - primitive(숫자/문자/불리언/null) → 단일 셀
 *  - array → idx · value 표
 *  - object → key · value 표 (값이 또 object/array 면 재귀)
 *
 * 결정적 산식의 산출물은 보통 1~2 레벨이며 깊은 재귀는 거의 없다.
 * 5 레벨 넘게 들어가면 펼치지 않고 그대로 JSON 으로 폴백 — 무한 루프/순환 참조 방어.
 */
export default function StructuredValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (depth > 5) return <code className="sv-fallback">{safeJson(value)}</code>;

  if (value == null) return <span className="sv-null">—</span>;
  if (typeof value === "number")
    return <span className="sv-num">{value.toLocaleString("ko-KR")}</span>;
  if (typeof value === "boolean")
    return <span className={value ? "sv-bool ok" : "sv-bool no"}>{value ? "true" : "false"}</span>;
  if (typeof value === "string") return <span className="sv-str">{value}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="sv-empty">(빈 배열)</span>;
    // 원소가 모두 primitive 면 인라인 리스트로 압축.
    if (value.every(isPrimitive)) {
      return (
        <span className="sv-inline">
          {value.map((v, i) => (
            <span key={i} className="sv-inline-item">
              <StructuredValue value={v} depth={depth + 1} />
            </span>
          ))}
        </span>
      );
    }
    return (
      <table className="sv-table">
        <tbody>
          {value.map((v, i) => (
            <tr key={i}>
              <th>[{i}]</th>
              <td>
                <StructuredValue value={v} depth={depth + 1} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="sv-empty">(빈 객체)</span>;
    return (
      <table className="sv-table">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <StructuredValue value={v} depth={depth + 1} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return <span>{String(value)}</span>;
}

function isPrimitive(v: unknown): boolean {
  return v == null || typeof v !== "object";
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
