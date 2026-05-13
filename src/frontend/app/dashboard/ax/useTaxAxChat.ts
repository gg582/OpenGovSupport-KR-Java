"use client";

import { useState, useCallback, useRef } from "react";
import { generateTaxChatResponse, reportToQwen } from "./qwen-client";
import { executePlan } from "./ax-api";
import type { AxPlan, AxExecutionResult } from "./types";

export type ChatMessageRole = "user" | "assistant" | "plan" | "result" | "error";

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string }
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
  | "error";

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

function buildResultTable(result: AxExecutionResult): string {
  const rows = result.stepResults
    .map((sr) => {
      const val =
        sr.success && sr.response && typeof sr.response === "object"
          ? (sr.response as Record<string, unknown>)["amount"] ??
            JSON.stringify(sr.response)
          : sr.error ?? "—";
      const displayVal =
        typeof val === "number" ? `${val.toLocaleString("ko-KR")}원` : String(val);
      return `<tr>
        <td>${sr.outputKey}</td>
        <td>${sr.description ?? "—"}</td>
        <td>${displayVal}</td>
        <td>${sr.success ? "성공" : "실패"}</td>
      </tr>`;
    })
    .join("");
  return `<table class="ax-result-table">
    <thead><tr><th>산출 단계</th><th>설명</th><th>결과</th><th>상태</th></tr></thead>
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
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [error, setError] = useState("");
  const abortRef = useRef(false);

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
          ...messages.map((m) => {
            if (m.role === "user" || m.role === "assistant") {
              return { role: m.role, content: m.content } as const;
            }
            if (m.role === "plan") {
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
          let plan: AxPlan;
          try {
            plan = JSON.parse(json);
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

          // 평문 설명이 있으면 먼저 보여주고
          if (plain) {
            addMessage({
              id: nextId(),
              role: "assistant",
              content: plain,
            });
          }

          // 플랜 메시지 추가
          addMessage({
            id: nextId(),
            role: "plan",
            content: JSON.stringify(plan, null, 2),
            plan,
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
    [messages, addMessage],
  );

  const executeChatPlan = useCallback(
    async (plan: AxPlan, originalRequest: string) => {
      abortRef.current = false;
      setError("");
      setPhase("executing");

      try {
        const res = await executePlan(plan);
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

  const exportResultToXlsx = useCallback(
    async (result: AxExecutionResult, filename = "세무AX_산출결과") => {
      const xlsx = await import("xlsx");
      const rows = result.stepResults.map((sr) => ({
        산출단계: sr.outputKey,
        설명: sr.description ?? "—",
        결과:
          sr.success && sr.response && typeof sr.response === "object"
            ? JSON.stringify((sr.response as Record<string, unknown>)["amount"] ?? sr.response)
            : sr.error ?? "—",
        상태: sr.success ? "성공" : "실패",
        소요시간ms: result.elapsedMs,
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
    [],
  );

  const exportResultToPdf = useCallback(
    (result: AxExecutionResult, filename = "세무AX_산출결과") => {
      const rows = result.stepResults
        .map((sr) => {
          const val =
            sr.success && sr.response && typeof sr.response === "object"
              ? (sr.response as Record<string, unknown>)["amount"] ??
                JSON.stringify(sr.response)
              : sr.error ?? "—";
          const displayVal =
            typeof val === "number" ? `${val.toLocaleString("ko-KR")}원` : String(val);
          return `<tr>
            <td style="padding:8px;border:1px solid #ccc">${sr.outputKey}</td>
            <td style="padding:8px;border:1px solid #ccc">${sr.description ?? "—"}</td>
            <td style="padding:8px;border:1px solid #ccc">${displayVal}</td>
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
                <th>설명</th>
                <th>결과</th>
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
    exportResultToXlsx,
    exportResultToPdf,
  };
}
