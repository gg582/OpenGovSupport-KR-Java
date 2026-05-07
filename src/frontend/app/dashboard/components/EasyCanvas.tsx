"use client";

import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import EasyStatNode from "./EasyStatNode";
import { useGraphStore } from "../lib/store";
import { GRID } from "../lib/types";
import { autoLayoutEasy } from "../lib/elk";

const nodeTypes = { easyStat: EasyStatNode } as const;
const defaultEdgeOptions = { type: "smoothstep" } as const;

export default function EasyCanvas() {
  const doc = useGraphStore((s) => s.doc);
  const setNodes = useGraphStore((s) => s.setNodes);
  const select = useGraphStore((s) => s.select);

  // 쉬운 모드 진입 시 자동 레이아웃 1회 적용 (n8n 스타일 프리폼)
  useEffect(() => {
    if (doc.nodes.length === 0) return;
    autoLayoutEasy(doc.nodes, doc.edges).then((laid) => {
      setNodes(() => laid);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rfNodes: Node[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        type: "easyStat",
        position: n.position,
        data: n.data,
        draggable: false,
        selectable: true,
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
        selectable: false,
      })),
    [doc.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      let lastSelected: string | null | undefined;
      changes.forEach((c) => {
        if (c.type === "select") {
          if (c.selected) lastSelected = c.id;
        }
      });
      if (lastSelected !== undefined) select(lastSelected);
      void updated;
    },
    [rfNodes, select],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, rfEdges);
      void updated;
    },
    [rfEdges],
  );

  return (
    <div className="dash-canvas easy-canvas" style={{ position: "relative" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        snapToGrid
        snapGrid={[GRID.size, GRID.size]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        defaultViewport={{ x: 80, y: 60, zoom: 0.9 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionOnDrag={false}
        panOnDrag={true}
        zoomOnDoubleClick={false}
      >
        <Background
          gap={GRID.size}
          size={1.2}
          color="#cbd5e1"
          variant={BackgroundVariant.Dots}
        />
      </ReactFlow>
    </div>
  );
}
