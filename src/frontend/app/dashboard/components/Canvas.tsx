"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type OnConnectStart,
  type OnConnectEnd,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import StatNode from "./StatNode";
import OrthoEdge from "./OrthoEdge";
import { useGraphStore } from "../lib/store";
import { GRID, snapXY } from "../lib/types";
import type { NodeTemplate } from "../lib/registry";
import { SUBGRAPH_TEMPLATES } from "../lib/subgraphTemplates";

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
  const selectedId = useGraphStore((s) => s.selectedId);
  const connect = useGraphStore((s) => s.connect);
  const select = useGraphStore((s) => s.select);
  const setNodes = useGraphStore((s) => s.setNodes);
  const removeNode = useGraphStore((s) => s.removeNode);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const runAll = useGraphStore((s) => s.runAll);
  const addNodeFromTemplate = useGraphStore((s) => s.addNodeFromTemplate);
  const addSubgraph = useGraphStore((s) => s.addSubgraph);
  const fitViewTrigger = useGraphStore((s) => s.fitViewTrigger);
  const execState = useGraphStore((s) => s.execState);
  const [isDragOver, setIsDragOver] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);

  useEffect(() => {
    if (fitViewTrigger > 0) {
      rf.fitView({ padding: 0.18, duration: 240 });
    }
  }, [fitViewTrigger, rf]);

  const isValidTarget = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return false;
      const sNode = doc.nodes.find((n) => n.id === sourceId);
      const tNode = doc.nodes.find((n) => n.id === targetId);
      if (!sNode || !tNode) return false;
      const invalidSources = ["legal", "output", "pdf"];
      const invalidTargets = ["input", "manual", "legal"];
      return (
        !invalidSources.includes(sNode.data.kind) &&
        !invalidTargets.includes(tNode.data.kind)
      );
    },
    [doc.nodes],
  );

  const rfNodes: Node[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        type: "stat",
        position: n.position,
        data: n.data,
        draggable: true,
        selected: n.id === selectedId,
        className:
          connectingFrom && isValidTarget(connectingFrom, n.id)
            ? "valid-target"
            : connectingFrom
              ? "invalid-target"
              : undefined,
      })),
    [doc.nodes, selectedId, connectingFrom, isValidTarget],
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

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const pos = snapXY(node.position.x, node.position.y);
      setNodes((nodes) =>
        nodes.map((n) => (n.id === node.id ? { ...n, position: pos } : n)),
      );
    },
    [setNodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      let lastSelected: string | null | undefined;
      changes.forEach((c) => {
        if (c.type === "select") {
          if (c.selected) lastSelected = c.id;
        }
        if (c.type === "remove") {
          removeNode(c.id);
        }
      });
      if (lastSelected !== undefined) select(lastSelected);
      void updated;
    },
    [rfNodes, select, removeNode],
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

  const onConnectStart: OnConnectStart = useCallback(
    (_: unknown, params) => {
      if (params.nodeId) setConnectingFrom(params.nodeId);
    },
    [],
  );

  const onConnectEnd: OnConnectEnd = useCallback(() => {
    setConnectingFrom(null);
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!newConnection.source || !newConnection.target) return;
      removeEdge(oldEdge.id);
      connect({
        source: newConnection.source,
        target: newConnection.target,
        sourceHandle: newConnection.sourceHandle,
        targetHandle: newConnection.targetHandle,
      });
      queueMicrotask(() => runAll());
    },
    [connect, removeEdge, runAll],
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
  const setMode = useGraphStore((s) => s.setMode);
  const clearAllSelection = useCallback(() => {
    select(null);
    setMode("normal");
  }, [select, setMode]);

  return (
    <div
      className={`dash-canvas stat-canvas ${mobile ? "mobile" : ""} ${execState === "running" ? "running" : ""} ${isDragOver ? "drag-over" : ""} ${connectingFrom ? "connecting" : ""}`}
      style={{ position: "relative" }}
      onDragLeave={() => setIsDragOver(false)}
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
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={clearAllSelection}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setIsDragOver(true);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const container = (e.target as HTMLElement).closest<HTMLElement>(".react-flow");
          const rect = container?.getBoundingClientRect();
          if (!rect) return;
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const nodeJson = e.dataTransfer.getData("application/opengov-node");
          const subId = e.dataTransfer.getData("application/opengov-subgraph");
          if (nodeJson) {
            try {
              const tpl = JSON.parse(nodeJson) as import("../lib/registry").NodeTemplate;
              addNodeFromTemplate(tpl, { x, y });
              queueMicrotask(() => runAll());
            } catch { /* ignore */ }
          } else if (subId) {
            const tpl = SUBGRAPH_TEMPLATES.find((t) => t.id === subId);
            if (tpl) {
              addSubgraph(tpl, { x, y });
              queueMicrotask(() => runAll());
            }
          }
        }}
        defaultViewport={{ x: 80, y: 60, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        nodesDraggable={true}
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
