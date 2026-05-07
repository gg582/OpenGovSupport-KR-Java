"use client";

import { useEffect } from "react";
import { ReactFlowProvider } from "reactflow";
import Canvas from "./components/Canvas";
import Palette from "./components/Palette";
import Toolbar from "./components/Toolbar";
import ExecPanel from "./components/ExecPanel";
import LogPanel from "./components/LogPanel";
import OverlayPanel from "./components/OverlayPanel";
import { useGraphStore } from "./lib/store";
import { TEMPLATES } from "./lib/templates";

import "./dashboard.css";

export default function Dashboard() {
  const doc = useGraphStore((s) => s.doc);
  const setDoc = useGraphStore((s) => s.setDoc);
  const runAll = useGraphStore((s) => s.runAll);
  const mode = useGraphStore((s) => s.mode);

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

  return (
    <ReactFlowProvider>
      <div className="dash-shell">
        <Toolbar />
        <Palette />
        <Canvas />
        {mode === "normal" ? <LogPanel /> : <OverlayPanel />}
        <ExecPanel />
      </div>
    </ReactFlowProvider>
  );
}
