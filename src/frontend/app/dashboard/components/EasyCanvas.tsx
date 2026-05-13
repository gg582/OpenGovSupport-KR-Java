"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  SelectionMode,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnect,
  type OnConnectStart,
  type OnConnectEnd,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import EasyStatNode from "./EasyStatNode";
import EasyConnectionLine from "./EasyConnectionLine";
import { useGraphStore } from "../lib/store";
import { GRID } from "../lib/types";
import { autoLayoutEasy } from "../lib/elk";
import type { NodeTemplate } from "../lib/registry";
import { SUBGRAPH_TEMPLATES } from "../lib/subgraphTemplates";

const nodeTypes = { easyStat: EasyStatNode } as const;
const defaultEdgeOptions = { type: "smoothstep" } as const;

export default function EasyCanvas() {
  const rf = useReactFlow();
  const doc = useGraphStore((s) => s.doc);
  const setNodes = useGraphStore((s) => s.setNodes);
  const select = useGraphStore((s) => s.select);
  const selectedId = useGraphStore((s) => s.selectedId);
  const setMode = useGraphStore((s) => s.setMode);

  const connect = useGraphStore((s) => s.connect);
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

  return (
    <div
      className={`dash-canvas easy-canvas ${execState === "running" ? "running" : ""} ${isDragOver ? "drag-over" : ""} ${connectingFrom ? "connecting" : ""}`}
      style={{ position: "relative" }}
      onDragLeave={() => setIsDragOver(false)}
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
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => {
          select(null);
          setMode("normal");
        }}
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
        defaultViewport={{ x: 80, y: 60, zoom: 0.9 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.2}
        edgesFocusable={true}
        edgeUpdaterRadius={12}
        deleteKeyCode={null}
        nodesDraggable={true}
        selectionOnDrag={true}
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        multiSelectionKeyCode={["Control", "Meta"]}
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
