"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { generateTaxChatResponse, reportToQwen, fixAxPlan } from "./qwen-client";
import { executePlan } from "./ax-api";
import type { AxPlan, AxExecutionResult } from "./types";

export type ChatMessageRole = "user" | "assistant" | "plan" | "result" | "error" | "clarification";

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string }
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
  // 3) composite 룰: data 낶의 숫자 값 스캔 (amount 필드가 없을 때)
  if (amount === undefined && dataObj) {
    const candidates: number[] = [];
    for (const v of Object.values(dataObj)) {
      if (typeof v === "number") candidates.push(v);
    }
    if (candidates.length > 0) {
      amount = Math.max(...candidates);
    }
  }

  const title = typeof obj.title === "string" ? obj.title : undefined;

  // 4) text 에서 결과 라인 추출
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
/*  결과 테이블 HTML                                                    */
/* ------------------------------------------------------------------ */
function buildResultTable(result: AxExecutionResult): string {
  const rows = result.stepResults
    .map((sr) => {
      const picked =
        sr.success && sr.response && typeof sr.response === "object"
          ? pickResult(sr.response)
          : { summary: sr.error ?? "—" };
      return `<tr>
        <td>${sr.outputKey}</td>
        <td>${picked.title ?? sr.description ?? "—"}</td>
        <td style="text-align:right;font-weight:600">${picked.summary}</td>
        <td>${sr.success ? "✓ 성공" : "✗ 실패"}</td>
      </tr>`;
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
  const abortRef = useRef(false);
  const wizardRef = useRef<WizardState | null>(null);

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
          const report = await reportToQwen(
            res.overallSuccess,
            JSON.stringify(res, null, 2),
            originalRequest,
          );
          if (abortRef.current) return;

          addMessage({
            id: nextId(),
            role: "assistant",
            content: report,
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
    sendMessage,
    executeChatPlan,
    confirmClarification,
    rejectClarification,
    exportResultToXlsx,
    exportResultToPdf,
  };
}
