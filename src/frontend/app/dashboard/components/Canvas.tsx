"use client";

import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
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

export default function Canvas() {
  const doc = useGraphStore((s) => s.doc);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);
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
      // 위치 변화만 동기 (selection·dimensions 등은 read-only).
      changes.forEach((c) => {
        if (c.type === "position" && c.position && !c.dragging) {
          // 드래그 종료 시점에만 그리드 스냅 적용 + 저장.
          moveNode(c.id, c.position.x, c.position.y);
        }
        if (c.type === "select" && c.selected) {
          select(c.id);
        }
        if (c.type === "remove") {
          removeNode(c.id);
        }
      });
      // 드래그 중 위치는 react-flow 가 알아서 표시하지만, 우리 store 에는 반영 안함.
      // 그래서 일시적인 RF state 와 store 가 어긋날 수 있는데,
      // 다시 setNodes 를 트리거하면 store 기준으로 복귀하므로 괜찮음.
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

  return (
    <div className="dash-canvas stat-canvas" style={{ position: "relative" }}>
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
        onPaneClick={() => select(null)}
        defaultViewport={{ x: 80, y: 60, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
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
