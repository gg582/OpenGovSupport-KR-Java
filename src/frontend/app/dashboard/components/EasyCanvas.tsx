"use client";

import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import EasyStatNode from "./EasyStatNode";
import EasyConnectionLine from "./EasyConnectionLine";
import { useGraphStore } from "../lib/store";
import { GRID } from "../lib/types";
import { autoLayoutEasy } from "../lib/elk";

const nodeTypes = { easyStat: EasyStatNode } as const;
const defaultEdgeOptions = { type: "smoothstep" } as const;

export default function EasyCanvas() {
  const doc = useGraphStore((s) => s.doc);
  const setNodes = useGraphStore((s) => s.setNodes);
  const select = useGraphStore((s) => s.select);
  const moveNode = useGraphStore((s) => s.moveNode);
  const connect = useGraphStore((s) => s.connect);
  const runAll = useGraphStore((s) => s.runAll);

  // 쉬운 모드 진입 시 자동 레이아웃 1회 적용 (n8n 스타일 프리폼)
  useEffect(() => {
    if (doc.nodes.length === 0) return;
    autoLayoutEasy(doc.nodes, doc.edges).then((laid) => {
      setNodes(() => laid);
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
    [rfNodes, moveNode, select],
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

  return (
    <div className="dash-canvas easy-canvas" style={{ position: "relative" }}>
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
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        defaultViewport={{ x: 80, y: 60, zoom: 0.9 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.2}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionOnDrag={false}
        panOnDrag={[1, 2]}
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
