"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { generateTaxChatResponse, reportToQwen, fixAxPlan } from "./qwen-client";
import { executePlan } from "./ax-api";
import type { AxPlan, AxExecutionResult } from "./types";

export type ChatMessageRole = "user" | "assistant" | "plan" | "result" | "error" | "clarification";

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; result?: AxExecutionResult }
  | { id: string; role: "clarification"; content: string; neededFields: string[]; originalRequest: string }
  | { id: string; role: "plan"; content: string; plan: AxPlan }
  | {
      id: string;
      role: "result";
      content: string;
      result: AxExecutionResult;
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
  "totalCredits",
  "earnedIncome",
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
  "qualified",
  "deduction",
  "payable",
  "shares",
];

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

  // 5) text 에서 결과 라인 추출
  let summary = "";
  if (typeof obj.text === "string") {
    const lines = obj.text.split("\n");
    const resultLine = lines.find((l) => l.startsWith("[결과]"));
    if (resultLine) {
      summary = resultLine.replace("[결과]", "").trim();
    } else {
      // 금액이 포함된 첫 번째 핵심 라인 찾기
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
/*  결과 테이블 HTML (전문가 모드용 원문)                               */
/* ------------------------------------------------------------------ */
function buildResultTable(result: AxExecutionResult): string {
  const rows = result.stepResults
    .map((sr) => {
      if (!sr.success || !sr.response || typeof sr.response !== "object") {
        return `<tr>
          <td>${sr.outputKey}</td>
          <td>${sr.description ?? "—"}</td>
          <td style="text-align:right;font-weight:600">${sr.error ?? "—"}</td>
          <td>✗ 실패</td>
        </tr>`;
      }
      const resp = sr.response as Record<string, unknown>;
      const dataObj =
        resp.data && typeof resp.data === "object"
          ? (resp.data as Record<string, unknown>)
          : null;
      const title =
        typeof resp.title === "string" ? resp.title : (sr.description ?? "—");

      // data에서 결과 키를 순서대로 펼쳐서 행 생성
      let valueRows = "";
      if (dataObj) {
        for (const key of RESULT_KEY_PRIORITY) {
          const val = dataObj[key];
          if (typeof val === "number") {
            // camelCase → 한글 라벨
            const label = key
              .replace(/([A-Z])/g, " $1")
              .replace(/^./, (s) => s.toUpperCase());
            valueRows += `<tr>
              <td>${sr.outputKey}</td>
              <td>${title} — ${label}</td>
              <td style="text-align:right;font-weight:600">${val.toLocaleString("ko-KR")}원</td>
              <td>✓ 성공</td>
            </tr>`;
          }
        }
      }
      // 결과 키가 하나도 없으면 pickResult fallback
      if (!valueRows) {
        const picked = pickResult(sr.response);
        valueRows = `<tr>
          <td>${sr.outputKey}</td>
          <td>${picked.title ?? sr.description ?? "—"}</td>
          <td style="text-align:right;font-weight:600">${picked.summary}</td>
          <td>✓ 성공</td>
        </tr>`;
      }
      return valueRows;
    })
    .join("");

  return `<table class="ax-result-table">
    <thead><tr><th>산출 단계</th><th>항목</th><th>산출 결과</th><th>상태</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const STORAGE_KEY = "opengov-tax-ax-chat-history";

const initialAssistantMessage: ChatMessage = {
  id: "msg_0",
  role: "assistant",
  content:
    "안녕하십니까, 세무 AX 챗봇입니다.\n연봉, 종합소득세, 세액공제, 부가가치세 등 세법 관련 계산을 도와드리겠습니다. 필요하신 계산이 있으시면 말씀해 주시기 바랍니다. 예) '연봉 5,000만원 직장인의 근로소득공제 금액을 알려주세요'",
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

export function useTaxAxChat() {
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

        const raw = await generateTaxChatResponse(history);
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

          const tableHtml = buildResultTable(res);
          addMessage({
            id: nextId(),
            role: "result",
            content: tableHtml,
            result: res,
          });

          setPhase("reporting");
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
          });

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

  const exportResultToXlsx = useCallback(
    async (result: AxExecutionResult, filename = "세무AX_산출결과") => {
      const xlsx = await import("xlsx");
      const rows = result.stepResults.map((sr) => {
        const picked =
          sr.success && sr.response && typeof sr.response === "object"
            ? pickResult(sr.response)
            : { summary: sr.error ?? "—" };
        return {
          산출단계: sr.outputKey,
          항목: picked.title ?? sr.description ?? "—",
          결과: picked.summary,
          상태: sr.success ? "성공" : "실패",
        };
      });
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
    [],
  );

  const confirmClarification = useCallback(
    async (originalRequest: string) => {
      wizardRef.current = null;
      await sendMessage("예, 이대로 진행해 주시기 바랍니다.");
    },
    [sendMessage],
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
    (result: AxExecutionResult, filename = "세무AX_산출결과") => {
      const rows = result.stepResults
        .map((sr) => {
          const picked =
            sr.success && sr.response && typeof sr.response === "object"
              ? pickResult(sr.response)
              : { summary: sr.error ?? "—" };
          return `<tr>
            <td style="padding:8px;border:1px solid #ccc">${sr.outputKey}</td>
            <td style="padding:8px;border:1px solid #ccc">${picked.title ?? sr.description ?? "—"}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:right;font-weight:600">${picked.summary}</td>
            <td style="padding:8px;border:1px solid #ccc">${sr.success ? "성공" : "실패"}</td>
          </tr>`;
        })
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
    [],
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
  };
}
