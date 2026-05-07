/**
 * 직교(orthogonal) 엣지 라우터.
 *
 * 전략: 그리드 기반 A* — 노드 사각형은 차단셀, 그 외는 통과셀.
 * 비용함수 = 거리 + bend penalty + collision penalty. 이로써 최단 Manhattan
 * 경로 + 최소 굴절 + 노드 가로지르기 회피를 동시에 달성.
 *
 * 좌표는 React Flow 의 flow-space (절대) 좌표를 그리드 셀 단위로 양자화해
 * 사용한다. {@link GRID.cellPx} 가 셀 크기.
 */

import { GRID } from "./types";

export type RectXYWH = { x: number; y: number; w: number; h: number };

export type Point = { x: number; y: number };

const BEND_COST = 8;        // bend 1 회당 추가비용 (단위 셀 비용 기준)
const NEAR_NODE_COST = 4;   // 노드 외곽 1셀 인접 통과 패널티
const STRAIGHT_COST = 1;
const MAX_NODES = 60_000;   // pathfinding 안전 상한

type CellKey = string;
function key(x: number, y: number): CellKey {
  return `${x},${y}`;
}

function cellize(p: Point, cell: number): Point {
  return { x: Math.round(p.x / cell), y: Math.round(p.y / cell) };
}

function expand(rect: RectXYWH, pad: number): RectXYWH {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
}

function rectToCells(rect: RectXYWH, cell: number): RectXYWH {
  const x = Math.floor(rect.x / cell);
  const y = Math.floor(rect.y / cell);
  const x2 = Math.ceil((rect.x + rect.w) / cell);
  const y2 = Math.ceil((rect.y + rect.h) / cell);
  return { x, y, w: x2 - x, h: y2 - y };
}

export type RouteOptions = {
  /** 모든 노드 사각형 (flow-space 좌표). */
  obstacles: RectXYWH[];
  /** 출발 노드의 인덱스 — 출발/도착 셀이 그 안에 있어도 막히지 않게. */
  fromIdx?: number;
  toIdx?: number;
  /** override grid cell size. */
  cell?: number;
};

/** 직교 A* — start → goal 사이 셀 경로를 계산해 좌표 폴리라인으로 반환. */
export function routeOrthogonal(start: Point, goal: Point, opts: RouteOptions): Point[] {
  const cell = opts.cell ?? GRID.cellPx;

  // 1. obstacle 셀 집합 — 도착/출발 노드는 유효 통로로 둠 (포트가 노드 변에 있으므로).
  const blocked = new Set<CellKey>();
  const near = new Set<CellKey>();
  opts.obstacles.forEach((rect, idx) => {
    if (idx === opts.fromIdx || idx === opts.toIdx) return; // skip own
    const inflated = expand(rect, 4); // 4px 여유
    const c = rectToCells(inflated, cell);
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x; x < c.x + c.w; x++) blocked.add(key(x, y));
    }
    // 노드 1셀 외곽 패널티 — 가능하면 노드를 따라가지 말도록.
    const near1 = rectToCells(expand(rect, cell), cell);
    for (let y = near1.y; y < near1.y + near1.h; y++) {
      for (let x = near1.x; x < near1.x + near1.w; x++) near.add(key(x, y));
    }
  });

  const s = cellize(start, cell);
  const g = cellize(goal, cell);

  // 같은 셀이면 직선 1칸.
  if (s.x === g.x && s.y === g.y) {
    return [start, goal];
  }

  // 검색 영역 한정 — bbox + padding.
  const minX = Math.min(s.x, g.x) - 12;
  const maxX = Math.max(s.x, g.x) + 12;
  const minY = Math.min(s.y, g.y) - 12;
  const maxY = Math.max(s.y, g.y) + 12;

  const inBounds = (x: number, y: number) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;

  // f-score open queue (lo-priority bucket queue — 32단계).
  const openSet = new Map<CellKey, number>(); // cellKey → f-score
  openSet.set(key(s.x, s.y), 0);
  const cameFrom = new Map<CellKey, { from: CellKey; dx: number; dy: number }>();
  const gScore = new Map<CellKey, number>();
  gScore.set(key(s.x, s.y), 0);

  let visited = 0;
  while (openSet.size > 0) {
    if (++visited > MAX_NODES) break;

    // 가장 작은 f-score 추출.
    let curK: CellKey | null = null;
    let curF = Infinity;
    for (const [k, f] of openSet) {
      if (f < curF) {
        curF = f;
        curK = k;
      }
    }
    if (curK == null) break;
    openSet.delete(curK);

    const [cxStr, cyStr] = curK.split(",");
    const cx = parseInt(cxStr, 10);
    const cy = parseInt(cyStr, 10);

    if (cx === g.x && cy === g.y) {
      return reconstructPath(cameFrom, curK, cell);
    }

    const prev = cameFrom.get(curK);
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const nk = key(nx, ny);
      if (blocked.has(nk)) continue;

      let stepCost = STRAIGHT_COST;
      if (near.has(nk)) stepCost += NEAR_NODE_COST;
      if (prev && (prev.dx !== dx || prev.dy !== dy)) stepCost += BEND_COST;

      const tentative = (gScore.get(curK) ?? 0) + stepCost;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, { from: curK, dx, dy });
        gScore.set(nk, tentative);
        const h = manhattan(nx, ny, g.x, g.y);
        openSet.set(nk, tentative + h);
      }
    }
  }

  // fallback — Manhattan L 모양 2단 폴리라인. 충돌 가능하지만 항상 직교.
  return [start, { x: goal.x, y: start.y }, goal];
}

function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function reconstructPath(
  cameFrom: Map<CellKey, { from: CellKey; dx: number; dy: number }>,
  goal: CellKey,
  cell: number,
): Point[] {
  const cells: CellKey[] = [goal];
  let cur = goal;
  while (cameFrom.has(cur)) {
    cur = cameFrom.get(cur)!.from;
    cells.unshift(cur);
  }
  // cell → flow-space + collinear 압축.
  const pts: Point[] = cells.map((k) => {
    const [x, y] = k.split(",").map(Number);
    return { x: x * cell, y: y * cell };
  });
  return compressCollinear(pts);
}

function compressCollinear(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const collinear =
      (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** SVG path 문자열 — orthogonal polyline. */
export function pathFromPoints(points: Point[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}
