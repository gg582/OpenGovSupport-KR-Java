export type Input = {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "textarea" | "select" | "rows";
  placeholder?: string;
  default?: string;
  help?: string;
  options?: string[];
  columns?: Input[];
  required?: boolean;
};

export type Feature = {
  id: string;
  domainKey: string;
  domainTitle: string;
  title: string;
  summary: string;
  inputs: Input[];
};

export type Result = {
  title: string;
  text: string;
  data?: Record<string, unknown>;
  html?: string;
  notes?: string[];
};

// apiBase: when running on the server (no window) we need an absolute URL
// because Node's fetch does not accept the relative form. In the browser we
// use the relative path so Next.js' rewrites take effect.
function apiBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.BACKEND_URL || "http://localhost:8080";
}

export async function listFeatures(): Promise<Feature[]> {
  const res = await fetch(`${apiBase()}/api/features`, { cache: "no-store" });
  if (!res.ok) throw new Error(`features: ${res.status}`);
  return res.json();
}

export async function callFeature(id: string, body: Record<string, unknown>): Promise<Result> {
  const res = await fetch(`${apiBase()}/api/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}
