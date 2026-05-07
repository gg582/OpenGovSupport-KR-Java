"use client";

import { useEffect, useState } from "react";
import { useGraphStore } from "../lib/store";
import {
  conflictDetect,
  conflictRules,
  solverRun,
  timeMachineRun,
  timeMachineYears,
} from "../lib/api";
import { exportAuditTrail, exportExplainJson, openExplainPdf } from "../lib/explain";
import { FORMULA_RULES } from "../lib/registry";

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 30) + "…";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

/**
 * 모드 별 보조 패널. dashboard 우하단의 LogPanel 자리에 모드가 바뀌면 컨텐츠가 교체.
 *
 * - normal     : 기존 LogPanel 유지
 * - timeline   : 연도 이동 + 다년 비교
 * - conflict   : 활성 룰 → 충돌 검출 + 우선순위
 * - reverse    : 노드별 REV 토글 + 솔버 결과
 * - audit      : 실행 로그 + 익스포트
 */
export default function OverlayPanel() {
  const mode = useGraphStore((s) => s.mode);
  const doc = useGraphStore((s) => s.doc);
  const setYear = useGraphStore((s) => s.setYear);
  const runAll = useGraphStore((s) => s.runAll);
  const logs = useGraphStore((s) => s.logs);
  const setTimeMachine = useGraphStore((s) => s.setTimeMachine);
  const setConflicts = useGraphStore((s) => s.setConflicts);
  const tm = useGraphStore((s) => s.timeMachine);
  const conflicts = useGraphStore((s) => s.conflicts);

  const [years, setYears] = useState<number[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [tmRule, setTmRule] = useState<string>("comprehensive-income-tax");
  const [tmInput, setTmInput] = useState<string>('{"taxableIncome":88000000}');
  const [activeRules, setActiveRules] = useState<Set<string>>(new Set());
  const [allConflictRules, setAllConflictRules] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    timeMachineYears().then((r) => {
      setYears(r.years);
      if (selectedYears.length === 0) setSelectedYears(r.years);
    }).catch(() => {});
    conflictRules().then((r) => setAllConflictRules(r.rules)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === "normal") return null;

  return (
    <section
      className="dash-logs"
      style={{ background: "#14181f", color: "#d8dde6", padding: 12 }}
    >
      <div
        style={{
          color: "#97a3b9",
          fontSize: 10,
          letterSpacing: "0.12em",
          paddingBottom: 4,
          borderBottom: "1px solid #2a313e",
          marginBottom: 8,
        }}
      >
        OVERLAY · {mode.toUpperCase()}
      </div>

      {mode === "timeline" && (
        <div style={{ display: "grid", gap: 6, fontSize: 11, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ color: "#97a3b9", flexShrink: 0 }}>연도 슬라이더:</span>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => {
                  setYear(y);
                  queueMicrotask(() => runAll());
                }}
                style={{
                  background: doc.year === y ? "#134075" : "#1d2330",
                  border: "1px solid",
                  borderColor: doc.year === y ? "#1f5da3" : "#2a313e",
                  color: "#d8dde6",
                  padding: "2px 10px",
                  cursor: "pointer",
                  font: "inherit",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {y}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
            <span style={{ color: "#97a3b9", flexShrink: 0 }}>다년 비교:</span>
            <select
              value={tmRule}
              onChange={(e) => setTmRule(e.target.value)}
              style={{ ...chipStyle(), maxWidth: 100 }}
            >
              {Object.keys(FORMULA_RULES).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              value={tmInput}
              onChange={(e) => setTmInput(e.target.value)}
              style={{ ...chipStyle(), flex: 1, minWidth: 60, fontFamily: "ui-monospace, monospace" }}
              placeholder='{"taxableIncome":88000000}'
            />
            <button
              onClick={async () => {
                let input: Record<string, unknown> = {};
                try { input = JSON.parse(tmInput); } catch {}
                const res = await timeMachineRun({
                  ruleId: tmRule,
                  years: selectedYears.length > 0 ? selectedYears : years,
                  input,
                });
                setTimeMachine({
                  ruleId: tmRule,
                  years: selectedYears.length > 0 ? selectedYears : years,
                  results: res.results as unknown[],
                  deltaTable: res.deltaTable as unknown[],
                });
              }}
              style={{ ...chipStyle(), background: "#134075", borderColor: "#1f5da3", color: "#fff", flexShrink: 0 }}
            >
              실행
            </button>
          </div>
          {tm.results.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle()}>
                <thead>
                  <tr>
                    <th style={thStyle()}>year</th>
                    <th style={thStyle()}>amount</th>
                    <th style={thStyle()}>delta(prev)</th>
                    <th style={thStyle()}>delta%</th>
                  </tr>
                </thead>
                <tbody>
                  {tm.results.map((r, i) => {
                    const row = r as Record<string, unknown>;
                    return (
                      <tr key={i}>
                        <td style={tdStyle()}>{fmt(row.year)}</td>
                        <td style={tdStyle()}>{fmt(row.amount)}</td>
                        <td style={tdStyle()}>{fmt(row.deltaFromPrevious)}</td>
                        <td style={tdStyle()}>{fmt(row.deltaPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mode === "conflict" && (
        <div style={{ display: "grid", gap: 6, fontSize: 11, minWidth: 0 }}>
          <div style={{ color: "#97a3b9" }}>
            활성화한 룰 → 강행 우선순위로 충돌 자동 해소.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.keys(allConflictRules).map((id) => {
              const meta = allConflictRules[id];
              const active = activeRules.has(id);
              const suppressed = conflicts.suppressed.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => {
                    const next = new Set(activeRules);
                    if (active) next.delete(id); else next.add(id);
                    setActiveRules(next);
                  }}
                  style={{
                    background: active
                      ? suppressed
                        ? "#421515"
                        : "#1a3520"
                      : "#1d2330",
                    border: "1px solid",
                    borderColor: active
                      ? suppressed
                        ? "#6b2424"
                        : "#2a4a32"
                      : "#2a313e",
                    color: active ? "#fff" : "#d8dde6",
                    padding: "3px 8px",
                    cursor: "pointer",
                    font: "inherit",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 10,
                    textDecoration: suppressed ? "line-through" : "none",
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={String(meta?.legalBasis ?? "")}
                >
                  {String(meta?.label ?? id)}
                </button>
              );
            })}
            <button
              onClick={async () => {
                const res = await conflictDetect(Array.from(activeRules));
                setConflicts({
                  activeBefore: res.activeBefore,
                  suppressed: res.suppressed,
                  activeAfter: res.activeAfter,
                  pairs: res.conflicts.map((c) => ({
                    a: c.a, b: c.b, winner: c.winner, loser: c.loser, reason: c.reason,
                  })),
                });
              }}
              style={{ ...chipStyle(), background: "#134075", borderColor: "#1f5da3", color: "#fff" }}
            >
              ▶ 검출
            </button>
          </div>
          {conflicts.pairs.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle()}>
                <thead>
                  <tr>
                    <th style={thStyle()}>a</th>
                    <th style={thStyle()}>b</th>
                    <th style={thStyle()}>winner</th>
                    <th style={thStyle()}>reason</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.pairs.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle(), color: p.loser === p.a ? "#ee7d7d" : "#d8dde6", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>{p.a}</td>
                      <td style={{ ...tdStyle(), color: p.loser === p.b ? "#ee7d7d" : "#d8dde6", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>{p.b}</td>
                      <td style={{ ...tdStyle(), color: "#6fde8c", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>{p.winner}</td>
                      <td style={{ ...tdStyle(), maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mode === "reverse" && (
        <div style={{ display: "grid", gap: 6, fontSize: 11, minWidth: 0 }}>
          <div style={{ color: "#97a3b9" }}>
            노드별 [REV] 토글 → 목표 출력값 입력 → 자동 역산.
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ color: "#97a3b9" }}>현재 Reverse 노드:</span>
            {doc.nodes
              .filter((n) => n.data.direction === "reverse")
              .map((n) => (
                <div
                  key={n.id}
                  style={{
                    border: "1px solid #a883da",
                    background: "#2a1a3f",
                    color: "#d8c2f5",
                    padding: "2px 8px",
                    fontSize: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{n.data.label}</span>
                  <span style={{ marginLeft: 8, flexShrink: 0 }}>{fmt(n.data.runtime?.output)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {mode === "audit" && (
        <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => openExplainPdf(doc)} style={{ ...chipStyle(), background: "#134075", borderColor: "#1f5da3", color: "#fff" }}>
              📄 reasoning PDF
            </button>
            <button onClick={() => exportExplainJson(doc)} style={chipStyle()}>
              { } reasoning.json
            </button>
            <button onClick={() => exportAuditTrail(doc, logs)} style={chipStyle()}>
              ▦ audit.txt
            </button>
          </div>
          <div style={{ color: "#97a3b9", maxHeight: 130, overflow: "auto" }}>
            {logs.slice().reverse().map((l, i) => (
              <div key={i} style={{ borderBottom: "1px solid #1d2330", padding: "1px 0" }}>
                <span style={{ color: "#6e7a93" }}>{new Date(l.ts).toISOString().slice(11, 19)}</span>{" "}
                <span style={{ color: "#97a3b9" }}>[{l.status}]</span>{" "}
                <span>{l.nodeLabel}</span> · {l.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function chipStyle(): React.CSSProperties {
  return {
    background: "#1d2330",
    border: "1px solid #2a313e",
    color: "#d8dde6",
    padding: "2px 8px",
    cursor: "pointer",
    font: "inherit",
    fontFamily: "ui-monospace, monospace",
    fontSize: 11,
  };
}
function tableStyle(): React.CSSProperties {
  return {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "ui-monospace, monospace",
    fontSize: 11,
  };
}
function thStyle(): React.CSSProperties {
  return {
    background: "#1d2330",
    border: "1px solid #2a313e",
    padding: "2px 8px",
    color: "#97a3b9",
    textAlign: "left",
    fontWeight: 600,
  };
}
function tdStyle(): React.CSSProperties {
  return {
    border: "1px solid #2a313e",
    padding: "2px 8px",
  };
}

// guard against unused import
void solverRun;
