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
  type OnConnectStart,
  type OnConnectEnd,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import { useGraphStore } from "../lib/store";
import { GRID, type GraphDoc } from "../lib/types";
import {
  ALL_TEMPLATES,
  formulaTemplatesByParent,
  type NodeTemplate,
} from "../lib/registry";
import { SUBGRAPH_TEMPLATES, type SubgraphTemplate } from "../lib/subgraphTemplates";
import {
  listGraphs,
  loadGraph,
  saveGraph,
  deleteGraph,
  timeMachineYears,
} from "../lib/api";
import { autoLayoutEasy } from "../lib/elk";
import { TEMPLATES } from "../lib/templates";
import EasyStatNode from "./EasyStatNode";
import EasyConnectionLine from "./EasyConnectionLine";
import TaxAxChatPanel from "../ax/TaxAxChatPanel";

const nodeTypes = { easyStat: EasyStatNode } as const;
const defaultEdgeOptions = { type: "smoothstep" } as const;

const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_TOLERANCE_PX = 30;
const DOUBLE_TAP_ZOOM_FACTOR = 1.6;

const LONG_PRESS_MS = 550;
const LONG_PRESS_TOLERANCE_PX = 8;

type Tab = "info" | "exec" | "menu" | "add" | "help";

export default function EasyMobileDashboard() {
  return (
    <ReactFlowProvider>
      <EasyMobileBody />
    </ReactFlowProvider>
  );
}

function EasyMobileBody() {
  const doc = useGraphStore((s) => s.doc);
  const rename = useGraphStore((s) => s.rename);
  const setDoc = useGraphStore((s) => s.setDoc);
  const setNodes = useGraphStore((s) => s.setNodes);
  const select = useGraphStore((s) => s.select);

  const connect = useGraphStore((s) => s.connect);
  const runAll = useGraphStore((s) => s.runAll);
  const execState = useGraphStore((s) => s.execState);
  const selectedId = useGraphStore((s) => s.selectedId);
  const logs = useGraphStore((s) => s.logs);
  const setYear = useGraphStore((s) => s.setYear);
  const addNodeFromTemplate = useGraphStore((s) => s.addNodeFromTemplate);
  const addSubgraph = useGraphStore((s) => s.addSubgraph);
  const removeNode = useGraphStore((s) => s.removeNode);
  const mode = useGraphStore((s) => s.mode);
  const setMode = useGraphStore((s) => s.setMode);

  const [tab, setTab] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);

  const savedResults = useGraphStore((s) => s.savedResults);
  const saveResult = useGraphStore((s) => s.saveResult);
  const loadResult = useGraphStore((s) => s.loadResult);
  const deleteResult = useGraphStore((s) => s.deleteResult);

  const rf = useReactFlow();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // ── 길게 누름 → 노드 삭제 ────────────────────────────────────────
  const pressRef = useRef<{
    timer: number | null;
    nodeId: string | null;
    label: string;
    startX: number;
    startY: number;
  }>({ timer: null, nodeId: null, label: "", startX: 0, startY: 0 });

  const findNodeIdAt = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>(".react-flow__node");
    return el?.dataset.id ?? null;
  };

  const cancelPress = () => {
    if (pressRef.current.timer != null) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
    pressRef.current.nodeId = null;
  };

  // 쉬운 모드 진입 시 자동 레이아웃 1회 (n8n 스타일 프리폼)
  useEffect(() => {
    if (doc.nodes.length === 0) return;
    autoLayoutEasy(doc.nodes, doc.edges).then((laid) => {
      setNodes(() => laid);
      queueMicrotask(() => rf.fitView({ padding: 0.18, duration: 240 }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceNode = doc.nodes.find((n) => n.id === connection.source);
      const targetNode = doc.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      const invalidSources = ["legal", "output", "pdf"];
      const invalidTargets = ["input", "manual", "legal"];
      return (
        !invalidSources.includes(sourceNode.data.kind) &&
        !invalidTargets.includes(targetNode.data.kind)
      );
    },
    [doc.nodes],
  );

  const rfNodes: Node[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        type: "easyStat",
        position: n.position,
        data: n.data,
        selectable: true,
        draggable: true,
        selected: n.id === selectedId,
        className:
          connectingFrom && isValidConnection({ source: connectingFrom, target: n.id, sourceHandle: null, targetHandle: null })
            ? "valid-target"
            : connectingFrom
              ? "invalid-target"
              : undefined,
      })),
    [doc.nodes, selectedId, connectingFrom, isValidConnection],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      doc.edges.map((e) => {
        const sNode = doc.nodes.find((n) => n.id === e.source);
        const tNode = doc.nodes.find((n) => n.id === e.target);
        const valid =
          sNode &&
          tNode &&
          !["legal", "output", "pdf"].includes(sNode.data.kind) &&
          !["input", "manual", "legal"].includes(tNode.data.kind);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          type: "smoothstep",
          selectable: false,
          style: {
            stroke: valid ? "#10b981" : "#ef4444",
            strokeWidth: 2.5,
          },
        };
      }),
    [doc.edges, doc.nodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      let lastSelected: string | null = null;

      // 드래그 종료 및 키보드 이동 시에만 store에 위치 반영 (snap 없이)
      const positionChanges = changes.filter(
        (c): c is Extract<NodeChange, { type: "position" }> =>
          c.type === "position" && c.position != null && !c.dragging,
      );
      if (positionChanges.length > 0) {
        setNodes((nodes) =>
          nodes.map((n) => {
            const change = positionChanges.find((c) => c.id === n.id);
            return change ? { ...n, position: change.position! } : n;
          }),
        );
      }

      let hasSelectChange = false;
      changes.forEach((c) => {
        if (c.type === "select") {
          hasSelectChange = true;
          if (c.selected) lastSelected = c.id;
        }
      });
      if (hasSelectChange) select(lastSelected);
      void updated;
    },
    [rfNodes, setNodes, select],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, rfEdges);
      void updated;
    },
    [rfEdges],
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

  const onConnectStart: OnConnectStart = useCallback(
    (_: unknown, params) => {
      if (params.nodeId) setConnectingFrom(params.nodeId);
    },
    [],
  );

  const onConnectEnd: OnConnectEnd = useCallback(() => {
    setConnectingFrom(null);
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === node.id ? { ...n, position: node.position } : n,
        ),
      );
    },
    [setNodes],
  );

  // 더블탭 줌
  const lastTapRef = useRef<{ ts: number; x: number; y: number } | null>(null);

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

    if (!id) {
      const now = performance.now();
      const last = lastTapRef.current;
      if (
        last &&
        now - last.ts < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_TOLERANCE_PX
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

    if (!editMode) return;

    const label = doc.nodes.find((n) => n.id === id)?.data.label ?? id.slice(0, 6);
    pressRef.current = {
      timer: window.setTimeout(() => {
        const cur = pressRef.current.nodeId;
        if (cur) {
          if (confirm(`"${pressRef.current.label}" 노드를 삭제하시겠습니까?`)) {
            removeNode(cur);
            showToast(`삭제: ${pressRef.current.label}`);
            if ("vibrate" in navigator) navigator.vibrate?.(40);
          }
        }
        pressRef.current.timer = null;
      }, LONG_PRESS_MS),
      nodeId: id,
      label,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1600);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pressRef.current.timer == null) return;
    const dx = e.clientX - pressRef.current.startX;
    const dy = e.clientY - pressRef.current.startY;
    if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE_PX) cancelPress();
  };

  const onNodeClick = useCallback(
    (_e: unknown, n: Node) => {
      select(n.id);
      setTab("info");
    },
    [select],
  );

  return (
    <div className="dash-mobile easy-mobile">
      <header className="m-head easy-m-head">
        <input
          className="m-title easy-m-title"
          value={doc.name}
          onChange={(e) => rename(e.target.value)}
          aria-label="그래프 이름"
        />
        <span className={`m-status m-status-${execState}`}>
          {execState.toUpperCase()}
        </span>
        <button
          className="m-help-btn easy-m-help-btn"
          onClick={() => setTab("help")}
          aria-label="도움말"
        >
          ?
        </button>
        <button
          className={`m-edit-toggle easy-m-edit-toggle ${editMode ? "active" : ""}`}
          onClick={() => setEditMode((v) => !v)}
          aria-label={editMode ? "보기 모드로 전환" : "편집 모드로 전환"}
        >
          {editMode ? "보기" : "편집"}
        </button>
        <button className="m-run easy-m-run" onClick={() => runAll()} aria-label="재실행">
          ▶
        </button>
      </header>

      <div
        ref={canvasRef}
        className={`m-canvas easy-m-canvas ${connectingFrom ? "connecting" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          connectionLineComponent={EasyConnectionLine}
          snapToGrid
          snapGrid={[GRID.size, GRID.size]}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          isValidConnection={isValidConnection}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeClick={onNodeClick}
          onPaneClick={() => {
            select(null);
            setTab(null);
          }}
          defaultViewport={{ x: 24, y: 60, zoom: 0.9 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
          panOnDrag={editMode}
          zoomOnPinch
          deleteKeyCode={null}
          nodesDraggable={editMode}
          selectionOnDrag={false}
          multiSelectionKeyCode={null}
          edgesFocusable={true}
          edgeUpdaterRadius={14}
        >
          <Background
            gap={GRID.size}
            size={1.2}
            color="#cbd5e1"
            variant={BackgroundVariant.Dots}
          />
        </ReactFlow>

        <ZoomControls onShowToast={showToast} />

        <button
          className={`m-ax-float ${mode === "ax" ? "active" : ""}`}
          onClick={() => setMode(mode === "ax" ? "normal" : "ax")}
          aria-label="AI"
          title="AI"
        >
          AI
        </button>

        <span
          className={`m-mode-badge ${editMode ? "m-mode-edit" : "m-mode-view"}`}
          aria-label={`현재 상태: ${editMode ? "편집" : "보기"}`}
        >
          {editMode ? "편집" : "보기"}
        </span>
      </div>

      {mode === "ax" && <TaxAxChatPanel />}

      {tab && (
        <section className="m-sheet easy-m-sheet" role="dialog" aria-label={tab}>
          <div className="m-sheet-head easy-m-sheet-head">
            <span className="m-sheet-title">
              {tab === "info" && "노드 정보"}
              {tab === "add" && "노드 추가"}
              {tab === "exec" && "실행 결과"}
              {tab === "menu" && "메뉴"}
              {tab === "help" && "도움말"}
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
            {tab === "info" && <EasyInfoSheet selectedId={selectedId} editMode={editMode} />}
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
              <EasyMenuSheet
                doc={doc}
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
                onReset={() => {
                  if (!confirm("현재 그래프를 초기화하시겠습니까? 저장되지 않은 내용은 사라집니다.")) return;
                  setDoc({
                    id: "",
                    name: "새 그래프",
                    kind: "custom",
                    nodes: [],
                    edges: [],
                  });
                  showToast("그래프가 초기화되었습니다.");
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
                    const laid = await autoLayoutEasy(doc.nodes, doc.edges);
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
            {tab === "help" && <HelpSheet />}
          </div>
        </section>
      )}

      <nav className="m-tabs easy-m-tabs" aria-label="대시보드 탭">
        <TabButton label="ⓘ정보" id="info" cur={tab} onSelect={setTab} />
        <TabButton label="＋추가" id="add" cur={tab} onSelect={setTab} />
        <TabButton label="▶실행" id="exec" cur={tab} onSelect={setTab} />
        <TabButton label="☰메뉴" id="menu" cur={tab} onSelect={setTab} />
      </nav>

      {toast && <div className="m-toast easy-m-toast">{toast}</div>}

      <EasyHint />
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
      className={`m-tab easy-m-tab ${active ? "active" : ""}`}
      onClick={() => onSelect(active ? null : id)}
    >
      {label}
    </button>
  );
}

function ZoomControls({
  onShowToast,
}: {
  onShowToast: (m: string) => void;
}) {
  const rf = useReactFlow();
  return (
    <div className="m-zoom" role="group" aria-label="줌 컨트롤">
      <button
        className="m-zoom-btn easy-m-zoom-btn"
        onClick={() => rf.zoomIn({ duration: 180 })}
        aria-label="확대"
      >
        ＋
      </button>
      <button
        className="m-zoom-btn easy-m-zoom-btn"
        onClick={() => rf.zoomOut({ duration: 180 })}
        aria-label="축소"
      >
        −
      </button>
      <button
        className="m-zoom-btn easy-m-zoom-btn"
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
        className="m-zoom-btn easy-m-zoom-btn"
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

function EasyInfoSheet({ selectedId, editMode }: { selectedId: string | null; editMode: boolean }) {
  const node = useGraphStore((s) =>
    selectedId ? s.doc.nodes.find((n) => n.id === selectedId) : undefined,
  );
  if (!node) {
    return (
      <p className="m-empty easy-m-empty">
        노드를 짧게 탭하면 결과가 표시됩니다.
        <br />
        {editMode ? "길게 누르면 삭제됩니다." : "편집 모드에서만 삭제할 수 있습니다."}
      </p>
    );
  }
  const r = node.data.runtime;
  return (
    <div className="m-info easy-m-info">
      <div className="m-info-row easy-m-info-row">
        <span className="m-info-key easy-m-info-key">항목</span>
        <span className="m-info-val easy-m-info-val">{node.data.label}</span>
      </div>
      <div className="m-info-row easy-m-info-row">
        <span className="m-info-key easy-m-info-key">유형</span>
        <span className="m-info-val easy-m-info-val">
          {EASY_KIND[node.data.kind] ?? node.data.kind}
        </span>
      </div>
      {node.data.value !== undefined && (
        <div className="m-info-row easy-m-info-row">
          <span className="m-info-key easy-m-info-key">입력값</span>
          <span className="m-info-val easy-m-info-val">{String(node.data.value)}</span>
        </div>
      )}
      {r && (
        <>
          <div className="m-info-row easy-m-info-row">
            <span className="m-info-key easy-m-info-key">결과</span>
            <span className="m-info-val easy-m-info-val">{formatOutput(r.output)}</span>
          </div>
          {r.error && (
            <div className="m-info-row easy-m-info-row">
              <span className="m-info-key easy-m-info-key">오류</span>
              <span className="m-info-val easy-m-info-val err">{r.error}</span>
            </div>
          )}
          {r.legalBasis && (
            <div className="m-info-row easy-m-info-row block">
              <span className="m-info-key easy-m-info-key">근거 법령</span>
              <p className="easy-m-info-basis">{r.legalBasis}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const EASY_KIND: Record<string, string> = {
  input: "입력값",
  manual: "고정값",
  formula: "계산식",
  conditional: "조건분기",
  threshold: "기준판단",
  lookup: "표조회",
  legal: "법령근거",
  output: "최종결과",
  pdf: "출력서식",
};

function formatOutput(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "object") {
    if (Array.isArray(v)) return `목록 ${v.length}건`;
    return `데이터 ${Object.keys(v).length}항`;
  }
  return String(v);
}

function EasyMenuSheet({
  doc,
  onSetYear,
  onLoadTemplate,
  onLoadSaved,
  onSave,
  onNew,
  onReset,
  onDelete,
  onAutoLayout,
}: {
  doc: GraphDoc;
  onSetYear: (y: number) => void;
  onLoadTemplate: (id: string) => void;
  onLoadSaved: (id: string) => void;
  onSave: () => void;
  onNew: () => void;
  onReset: () => void;
  onDelete: () => void;
  onAutoLayout: () => void;
}) {
  const [saved, setSaved] = useState<
    Array<{ id: string; name: string; kind: string; updatedAt: string }>
  >([]);
  const [years, setYears] = useState<number[]>([]);
  const savedResults = useGraphStore((s) => s.savedResults);
  const saveResult = useGraphStore((s) => s.saveResult);
  const loadResult = useGraphStore((s) => s.loadResult);
  const deleteResult = useGraphStore((s) => s.deleteResult);

  useEffect(() => {
    listGraphs()
      .then((list) => setSaved(list))
      .catch(() => setSaved([]));
    timeMachineYears()
      .then((r) => setYears(r.years))
      .catch(() => setYears([]));
  }, []);

  return (
    <div className="m-menu easy-m-menu">
      <section className="m-menu-section">
        <div className="m-menu-label easy-m-menu-label">그래프</div>
        <div className="m-menu-row">
          <button className="m-menu-btn accent easy-m-menu-btn-accent" onClick={onSave}>
            ▣ 저장
          </button>
          <button className="m-menu-btn easy-m-menu-btn" onClick={onNew}>
            ＋ 새로
          </button>
          <button
            className="m-menu-btn danger easy-m-menu-btn-danger"
            onClick={onReset}
          >
            ⟲ 초기화
          </button>
        </div>
        <div className="m-menu-row" style={{ marginTop: 6 }}>
          <button
            className="m-menu-btn danger full easy-m-menu-btn-danger"
            onClick={onDelete}
            disabled={!doc.id}
          >
            × 그래프 삭제
          </button>
        </div>
        <div className="m-menu-id">
          ID: <span>{doc.id || "(미저장)"}</span>
        </div>
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label easy-m-menu-label">템플릿</div>
        <select
          className="m-menu-select easy-m-menu-select"
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
          className="m-menu-select easy-m-menu-select"
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
        <div className="m-menu-label easy-m-menu-label">예시 불러오기</div>
        <div className="m-template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="m-template-chip easy-m-template-chip"
              onClick={() => onLoadTemplate(t.id)}
            >
              <span className="m-template-name">{t.name}</span>
              <span className="m-template-kind">[{t.kind}]</span>
            </button>
          ))}
        </div>
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label easy-m-menu-label">레이아웃</div>
        <button className="m-menu-btn full easy-m-menu-btn" onClick={onAutoLayout}>
          ⌗ 자동 정렬
        </button>
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label easy-m-menu-label">기준 연도</div>
        {years.length === 0 ? (
          <p className="m-empty easy-m-empty" style={{ padding: 8 }}>
            연도 목록을 가져올 수 없습니다.
          </p>
        ) : (
          <div className="m-year-grid">
            {years.map((y) => (
              <button
                key={y}
                className={`m-year ${doc.year === y ? "active" : ""} easy-m-year`}
                onClick={() => onSetYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="m-menu-section">
        <div className="m-menu-label easy-m-menu-label">계산 결과 저장/불러오기</div>
        <div className="m-menu-row">
          <input
            className="m-menu-input easy-m-menu-input"
            placeholder="결과 이름"
            id="easy-save-result-name"
            style={{ flex: 1 }}
          />
          <button
            className="m-menu-btn accent easy-m-menu-btn-accent"
            onClick={() => {
              const el = document.getElementById("easy-save-result-name") as HTMLInputElement | null;
              const name = el?.value.trim();
              if (name) {
                saveResult(name);
                if (el) el.value = "";
              }
            }}
          >
            ▣ 저장
          </button>
        </div>
        {savedResults.length === 0 ? (
          <p className="m-empty easy-m-empty" style={{ padding: 8 }}>
            저장된 계산 결과가 없습니다.
          </p>
        ) : (
          <div className="m-result-list">
            {savedResults.map((r) => (
              <div key={r.id} className="m-result-item">
                <span className="m-result-name">{r.name}</span>
                <span className="m-result-date">
                  {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                </span>
                <button
                  className="m-menu-btn easy-m-menu-btn"
                  onClick={() => loadResult(r.id)}
                >
                  불러오기
                </button>
                <button
                  className="m-menu-btn danger easy-m-menu-btn-danger"
                  onClick={() => {
                    if (confirm(`"${r.name}" 결과를 삭제하시겠습니까?`)) deleteResult(r.id);
                  }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
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
  const runtimeNodes = nodes.filter((n) => n.data.runtime);
  return (
    <div className="m-exec">
      <button className="m-exec-btn easy-m-exec-btn" onClick={() => runAll()}>
        ▶ 전체 재실행 ({execState})
      </button>

      <div className="m-menu-label easy-m-menu-label">전체 결과 요약</div>
      {runtimeNodes.length === 0 ? (
        <p className="m-empty easy-m-empty">실행 결과가 없습니다.</p>
      ) : (
        <table className="m-summary-table easy-m-summary-table">
          <thead>
            <tr>
              <th>노드</th>
              <th>출력</th>
            </tr>
          </thead>
          <tbody>
            {runtimeNodes.map((n) => (
              <tr key={n.id}>
                <td>{n.data.label}</td>
                <td className="m-summary-val">
                  {formatOutput(n.data.runtime?.output)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="m-menu-label easy-m-menu-label" style={{ marginTop: 14 }}>
        출력 노드
      </div>
      <div className="m-exec-list">
        {outputs.length === 0 ? (
          <p className="m-empty easy-m-empty">출력 노드가 없습니다.</p>
        ) : (
          outputs.map((n) => (
            <div key={n.id} className="m-exec-item">
              <span className="m-exec-lbl">{n.data.label}</span>
              <span className="m-exec-val">{formatOutput(n.data.runtime?.output)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AddSheet({
  onAddTemplate,
  onAddSubgraph,
}: {
  onAddTemplate: (t: NodeTemplate) => void;
  onAddSubgraph: (t: SubgraphTemplate) => void;
}) {
  const [openParents, setOpenParents] = useState<Set<string>>(
    new Set(["근로소득", "종합소득세", "연말정산", "세액공제", "정통산식"])
  );
  const toggleParent = (p: string) => {
    setOpenParents((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };
  const baseNodes = ALL_TEMPLATES.filter((t) => t.kind !== "formula");
  const formulaGroups = formulaTemplatesByParent();

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
      <div className="m-add-section">기본 노드</div>
      <div className="m-chip-grid">
        {baseNodes.map((t) => (
          <button
            key={t.kind}
            className="m-chip"
            data-kind={t.kind}
            onClick={() => onAddTemplate(t)}
          >
            <span className="m-chip-lbl">{t.label}</span>
            {t.hint && <span className="m-chip-hint">{t.hint}</span>}
          </button>
        ))}
      </div>
      {formulaGroups.map(({ parent, items }) => {
        const open = openParents.has(parent);
        return (
          <div key={parent}>
            <button
              className="m-add-section"
              onClick={() => toggleParent(parent)}
              style={{ textAlign: "left", width: "100%" }}
            >
              <span style={{ display: "inline-block", width: 16 }}>
                {open ? "▼" : "▶"}
              </span>
              {parent}
            </button>
            {open && (
              <div className="m-chip-grid">
                {items.map((t) => (
                  <button
                    key={`formula:${t.rule}`}
                    className="m-chip"
                    data-kind="formula"
                    onClick={() => onAddTemplate(t)}
                  >
                    <span className="m-chip-lbl">{t.label}</span>
                    {t.hint && <span className="m-chip-hint">{t.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HelpSheet() {
  return (
    <div className="m-help-sheet easy-m-help-sheet">
      <div className="m-help-section">
        <div className="m-menu-label easy-m-menu-label">단축키</div>
        <div className="m-help-list">
          <p>Ctrl+Enter : 전체 재실행</p>
          <p>Delete : 선택 노드 삭제</p>
          <p>Escape : 선택 해제</p>
          <p>? : 도움말</p>
          <p>Ctrl+S : 그래프 저장</p>
          <p>Ctrl+0 : 화면 맞춤</p>
        </div>
      </div>
      <div className="m-help-section">
        <div className="m-menu-label easy-m-menu-label">사용법</div>
        <div className="m-help-list">
          <p>짧게 클릭 : 노드 결과 확인</p>
          <p>편집 모드에서 길게 누름(모바일) : 노드 삭제 (확인 후)</p>
          <p>편집 모드에서 노드 드래그 : 이동</p>
          <p>엣지 끝점 드래그 : 다른 노드로 재연결</p>
          <p>빈 영역 두 번 탭 : 손가락 위치로 확대</p>
        </div>
      </div>
    </div>
  );
}

function EasyHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("dash-easy-mobile-hint") === "1") return;
    setShow(true);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dash-easy-mobile-hint", "1");
    }
  };
  return (
    <div className="m-hint easy-m-hint" onClick={dismiss}>
      <p>
        <b>짧게 탭</b> — 노드 결과 확인
        <br />
        <b>편집 → 길게 누름</b> — 노드 삭제
        <br />
        <b>두 번 탭(빈 곳)</b> — 손가락 위치로 확대
        <br />
        <b>두 손가락</b> — 핀치 줌
      </p>
      <button className="m-hint-x easy-m-hint-x">알겠습니다</button>
    </div>
  );
}
