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

  // 1) data.amount
  let amount: number | undefined;
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.amount === "number") amount = data.amount;
  }
  // 2) 최상위 amount
  if (amount === undefined && typeof obj.amount === "number") {
    amount = obj.amount;
  }

  const title = typeof obj.title === "string" ? obj.title : undefined;

  // 3) text 에서 [결과] 라인 추출
  let summary = "";
  if (typeof obj.text === "string") {
    const resultLine = obj.text.split("\n").find((l) => l.startsWith("[결과]"));
    if (resultLine) {
      summary = resultLine.replace("[결과]", "").trim();
    }
  }

  // amount 가 있으면 "12,345,678원" 으로 덮어씀
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

export function useTaxAxChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextId(),
      role: "assistant",
      content:
        "안녕하세요! 세무 AX 챗봇입니다.\n연봉, 종합소득세, 세액공제, 부가가치세 등 세법 관련 계산이 필요하시면 편하게 말씀해 주세요. 예) '연봉 5,000만원 직장인의 근로소득공제 금액을 알려줘'",
    },
  ]);
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [error, setError] = useState("");
  const abortRef = useRef(false);
  const pendingClarificationRef = useRef<{ content: string; neededFields: string[]; originalRequest: string } | null>(null);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

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
          { role: "user" as const, content: text.trim() },
        ];

        const raw = await generateTaxChatResponse(history);
        if (abortRef.current) return;

        const { json, plain } = extractJson(raw);

        // JSON 플랜이 있으면 plan 메시지 + 평문이 있으면 assistant 메시지
        if (json) {
          let parsedJson: Record<string, unknown>;
          try {
            parsedJson = JSON.parse(json);
          } catch {
            // JSON 파싱 실패 시 평문으로 처리
            addMessage({
              id: nextId(),
              role: "assistant",
              content: plain || raw,
            });
            setPhase("done");
            return;
          }

          // 정보 과잉/부족 확인 응답 처리
          if (parsedJson.clarification_needed === true) {
            const neededFields = Array.isArray(parsedJson.needed_fields)
              ? parsedJson.needed_fields.map(String)
              : [];
            const msg = typeof parsedJson.message === "string" ? parsedJson.message : plain || raw;
            addMessage({
              id: nextId(),
              role: "clarification",
              content: msg,
              neededFields,
              originalRequest: text.trim(),
            });
            pendingClarificationRef.current = {
              content: msg,
              neededFields,
              originalRequest: text.trim(),
            };
            setPhase("clarifying");
            return;
          }

          // steps가 있으면 플랜 메시지
          const steps = parsedJson.steps;
          if (Array.isArray(steps)) {
            const plan = parsedJson as unknown as AxPlan;

            // 평문 설명이 있으면 먼저 보여주고
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
            setPhase("done");
            return;
          }

          // steps가 없는 기타 JSON 응답 (지원 불가 등)
          addMessage({
            id: nextId(),
            role: "assistant",
            content: plain || raw,
          });
          setPhase("done");
        } else {
          // 일반 대화 응답
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

  const executeChatPlan = useCallback(
    async (plan: AxPlan, originalRequest: string) => {
      abortRef.current = false;
      setError("");
      setPhase("executing");

      const startTime = Date.now();
      const deadline = startTime + 180_000; // 180초
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
          const errMsg = (e as Error).message;

          if (Date.now() > deadline) {
            setError(errMsg);
            addMessage({ id: nextId(), role: "error", content: errMsg });
            setPhase("error");
            return;
          }

          addMessage({
            id: nextId(),
            role: "assistant",
            content: `AX 실행 실패 (시도 ${attempt}): ${errMsg}\n플랜을 수정하여 재시도합니다...`,
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
      pendingClarificationRef.current = null;
      // "예"라고 입력한 것처럼 다음 턴으로 진행
      // 이때 history에 clarification 질문이 포함되어 있어 LLM이 플랜을 생성할 가능성이 높아짐
      await sendMessage("예, 이대로 진행해줘");
    },
    [sendMessage],
  );

  const rejectClarification = useCallback(() => {
    pendingClarificationRef.current = null;
    addMessage({
      id: nextId(),
      role: "assistant",
      content: "알겠습니다. 정확한 계산을 위해 필요한 정보만 다시 입력해 주세요.",
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
