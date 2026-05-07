"use client";

import { useMemo } from "react";
import { useReactFlow, type EdgeProps } from "reactflow";
import { useGraphStore } from "../lib/store";
import { pathFromPoints, routeOrthogonal, type Point, type RectXYWH } from "../lib/router";

const NODE_W = 224;
const NODE_H = 128;

/**
 * 직교 엣지 — bezier 금지, A* 경로로 그린다.
 *
 * 매번 라우트를 다시 계산하므로 그래프가 거대하면 비용이 크지만,
 * 32px 그리드 + bbox 한정 검색 덕분에 수십~수백 노드까지는 즉시 계산 가능.
 */
export default function OrthoEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, selected } = props;
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const rf = useReactFlow();

  const path = useMemo(() => {
    const start: Point = { x: sourceX, y: sourceY };
    const goal: Point = { x: targetX, y: targetY };

    const allNodes = rf.getNodes();
    const obstacles: RectXYWH[] = allNodes.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      w: n.width ?? NODE_W,
      h: n.height ?? NODE_H,
    }));
    const fromIdx = allNodes.findIndex((n) => n.id === source);
    const toIdx = allNodes.findIndex((n) => n.id === target);

    const points = routeOrthogonal(start, goal, {
      obstacles,
      fromIdx,
      toIdx,
    });
    return pathFromPoints(points);
  }, [sourceX, sourceY, targetX, targetY, source, target, rf]);

  // 화살표를 path 끝에 붙이기 위한 작은 marker — 마지막 두 점에서 방향 계산.
  const arrow = useMemo(() => {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    // path 의 마지막 진입 방향은 거의 좌→우 (orthogonal)이지만 위/아래도 가능.
    const horizontalLast = Math.abs(dx) >= Math.abs(dy);
    const size = 6;
    if (horizontalLast) {
      // pointing right by default
      const x = targetX;
      const y = targetY;
      return `M ${x - size} ${y - size / 2} L ${x} ${y} L ${x - size} ${y + size / 2} Z`;
    }
    const x = targetX;
    const y = targetY;
    const dir = dy >= 0 ? 1 : -1;
    return `M ${x - size / 2} ${y - dir * size} L ${x} ${y} L ${x + size / 2} ${y - dir * size} Z`;
  }, [sourceX, sourceY, targetX, targetY]);

  return (
    <g>
      {/* fat invisible hit area for click-to-delete */}
      <path
        d={path}
        className="ortho-edge-hit"
        onClick={(e) => {
          e.stopPropagation();
          if (e.shiftKey) removeEdge(id);
        }}
      />
      <path d={path} className={`ortho-edge ${selected ? "selected" : ""}`} />
      <path d={arrow} className={`ortho-edge-arrow ${selected ? "selected" : ""}`} />
    </g>
  );
}
