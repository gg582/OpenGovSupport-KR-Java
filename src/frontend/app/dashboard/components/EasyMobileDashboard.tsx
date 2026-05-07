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
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import { useGraphStore } from "../lib/store";
import { GRID, type GraphDoc } from "../lib/types";
import { ALL_TEMPLATES, type NodeTemplate } from "../lib/registry";
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

const nodeTypes = { easyStat: EasyStatNode } as const;
const defaultEdgeOptions = { type: "smoothstep" } as const;

const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_TOLERANCE_PX = 30;
const DOUBLE_TAP_ZOOM_FACTOR = 1.6;

type Tab = "info" | "exec" | "menu" | "add";

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
  const moveNode = useGraphStore((s) => s.moveNode);
  const connect = useGraphStore((s) => s.connect);
  const runAll = useGraphStore((s) => s.runAll);
  const execState = useGraphStore((s) => s.execState);
  const selectedId = useGraphStore((s) => s.selectedId);
  const logs = useGraphStore((s) => s.logs);
  const setYear = useGraphStore((s) => s.setYear);
  const addNodeFromTemplate = useGraphStore((s) => s.addNodeFromTemplate);
  const addSubgraph = useGraphStore((s) => s.addSubgraph);

  const [tab, setTab] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const rf = useReactFlow();
  const canvasRef = useRef<HTMLDivElement | null>(null);

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
      })),
    [doc.nodes],
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
      let lastSelected: string | null | undefined;
      changes.forEach((c) => {
        if (c.type === "position" && c.position && !c.dragging) {
          moveNode(c.id, c.position.x, c.position.y);
        }
        if (c.type === "select") {
          if (c.selected) lastSelected = c.id;
        }
      });
      if (lastSelected !== undefined) select(lastSelected);
      void updated;
    },
    [rfNodes, select, moveNode],
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
        <button className="m-run easy-m-run" onClick={() => runAll()} aria-label="재실행">
          ▶
        </button>
      </header>

      <div
        ref={canvasRef}
        className="m-canvas easy-m-canvas"
        onPointerDown={onPointerDown}
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
          isValidConnection={isValidConnection}
          onNodeClick={onNodeClick}
          onPaneClick={() => {
            select(null);
            setTab(null);
          }}
          defaultViewport={{ x: 24, y: 60, zoom: 0.9 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
          panOnDrag
          zoomOnPinch
          deleteKeyCode={null}
          selectionOnDrag={false}
          multiSelectionKeyCode={null}
          edgesFocusable={false}
        >
          <Background
            gap={GRID.size}
            size={1.2}
            color="#cbd5e1"
            variant={BackgroundVariant.Dots}
          />
        </ReactFlow>

        <ZoomControls onShowToast={showToast} />
      </div>

      {tab && (
        <section className="m-sheet easy-m-sheet" role="dialog" aria-label={tab}>
          <div className="m-sheet-head easy-m-sheet-head">
            <span className="m-sheet-title">
              {tab === "info" && "노드 정보"}
              {tab === "add" && "노드 추가"}
              {tab === "exec" && "실행 결과"}
              {tab === "menu" && "메뉴"}
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
            {tab === "info" && <EasyInfoSheet selectedId={selectedId} />}
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

function EasyInfoSheet({ selectedId }: { selectedId: string | null }) {
  const node = useGraphStore((s) =>
    selectedId ? s.doc.nodes.find((n) => n.id === selectedId) : undefined,
  );
  if (!node) {
    return (
      <p className="m-empty easy-m-empty">
        노드를 짧게 탭하면 결과가 표시됩니다.
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
  conditional: "조걸분기",
  threshold: "기준판단",
  lookup: "표조회",
  legal: "법령근거",
  output: "최종결과",
  pdf: "출력서식",
};

function formatOutput(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

function EasyMenuSheet({
  doc,
  onSetYear,
  onLoadTemplate,
  onLoadSaved,
  onSave,
  onNew,
  onDelete,
  onAutoLayout,
}: {
  doc: GraphDoc;
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
      <button className="m-exec-btn easy-m-exec-btn" onClick={() => runAll()}>
        ▶ 전체 재실행 ({execState})
      </button>
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
        <b>두 번 탭(빈 곳)</b> — 손가락 위치로 확대
        <br />
        <b>두 손가락</b> — 핀치 줌 / 한 손가락 드래그 = 팬
      </p>
      <button className="m-hint-x easy-m-hint-x">알겠습니다</button>
    </div>
  );
}
