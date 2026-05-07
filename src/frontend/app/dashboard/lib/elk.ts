/**
 * ELK.js layered layout — 직교 라우팅 옵션 사용. 결과는 32px 그리드에 스냅.
 */

import ELK from "elkjs/lib/elk.bundled.js";
import { GRID, snap, type GraphEdge, type GraphNode } from "./types";

const elk = new ELK();

const NODE_W = 224;
const NODE_H = 128;

export async function autoLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<GraphNode[]> {
  if (nodes.length === 0) return nodes;
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(GRID.size * 4),
      "elk.spacing.nodeNode": String(GRID.size * 2),
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: NODE_W,
      height: NODE_H,
    })),
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  } as const;

  const out = await elk.layout(graph as never);
  const positions = new Map<string, { x: number; y: number }>();
  out.children?.forEach((c) => {
    if (c.id == null) return;
    positions.set(c.id, { x: snap(c.x ?? 0), y: snap(c.y ?? 0) });
  });
  return nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}

/** 쉬운 모드 전용 — n8n 스타일 프리폼 레이아웃. 간격 넉넉, 곡선 엣지. */
export async function autoLayoutEasy(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<GraphNode[]> {
  if (nodes.length === 0) return nodes;
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.spacing.nodeNodeBetweenLayers": "220",
      "elk.spacing.nodeNode": "100",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: 280,
      height: 160,
    })),
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  } as const;

  const out = await elk.layout(graph as never);
  const positions = new Map<string, { x: number; y: number }>();
  out.children?.forEach((c) => {
    if (c.id == null) return;
    positions.set(c.id, { x: snap(c.x ?? 0), y: snap(c.y ?? 0) });
  });
  return nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}
