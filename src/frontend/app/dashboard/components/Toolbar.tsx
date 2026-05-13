"use client";

import { useEffect, useState } from "react";
import { useGraphStore } from "../lib/store";
import { TEMPLATES } from "../lib/templates";
import { autoLayout } from "../lib/elk";
import {
  listGraphs,
  loadGraph,
  saveGraph,
  deleteGraph,
  timeMachineYears,
} from "../lib/api";
import type { DashMode } from "../lib/types";
import { downloadScript, type ShellType } from "../lib/exportScript";
import { exportGraphToJson, exportGraphToXml, exportGraphToXlsx } from "../lib/exportData";

const MODE_LABELS: Record<DashMode, string> = {
  normal: "정상",
  reverse: "역산",
  conflict: "충돌",
  timeline: "연도",
  audit: "감사",
  ax: "세무 AX",
};

export default function Toolbar() {
  const doc = useGraphStore((s) => s.doc);
  const setDoc = useGraphStore((s) => s.setDoc);
  const rename = useGraphStore((s) => s.rename);
  const setNodes = useGraphStore((s) => s.setNodes);
  const runAll = useGraphStore((s) => s.runAll);
  const execState = useGraphStore((s) => s.execState);
  const mode = useGraphStore((s) => s.mode);
  const setMode = useGraphStore((s) => s.setMode);
  const setYear = useGraphStore((s) => s.setYear);
  const savedResults = useGraphStore((s) => s.savedResults);
  const saveResult = useGraphStore((s) => s.saveResult);
  const loadResult = useGraphStore((s) => s.loadResult);
  const deleteResult = useGraphStore((s) => s.deleteResult);
  const toggleHelp = useGraphStore((s) => s.toggleHelp);

  const [saved, setSaved] = useState<
    Array<{ id: string; name: string; kind: string; updatedAt: string }>
  >([]);
  const [savingHint, setSavingHint] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    refreshSaved();
    timeMachineYears()
      .then((r) => {
        setYears(r.years);
        const cur = useGraphStore.getState().doc.year;
        if (cur == null && r.currentYear) {
          useGraphStore.getState().setYear(r.currentYear);
        }
      })
      .catch(() => setYears([]));
  }, []);

  async function refreshSaved() {
    try {
      const list = await listGraphs();
      setSaved(list);
    } catch {
      /* ignore */
    }
  }

  async function onSave() {
    try {
      setSavingHint("저장 중…");
      const ack = await saveGraph(doc);
      if (!doc.id) {
        // assign new id from server.
        rename(doc.name);
        useGraphStore.getState().setDoc({ ...doc, id: ack.id, updatedAt: ack.updatedAt });
      }
      setSavingHint(`✓ 저장 ${ack.id}`);
      await refreshSaved();
      setTimeout(() => setSavingHint(null), 1500);
    } catch (e) {
      setSavingHint(`× ${(e as Error).message}`);
      setTimeout(() => setSavingHint(null), 2500);
    }
  }

  async function onLoad(id: string) {
    if (!id) return;
    try {
      const g = await loadGraph(id);
      setDoc(g);
      queueMicrotask(() => runAll());
    } catch (e) {
      setSavingHint(`× ${(e as Error).message}`);
    }
  }

  async function onDelete() {
    if (!doc.id) return;
    if (!confirm(`"${doc.name}" 그래프를 삭제하시겠습니까?`)) return;
    await deleteGraph(doc.id);
    setDoc({ ...doc, id: "" });
    await refreshSaved();
  }

  function loadTemplate(id: string) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    // 템플릿은 새 문서로 — id 비움.
    setDoc({ ...tpl, id: "" });
    queueMicrotask(() => runAll());
  }

  async function onAutoLayout() {
    const laid = await autoLayout(doc.nodes, doc.edges);
    setNodes(() => laid);
  }

  function newDoc() {
    setDoc({ id: "", name: "새 그래프", kind: "custom", nodes: [], edges: [] });
  }

  return (
    <header className="dash-toolbar">
      <input
        className="title"
        value={doc.name}
        onChange={(e) => rename(e.target.value)}
      />
      <span className="pill" title="현재 그래프 ID">{doc.id || "(미저장)"}</span>
      <div className="sep" />

      <button className="btn btn-accent" onClick={onSave}>
        ▣ 저장
      </button>
      <button className="btn" onClick={newDoc}>＋ 새로</button>
      <button className="btn btn-danger" onClick={onDelete} disabled={!doc.id}>
        × 삭제
      </button>

      <div className="sep" />
      <select
        className="tpl"
        value=""
        onChange={(e) => {
          loadTemplate(e.target.value);
          e.currentTarget.value = "";
        }}
      >
        <option value="">▼ 템플릿 로드</option>
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            [{t.kind}] {t.name}
          </option>
        ))}
      </select>

      <select
        className="saved"
        value=""
        onChange={(e) => {
          onLoad(e.target.value);
          e.currentTarget.value = "";
        }}
      >
        <option value="">▼ 저장된 그래프 ({saved.length})</option>
        {saved.map((g) => (
          <option key={g.id} value={g.id}>
            [{g.kind}] {g.name}
          </option>
        ))}
      </select>

      <div className="sep" />
      <button className="btn" onClick={onAutoLayout}>⌗ 자동 정렬</button>
      <button className="btn btn-accent" onClick={() => runAll()}>▶ 재실행</button>

      <div className="sep" />
      <select
        className="tpl"
        value={doc.year ?? years[0] ?? ""}
        onChange={(e) => {
          const y = Number(e.target.value);
          if (Number.isFinite(y)) {
            setYear(y);
            queueMicrotask(() => runAll());
          }
        }}
        title="기준 연도 — Time Machine"
      >
        {years.length === 0 && <option value="">연도</option>}
        {years.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>

      <div className="sep" />
      {(["normal", "reverse", "conflict", "timeline", "audit", "ax"] as const).map(
        (m) => (
          <button
            key={m}
            className={`btn ${mode === m ? "btn-accent" : ""}`}
            onClick={() => setMode(m)}
            title={`overlay: ${m}`}
          >
            {MODE_LABELS[m]}
          </button>
        ),
      )}

      <div className="sep" />
      <select
        className="tpl"
        value=""
        onChange={async (e) => {
          const v = e.target.value as ShellType;
          if (v) await downloadScript(doc, v);
          e.currentTarget.value = "";
        }}
        title="스크립트 납품"
      >
        <option value="">▼ 스크립트</option>
        <option value="bash">Bash (.sh)</option>
        <option value="zsh">Zsh (.zsh)</option>
        <option value="powershell">PowerShell (.ps1)</option>
      </select>

      <div className="sep" />
      <select
        className="tpl"
        value=""
        onChange={async (e) => {
          const v = e.target.value as "json" | "xml" | "xlsx";
          if (v === "json") exportGraphToJson(doc);
          else if (v === "xml") exportGraphToXml(doc);
          else if (v === "xlsx") await exportGraphToXlsx(doc);
          e.currentTarget.value = "";
        }}
        title="자료 추출"
      >
        <option value="">▼ 추출</option>
        <option value="json">JSON (.json)</option>
        <option value="xml">XML (.xml)</option>
        <option value="xlsx">Excel (.xlsx)</option>
      </select>

      <div className="sep" />
      <button className="btn" onClick={() => toggleHelp()} title="도움말">?</button>

      <div className="sep" />
      <button
        className="btn"
        onClick={() => {
          const name = prompt("계산 결과 이름을 입력하세요");
          if (name) saveResult(name);
        }}
        title="계산 결과 저장"
      >
        ▣ 결과 저장
      </button>
      <select
        className="saved"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("load:")) loadResult(v.slice(5));
          else if (v.startsWith("del:")) {
            if (confirm("해당 계산 결과를 삭제하시겠습니까?")) deleteResult(v.slice(5));
          }
          e.currentTarget.value = "";
        }}
        title="저장된 계산 결과"
      >
        <option value="">▼ 저장된 결과 ({savedResults.length})</option>
        {savedResults.map((r) => (
          <option key={r.id} value={`load:${r.id}`}>
            {r.name} ({new Date(r.createdAt).toLocaleDateString("ko-KR")})
          </option>
        ))}
        {savedResults.length > 0 && <option disabled>──────────</option>}
        {savedResults.map((r) => (
          <option key={r.id} value={`del:${r.id}`}>
            × 삭제: {r.name}
          </option>
        ))}
      </select>

      <div className="grow" />
      <span className={`pill ${execState === "ok" ? "ok" : execState === "error" ? "error" : execState === "running" ? "run" : ""}`}>
        {execState.toUpperCase()}
      </span>
      {savingHint && <span className="pill">{savingHint}</span>}
      <span className="pill">JAVA EXEC</span>
    </header>
  );
}
