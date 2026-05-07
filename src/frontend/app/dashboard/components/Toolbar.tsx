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

const MODE_LABELS: Record<DashMode, string> = {
  normal: "정상 실행",
  reverse: "역산 (Reverse)",
  conflict: "충돌 보기",
  timeline: "연도 타임라인",
  audit: "감사 모드",
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

  const [saved, setSaved] = useState<
    Array<{ id: string; name: string; kind: string; updatedAt: string }>
  >([]);
  const [savingHint, setSavingHint] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    refreshSaved();
    timeMachineYears()
      .then((r) => setYears(r.years))
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
      <button className="btn" onClick={onAutoLayout}>⌗ 자동 레이아웃 (ELK)</button>
      <button className="btn btn-accent" onClick={() => runAll()}>▶ 전체 재실행</button>

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
      {(["normal", "reverse", "conflict", "timeline", "audit"] as const).map(
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

      <div className="grow" />
      <span className={`pill ${execState === "ok" ? "ok" : execState === "error" ? "error" : execState === "running" ? "run" : ""}`}>
        {execState.toUpperCase()}
      </span>
      {savingHint && <span className="pill">{savingHint}</span>}
      <span className="pill">JAVA EXEC</span>
    </header>
  );
}
