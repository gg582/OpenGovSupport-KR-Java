"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { generateAxChatResponse, reportToQwen, fixAxPlan, summarizeAxResult } from "./qwen-client";
import type { AxDomain } from "./qwen-client";
import { executePlan } from "./ax-api";
import type { AxPlan, AxExecutionResult } from "./types";
import { useGraphStore } from "../lib/store";
import { FORMULA_RULES } from "../lib/registry";
import type { FormulaRule, GraphNode, GraphEdge, NodeData } from "../lib/types";
import { GRID, snap } from "../lib/types";

export type ChatMessageRole = "user" | "assistant" | "plan" | "result" | "error" | "clarification";

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; result?: AxExecutionResult; plan?: AxPlan }
  | { id: string; role: "clarification"; content: string; neededFields: string[]; originalRequest: string }
  | { id: string; role: "plan"; content: string; plan: AxPlan }
  | {
      id: string;
      role: "result";
      content: string;
      result: AxExecutionResult;
      plan?: AxPlan;
    }
  | { id: string; role: "error"; content: string };

export type ChatPhase =
  | "idle"
  | "thinking"
  | "executing"
  | "reporting"
  | "formatting"
  | "preparing"
  | "done"
  | "error"
  | "clarifying";

let msgId = 0;
function nextId() {
  return `msg_${++msgId}`;
}

function extractJson(text: string): { json: string; plain: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { json: "", plain: text.trim() };
  const json = match[0];
  const plain = text.replace(json, "").trim();
  return { json, plain };
}

/* ------------------------------------------------------------------ */
/*  결과에서 amount / title / 요약 추출 (백엔드 응답: {title,text,data})  */
/* ------------------------------------------------------------------ */

/** 결과로 간주할 키 (우선순위 순서). 입력값은 제외. */
const RESULT_KEY_PRIORITY = [
  "amount",
  "earnedDeduction",
  "earnedDed",
  "earnedIncome",
  "totalCredits",
  "refund",
  "medicalCredit",
  "educationCredit",
  "rentCredit",
  "pensionCredit",
  "donationCredit",
  "childCredit",
  "marriageCredit",
  "sportsCredit",
  "recognizedIncome",
  "ratio",
  "ratioPct",
  "qualified",
  "overseasThresholdDays",
  "deduction",
  "payable",
  "shares",
];

/** 결과 키 → 한글 라벨 (산출식 기반) */
const RESULT_KEY_LABELS: Record<string, string> = {
  amount: "산출세액",
  earnedDeduction: "근로소득공제액",
  earnedDed: "근로소득공제액",
  earnedIncome: "근로소득금액",
  totalCredits: "세액공제합계",
  refund: "환급/추징액",
  medicalCredit: "의료비세액공제",
  educationCredit: "교육비세액공제",
  rentCredit: "월세세액공제",
  pensionCredit: "연금계좌세액공제",
  donationCredit: "기부금세액공제",
  childCredit: "자녀세액공제",
  marriageCredit: "결혼세액공제",
  sportsCredit: "체육시설세액공제",
  recognizedIncome: "소득인정액",
  ratio: "중위소득비율",
  ratioPct: "중위소득비율(%)",
  qualified: "자격여부",
  overseasThresholdDays: "해외체류기준일수",
  deduction: "공제액",
  payable: "납부/환급세액",
  shares: "상속분배",
  marriedChildCount: "자녀수",
};

/** 입력값 키 — 결과 추출 시 무시 */
const INPUT_KEYS = new Set([
  "grossSalary",
  "taxableIncome",
  "salary",
  "householdIncome",
  "childCount",
  "year",
  "supplyValue",
  "purchaseValue",
  "giftBase",
  "inheritanceBase",
  "revenue",
  "industry",
  "stage",
  "isMarriedInPeriod",
  "claimedBefore",
  "spouseClaim",
  "dependentCount",
  "insurancePremium",
  "prepaidTax",
  "donation",
  "pensionContribution",
  "rentPaid",
  "medicalExpense",
  "educationExpense",
  "sportsExpense",
  "householdSize",
  "overseasDays",
  "totalEstate",
  "spouseCount",
  "parentCount",
  "salesSupplyAmount",
  "purchaseSupplyAmount",
  "recognizedIncome",
  "businessIncome",
  "financialIncome",
  "rentalIncome",
  "transferIncome",
  "generalProperty",
  "financialAssets",
  "vehicleAssets",
  "debt",
  "householdSize",
  "overseasDays",
  "overseasThresholdDays",
  "primitivesUsed",
  "tiers",
  "qualifiedFor",
  "cutoffPct",
  "explanationSteps",
  "eligibility",
  "documents",
  "submissionChannels",
  "legalSource",
  "ruleId",
  "category",
]);

function pickResult(response: unknown): {
  amount?: number;
  title?: string;
  summary: string;
} {
  if (!response || typeof response !== "object") {
    return { summary: String(response ?? "—") };
  }
  const obj = response as Record<string, unknown>;

  let amount: number | undefined;
  let boolResult: { key: string; value: boolean } | undefined;
  let strResult: { key: string; value: string } | undefined;
  let dataObj: Record<string, unknown> | undefined;

  if (obj.data && typeof obj.data === "object") {
    dataObj = obj.data as Record<string, unknown>;
  }

  // 1) data.amount (단일 룰)
  if (dataObj && typeof dataObj.amount === "number") {
    amount = dataObj.amount;
  }
  // 2) 최상위 amount
  if (amount === undefined && typeof obj.amount === "number") {
    amount = obj.amount;
  }
  // 3) composite 룰: RESULT_KEY_PRIORITY 순서로 결과 키 탐색
  if (amount === undefined && dataObj) {
    for (const key of RESULT_KEY_PRIORITY) {
      const v = dataObj[key];
      if (typeof v === "number") {
        amount = v;
        break;
      } else if (typeof v === "boolean") {
        boolResult = { key, value: v };
        break;
      } else if (typeof v === "string" && v.trim().length > 0) {
        strResult = { key, value: v };
        break;
      }
    }
  }
  // 4) fallback: 입력값이 아닌 숫자 값 중 첫 번째 양수
  if (amount === undefined && dataObj) {
    for (const [k, v] of Object.entries(dataObj)) {
      if (typeof v === "number" && !INPUT_KEYS.has(k) && v > 0) {
        amount = v;
        break;
      }
    }
  }

  const title = typeof obj.title === "string" ? obj.title : undefined;

  // 5) text 에서 결과 라인 추출 (최후의 수단)
  let summary = "";
  if (amount === undefined && !boolResult && !strResult && typeof obj.text === "string") {
    const lines = obj.text.split("\n");
    const resultLine = lines.find((l) => l.startsWith("[결과]"));
    if (resultLine) {
      summary = resultLine.replace("[결과]", "").trim();
    } else {
      const moneyLine = lines.find(
        (l) => l.includes("원") && (l.includes("=") || l.includes("−") || l.includes(":") || l.includes("·")),
      );
      if (moneyLine) {
        summary = moneyLine.trim().replace(/^\s*·\s*/, "");
      }
    }
  }

  if (amount !== undefined) {
    summary = `${amount.toLocaleString("ko-KR")}원`;
  } else if (boolResult) {
    summary = `${RESULT_KEY_LABELS[boolResult.key] ?? boolResult.key}: ${boolResult.value ? "예" : "아니오"}`;
  } else if (strResult) {
    summary = `${RESULT_KEY_LABELS[strResult.key] ?? strResult.key}: ${strResult.value}`;
  }

  return { amount, title, summary: summary || "—" };
}

/* ------------------------------------------------------------------ */
/*  HTML self-heal (LLM 생성 HTML 정제)                                 */
/* ------------------------------------------------------------------ */
const ALLOWED_HTML_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "br",
  "p",
  "span",
  "div",
  "strong",
  "em",
  "b",
  "i",
  "caption",
  "colgroup",
  "col",
]);

function sanitizeHtmlTable(html: string): string {
  if (!html) return "";
  let cleaned = html.trim();
  // 마크다운 코드 블록 제거
  cleaned = cleaned.replace(/```html\s*/gi, "").replace(/```\s*/g, "");
  // 백틱 문자 제거
  cleaned = cleaned.replace(/`/g, "");
  // <html>, <head>, <body> 제거
  cleaned = cleaned.replace(/<\/?html[^>]*>/gi, "");
  cleaned = cleaned.replace(/<\/?head[^>]*>/gi, "");
  cleaned = cleaned.replace(/<\/?body[^>]*>/gi, "");
  // script, style 제거
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  // event handler 제거
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  // javascript: 링크 제거
  cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  // ${...} 템플릿 리터럴 잔여물 제거 (LLM이 JSON 키를 그대로 출력한 경우)
  cleaned = cleaned.replace(/\$\{[^}]+\}/g, "");
  // 허용되지 않은 태그 제거 (whitelist 기반)
  cleaned = cleaned.replace(/<[^>]+>/g, (match) => {
    const m = match.match(/<\/?([a-zA-Z0-9_-]+)/);
    if (!m) return "";
    const tag = m[1].toLowerCase();
    return ALLOWED_HTML_TAGS.has(tag) ? match : "";
  });
  // table 태그가 없으면 감싸기
  if (!cleaned.includes("<table")) {
    cleaned = `<table class="ax-report-table">${cleaned}</table>`;
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/*  결과 행 정규화 — HTML / Excel / PDF 공통 사용                       */
/* ------------------------------------------------------------------ */
interface ResultRow {
  step: string;
  item: string;
  value: string;
  status: string;
}

function buildResultRows(result: AxExecutionResult): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const sr of result.stepResults) {
    if (!sr.success || !sr.response || typeof sr.response !== "object") {
      rows.push({
        step: sr.outputKey,
        item: sr.description ?? "—",
        value: sr.error ?? "—",
        status: "실패",
      });
      continue;
    }

    const resp = sr.response as Record<string, unknown>;
    const dataObj =
      resp.data && typeof resp.data === "object"
        ? (resp.data as Record<string, unknown>)
        : null;
    const title =
      typeof resp.title === "string" ? resp.title : (sr.description ?? "—");

    let hasResult = false;
    if (dataObj) {
      for (const key of RESULT_KEY_PRIORITY) {
        const val = dataObj[key];
        if (typeof val === "number" && val !== 0) {
          hasResult = true;
          rows.push({
            step: sr.outputKey,
            item: `${title} — ${RESULT_KEY_LABELS[key] ?? key}`,
            value: `${val.toLocaleString("ko-KR")}원`,
            status: "성공",
          });
        } else if (typeof val === "boolean") {
          hasResult = true;
          rows.push({
            step: sr.outputKey,
            item: `${title} — ${RESULT_KEY_LABELS[key] ?? key}`,
            value: val ? "예" : "아니오",
            status: "성공",
          });
        } else if (typeof val === "string" && val.trim().length > 0) {
          hasResult = true;
          rows.push({
            step: sr.outputKey,
            item: `${title} — ${RESULT_KEY_LABELS[key] ?? key}`,
            value: val,
            status: "성공",
          });
        }
      }
    }

    if (!hasResult) {
      const picked = pickResult(sr.response);
      rows.push({
        step: sr.outputKey,
        item: picked.title ?? sr.description ?? "—",
        value: picked.summary,
        status: "성공",
      });
    }
  }
  return rows;
}

function buildResultTable(result: AxExecutionResult): string {
  const rows = buildResultRows(result);
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.step}</td><td>${r.item}</td><td style="text-align:right;font-weight:600">${r.value}</td><td>${r.status === "성공" ? "✓ 성공" : "✗ 실패"}</td></tr>`,
    )
    .join("");
  return `<table class="ax-result-table">
    <thead><tr><th>산출 단계</th><th>항목</th><th>산출 결과</th><th>상태</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}



type WizardState = {
  originalRequest: string;
  neededFields: string[];
  collected: Record<string, string>;
};

function buildEnrichedRequest(original: string, collected: Record<string, string>): string {
  const parts = Object.entries(collected)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return `${original} (${parts})`;
}

export function useTaxAxChat(domain: AxDomain = "tax") {
  const STORAGE_KEY = domain === "tax"
    ? "opengov-tax-ax-chat-history"
    : "opengov-welfare-ax-chat-history";

  const initialAssistantMessage: ChatMessage = {
    id: "msg_0",
    role: "assistant",
    content:
      domain === "tax"
        ? "안녕하십니까, 세무 AX 챗봇입니다.\n연봉, 종합소득세, 세액공제, 부가가치세 등 세법 관련 계산을 도와드리겠습니다. 필요하신 계산이 있으시면 말씀해 주시기 바랍니다. 예) '연봉 5,000만원 직장인의 근로소득공제 금액을 알려주세요'"
        : "안녕하십니까, 복지 AX 챗봇입니다.\n소득인정액, 중위소득 비율, 복지 자격 여부 등 사회복지 관련 계산을 도와드리겠습니다. 필요하신 계산이 있으시면 말씀해 주시기 바랍니다. 예) '월급 250만원, 가구원 3인 가구의 복지 자격을 알려주세요'",
  };

  function loadMessages(): ChatMessage[] {
    if (typeof window === "undefined") return [initialAssistantMessage];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [initialAssistantMessage];
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // ignore parse errors
    }
    return [initialAssistantMessage];
  }

  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // persist to localStorage on every change
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // ignore quota errors
    }
  }, [messages]);

  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [error, setError] = useState("");
  const [isExpertMode, setIsExpertMode] = useState(false);
  const isExpertModeRef = useRef(isExpertMode);
  useEffect(() => {
    isExpertModeRef.current = isExpertMode;
  }, [isExpertMode]);
  const abortRef = useRef(false);
  const wizardRef = useRef<WizardState | null>(null);

  const toggleExpertMode = useCallback(() => setIsExpertMode((prev) => !prev), []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // 내부: 플랜 생성 후 자동 실행까지 한 번에 처리
  const generateAndExecute = useCallback(
    async (userText: string) => {
      abortRef.current = false;
      setError("");
      setPhase("thinking");

      try {
        const history = [
          ...messagesRef.current.map((m) => {
            if (m.role === "user" || m.role === "assistant") {
              return { role: m.role, content: m.content } as const;
            }
            if (m.role === "plan" || m.role === "clarification") {
              return { role: "assistant", content: m.content } as const;
            }
            return { role: "assistant", content: m.content } as const;
          }),
          { role: "user" as const, content: userText.trim() },
        ];

        const raw = await generateAxChatResponse(history, domain);
        if (abortRef.current) return;

        const { json, plain } = extractJson(raw);

        if (json) {
          let parsedJson: Record<string, unknown>;
          try {
            parsedJson = JSON.parse(json);
          } catch {
            addMessage({
              id: nextId(),
              role: "assistant",
              content: plain || raw,
            });
            setPhase("done");
            return;
          }

          // 정보 부족 → wizard 모드 진입
          if (parsedJson.clarification_needed === true) {
            const neededFields = Array.isArray(parsedJson.needed_fields)
              ? parsedJson.needed_fields.map(String)
              : [];
            if (neededFields.length > 0) {
              wizardRef.current = {
                originalRequest: userText.trim(),
                neededFields: [...neededFields],
                collected: {},
              };
              const firstField = neededFields[0];
              addMessage({
                id: nextId(),
                role: "assistant",
                content: `요청하신 계산을 위해서 ${firstField}이(가) 필요합니다. 필요한 정보를 요청드립니다.`,
              });
              setPhase("clarifying");
              return;
            }
            // needed_fields가 비었으면 평문으로 처리
            const msg = typeof parsedJson.message === "string" ? parsedJson.message : plain || raw;
            addMessage({ id: nextId(), role: "assistant", content: msg });
            setPhase("done");
            return;
          }

          // steps가 있으면 플랜 메시지 + 자동 실행
          const steps = parsedJson.steps;
          if (Array.isArray(steps)) {
            const plan = parsedJson as unknown as AxPlan;

            if (plain) {
              addMessage({
                id: nextId(),
                role: "assistant",
                content: plain,
              });
            }

            addMessage({
              id: nextId(),
              role: "plan",
              content: JSON.stringify(plan, null, 2),
              plan,
            });

            if (plan.steps && plan.steps.length > 0) {
              // 자동 실행
              await executeChatPlan(plan, userText.trim());
            } else {
              setPhase("done");
            }
            return;
          }

          // 기타 JSON
          addMessage({
            id: nextId(),
            role: "assistant",
            content: plain || raw,
          });
          setPhase("done");
        } else {
          addMessage({
            id: nextId(),
            role: "assistant",
            content: plain || raw,
          });
          setPhase("done");
        }
      } catch (e) {
        if (abortRef.current) return;
        const errMsg = (e as Error).message;
        setError(errMsg);
        addMessage({ id: nextId(), role: "error", content: errMsg });
        setPhase("error");
      }
    },
    [addMessage],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      abortRef.current = false;
      setError("");

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content: text.trim(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // wizard 모드: 단계적 질문 답변 수집
      const wizard = wizardRef.current;
      if (wizard && wizard.neededFields.length > 0) {
        const currentField = wizard.neededFields[0];
        wizard.collected[currentField] = text.trim();
        wizard.neededFields.shift(); // 현재 필드 제거

        if (wizard.neededFields.length > 0) {
          const nextField = wizard.neededFields[0];
          addMessage({
            id: nextId(),
            role: "assistant",
            content: `그럼 ${nextField}은(는) 어떻게 되나요?`,
          });
          setPhase("clarifying");
          return;
        }

        // 모든 필드 수집 완료 → 자동 플랜 생성 및 실행
        wizardRef.current = null;
        const enriched = buildEnrichedRequest(wizard.originalRequest, wizard.collected);
        await generateAndExecute(enriched);
        return;
      }

      // 일반 모드
      await generateAndExecute(text.trim());
    },
    [addMessage, generateAndExecute],
  );

  const executeChatPlan = useCallback(
    async (plan: AxPlan, originalRequest: string) => {
      abortRef.current = false;
      setError("");

      if (!plan.steps || plan.steps.length === 0) {
        const noStepMsg =
          "실행할 계산 단계가 없습니다. 요청하신 내용에 필요한 정보가 부족하거나 지원하지 않는 항목일 수 있습니다.";
        addMessage({ id: nextId(), role: "error", content: noStepMsg });
        setPhase("error");
        return;
      }

      setPhase("executing");

      const startTime = Date.now();
      const deadline = startTime + 180_000;
      let currentPlan = plan;
      let attempt = 0;

      while (true) {
        if (abortRef.current) return;
        if (Date.now() > deadline) {
          const timeoutMsg = "AX 실행 제한 시간 180초 초과";
          setError(timeoutMsg);
          addMessage({ id: nextId(), role: "error", content: timeoutMsg });
          setPhase("error");
          return;
        }

        try {
          attempt++;
          const res = await executePlan(currentPlan);
          if (abortRef.current) return;

          const isExpert = isExpertModeRef.current;

          if (isExpert) {
            const tableHtml = buildResultTable(res);
            addMessage({
              id: nextId(),
              role: "result",
              content: tableHtml,
              result: res,
              plan: currentPlan,
            });
          }

          setPhase("reporting");
          if (isExpert) {
            const accurateTable = buildResultTable(res);
            const report = await reportToQwen(
              res.overallSuccess,
              JSON.stringify(res, null, 2),
              originalRequest,
              accurateTable,
            );
            if (abortRef.current) return;

            setPhase("formatting");
            await new Promise((r) => setTimeout(r, 600));
            const sanitized = sanitizeHtmlTable(report);

            setPhase("preparing");
            await new Promise((r) => setTimeout(r, 600));
            addMessage({
              id: nextId(),
              role: "assistant",
              content: sanitized,
              result: res,
              plan: currentPlan,
            });
          } else {
            // 쉬운 모드: 자연어 요약 + 다운로드/대시보드 액션
            setPhase("formatting");
            const summary = await summarizeAxResult(
              JSON.stringify(res, null, 2),
              originalRequest,
            );
            if (abortRef.current) return;

            setPhase("preparing");
            await new Promise((r) => setTimeout(r, 400));
            addMessage({
              id: nextId(),
              role: "assistant",
              content: summary,
              result: res,
              plan: currentPlan,
            });
          }

          setPhase("done");
          return;
        } catch (e) {
          if (abortRef.current) return;
          let errMsg = (e as Error).message;

          if (errMsg.includes("Failed to fetch") || errMsg.includes("NetworkError")) {
            errMsg = "서버와의 연결에 실패하였습니다. 잠시 후 다시 시도해 주시기 바랍니다.";
          }

          if (Date.now() > deadline) {
            setError(errMsg);
            addMessage({ id: nextId(), role: "error", content: errMsg });
            setPhase("error");
            return;
          }

          addMessage({
            id: nextId(),
            role: "assistant",
            content: `AX 실행 실패 (시도 ${attempt}): ${errMsg}\n플랜을 수정하여 재시도하겠습니다. 잠시만 기다려 주시기 바랍니다.`,
          });

          try {
            const fixText = await fixAxPlan(
              originalRequest,
              JSON.stringify(currentPlan, null, 2),
              errMsg,
              domain,
            );
            if (abortRef.current) return;

            const { json } = extractJson(fixText);
            if (!json) {
              throw new Error("수정된 플랜에서 JSON을 찾을 수 없습니다.");
            }
            const fixed = JSON.parse(json);
            if (fixed.steps) {
              currentPlan = fixed as AxPlan;
            } else {
              throw new Error("수정된 응답에 steps가 없습니다.");
            }

            await new Promise((r) => setTimeout(r, 1000));
          } catch (fixErr) {
            if (abortRef.current) return;
            const fixErrMsg = (fixErr as Error).message;
            setError(fixErrMsg);
            addMessage({ id: nextId(), role: "error", content: fixErrMsg });
            setPhase("error");
            return;
          }
        }
      }
    },
    [addMessage],
  );

  const confirmClarification = useCallback(
    async (originalRequest: string) => {
      wizardRef.current = null;
      await sendMessage("예, 이대로 진행해 주시기 바랍니다.");
    },
    [sendMessage],
  );

  /* ------------------------------------------------------------------ */
  /*  AX 결과 → 대시보드 노드 등록                                       */
  /* ------------------------------------------------------------------ */

  const newId = (prefix = "n"): string =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  function endpointToRuleId(endpoint: string): FormulaRule | undefined {
    for (const [ruleId, rule] of Object.entries(FORMULA_RULES)) {
      if (rule.endpoint === endpoint) return ruleId as FormulaRule;
    }
    return undefined;
  }

  function defaultDropOffset(nodes: GraphNode[]): { x: number; y: number } {
    if (nodes.length === 0) {
      return { x: 2 * GRID.size, y: 2 * GRID.size };
    }
    const maxRight = Math.max(...nodes.map((n) => n.position.x + 224));
    return { x: snap(maxRight + 4 * GRID.size), y: 2 * GRID.size };
  }

  const registerToDashboard = useCallback(
    (result: AxExecutionResult, plan?: AxPlan) => {
      if (!plan || !plan.steps || plan.steps.length === 0) {
        console.warn("[registerToDashboard] 등록할 플랜이 없습니다.");
        return;
      }

      const store = useGraphStore.getState();
      const existingNodes = store.doc.nodes;
      const offset = defaultDropOffset(existingNodes);

      const newNodes: GraphNode[] = [];
      const newEdges: GraphEdge[] = [];
      const stepNodeMap = new Map<number, GraphNode>();

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const ruleId = endpointToRuleId(step.endpoint);
        if (!ruleId) {
          console.warn(`[registerToDashboard] 지원하지 않는 endpoint: ${step.endpoint}`);
          continue;
        }

        const tpl = FORMULA_RULES[ruleId];
        const formulaId = newId();
        const baseX = offset.x;
        const baseY = offset.y + i * 180;

        // 실행 결과 → 노드 runtime 주입
        const stepResult = result.stepResults[i];
        let runtime: NodeData["runtime"] | undefined;
        if (stepResult?.success && stepResult.response && typeof stepResult.response === "object") {
          const resp = stepResult.response as Record<string, unknown>;
          const dataObj =
            resp.data && typeof resp.data === "object"
              ? (resp.data as Record<string, unknown>)
              : null;
          let output: unknown = undefined;
          if (dataObj) {
            for (const key of RESULT_KEY_PRIORITY) {
              if (dataObj[key] !== undefined) {
                output = dataObj[key];
                break;
              }
            }
            if (output === undefined) output = dataObj;
          } else {
            output = resp;
          }
          runtime = {
            output,
            rawFormula: stepResult.description ?? tpl.label,
            legalBasis: tpl.legalBasis,
            substituted: resp,
            intermediate: dataObj ?? {},
            epoch: Date.now(),
            durationMs: result.elapsedMs,
          };
        }

        const formulaNode: GraphNode = {
          id: formulaId,
          type: "stat",
          position: { x: baseX, y: baseY },
          data: {
            kind: "formula",
            label: tpl.label,
            rule: ruleId,
            inputs: tpl.inputs,
            outputs: tpl.outputs,
            runtime,
          },
        };
        newNodes.push(formulaNode);
        stepNodeMap.set(i, formulaNode);

        // 입력값 처리
        const inputEntries = Object.entries(step.inputs);
        for (let j = 0; j < inputEntries.length; j++) {
          const [inputKey, rawValue] = inputEntries[j];
          // 백엔드 변수명 → 포트 ID
          const portEntry = Object.entries(tpl.inputMap).find(([, v]) => v === inputKey);
          const portId = portEntry?.[0] ?? inputKey;

          // __prev_... 참조 → 이전 노드와 연결
          if (typeof rawValue === "string" && rawValue.startsWith("__prev_")) {
            const refKey = rawValue.replace(/__prev_|__/g, "").trim();
            for (let pi = i - 1; pi >= 0; pi--) {
              if (plan.steps[pi].outputKey === refKey) {
                const prevNode = stepNodeMap.get(pi);
                if (prevNode) {
                  const srcHandle = prevNode.data.outputs?.[0]?.id ?? null;
                  const edge: GraphEdge = {
                    id: newId("e"),
                    source: prevNode.id,
                    target: formulaId,
                    sourceHandle: srcHandle,
                    targetHandle: portId,
                    type: "ortho",
                  };
                  newEdges.push(edge);
                }
                break;
              }
            }
            continue;
          }

          // 리터럴 값 → manual 노드 생성
          if (
            typeof rawValue === "number" ||
            typeof rawValue === "string" ||
            typeof rawValue === "boolean"
          ) {
            const manualId = newId();
            const portInfo = tpl.inputs.find((p) => p.id === portId);
            const manualNode: GraphNode = {
              id: manualId,
              type: "stat",
              position: {
                x: baseX - 240,
                y: baseY + j * 60,
              },
              data: {
                kind: "manual",
                label: portInfo?.label ?? inputKey,
                inputs: [],
                outputs: [{ id: "v", name: "v", label: "값" }],
                value:
                  typeof rawValue === "boolean"
                    ? rawValue
                      ? 1
                      : 0
                    : rawValue,
              },
            };
            newNodes.push(manualNode);

            newEdges.push({
              id: newId("e"),
              source: manualId,
              target: formulaId,
              sourceHandle: "v",
              targetHandle: portId,
              type: "ortho",
            });
          }
        }
      }

      // 마지막 단계 결과를 받는 output 노드 추가
      if (stepNodeMap.size > 0) {
        const lastIdx = Math.max(...Array.from(stepNodeMap.keys()));
        const lastNode = stepNodeMap.get(lastIdx)!;
        const outPort = lastNode.data.outputs?.[0]?.id ?? "amount";
        const outputId = newId();
        const outputNode: GraphNode = {
          id: outputId,
          type: "stat",
          position: { x: lastNode.position.x + 320, y: lastNode.position.y },
          data: {
            kind: "output",
            label: "AX 결과",
            inputs: [{ id: "v", name: "v", label: "값" }],
            outputs: [],
          },
        };
        newNodes.push(outputNode);
        newEdges.push({
          id: newId("e"),
          source: lastNode.id,
          target: outputId,
          sourceHandle: outPort,
          targetHandle: "v",
          type: "ortho",
        });

        const lastStepResult = result.stepResults[lastIdx];
        if (lastStepResult?.success && lastStepResult.response && typeof lastStepResult.response === "object") {
          const resp = lastStepResult.response as Record<string, unknown>;
          const dataObj =
            resp.data && typeof resp.data === "object"
              ? (resp.data as Record<string, unknown>)
              : null;
          let output: unknown = undefined;
          if (dataObj) {
            for (const key of RESULT_KEY_PRIORITY) {
              if (dataObj[key] !== undefined) {
                output = dataObj[key];
                break;
              }
            }
            if (output === undefined) output = dataObj;
          } else {
            output = resp;
          }
          outputNode.data.runtime = {
            output,
            rawFormula: "AX 결과",
            legalBasis: "",
            substituted: {},
            intermediate: {},
            epoch: Date.now(),
          };
        }
      }

      store.setNodes((prev) => [...prev, ...newNodes]);
      store.setEdges((prev) => [...prev, ...newEdges]);
    },
    [],
  );

  const rejectClarification = useCallback(() => {
    wizardRef.current = null;
    addMessage({
      id: nextId(),
      role: "assistant",
      content: "죄송합니다. 정확한 계산을 위해서는 필요한 정보를 다시 입력해 주시기 바랍니다.",
    });
    setPhase("idle");
  }, [addMessage]);

  const exportResultToPdf = useCallback(
    (result: AxExecutionResult, filename = domain === "tax" ? "세무AX_산출결과" : "복지AX_산출결과") => {
      const rows = buildResultRows(result)
        .map(
          (r) =>
            `<tr>
            <td style="padding:8px;border:1px solid #ccc">${r.step}</td>
            <td style="padding:8px;border:1px solid #ccc">${r.item}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:right;font-weight:600">${r.value}</td>
            <td style="padding:8px;border:1px solid #ccc">${r.status}</td>
          </tr>`,
        )
        .join("");

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>세무 AX 산출결과</title>
          <style>
            body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; }
            h1 { font-size: 20px; margin-bottom: 16px; }
            table { border-collapse: collapse; width: 100%; }
            th { background: #f3f4f6; padding: 8px; border: 1px solid #ccc; }
            td { padding: 8px; border: 1px solid #ccc; }
            .footer { margin-top: 24px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <h1>세무 AX 산출결과</h1>
          <table>
            <thead>
              <tr>
                <th>산출 단계</th>
                <th>항목</th>
                <th>산출 결과</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="footer">총 소요 시간: ${result.elapsedMs}ms</div>
        </body>
        </html>
      `;

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [domain],
  );

  const exportResultToXlsx = useCallback(
    async (result: AxExecutionResult, filename = domain === "tax" ? "세무AX_산출결과" : "복지AX_산출결과") => {
      const xlsx = await import("xlsx");
      const rows = buildResultRows(result).map((r) => ({
        산출단계: r.step,
        항목: r.item,
        결과: r.value,
        상태: r.status,
      }));
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "산출결과");
      const buf = xlsx.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buf], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [domain],
  );

  return {
    messages,
    phase,
    error,
    isExpertMode,
    sendMessage,
    executeChatPlan,
    confirmClarification,
    rejectClarification,
    exportResultToXlsx,
    exportResultToPdf,
    toggleExpertMode,
    registerToDashboard,
  };
}
