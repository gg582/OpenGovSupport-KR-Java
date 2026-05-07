"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactFlow, {
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
  type OnEdgeUpdateFunc,
} from "reactflow";
import "reactflow/dist/style.css";

import { useGraphStore } from "../lib/store";
import { GRID, type DashMode, type GraphDoc } from "../lib/types";
import { ALL_TEMPLATES, type NodeTemplate } from "../lib/registry";
import {
  SUBGRAPH_TEMPLATES,
  type SubgraphTemplate,
} from "../lib/subgraphTemplates";
import {
  listGraphs,
  loadGraph,
  saveGraph,
  deleteGraph,
  timeMachineYears,
} from "../lib/api";
import { autoLayout } from "../lib/elk";
import { TEMPLATES } from "../lib/templates";
import StatNode from "./StatNode";
import OrthoEdge from "./OrthoEdge";
import OverlayPanel from "./OverlayPanel";
import { clearReactFlowSelection } from "../lib/clearSelection";

const nodeTypes = { stat: StatNode } as const;
const edgeTypes = { ortho: OrthoEdge } as const;
const defaultEdgeOptions = { type: "ortho" } as const;

const LONG_PRESS_MS = 550;
const LONG_PRESS_TOLERANCE_PX = 8;
// 더블탭 줌: 두 번째 탭이 280ms 이내, 30px 이내면 같은 위치 더블탭으로 간주.
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_TOLERANCE_PX = 30;
const DOUBLE_TAP_ZOOM_FACTOR = 1.6;

type Tab = "info" | "add" | "exec" | "menu" | "log";

const MODE_LABELS: Record<DashMode, string> = {
  normal: "정상",
  reverse: "역산",
  conflict: "충돌",
  timeline: "연도",
  audit: "감사",
};

export default function MobileDashboard() {
  return (
    <ReactFlowProvider>
      <MobileBody />
    </ReactFlowProvider>
  );
}

function MobileBody() {
  const doc = useGraphStore((s) => s.doc);
  const rename = useGraphStore((s) => s.rename);
  const setDoc = useGraphStore((s) => s.setDoc);
  const setNodes = useGraphStore((s) => s.setNodes);
  const connect = useGraphStore((s) => s.connect);
  const select = useGraphStore((s) => s.select);
  const moveNode = useGraphStore((s) => s.moveNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const setEdges = useGraphStore((s) => s.setEdges);
  const runAll = useGraphStore((s) => s.runAll);
  const execState = useGraphStore((s) => s.execState);
  const selectedId = useGraphStore((s) => s.selectedId);
  const logs = useGraphStore((s) => s.logs);
  const addNodeFromTemplate = useGraphStore((s) => s.addNodeFromTemplate);
  const addSubgraph = useGraphStore((s) => s.addSubgraph);
  const mode = useGraphStore((s) => s.mode);
  const setMode = useGraphStore((s) => s.setMode);
  const setYear = useGraphStore((s) => s.setYear);

  const [tab, setTab] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 줌 컨트롤 + 더블탭에 사용. ReactFlowProvider 안쪽이라 안전.
  const rf = useReactFlow();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const rfNodes: Node[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        type: "stat",
        position: n.position,
        data: n.data,
      })),
    [doc.nodes],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      doc.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type: "ortho",
        // 손가락으로 핸들을 잡고 드래그해 다른 노드로 옮길 수 있도록.
        reconnectable: true,
      })),
    [doc.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((c) => {
        if (c.type === "position" && c.position && !c.dragging) {
          moveNode(c.id, c.position.x, c.position.y);
        }
        if (c.type === "remove") removeNode(c.id);
      });
    },
    [moveNode, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      changes.forEach((c) => {
        if (c.type === "remove") removeEdge(c.id);
      });
    },
    [removeEdge],
  );

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      connect({
        source: params.source,
        target: params.target,
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle,
      });
      queueMicrotask(() => runAll());
    },
    [connect, runAll],
  );

  // 엣지 끝점을 다른 노드/포트로 옮기는 인터랙션. 드롭된 새 연결로 source/target 갱신.
  const onReconnect: OnEdgeUpdateFunc = useCallback(
    (oldEdge, newConnection) => {
      if (!newConnection.source || !newConnection.target) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === oldEdge.id
            ? {
                ...e,
                source: newConnection.source!,
                target: newConnection.target!,
                sourceHandle: newConnection.sourceHandle ?? null,
                targetHandle: newConnection.targetHandle ?? null,
              }
            : e,
        ),
      );
      queueMicrotask(() => runAll());
    },
    [setEdges, runAll],
  );

  // ── 길게 누름 → 노드 삭제 ────────────────────────────────────────
  const pressRef = useRef<{
    timer: number | null;
    nodeId: string | null;
    label: string;
    startX: number;
    startY: number;
  }>({ timer: null, nodeId: null, label: "", startX: 0, startY: 0 });

  // ── 더블탭 줌 — 빈 영역 두 번 탭 시 손가락 위치를 중심으로 1.6x ─
  const lastTapRef = useRef<{ ts: number; x: number; y: number } | null>(null);

  const findNodeIdAt = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>(".react-flow__node");
    return el?.dataset.id ?? null;
  };

  // 손가락 위치를 고정한 채 줌을 변경. (cx,cy)는 캔버스 로컬 좌표.
  const zoomAtPoint = (cx: number, cy: number, factor: number) => {
    const vp = rf.getViewport();
    const nextZoom = Math.min(2, Math.max(0.3, vp.zoom * factor));
    if (nextZoom === vp.zoom) return;
    const fx = (cx - vp.x) / vp.zoom;
    const fy = (cy - vp.y) / vp.zoom;
    rf.setViewport(
      { x: cx - fx * nextZoom, y: cy - fy * nextZoom, zoom: nextZoom },
      { duration: 200 },
    );
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    const id = findNodeIdAt(e.target);

    // 빈 영역에서만 더블탭 줌 검사 — 노드 위는 정보 표시용으로 둔다.
    if (!id) {
      const now = performance.now();
      const last = lastTapRef.current;
      if (
        last &&
        now - last.ts < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) <
          DOUBLE_TAP_TOLERANCE_PX
      ) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          zoomAtPoint(
            e.clientX - rect.left,
            e.clientY - rect.top,
            DOUBLE_TAP_ZOOM_FACTOR,
          );
        }
        lastTapRef.current = null;
        return;
      }
      lastTapRef.current = { ts: now, x: e.clientX, y: e.clientY };
      return;
    }

    const label = doc.nodes.find((n) => n.id === id)?.data.label ?? id.slice(0, 6);
    pressRef.current = {
      timer: window.setTimeout(() => {
        const cur = pressRef.current.nodeId;
        if (cur) {
          removeNode(cur);
          showToast(`삭제: ${pressRef.current.label}`);
          if ("vibrate" in navigator) navigator.vibrate?.(40);
        }
        pressRef.current.timer = null;
      }, LONG_PRESS_MS),
      nodeId: id,
      label,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const cancelPress = () => {
    if (pressRef.current.timer != null) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
    pressRef.current.nodeId = null;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pressRef.current.timer == null) return;
    const dx = e.clientX - pressRef.current.startX;
    const dy = e.clientY - pressRef.current.startY;
    if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE_PX) cancelPress();
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1600);
  };

  const onNodeClick = useCallback(
    (_e: unknown, n: Node) => {
      select(n.id);
      setTab("info");
    },
    [select],
  );
  const clearAllSelection = useCallback(() => {
    select(null);
    setTab(null);
    clearReactFlowSelection(rf);
  }, [rf, select]);

  return (
    <div className="dash-mobile">
      <header className="m-head">
        <input
          className="m-title"
          value={doc.name}
          onChange={(e) => rename(e.target.value)}
          aria-label="그래프 이름"
        />
        <span className={`m-status m-status-${execState}`}>
          {execState.toUpperCase()}
        </span>
        <button className="m-run" onClick={() => runAll()} aria-label="재실행">
          ▶
        </button>
      </header>

      <div
        ref={canvasRef}
        className="m-canvas stat-canvas mobile"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          snapToGrid
          snapGrid={[GRID.size, GRID.size]}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeClick={onNodeClick}
          onPaneClick={clearAllSelection}
          defaultViewport={{ x: 24, y: 60, zoom: 0.9 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
          panOnDrag
          zoomOnPinch
          deleteKeyCode={null}
          selectionOnDrag={false}
          multiSelectionKeyCode={null}
          reconnectRadius={28}
        >
          <Background
            gap={GRID.size}
            size={1.2}
            color="#2a313e"
            variant={BackgroundVariant.Dots}
          />
        </ReactFlow>

        <ZoomControls
          onShowToast={showToast}
          onMessage={(m) => showToast(m)}
        />

        {mode !== "normal" && (
          <span
            className={`m-mode-badge m-mode-${mode}`}
            aria-label={`현재 모드: ${MODE_LABELS[mode]}`}
          >
            {MODE_LABELS[mode]}
          </span>
        )}
      </div>

      {tab && (
        <section className="m-sheet" role="dialog" aria-label={tab}>
          <div className="m-sheet-head">
            <span className="m-sheet-title">
              {tab === "log" && mode !== "normal"
                ? `오버레이 · ${MODE_LABELS[mode]}`
                : tabTitle(tab)}
            </span>
            <button
              className="m-sheet-close"
              onClick={() => setTab(null)}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
          <div className="m-sheet-body">
            {tab === "info" && <InfoSheet selectedId={selectedId} />}
            {tab === "add" && (
              <AddSheet
                onAddTemplate={(tpl) => {
                  addNodeFromTemplate(tpl, { x: 3 * GRID.size, y: 3 * GRID.size });
                  queueMicrotask(() => runAll());
                  setTab(null);
                }}
                onAddSubgraph={(tpl) => {
                  addSubgraph(tpl);
                  queueMicrotask(() => runAll());
                  setTab(null);
                }}
              />
            )}
            {tab === "exec" && <ExecSheet />}
            {tab === "menu" && (
              <MenuSheet
                doc={doc}
                mode={mode}
                onSetMode={setMode}
                onSetYear={(y) => {
                  setYear(y);
                  queueMicrotask(() => runAll());
                }}
                onLoadTemplate={(id) => {
                  const tpl = TEMPLATES.find((t) => t.id === id);
                  if (!tpl) return;
                  setDoc({ ...tpl, id: "" });
                  queueMicrotask(() => runAll());
                  showToast(`템플릿 로드: ${tpl.name}`);
                }}
                onLoadSaved={async (id) => {
                  try {
                    const g = await loadGraph(id);
                    setDoc(g);
                    queueMicrotask(() => runAll());
                    showToast(`불러옴: ${g.name}`);
                  } catch (e) {
                    showToast(`× ${(e as Error).message}`);
                  }
                }}
                onSave={async () => {
                  try {
                    showToast("저장 중…");
                    const ack = await saveGraph(doc);
                    if (!doc.id) {
                      setDoc({ ...doc, id: ack.id, updatedAt: ack.updatedAt });
                    }
                    showToast(`✓ 저장됨`);
                  } catch (e) {
                    showToast(`× ${(e as Error).message}`);
                  }
                }}
                onNew={() => {
                  setDoc({
                    id: "",
                    name: "새 그래프",
                    kind: "custom",
                    nodes: [],
                    edges: [],
                  });
                  showToast("빈 그래프로 시작");
                }}
                onDelete={async () => {
                  if (!doc.id) return;
                  if (!confirm(`"${doc.name}" 그래프를 삭제하시겠습니까?`)) return;
                  try {
                    await deleteGraph(doc.id);
                    setDoc({ ...doc, id: "" });
                    showToast("삭제됨");
                  } catch (e) {
                    showToast(`× ${(e as Error).message}`);
                  }
                }}
                onAutoLayout={async () => {
                  try {
                    const laid = await autoLayout(doc.nodes, doc.edges);
                    setNodes(() => laid);
                    queueMicrotask(() =>
                      rf.fitView({ padding: 0.18, duration: 240 }),
                    );
                    showToast("자동 정렬 완료");
                  } catch (e) {
                    showToast(`× ${(e as Error).message}`);
                  }
                }}
              />
            )}
            {tab === "log" &&
              (mode === "normal" ? (
                <LogSheet logs={logs} />
              ) : (
                <OverlayPanel />
              ))}
          </div>
        </section>
      )}

      <nav className="m-tabs" aria-label="대시보드 탭">
        <TabButton label="＋추가" id="add" cur={tab} onSelect={setTab} />
        <TabButton label="ⓘ정보" id="info" cur={tab} onSelect={setTab} />
        <TabButton label="▶실행" id="exec" cur={tab} onSelect={setTab} />
        <TabButton label="☰메뉴" id="menu" cur={tab} onSelect={setTab} />
        <TabButton
          label={mode === "normal" ? "≡로그" : "✦오버"}
          id="log"
          cur={tab}
          onSelect={setTab}
        />
      </nav>

      {toast && <div className="m-toast">{toast}</div>}

      <Hint />
    </div>
  );
}

function tabTitle(t: Tab): string {
  switch (t) {
    case "info":
      return "노드 정보";
    case "add":
      return "노드 추가";
    case "exec":
      return "실행";
    case "menu":
      return "메뉴";
    case "log":
      return "실행 로그";
  }
}

// ── 줌 컨트롤 — 캔버스 우측 하단 floating ─────────────────────────
function ZoomControls({
  onShowToast,
}: {
  onShowToast: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const rf = useReactFlow();
  return (
    <div className="m-zoom" role="group" aria-label="줌 컨트롤">
      <button
        className="m-zoom-btn"
        onClick={() => rf.zoomIn({ duration: 180 })}
        aria-label="확대"
      >
        ＋
      </button>
      <button
        className="m-zoom-btn"
        onClick={() => rf.zoomOut({ duration: 180 })}
        aria-label="축소"
      >
        −
      </button>
      <button
        className="m-zoom-btn"
        onClick={() => {
          rf.fitView({ padding: 0.18, duration: 240 });
          onShowToast("화면 맞춤");
        }}
        aria-label="화면 맞춤"
        title="화면 맞춤"
      >
        ⛶
      </button>
      <button
        className="m-zoom-btn"
        onClick={() =>
          rf.setViewport({ x: 24, y: 60, zoom: 0.9 }, { duration: 200 })
        }
        aria-label="줌 초기화"
        title="줌 초기화"
      >
        ⌂
      </button>
    </div>
  );
}

// ── 메뉴 시트 — 저장/불러오기/템플릿/자동정렬/연도/모드 ────────────
function MenuSheet({
  doc,
  mode,
  onSetMode,
  onSetYear,
  onLoadTemplate,
  onLoadSaved,
  onSave,
  onNew,
  onDelete,
  onAutoLayout,
}: {
  doc: GraphDoc;
  mode: DashMode;
  onSetMode: (m: DashMode) => void;
  onSetYear: (y: number) => void;
  onLoadTemplate: (id: string) => void;
  onLoadSaved: (id: string) => void;
  onSave: () => void;
  onNew: () => void;
  onDelete: () => void;
  onAutoLayout: () => void;
}) {
  const [saved, setSaved] = useState<
    Array<{ id: string; name: string; kind: string; updatedAt: string }>
  >([]);
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    listGraphs()
      .then((list) => setSaved(list))
      .catch(() => setSaved([]));
    timeMachineYears()
      .then((r) => setYears(r.years))
      .catch(() => setYears([]));
  }, []);

  return (
    <div className="m-menu">
      <section className="m-menu-section">
        <div className="m-menu-label">그래프</div>
        <div className="m-menu-row">
          <button className="m-menu-btn accent" onClick={onSave}>
            ▣ 저장
          </button>
          <button className="m-menu-btn" onClick={onNew}>
            ＋ 새로
          </button>
          <button
            className="m-menu-btn danger"
            onClick={onDelete}
            disabled={!doc.id}
          >
            × 삭제
          </button>
        </div>
        <div className="m-menu-id">
          ID: <span>{doc.id || "(미저장)"}</span>
        </div>
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label">템플릿</div>
        <select
          className="m-menu-select"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onLoadTemplate(v);
            e.currentTarget.value = "";
          }}
        >
          <option value="">▼ 템플릿 로드…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              [{t.kind}] {t.name}
            </option>
          ))}
        </select>
        <select
          className="m-menu-select"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onLoadSaved(v);
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
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label">레이아웃</div>
        <button className="m-menu-btn full" onClick={onAutoLayout}>
          ⌗ 자동 정렬 (ELK)
        </button>
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label">기준 연도</div>
        {years.length === 0 ? (
          <p className="m-empty" style={{ padding: 8 }}>
            연도 목록을 가져올 수 없습니다.
          </p>
        ) : (
          <div className="m-year-grid">
            {years.map((y) => (
              <button
                key={y}
                className={`m-year ${doc.year === y ? "active" : ""}`}
                onClick={() => onSetYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label">모드</div>
        <div className="m-mode-grid">
          {(
            ["normal", "reverse", "conflict", "timeline", "audit"] as DashMode[]
          ).map((m) => (
            <button
              key={m}
              className={`m-mode ${mode === m ? "active" : ""} m-mode-${m}`}
              onClick={() => onSetMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode !== "normal" && (
          <p className="m-menu-hint">
            “로그” 탭이 <b>{MODE_LABELS[mode]} 오버레이</b>로 전환됩니다.
          </p>
        )}
      </section>
    </div>
  );
}

function TabButton({
  label,
  id,
  cur,
  onSelect,
}: {
  label: string;
  id: Tab;
  cur: Tab | null;
  onSelect: (t: Tab | null) => void;
}) {
  const active = cur === id;
  return (
    <button
      className={`m-tab ${active ? "active" : ""}`}
      onClick={() => onSelect(active ? null : id)}
    >
      {label}
    </button>
  );
}

function InfoSheet({ selectedId }: { selectedId: string | null }) {
  const node = useGraphStore((s) =>
    selectedId ? s.doc.nodes.find((n) => n.id === selectedId) : undefined,
  );
  const removeNode = useGraphStore((s) => s.removeNode);
  if (!node) {
    return (
      <p className="m-empty">
        노드를 짧게 탭하면 정보가 표시됩니다.
        <br />길게 누르면 삭제됩니다.
      </p>
    );
  }
  const r = node.data.runtime;
  return (
    <div className="m-info">
      <div className="m-info-row">
        <span className="m-info-key">라벨</span>
        <span className="m-info-val">{node.data.label}</span>
      </div>
      <div className="m-info-row">
        <span className="m-info-key">종류</span>
        <span className="m-info-val">{node.data.kind}</span>
      </div>
      {node.data.rule && (
        <div className="m-info-row">
          <span className="m-info-key">룰</span>
          <span className="m-info-val">{node.data.rule}</span>
        </div>
      )}
      {node.data.value !== undefined && (
        <div className="m-info-row">
          <span className="m-info-key">값</span>
          <span className="m-info-val">{String(node.data.value)}</span>
        </div>
      )}
      {r && (
        <>
          <div className="m-info-row">
            <span className="m-info-key">출력</span>
            <span className="m-info-val">{formatOutput(r.output)}</span>
          </div>
          {r.error && (
            <div className="m-info-row">
              <span className="m-info-key">에러</span>
              <span className="m-info-val err">{r.error}</span>
            </div>
          )}
          {r.rawFormula && (
            <div className="m-info-row block">
              <span className="m-info-key">산식</span>
              <pre className="m-info-formula">{r.rawFormula}</pre>
            </div>
          )}
        </>
      )}
      <button className="m-info-del" onClick={() => removeNode(node.id)}>
        × 이 노드 삭제
      </button>
    </div>
  );
}

function formatOutput(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

function AddSheet({
  onAddTemplate,
  onAddSubgraph,
}: {
  onAddTemplate: (t: NodeTemplate) => void;
  onAddSubgraph: (t: SubgraphTemplate) => void;
}) {
  return (
    <div className="m-add">
      <div className="m-add-section">정형 패턴</div>
      <div className="m-chip-grid">
        {SUBGRAPH_TEMPLATES.map((t) => (
          <button
            key={t.id}
            className="m-chip subgraph"
            onClick={() => onAddSubgraph(t)}
          >
            <span className="m-chip-lbl">{t.name}</span>
            <span className="m-chip-hint">{t.description}</span>
          </button>
        ))}
      </div>
      <div className="m-add-section">단일 노드</div>
      <div className="m-chip-grid">
        {ALL_TEMPLATES.map((t) => {
          const k = t.kind === "formula" ? `formula:${t.rule}` : t.kind;
          return (
            <button
              key={k}
              className="m-chip"
              data-kind={t.kind}
              onClick={() => onAddTemplate(t)}
            >
              <span className="m-chip-lbl">{t.label}</span>
              {t.hint && <span className="m-chip-hint">{t.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExecSheet() {
  const runAll = useGraphStore((s) => s.runAll);
  const execState = useGraphStore((s) => s.execState);
  const nodes = useGraphStore((s) => s.doc.nodes);
  const outputs = nodes.filter(
    (n) => n.data.kind === "output" || n.data.kind === "pdf",
  );
  return (
    <div className="m-exec">
      <button className="m-exec-btn" onClick={() => runAll()}>
        ▶ 전체 재실행 ({execState})
      </button>
      <div className="m-exec-list">
        {outputs.length === 0 ? (
          <p className="m-empty">출력 노드가 없습니다.</p>
        ) : (
          outputs.map((n) => (
            <div key={n.id} className="m-exec-item">
              <span className="m-exec-lbl">{n.data.label}</span>
              <span className="m-exec-val">
                {formatOutput(n.data.runtime?.output)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LogSheet({
  logs,
}: {
  logs: ReturnType<typeof useGraphStore.getState>["logs"];
}) {
  if (logs.length === 0) {
    return <p className="m-empty">로그가 없습니다.</p>;
  }
  return (
    <ul className="m-log">
      {logs
        .slice()
        .reverse()
        .map((l, i) => (
          <li key={i} className={`m-log-item ${l.status}`}>
            <span className="m-log-lbl">{l.nodeLabel}</span>
            <span className="m-log-msg">{l.message}</span>
          </li>
        ))}
    </ul>
  );
}

function Hint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("dash-mobile-hint") === "1") return;
    setShow(true);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dash-mobile-hint", "1");
    }
  };
  return (
    <div className="m-hint" onClick={dismiss}>
      <p>
        <b>짧게 탭</b> — 노드 정보
        <br />
        <b>길게 누름</b> — 노드 삭제
        <br />
        <b>두 번 탭(빈 곳)</b> — 손가락 위치로 확대
        <br />
        <b>두 손가락</b> — 핀치 줌 / 한 손가락 드래그 = 팬
        <br />
        <b>엣지 끝점 드래그</b> — 다른 노드로 재연결
      </p>
      <button className="m-hint-x">알겠습니다</button>
    </div>
  );
}
