import type { AxPlan, AxExecutionResult, AxConfig } from "./types";

const AGENT_API = "/api/llm/agent/execute";
const AX_API = "/api/ax";

export async function executePlan(plan: AxPlan): Promise<AxExecutionResult> {
  const res = await fetch(AGENT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steps: plan.steps }),
  });
  if (!res.ok) throw new Error(`AX 실행 실패: ${res.status}`);

  const agentRes = (await res.json()) as {
    success: boolean;
    results?: Array<{
      step: number;
      endpoint: string;
      description?: string;
      status_code: number;
      output_key?: string;
      data?: unknown;
      error?: string;
    }>;
    final_result?: unknown;
    message: string;
  };

  const rows = agentRes.results ?? [];
  return {
    overallSuccess: agentRes.success,
    stepResults: rows.map((r) => ({
      outputKey: r.output_key ?? r.endpoint,
      response: r.data ?? r.error,
      success: !r.error && r.status_code >= 200 && r.status_code < 300,
      error: r.error,
      description: r.description,
    })),
    elapsedMs: 0,
    message: agentRes.message,
  };
}

export async function getAxConfig(): Promise<AxConfig> {
  const res = await fetch(`${AX_API}/config`);
  if (!res.ok) throw new Error(`AX 설정 조회 실패: ${res.status}`);
  return res.json();
}
