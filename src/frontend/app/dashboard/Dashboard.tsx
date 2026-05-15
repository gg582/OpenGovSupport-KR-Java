"use client";

import { useEffect, useState } from "react";
import { ReactFlowProvider } from "reactflow";
import Canvas from "./components/Canvas";
import Palette from "./components/Palette";
import Toolbar from "./components/Toolbar";
import ExecPanel from "./components/ExecPanel";
import LogPanel from "./components/LogPanel";
import OverlayPanel from "./components/OverlayPanel";
import TaxAxChatPanel from "./ax/TaxAxChatPanel";
import MobileDashboard from "./components/MobileDashboard";
import EasyMobileDashboard from "./components/EasyMobileDashboard";
import EasyCanvas from "./components/EasyCanvas";
import EasyToolbar from "./components/EasyToolbar";
import EasyExecPanel from "./components/EasyExecPanel";
import { useGraphStore } from "./lib/store";
import { useIsMobile } from "./lib/useIsMobile";
import { TEMPLATES } from "./lib/templates";
import { saveGraph } from "./lib/api";

import "./dashboard.css";

export default function Dashboard() {
  const doc = useGraphStore((s) => s.doc);
  const setDoc = useGraphStore((s) => s.setDoc);
  const runAll = useGraphStore((s) => s.runAll);
  const mode = useGraphStore((s) => s.mode);
  const axDomain = doc.kind === "welfare" ? "welfare" : "tax";
  const uiMode = useGraphStore((s) => s.uiMode);
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const selectedId = useGraphStore((s) => s.selectedId);
  const select = useGraphStore((s) => s.select);
  const removeNode = useGraphStore((s) => s.removeNode);
  const setShowHelp = useGraphStore((s) => s.setShowHelp);
  const toggleHelp = useGraphStore((s) => s.toggleHelp);
  const triggerFitView = useGraphStore((s) => s.triggerFitView);
  const showHelp = useGraphStore((s) => s.showHelp);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 첫 진입 시 빈 그래프 → 기본 템플릿으로 부트스트랩.
  useEffect(() => {
    if (doc.nodes.length === 0) {
      const tax = TEMPLATES.find((t) => t.id === "tpl_tax");
      if (tax) {
        setDoc({ ...tax, id: "" });
        queueMicrotask(() => runAll());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 키보드 단축키
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runAll();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) removeNode(selectedId);
        return;
      }
      if (e.key === "Escape") {
        select(null);
        setShowHelp(false);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveGraph(doc).catch(() => {});
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        triggerFitView();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runAll, selectedId, removeNode, select, setShowHelp, toggleHelp, doc, triggerFitView]);

  if (mounted && isMobile) {
    return uiMode === "easy" ? <EasyMobileDashboard /> : <MobileDashboard />;
  }

  const helpPanel = showHelp ? (
    <div className="dash-help-overlay" onClick={() => setShowHelp(false)}>
      <div className="dash-help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dash-help-head">
          <span>단축키 및 사용법</span>
          <button onClick={() => setShowHelp(false)} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="dash-help-body">
          <div className="dash-help-section">
            <div className="dash-help-label">단축키</div>
            <div className="dash-help-list">
              <p>Ctrl+Enter : 전체 재실행</p>
              <p>Delete : 선택 노드 삭제</p>
              <p>Escape : 선택 해제</p>
              <p>? : 도움말</p>
              <p>Ctrl+S : 그래프 저장</p>
              <p>Ctrl+0 : 화면 맞춤</p>
            </div>
          </div>
          <div className="dash-help-section">
            <div className="dash-help-label">사용법</div>
            <div className="dash-help-list">
              <p>짧게 클릭 : 노드 정보 보기</p>
              <p>길게 누름(모바일) : 노드 삭제 (확인 후)</p>
              <p>노드 드래그 : 이동</p>
              <p>엣지 끝점 드래그 : 다른 노드로 재연결</p>
              <p>빈 영역 더블클릭 : 화면 맞춤</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (uiMode === "easy") {
    return (
      <ReactFlowProvider>
        <div className="dash-shell easy-shell">
          <EasyToolbar />
          <EasyCanvas />
          <EasyExecPanel />
          {mode === "ax" && <TaxAxChatPanel domain={axDomain} />}
          {helpPanel}
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="dash-shell">
        <Toolbar />
        <Palette />
        <Canvas />
        {mode === "ax" ? (
          <TaxAxChatPanel domain={axDomain} />
        ) : mode === "normal" ? (
          <LogPanel />
        ) : (
          <OverlayPanel />
        )}
        {mode !== "ax" && <ExecPanel />}
        {helpPanel}
      </div>
    </ReactFlowProvider>
  );
}
