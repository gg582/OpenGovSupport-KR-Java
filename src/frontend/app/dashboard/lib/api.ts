/**
 * 대시보드가 사용하는 백엔드 호출. 모든 산식 실행은 Java 백엔드에서 수행 (WASM 미사용).
 */

import { FORMULA_RULES } from "./registry";
import type { FormulaRule, GraphDoc } from "./types";

function apiBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.BACKEND_URL || "http://localhost:8080";
}

/** statutory primitive 1회 평가. */
export async function evalFormula(
  rule: FormulaRule,
  body: Record<string, unknown>,
): Promise<{
  amount?: unknown;
  rawFormula?: string;
  legalBasis?: string;
  substituted?: Record<string, unknown>;
  intermediate?: Record<string, unknown>;
  eligibility?: { qualified: boolean; reasons?: string[]; blockers?: string[] };
  raw: Record<string, unknown>;
}> {
  const ep = FORMULA_RULES[rule].endpoint;
  const res = await fetch(`${apiBase()}${ep}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { data?: Record<string, unknown> };
  const d = data.data ?? {};

  // 두 가지 모양을 통합 — 기존 tax 파이프라인은 {amount, intermediate, ...},
  // 신규 statutory 컨트롤러는 {finalOutput, rawFormula, substitutedVariables, ...}.
  const amount = d["amount"] ?? d["finalOutput"];
  const rawFormula = (d["rawFormula"] as string) ?? undefined;
  const legalBasis = (d["legalBasis"] as string) ?? (d["legalSource"] as string);
  const substituted = (d["substitutedVariables"] as Record<string, unknown>) ?? undefined;
  const intermediate = (d["intermediate"] as Record<string, unknown>) ?? undefined;
  const eligibility = (d["eligibility"] as {
    qualified: boolean;
    reasons?: string[];
    blockers?: string[];
  }) ?? undefined;

  return { amount, rawFormula, legalBasis, substituted, intermediate, eligibility, raw: d };
}

/** 그래프 영속화 — 백엔드 GraphController. */
export async function listGraphs(): Promise<
  Array<{
    id: string;
    name: string;
    kind: string;
    updatedAt: string;
    nodeCount: number;
    edgeCount: number;
  }>
> {
  const res = await fetch(`${apiBase()}/api/dashboard/graphs`, { cache: "no-store" });
  if (!res.ok) throw new Error(`graphs: ${res.status}`);
  return res.json();
}

export async function loadGraph(id: string): Promise<GraphDoc> {
  const res = await fetch(`${apiBase()}/api/dashboard/graphs/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`graph ${id}: ${res.status}`);
  return res.json();
}

export async function saveGraph(doc: GraphDoc): Promise<{ id: string; updatedAt: string }> {
  const res = await fetch(`${apiBase()}/api/dashboard/graphs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteGraph(id: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/dashboard/graphs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete ${id}: ${res.status}`);
}

/** Time Machine — 동일 입력을 여러 연도에서 실행. */
export async function timeMachineRun(body: {
  ruleId: string;
  years: number[];
  input: Record<string, unknown>;
}): Promise<{
  results: Array<Record<string, unknown>>;
  deltaTable?: Array<Record<string, unknown>>;
}> {
  const res = await fetch(`${apiBase()}/api/dashboard/time-machine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`time-machine: ${res.status}`);
  return res.json();
}

export async function timeMachineYears(): Promise<{
  years: number[];
  currentYear: number;
}> {
  const res = await fetch(`${apiBase()}/api/dashboard/time-machine/years`);
  if (!res.ok) throw new Error(`years: ${res.status}`);
  return res.json();
}

/** Conflict detection — 활성 룰 ID 집합 → 충돌 + 우선순위 해소. */
export async function conflictDetect(activeRuleIds: string[]): Promise<{
  activeBefore: string[];
  conflicts: Array<{
    a: string;
    b: string;
    winner: string;
    loser: string;
    reason: string;
    winnerLegalBasis: string;
  }>;
  suppressed: string[];
  activeAfter: string[];
  rulesById: Record<string, Record<string, unknown>>;
}> {
  const res = await fetch(`${apiBase()}/api/dashboard/conflicts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeRuleIds }),
  });
  if (!res.ok) throw new Error(`conflicts: ${res.status}`);
  return res.json();
}

export async function conflictRules(): Promise<{
  rules: Record<string, Record<string, unknown>>;
}> {
  const res = await fetch(`${apiBase()}/api/dashboard/conflicts/rules`);
  if (!res.ok) throw new Error(`conflict-rules: ${res.status}`);
  return res.json();
}

/** Range solver — max/min/invert. */
export async function solverRun(body: {
  mode: "max" | "min" | "invert";
  ruleId: string;
  year?: number;
  sweepVar: string;
  targetField?: string;
  target: number;
  constraint?: "EQUAL" | "LTE" | "GTE";
  input: Record<string, unknown>;
  lo?: number;
  hi?: number;
  tol?: number;
}): Promise<{
  solution: number;
  solutionEval: number;
  iterations: number;
  trace: Array<{ x: number; eval: number }>;
}> {
  const res = await fetch(`${apiBase()}/api/dashboard/solver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`solver: ${res.status}`);
  return res.json();
}

/** Job 폴링 (solver/async, time-machine/async 응답이 가리키는 location). */
export async function pollJob(jobId: string): Promise<{
  id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "ERROR";
  result?: unknown;
  error?: string;
}> {
  const res = await fetch(`${apiBase()}/api/dashboard/jobs/${jobId}`);
  if (!res.ok) throw new Error(`job ${jobId}: ${res.status}`);
  return res.json();
}
