/**
 * Zustand 스토어 — 그래프 상태 + 실행 상태 + 셀렉션 + 로그.
 */

import { create } from "zustand";
import type {
  ExecLog,
  GraphDoc,
  GraphEdge,
  GraphNode,
  NodeData,
} from "./types";
import { GRID, snap, snapXY } from "./types";
import { downstreamOf, executeGraph, type SlotMap } from "./exec";
import type { NodeTemplate } from "./registry";
import type { SubgraphTemplate } from "./subgraphTemplates";

type ExecState = "idle" | "running" | "ok" | "error";

type State = {
  doc: GraphDoc;
  selectedId: string | null;
  slots: SlotMap;
  logs: ExecLog[];
  execState: ExecState;
  pendingExec: number; // request counter — superseded re-runs.
  mode: import("./types").DashMode;
  /** Time Machine — 비교 결과 저장. */
  timeMachine: {
    ruleId?: string;
    years: number[];
    results: unknown[];
    deltaTable?: unknown[];
  };
  /** Conflict 검출 결과. */
  conflicts: {
    activeBefore: string[];
    suppressed: string[];
    activeAfter: string[];
    pairs: Array<{ a: string; b: string; winner: string; loser: string; reason: string }>;
  };

  // mutations
  setDoc(doc: GraphDoc): void;
  rename(name: string): void;
  setNodes(updater: (nodes: GraphNode[]) => GraphNode[]): void;
  setEdges(updater: (edges: GraphEdge[]) => GraphEdge[]): void;

  addNodeFromTemplate(tpl: NodeTemplate, at: { x: number; y: number }): GraphNode;
  addSubgraph(tpl: SubgraphTemplate, at?: { x: number; y: number }): { addedNodeIds: string[] };
  removeNode(id: string): void;
  moveNode(id: string, x: number, y: number): void;
  updateNodeData(id: string, patch: Partial<NodeData>): void;

  connect(params: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }): void;
  removeEdge(id: string): void;

  select(id: string | null): void;

  // execution
  runAll(): Promise<void>;
  runFrom(id: string): Promise<void>;
  clearLogs(): void;

  // overlay modes
  setMode(m: import("./types").DashMode): void;
  setYear(y: number): void;
  setTimeMachine(r: State["timeMachine"]): void;
  setConflicts(c: State["conflicts"]): void;
  toggleNodeDirection(id: string): void;
};

const newId = (prefix = "n"): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

function emptyDoc(): GraphDoc {
  return {
    id: "",
    name: "새 그래프",
    kind: "custom",
    nodes: [],
    edges: [],
  };
}

export const useGraphStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  selectedId: null,
  slots: new Map(),
  logs: [],
  execState: "idle",
  pendingExec: 0,
  mode: "normal",
  timeMachine: { years: [], results: [] },
  conflicts: { activeBefore: [], suppressed: [], activeAfter: [], pairs: [] },

  setDoc: (doc) => {
    set({ doc, slots: new Map(), logs: [], selectedId: null, execState: "idle" });
  },

  rename: (name) => set((s) => ({ doc: { ...s.doc, name } })),

  setNodes: (updater) =>
    set((s) => ({ doc: { ...s.doc, nodes: updater(s.doc.nodes) } })),

  setEdges: (updater) =>
    set((s) => ({ doc: { ...s.doc, edges: updater(s.doc.edges) } })),

  addNodeFromTemplate: (tpl, at) => {
    const id = newId();
    const pos = snapXY(at.x, at.y);
    const data: NodeData = {
      kind: tpl.kind,
      label: tpl.label,
      rule: tpl.rule,
      inputs: tpl.inputs,
      outputs: tpl.outputs,
    };
    if (tpl.kind === "manual" || tpl.kind === "input") {
      data.value = 0;
    } else if (tpl.kind === "threshold") {
      data.threshold = { op: "gt", limit: 0 };
    } else if (tpl.kind === "conditional") {
      data.conditional = { op: "gt", value: 0 };
    } else if (tpl.kind === "lookup") {
      data.lookup = { table: "custom", custom: {} };
    } else if (tpl.kind === "legal") {
      data.citation = tpl.citation ?? "";
    }
    const node: GraphNode = { id, type: "stat", position: pos, data };
    set((s) => ({ doc: { ...s.doc, nodes: [...s.doc.nodes, node] }, selectedId: id }));
    return node;
  },

  /**
   * 정형 패턴(subgraph) 을 캔버스에 통째로 추가.
   *
   * - 기존 그래프는 그대로 유지 — 새 노드/엣지가 추가될 뿐
   * - placeholder ID 는 새 unique ID 로 교체, 엣지 source/target 도 다시 결선
   * - 위치는 {@code at} 또는 (현재 그래프의 우측 끝 + 4 셀) 에 평행이동
   */
  addSubgraph: (tpl, at) => {
    const offset = at ?? defaultDropOffset(get().doc.nodes);

    // placeholder → new id 매핑.
    const idMap = new Map<string, string>();
    const newNodes: GraphNode[] = tpl.nodes.map((n) => {
      const id = newId();
      idMap.set(n.placeholderId, id);
      const x = snap(offset.x + n.cx * GRID.size);
      const y = snap(offset.y + n.cy * GRID.size);
      const data: NodeData = { ...n.data };
      return { id, type: "stat", position: { x, y }, data };
    });

    const newEdges: GraphEdge[] = [];
    for (const e of tpl.edges) {
      const src = idMap.get(e.source);
      const tgt = idMap.get(e.target);
      if (!src || !tgt) continue;
      const edge: GraphEdge = {
        id: newId("e"),
        source: src,
        target: tgt,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        type: "ortho",
      };
      newEdges.push(edge);
    }

    const addedIds = newNodes.map((n) => n.id);
    set((s) => {
      const log: ExecLog = {
        ts: Date.now(),
        nodeId: addedIds[0] ?? "",
        nodeLabel: tpl.name,
        status: "ok",
        message: `정형 패턴 드롭 — 노드 ${newNodes.length}개 + 엣지 ${newEdges.length}개`,
      };
      return {
        doc: {
          ...s.doc,
          nodes: [...s.doc.nodes, ...newNodes],
          edges: [...s.doc.edges, ...newEdges],
        },
        selectedId: addedIds[0] ?? s.selectedId,
        logs: [...s.logs, log].slice(-200),
      };
    });

    return { addedNodeIds: addedIds };
  },

  removeNode: (id) =>
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.filter((n) => n.id !== id),
        edges: s.doc.edges.filter((e) => e.source !== id && e.target !== id),
      },
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  moveNode: (id, x, y) => {
    const pos = snapXY(x, y);
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
      },
    }));
  },

  updateNodeData: (id, patch) => {
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      },
    }));
  },

  connect: ({ source, target, sourceHandle, targetHandle }) => {
    const id = newId("e");
    set((s) => {
      // 동일 source→target+포트 조합 중복 제거.
      const existing = s.doc.edges.find(
        (e) =>
          e.source === source &&
          e.target === target &&
          e.sourceHandle === sourceHandle &&
          e.targetHandle === targetHandle,
      );
      if (existing) return s;
      const edge: GraphEdge = { id, source, target, sourceHandle, targetHandle, type: "ortho" };
      return { doc: { ...s.doc, edges: [...s.doc.edges, edge] } };
    });
  },

  removeEdge: (id) =>
    set((s) => ({
      doc: { ...s.doc, edges: s.doc.edges.filter((e) => e.id !== id) },
    })),

  select: (id) => set({ selectedId: id }),

  runAll: async () => {
    const ticket = (get().pendingExec ?? 0) + 1;
    set({ pendingExec: ticket, execState: "running", logs: [] });
    const { doc } = get();
    // 글로벌 연도 — exec.ts 가 백엔드 호출에 사용.
    (globalThis as unknown as { __dashYear?: number }).__dashYear = doc.year ?? 0;
    const newSlots = await executeGraph(
      doc.nodes,
      doc.edges,
      null,
      (id, runtime, log) => {
        if (get().pendingExec !== ticket) return;
        set((s) => {
          // attach runtime to node + push log.
          const updated = s.doc.nodes.map((n) =>
            n.id === id && runtime ? { ...n, data: { ...n.data, runtime } } : n,
          );
          return {
            doc: { ...s.doc, nodes: updated },
            logs: [...s.logs, log].slice(-200),
          };
        });
      },
    );
    if (get().pendingExec !== ticket) return;
    const hasErr = get().logs.some((l) => l.status === "error");
    set({ slots: newSlots, execState: hasErr ? "error" : "ok" });
  },

  runFrom: async (id) => {
    const ticket = (get().pendingExec ?? 0) + 1;
    set({ pendingExec: ticket, execState: "running" });
    const { doc, slots } = get();
    (globalThis as unknown as { __dashYear?: number }).__dashYear = doc.year ?? 0;
    const dirty = downstreamOf(id, doc.edges);
    set((s) => {
      const entry: ExecLog = {
        ts: Date.now(),
        nodeId: id,
        nodeLabel: "graph",
        status: "ok",
        message: `incremental: ${dirty.size}개 노드 재평가`,
      };
      return { logs: [...s.logs, entry].slice(-200) };
    });
    const newSlots = await executeGraph(
      doc.nodes,
      doc.edges,
      slots,
      (nid, runtime, log) => {
        if (get().pendingExec !== ticket) return;
        set((s) => ({
          doc: {
            ...s.doc,
            nodes: s.doc.nodes.map((n) =>
              n.id === nid && runtime ? { ...n, data: { ...n.data, runtime } } : n,
            ),
          },
          logs: [...s.logs, log].slice(-200),
        }));
      },
      id,
    );
    if (get().pendingExec !== ticket) return;
    const hasErr = get().logs.some((l) => l.status === "error");
    set({ slots: newSlots, execState: hasErr ? "error" : "ok" });
  },

  clearLogs: () => set({ logs: [] }),

  setMode: (m) => set({ mode: m }),
  setYear: (y) =>
    set((s) => ({ doc: { ...s.doc, year: y } })),
  setTimeMachine: (r) => set({ timeMachine: r }),
  setConflicts: (c) => set({ conflicts: c }),
  toggleNodeDirection: (id) =>
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  direction:
                    (n.data.direction ?? "forward") === "forward"
                      ? "reverse"
                      : "forward",
                },
              }
            : n,
        ),
      },
    })),
}));

/** 그리드 셀 단위로 위치를 해석하는 도우미. */
export function gridCell(x: number, y: number) {
  return { x: x * GRID.size, y: y * GRID.size };
}

/**
 * 새 subgraph 가 기존 노드를 가리지 않도록 기본 드롭 위치를 계산.
 * — 빈 캔버스: (2,2) 셀
 * — 기존 노드 있음: 가장 오른쪽 노드의 우측 + 4 셀, y=2 셀
 */
function defaultDropOffset(nodes: GraphNode[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 2 * GRID.size, y: 2 * GRID.size };
  }
  const maxRight = Math.max(...nodes.map((n) => n.position.x + 224)); // node width
  const x = snap(maxRight + 4 * GRID.size);
  return { x, y: 2 * GRID.size };
}
