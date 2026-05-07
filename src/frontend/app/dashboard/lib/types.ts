/**
 * 정통 산식 실행 그래프의 타입 정의.
 *
 * 노드 종류:
 *  - input        : 사용자가 직접 값을 넣는 입력 단자 (gross_salary 등)
 *  - manual       : 상수/매뉴얼 값 (예: 표 상한치)
 *  - formula      : 백엔드 statutory primitive 호출 (Java 실행)
 *  - conditional  : if/elif/else — 입력값 기준 분기
 *  - threshold    : x > limit ? bypass : pass — 임계 조건
 *  - lookup       : 표 조회 (가구원수→중위소득 등)
 *  - legal        : 근거 법령 메모 (실행 안 함, 표시만)
 *  - output       : 최종 결과 단자
 *  - pdf          : 결과 PDF 출력 단자
 */
export type NodeKind =
  | "input"
  | "manual"
  | "formula"
  | "conditional"
  | "threshold"
  | "lookup"
  | "legal"
  | "output"
  | "pdf";

/** 백엔드 statutory primitive 의 ruleId. */
export type FormulaRule =
  | "earned-income-deduction"
  | "comprehensive-income-tax"
  | "corporate-tax"
  | "inheritance-tax"
  | "gift-tax"
  | "medical-expense-credit"
  | "education-credit"
  | "rent-credit"
  | "pension-credit"
  | "donation-credit"
  | "child-credit"
  | "earned-income-credit"
  | "simple-expense-rate"
  | "vat-payable"
  | "recognized-income"
  | "median-ratio"
  | "eligibility-flow"
  | "inheritance-priority"
  | "vat-delta"
  | "deduction-ladder/earned-income";

export type Port = { id: string; name: string; label: string };

export type NodeData = {
  kind: NodeKind;
  label: string;
  /** formula nodes only — backend ruleId. */
  rule?: FormulaRule;
  /** Forward(default) → 정방향 실행. Reverse → 목표 출력 → 입력 역산. */
  direction?: "forward" | "reverse";
  /** Reverse 모드 전용 — 목표 출력값. */
  targetOutput?: number;
  /** Reverse 모드 전용 — 어떤 변수를 풀지 (formula 의 input 포트 ID). */
  reverseSweepVar?: string;
  /** input/manual nodes — current value. */
  value?: number | string | null;
  /** lookup nodes — table key + value. */
  lookup?: {
    table: "median-income" | "welfare-tier" | "overseas-threshold" | "custom";
    keyVar?: string;
    custom?: Record<string, number | string>;
  };
  /** threshold nodes — compare variable to limit. */
  threshold?: { op: "gt" | "lt" | "gte" | "lte" | "eq"; limit: number };
  /** conditional nodes — value-of expression and branches. */
  conditional?: {
    op: "gt" | "lt" | "gte" | "lte" | "eq";
    value: number;
  };
  /** legal nodes — citation text only. */
  citation?: string;
  /** runtime — last computed output, formula text, vars. */
  runtime?: {
    output: unknown;
    rawFormula?: string;
    legalBasis?: string;
    substituted?: Record<string, unknown>;
    intermediate?: Record<string, unknown>;
    eligibility?: { qualified: boolean; reasons?: string[]; blockers?: string[] };
    error?: string;
    durationMs?: number;
    /** monotonically increasing — used to invalidate downstream reads. */
    epoch: number;
  };
  /** UI extras — input/output port labels. */
  inputs?: Port[];
  outputs?: Port[];
};

export type GraphNode = {
  id: string;
  type: string; // react-flow node type key
  position: { x: number; y: number };
  data: NodeData;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /**
   * Edges always render orthogonally — the route is computed by the custom
   * router and stored here. Rerouted on every node move.
   */
  data?: { points?: { x: number; y: number }[] };
  type?: string;
};

export type GraphDoc = {
  id: string;
  name: string;
  kind: "tax" | "welfare" | "inheritance" | "vat" | "custom";
  createdAt?: string;
  updatedAt?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 활성 연도 — Time Machine. */
  year?: number;
  /** 활성 룰 ID 집합 — 충돌 검출용. */
  activeConflictRules?: string[];
};

/** 글로벌 dashboard 모드 — 상단 overlay 토글. */
export type DashMode = "normal" | "reverse" | "conflict" | "timeline" | "audit";

/** Single execution log entry. */
export type ExecLog = {
  ts: number;
  nodeId: string;
  nodeLabel: string;
  status: "ok" | "error" | "skipped";
  message: string;
};

/** Grid system — 32px snap + dot pattern. */
export const GRID = {
  size: 32,
  /** 라우터 셀 단위 (그리드 1칸 = 라우터 1셀). */
  cellPx: 32,
} as const;

export function snap(v: number): number {
  return Math.round(v / GRID.size) * GRID.size;
}

export function snapXY(x: number, y: number): { x: number; y: number } {
  return { x: snap(x), y: snap(y) };
}
