"use client";

import { useState, useRef, useEffect } from "react";
import { useTaxAxChat } from "./useTaxAxChat";
import type { AxPlan } from "./types";
import { useGraphStore } from "../lib/store";

export default function TaxAxChatPanel() {
  const { messages, phase, sendMessage, executeChatPlan, confirmClarification, rejectClarification, exportResultToXlsx, exportResultToPdf } =
    useTaxAxChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const setMode = useGraphStore((s) => s.setMode);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const handleSend = () => {
    if (!input.trim() || phase === "thinking" || phase === "executing" || phase === "reporting" || phase === "clarifying")
      return;
    sendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastUserContent =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  return (
    <aside className="dash-exec tax-ax-chat-panel">
      <div className="tax-ax-header">
        <h3>세무 AX — 대화형 세법 계산</h3>
        <button className="tax-ax-close" onClick={() => setMode("normal")} aria-label="닫기">
          ×
        </button>
      </div>

      <div className="tax-ax-messages">
        {messages
          .filter((msg) => {
            if (msg.role === "user" || msg.role === "assistant") {
              return msg.content.trim().length > 0;
            }
            return true;
          })
          .map((msg) => {
          switch (msg.role) {
            case "user":
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-user">
                  <div className="tax-ax-bubble tax-ax-bubble-user">{msg.content}</div>
                </div>
              );
            case "assistant":
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot">
                    {msg.content.split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              );
            case "clarification":
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot">
                    {msg.content.split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                    <div className="tax-ax-clarify-actions" style={{ marginTop: 12, display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-accent btn-sm"
                        onClick={() => confirmClarification(msg.originalRequest)}
                        disabled={phase === "thinking" || phase === "executing" || phase === "reporting"}
                      >
                        예
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={rejectClarification}
                        disabled={phase === "thinking" || phase === "executing" || phase === "reporting"}
                      >
                        아니오
                      </button>
                    </div>
                  </div>
                </div>
              );
            case "plan":
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot">
                    <p>산출 플랜을 생성했습니다. 아래 내용을 확인하고 실행해 주세요.</p>
                    <pre className="tax-ax-plan-code">{msg.content}</pre>
                    <button
                      className="btn btn-accent tax-ax-run-btn"
                      onClick={() => executeChatPlan(msg.plan, lastUserContent)}
                      disabled={phase === "executing" || phase === "reporting"}
                    >
                      {phase === "executing"
                        ? "실행 중…"
                        : phase === "reporting"
                          ? "보고서 작성 중…"
                          : "플랜 실행"}
                    </button>
                  </div>
                </div>
              );
            case "result":
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot">
                    <p>산출이 완료되었습니다. 결과를 확인해 주세요.</p>
                    <div
                      className="tax-ax-result-table-wrap"
                      dangerouslySetInnerHTML={{ __html: msg.content }}
                    />
                    <div className="tax-ax-actions">
                      <button
                        className="btn btn-sm"
                        onClick={() => exportResultToXlsx(msg.result)}
                      >
                        📊 XLSX 다운로드
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => exportResultToPdf(msg.result)}
                      >
                        📄 PDF 다운로드
                      </button>
                    </div>
                  </div>
                </div>
              );
            case "error":
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot tax-ax-bubble-error">
                    {msg.content}
                  </div>
                </div>
              );
            default:
              return null;
          }
        })}

        {(phase === "thinking" || phase === "executing" || phase === "reporting" || phase === "clarifying") && (
          <div className="tax-ax-msg tax-ax-msg-bot">
            <div className="tax-ax-avatar">AX</div>
            <div className="tax-ax-bubble tax-ax-bubble-bot">
              <div className="tax-ax-typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="tax-ax-input-area">
        <textarea
          className="tax-ax-textarea"
          rows={2}
          placeholder="세법 계산을 요청해 보세요… (예: 연봉 6000만원 직장인 근로소득공제 금액)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={phase === "thinking" || phase === "executing" || phase === "reporting" || phase === "clarifying"}
        />
        <button
          className="btn btn-accent tax-ax-send"
          onClick={handleSend}
          disabled={!input.trim() || phase === "thinking" || phase === "executing" || phase === "reporting" || phase === "clarifying"}
        >
          ➤
        </button>
      </div>
    </aside>
  );
}
