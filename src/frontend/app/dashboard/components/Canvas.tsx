"use client";

import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  SelectionMode,
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

import StatNode from "./StatNode";
import OrthoEdge from "./OrthoEdge";
import { useGraphStore } from "../lib/store";
import { GRID } from "../lib/types";

const nodeTypes = { stat: StatNode } as const;
const edgeTypes = { ortho: OrthoEdge } as const;

const defaultEdgeOptions = { type: "ortho" } as const;

type Props = {
  /** 모바일 모드에서 React Flow 의 인터랙션 셋팅을 다르게 적용. */
  mobile?: boolean;
};

export default function Canvas({ mobile = false }: Props) {
  const rf = useReactFlow();
  const doc = useGraphStore((s) => s.doc);
  const connect = useGraphStore((s) => s.connect);
  const select = useGraphStore((s) => s.select);
  const moveNode = useGraphStore((s) => s.moveNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const runAll = useGraphStore((s) => s.runAll);

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
      })),
    [doc.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 적용은 react-flow 도우미로 — 그러나 위치 변화는 우리 store 에 동기.
      const updated = applyNodeChanges(changes, rfNodes);
      // 다중 선택을 고려해 select 변화는 마지막 selected 만 반영
      // (selectedId 는 단일 — 다중은 RF 내부 selected flag 가 보유).
      let lastSelected: string | null | undefined;
      changes.forEach((c) => {
        if (c.type === "position" && c.position && !c.dragging) {
          // 드래그 종료 시점에만 그리드 스냅 적용 + 저장.
          moveNode(c.id, c.position.x, c.position.y);
        }
        if (c.type === "select") {
          if (c.selected) lastSelected = c.id;
        }
        if (c.type === "remove") {
          removeNode(c.id);
        }
      });
      if (lastSelected !== undefined) select(lastSelected);
      // 드래그 중 위치는 react-flow 가 알아서 표시하지만, 우리 store 에는 반영 안함.
      void updated;
    },
    [rfNodes, moveNode, select, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, rfEdges);
      changes.forEach((c) => {
        if (c.type === "remove") removeEdge(c.id);
      });
      void updated;
    },
    [rfEdges, removeEdge],
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

  // 데스크톱: 좌클릭 드래그 = 영역 선택, 중·우클릭 드래그 = 팬.
  // 모바일: 한 손가락 드래그 = 팬, 두 손가락 = 핀치 줌 (RF 기본).
  const desktopProps = {
    selectionOnDrag: true,
    selectionMode: SelectionMode.Partial,
    panOnDrag: [1, 2] as number[],
    multiSelectionKeyCode: ["Control", "Meta"] as string[],
  } as const;
  const mobileProps = {
    selectionOnDrag: false,
    panOnDrag: true,
    multiSelectionKeyCode: null,
  } as const;
  const interactionProps = mobile ? mobileProps : desktopProps;
  const clearAllSelection = useCallback(() => {
    select(null);
    rf.setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
    rf.setEdges((eds) => eds.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, [rf, select]);

  return (
    <div
      className={`dash-canvas stat-canvas ${mobile ? "mobile" : ""}`}
      style={{ position: "relative" }}
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
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={clearAllSelection}
        defaultViewport={{ x: 80, y: 60, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        {...interactionProps}
      >
        <Background
          gap={GRID.size}
          size={1.2}
          color="#2a313e"
          variant={BackgroundVariant.Dots}
        />
      </ReactFlow>
    </div>
  );
}
