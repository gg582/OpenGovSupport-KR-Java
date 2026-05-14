"use client";

import { useEffect, useState } from "react";
import { useGraphStore } from "../lib/store";
import { TEMPLATES } from "../lib/templates";
import { ALL_TEMPLATES } from "../lib/registry";
import { autoLayoutEasy } from "../lib/elk";
import { listGraphs, loadGraph, saveGraph, deleteGraph, timeMachineYears } from "../lib/api";
import { exportGraphToXlsx } from "../lib/exportData";

export default function EasyToolbar() {
  const doc = useGraphStore((s) => s.doc);
  const setDoc = useGraphStore((s) => s.setDoc);
  const rename = useGraphStore((s) => s.rename);
  const setNodes = useGraphStore((s) => s.setNodes);
  const runAll = useGraphStore((s) => s.runAll);
  const execState = useGraphStore((s) => s.execState);
  const setYear = useGraphStore((s) => s.setYear);
  const addNodeFromTemplate = useGraphStore((s) => s.addNodeFromTemplate);
  const savedResults = useGraphStore((s) => s.savedResults);
  const saveResult = useGraphStore((s) => s.saveResult);
  const loadResult = useGraphStore((s) => s.loadResult);
  const deleteResult = useGraphStore((s) => s.deleteResult);
  const toggleHelp = useGraphStore((s) => s.toggleHelp);
  const setMode = useGraphStore((s) => s.setMode);

  const [saved, setSaved] = useState<Array<{ id: string; name: string; kind: string; updatedAt: string }>>([]);
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
    setDoc({ ...tpl, id: "" });
    queueMicrotask(() => runAll());
  }

  async function onAutoLayout() {
    const laid = await autoLayoutEasy(doc.nodes, doc.edges);
    setNodes(() => laid);
  }

  function newDoc() {
    setDoc({ id: "", name: "새 그래프", kind: "custom", nodes: [], edges: [] });
  }

  return (
    <header className="dash-toolbar easy-toolbar">
      <input
        className="title"
        value={doc.name}
        onChange={(e) => rename(e.target.value)}
      />
      <span className="pill" title="현재 그래프 ID">{doc.id || "(미저장)"}</span>
      <div className="sep" />

      <button className="btn btn-accent" onClick={onSave}><span className="ico">▣</span><span className="label"> 저장</span></button>
      <button className="btn" onClick={newDoc}><span className="ico">＋</span><span className="label"> 새로</span></button>
      <button className="btn btn-danger" onClick={onDelete} disabled={!doc.id}><span className="ico">×</span><span className="label"> 삭제</span></button>

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
        className="tpl"
        value=""
        onChange={(e) => {
          const tpl = ALL_TEMPLATES.find(
            (t) => (t.kind === "formula" ? `formula:${t.rule}` : t.kind) === e.target.value,
          );
          if (tpl) {
            addNodeFromTemplate(tpl, { x: 300, y: 200 });
            queueMicrotask(() => runAll());
          }
          e.currentTarget.value = "";
        }}
      >
        <option value="">＋ 노드 추가</option>
        {ALL_TEMPLATES.map((t) => {
          const k = t.kind === "formula" ? `formula:${t.rule}` : t.kind;
          return (
            <option key={k} value={k}>
              {t.label}
            </option>
          );
        })}
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
      <button className="btn" onClick={onAutoLayout}><span className="ico">⌗</span><span className="label"> 자동 정렬</span></button>
      <button className="btn btn-accent" onClick={() => runAll()}><span className="ico">▶</span><span className="label"> 재실행</span></button>

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
        title="기준 연도"
      >
        {years.length === 0 && <option value="">연도</option>}
        {years.map((y) => (
          <option key={y} value={y}>{y}년</option>
        ))}
      </select>

      <div className="sep" />
      <button className="btn btn-accent" onClick={() => setMode("ax")} title="세무 AX 챗봇"><span className="ico">AX</span><span className="label"> 세무 AX</span></button>
      <button className="btn" onClick={() => toggleHelp()} title="도움말"><span className="ico">?</span></button>

      <div className="sep" />
      <button
        className="btn"
        onClick={() => {
          const name = prompt("계산 결과 이름을 입력하세요");
          if (name) saveResult(name);
        }}
        title="계산 결과 저장"
      >
        <span className="ico">▣</span><span className="label"> 결과 저장</span>
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

      <div className="sep" />
      <select
        className="tpl"
        value=""
        onChange={async (e) => {
          const v = e.target.value;
          if (v === "xlsx") await exportGraphToXlsx(doc);
          e.currentTarget.value = "";
        }}
        title="자료 추출"
      >
        <option value="">▼ 추출</option>
        <option value="xlsx">Excel (.xlsx)</option>
      </select>

      <div className="grow" />
      {execState !== "ok" && (
        <span className={`pill ${execState === "error" ? "error" : execState === "running" ? "run" : ""}`}>
          {execState.toUpperCase()}
        </span>
      )}
      {savingHint && <span className="pill">{savingHint}</span>}
    </header>
  );
}
