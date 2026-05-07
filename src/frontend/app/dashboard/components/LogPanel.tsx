"use client";

import { useGraphStore } from "../lib/store";

function clock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function LogPanel() {
  const logs = useGraphStore((s) => s.logs);
  const clearLogs = useGraphStore((s) => s.clearLogs);

  return (
    <section className="dash-logs">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingBottom: 4,
          borderBottom: "1px solid #2a313e",
          marginBottom: 6,
        }}
      >
        <span style={{ color: "#97a3b9", fontSize: 10, letterSpacing: "0.12em" }}>
          EXECUTION LOG · {logs.length} 행
        </span>
        <button
          onClick={clearLogs}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "1px solid #2a313e",
            color: "#97a3b9",
            padding: "1px 8px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 10,
          }}
        >
          CLEAR
        </button>
      </div>
      {logs.length === 0 && (
        <div style={{ color: "#6e7a93", fontStyle: "italic" }}>
          (실행 로그 없음 — 노드를 추가하거나 입력값을 변경하면 실시간 표시)
        </div>
      )}
      {logs.slice().reverse().map((l, i) => (
        <div className={`row ${l.status}`} key={i}>
          <span className="ts">{clock(l.ts)}</span>
          <span className="lbl">{l.nodeLabel.slice(0, 14)}</span>
          <span className="msg">{l.message}</span>
        </div>
      ))}
    </section>
  );
}
