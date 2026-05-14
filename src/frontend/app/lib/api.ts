export type Input = {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "textarea" | "select" | "rows" | "checkbox";
  placeholder?: string;
  default?: string;
  help?: string;
  options?: string[];
  columns?: Input[];
  required?: boolean;
};

export type Feature = {
  id: string;
  section: "welfare" | "tax" | string;
  domainKey: string;
  domainTitle: string;
  title: string;
  summary: string;
  inputs: Input[];
  /** Tree children — present on group / composite nodes. */
  children?: Feature[];
  /** true if this is a composite scenario node (has its own inputs + children). */
  composite?: boolean;
  /** Prerequisite feature ids — if present, this feature cannot be used standalone. */
  requires?: string[];
};

/** Strip features (and their children) that have prerequisites (requires). */
export function filterAvailable(features: Feature[]): Feature[] {
  return features
    .filter((f) => !f.requires || f.requires.length === 0)
    .map((f) => ({
      ...f,
      children: f.children ? filterAvailable(f.children) : undefined,
    }));
}

export type Result = {
  title: string;
  text: string;
  data?: Record<string, any>;
  notes?: string[];
};

export type ExplanationStep = {
  label: string;
  body: string;
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

export const SECTIONS: { key: "welfare" | "tax"; label: string; href: string }[] = [
  { key: "tax",     label: "개인세무", href: "/tax" },
  { key: "welfare", label: "사회복지", href: "/welfare" },
];

export function sectionOf(pathname: string): "welfare" | "tax" {
  if (pathname.startsWith("/welfare") || pathname.includes("/welfare/")) return "welfare";
  return "tax";
}

/** Recursively find a feature by id in a tree. */
export function findFeatureById(
  features: Feature[],
  id: string
): Feature | undefined {
  for (const f of features) {
    if (f.id === id) return f;
    if (f.children) {
      const found = findFeatureById(f.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Recursively collect every leaf and group node with its depth. */
export function flattenFeatures(
  features: Feature[],
  depth = 0,
  out: Array<{ feature: Feature; depth: number }> = []
): Array<{ feature: Feature; depth: number }> {
  for (const f of features) {
    out.push({ feature: f, depth });
    if (f.children) {
      flattenFeatures(f.children, depth + 1, out);
    }
  }
  return out;
}

/** Collect only leaf nodes (no children) with their depth. */
export function flattenLeaves(
  features: Feature[],
  depth = 0,
  out: Array<{ feature: Feature; depth: number }> = []
): Array<{ feature: Feature; depth: number }> {
  for (const f of features) {
    if (!f.children || f.children.length === 0) {
      out.push({ feature: f, depth });
    } else {
      flattenLeaves(f.children, depth + 1, out);
    }
  }
  return out;
}
