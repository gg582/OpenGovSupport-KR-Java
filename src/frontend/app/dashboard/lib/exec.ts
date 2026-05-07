/**
 * 실행 그래프. 한 노드의 출력이 곧바로 하류 노드의 입력이 되며,
 * 입력이 변하면 toposort 순서로 하류 전체가 재평가된다.
 *
 * 모든 산식 실행은 Java 백엔드의 statutory primitive 가 처리한다 (WASM 미사용).
 */

import { evalFormula, solverRun } from "./api";
import { FORMULA_RULES } from "./registry";
import type { ExecLog, FormulaRule, GraphEdge, GraphNode, NodeData } from "./types";

/** 노드 ID + 출력 포트 ID 로 값 슬롯 키 생성. */
function slot(nodeId: string, portId: string): string {
  return `${nodeId}::${portId}`;
}

/** Kahn topological sort. cycle 이면 빈 배열 반환. */
export function topoSort(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const indeg = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  nodes.forEach((n) => {
    indeg.set(n.id, 0);
    outAdj.set(n.id, []);
  });
  edges.forEach((e) => {
    if (!indeg.has(e.target) || !indeg.has(e.source)) return;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    outAdj.get(e.source)!.push(e.target);
  });
  const queue: string[] = [];
  indeg.forEach((d, id) => {
    if (d === 0) queue.push(id);
  });
  const sorted: GraphNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) sorted.push(node);
    for (const nb of outAdj.get(id) ?? []) {
      const nd = (indeg.get(nb) ?? 1) - 1;
      indeg.set(nb, nd);
      if (nd === 0) queue.push(nb);
    }
  }
  return sorted.length === nodes.length ? sorted : [];
}

/** 한 노드에서 발생할 수 있는 하류 영향권을 BFS 로 수집. */
export function downstreamOf(rootId: string, edges: GraphEdge[]): Set<string> {
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  });
  const out = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!out.has(nb)) {
        out.add(nb);
        queue.push(nb);
      }
    }
  }
  return out;
}

/** 결과 슬롯 — 실행 후 하류로 전달될 값. */
export type SlotMap = Map<string, unknown>;

/** 한 노드의 입력 포트별로 들어오는 엣지의 source 출력값을 수집. */
function collectInputs(
  nodeId: string,
  edges: GraphEdge[],
  slots: SlotMap,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const handleIn = e.targetHandle ?? "v";
    const handleOut = e.sourceHandle ?? "v";
    const v = slots.get(slot(e.source, handleOut));
    if (v !== undefined) inputs[handleIn] = v;
  }
  return inputs;
}

/** 단일 노드 평가 — 산출 슬롯에 결과를 채우고 runtime 메타를 반환. */
async function evaluateNode(
  node: GraphNode,
  inputs: Record<string, unknown>,
  slots: SlotMap,
): Promise<NodeData["runtime"] & { logMessage: string; status: "ok" | "error" | "skipped" }> {
  const t0 = performance.now();
  const epoch = Date.now();
  try {
    switch (node.data.kind) {
      case "input":
      case "manual": {
        const v = node.data.value;
        const num = typeof v === "string" && v !== "" ? Number(v) : v;
        slots.set(slot(node.id, "v"), num ?? 0);
        return {
          output: num ?? 0,
          rawFormula: "value",
          legalBasis: "사용자 입력",
          substituted: { value: num ?? 0 },
          intermediate: {},
          epoch,
          durationMs: Math.round(performance.now() - t0),
          logMessage: `value=${num ?? 0}`,
          status: "ok",
        };
      }
      case "lookup": {
        const t = node.data.lookup;
        if (!t) {
          throw new Error("lookup table 미설정");
        }
        const key = String(inputs["key"] ?? node.data.value ?? "");
        let v: unknown = undefined;
        if (t.table === "custom" && t.custom) v = t.custom[key];
        else v = key; // 다른 테이블은 백엔드 호출 필요 — 본 노드는 데모용으로 키 패스스루.
        slots.set(slot(node.id, "v"), v ?? 0);
        return {
          output: v,
          rawFormula: `lookup(${t.table}, key=${key})`,
          legalBasis: "표 기반 결정적 매핑",
          substituted: { key, value: v },
          intermediate: { table: t.table },
          epoch,
          durationMs: Math.round(performance.now() - t0),
          logMessage: `lookup(${t.table}, ${key}) = ${v ?? "—"}`,
          status: "ok",
        };
      }
      case "threshold": {
        const cfg = node.data.threshold;
        if (!cfg) throw new Error("threshold cfg 미설정");
        const x = Number(inputs["v"] ?? node.data.value ?? 0);
        const cmp = compare(x, cfg.op, cfg.limit);
        slots.set(slot(node.id, cmp ? "pass" : "block"), x);
        return {
          output: cmp ? "pass" : "block",
          rawFormula: `${x} ${cfg.op} ${cfg.limit}`,
          legalBasis: "임계 조건",
          substituted: { x, limit: cfg.limit, op: cfg.op, result: cmp },
          intermediate: {},
          epoch,
          durationMs: Math.round(performance.now() - t0),
          logMessage: `${x} ${cfg.op} ${cfg.limit} → ${cmp ? "pass" : "block"}`,
          status: "ok",
        };
      }
      case "conditional": {
        const cfg = node.data.conditional;
        if (!cfg) throw new Error("conditional cfg 미설정");
        const x = Number(inputs["v"] ?? 0);
        const cmp = compare(x, cfg.op, cfg.value);
        slots.set(slot(node.id, cmp ? "then" : "else"), x);
        return {
          output: cmp ? "then" : "else",
          rawFormula: `if (${x} ${cfg.op} ${cfg.value}) then else`,
          legalBasis: "조건 분기",
          substituted: { x, op: cfg.op, value: cfg.value, branch: cmp ? "then" : "else" },
          intermediate: {},
          epoch,
          durationMs: Math.round(performance.now() - t0),
          logMessage: `${x} ${cfg.op} ${cfg.value} → ${cmp ? "then" : "else"}`,
          status: "ok",
        };
      }
      case "legal": {
        return {
          output: node.data.citation ?? "",
          rawFormula: "(메타 노드)",
          legalBasis: node.data.citation ?? "",
          substituted: {},
          intermediate: {},
          epoch,
          durationMs: 0,
          logMessage: node.data.citation ?? "(법령 인용)",
          status: "ok",
        };
      }
      case "output": {
        const v = inputs["v"];
        slots.set(slot(node.id, "v"), v);
        return {
          output: v,
          rawFormula: "output = upstream",
          legalBasis: "최종 결과",
          substituted: { v },
          intermediate: {},
          epoch,
          durationMs: Math.round(performance.now() - t0),
          logMessage: `output = ${formatVal(v)}`,
          status: "ok",
        };
      }
      case "pdf": {
        const v = inputs["v"];
        slots.set(slot(node.id, "v"), v);
        return {
          output: v,
          rawFormula: "pdf = upstream",
          legalBasis: "PDF 출력 (프런트엔드 인쇄)",
          substituted: { v },
          intermediate: {},
          epoch,
          durationMs: 0,
          logMessage: `PDF 단자 — ${formatVal(v)}`,
          status: "ok",
        };
      }
      case "formula": {
        const rule = node.data.rule as FormulaRule | undefined;
        if (!rule || !FORMULA_RULES[rule]) throw new Error(`formula rule 미설정`);
        const map = FORMULA_RULES[rule].inputMap;
        const year = (typeof globalThis !== "undefined"
          ? (globalThis as unknown as { __dashYear?: number }).__dashYear
          : 0) ?? 0;

        // Reverse 모드 — 목표 출력 → 입력 역산.
        if (node.data.direction === "reverse" && node.data.targetOutput != null) {
          const sweepPort = node.data.reverseSweepVar ?? FORMULA_RULES[rule].inputs[0]?.id;
          if (!sweepPort) throw new Error("reverse: 풀 변수 미지정");
          const sweepVar = map[sweepPort] ?? sweepPort;
          const baseInput: Record<string, unknown> = { year };
          for (const [port, varname] of Object.entries(map)) {
            if (port !== sweepPort && inputs[port] !== undefined) {
              baseInput[varname] = inputs[port];
            }
          }
          const inv = await solverRun({
            mode: "invert",
            ruleId: rule,
            year,
            sweepVar,
            target: Number(node.data.targetOutput) || 0,
            input: baseInput,
            tol: 1,
          });
          // 출력 슬롯에 역산된 입력값을 거꾸로 노출 — 상류 노드는 이 값을 받아 표시.
          const outPort = FORMULA_RULES[rule].outputs[0]?.id ?? "amount";
          slots.set(slot(node.id, outPort), inv.solution);
          return {
            output: inv.solution,
            rawFormula: `INVERT: ${rule}(${sweepVar}=?) → ${node.data.targetOutput}`,
            legalBasis: FORMULA_RULES[rule].legalBasis,
            substituted: { ...baseInput, target: node.data.targetOutput },
            intermediate: { iterations: inv.iterations, eval: inv.solutionEval },
            epoch,
            durationMs: Math.round(performance.now() - t0),
            logMessage: `REVERSE ${rule}(${sweepVar}) = ${inv.solution.toLocaleString("ko-KR")}`,
            status: "ok",
          };
        }

        const body: Record<string, unknown> = { year };
        for (const [port, varname] of Object.entries(map)) {
          if (inputs[port] !== undefined) body[varname] = inputs[port];
        }
        const result = await evalFormula(rule, body);
        // 출력 포트는 ruleId 별 첫 outputs 항목 — registry 정의 사용.
        const outPort = FORMULA_RULES[rule].outputs[0]?.id ?? "amount";
        slots.set(slot(node.id, outPort), result.amount);
        return {
          output: result.amount,
          rawFormula: result.rawFormula ?? FORMULA_RULES[rule].label,
          legalBasis: result.legalBasis ?? FORMULA_RULES[rule].legalBasis,
          substituted: result.substituted ?? body,
          intermediate: result.intermediate ?? {},
          eligibility: result.eligibility,
          epoch,
          durationMs: Math.round(performance.now() - t0),
          logMessage: `${rule} → ${formatVal(result.amount)}`,
          status: "ok",
        };
      }
    }
    throw new Error(`알 수 없는 노드 종류: ${node.data.kind}`);
  } catch (e) {
    return {
      output: undefined,
      epoch,
      error: (e as Error).message,
      durationMs: Math.round(performance.now() - t0),
      logMessage: `error: ${(e as Error).message}`,
      status: "error",
    };
  }
}

function compare(x: number, op: string, limit: number): boolean {
  switch (op) {
    case "gt": return x > limit;
    case "lt": return x < limit;
    case "gte": return x >= limit;
    case "lte": return x <= limit;
    case "eq": return x === limit;
    default: return false;
  }
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
}

/**
 * 그래프 전체 평가. {@link onProgress} 가 있으면 노드별 결과를 즉시 콜백.
 * onlyDownstreamOf 가 주어지면 그 노드의 영향권만 재평가 (입력값만 변경된 경우).
 */
export async function executeGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  prevSlots: SlotMap | null,
  onProgress?: (id: string, runtime: NodeData["runtime"], log: ExecLog) => void,
  onlyDownstreamOf?: string,
): Promise<SlotMap> {
  const sorted = topoSort(nodes, edges);
  if (sorted.length === 0) {
    if (nodes.length > 0) {
      const log: ExecLog = {
        ts: Date.now(),
        nodeId: "",
        nodeLabel: "graph",
        status: "error",
        message: "사이클 검출 — 실행 불가",
      };
      onProgress?.("", undefined, log);
    }
    return new Map();
  }

  const slots: SlotMap = new Map(prevSlots ?? []);
  const dirty = onlyDownstreamOf
    ? downstreamOf(onlyDownstreamOf, edges)
    : new Set(nodes.map((n) => n.id));

  for (const node of sorted) {
    if (!dirty.has(node.id)) continue;
    const inputs = collectInputs(node.id, edges, slots);
    const rt = await evaluateNode(node, inputs, slots);
    onProgress?.(node.id, rt, {
      ts: Date.now(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      status: rt.status,
      message: rt.logMessage,
    });
  }
  return slots;
}
