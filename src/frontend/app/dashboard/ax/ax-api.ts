import type { AxPlan, AxExecutionResult, AxConfig } from "./types";

const API = "/api/ax";

export async function executePlan(plan: AxPlan): Promise<AxExecutionResult> {
  const res = await fetch(`${API}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!res.ok) throw new Error(`AX 실행 실패: ${res.status}`);
  return res.json();
}

export async function getAxConfig(): Promise<AxConfig> {
  const res = await fetch(`${API}/config`);
  if (!res.ok) throw new Error(`AX 설정 조회 실패: ${res.status}`);
  return res.json();
}
