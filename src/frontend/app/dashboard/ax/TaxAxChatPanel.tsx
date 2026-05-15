"use client";

import { useState, useRef, useEffect } from "react";
import { useTaxAxChat } from "./useTaxAxChat";
import type { AxPlan } from "./types";
import { useGraphStore } from "../lib/store";

export default function TaxAxChatPanel() {
  const { messages, phase, sendMessage, executeChatPlan, confirmClarification, rejectClarification, exportResultToXlsx, exportResultToPdf, isExpertMode, toggleExpertMode } =
    useTaxAxChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const setMode = useGraphStore((s) => s.setMode);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const handleSend = () => {
    if (!input.trim() || phase === "thinking" || phase === "executing" || phase === "reporting") return;
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn btn-sm"
            onClick={toggleExpertMode}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            {isExpertMode ? "전문가 모드 ON" : "전문가 모드 OFF"}
          </button>
          <button className="tax-ax-close" onClick={() => setMode("normal")} aria-label="닫기">
            ×
          </button>
        </div>
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
                    {msg.content.trim().startsWith("<") ? (
                      <>
                        <div
                          className="tax-ax-result-table-wrap"
                          dangerouslySetInnerHTML={{ __html: msg.content }}
                        />
                        {msg.result && (
                          <div className="tax-ax-actions" style={{ marginTop: 12 }}>
                            <button
                              className="btn btn-sm"
                              onClick={() => exportResultToXlsx(msg.result!)}
                            >
                              📊 XLSX 다운로드
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => exportResultToPdf(msg.result!)}
                            >
                              📄 PDF 다운로드
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      msg.content.split("\n").map((line, i) => (
                        <p key={i}>{line}</p>
                      ))
                    )}
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
            case "plan": {
              if (!isExpertMode) return null;
              const hasSteps = msg.plan.steps && msg.plan.steps.length > 0;
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot">
                    <p>요청하신 산출 플랜을 생성하였습니다. 아래 내용을 확인하신 후 실행해 주시기 바랍니다.</p>
                    <pre className="tax-ax-plan-code">{msg.content}</pre>
                    {hasSteps ? (
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
                    ) : (
                      <p className="tax-ax-plan-no-steps" style={{ color: "#b45309", fontSize: 14, marginTop: 8 }}>
                        ⚠️ 실행 가능한 계산 단계가 없습니다. 필요한 정보가 부족하거나 지원하지 않는 요청일 수 있습니다. 다시 한번 확인해 주시기 바랍니다.
                      </p>
                    )}
                  </div>
                </div>
              );
            }
            case "result":
              if (!isExpertMode) return null;
              return (
                <div key={msg.id} className="tax-ax-msg tax-ax-msg-bot">
                  <div className="tax-ax-avatar">AX</div>
                  <div className="tax-ax-bubble tax-ax-bubble-bot">
                    <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>📝 원문 응답</p>
                    <pre className="tax-ax-plan-code" style={{ maxHeight: 300, overflow: "auto" }}>{JSON.stringify(msg.result, null, 2)}</pre>
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

        {(phase === "thinking" || phase === "executing" || phase === "reporting" || phase === "formatting" || phase === "preparing") && (
          <div className="tax-ax-msg tax-ax-msg-bot">
            <div className="tax-ax-avatar">AX</div>
            <div className="tax-ax-bubble tax-ax-bubble-bot">
              <div className="tax-ax-typing">
                <span />
                <span />
                <span />
              </div>
              <p className="tax-ax-hint" style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
                {phase === "thinking" && "AI가 요청을 보내는 중입니다..."}
                {phase === "executing" && "AI의 요청으로부터 데이터를 계산하는 중입니다..."}
                {phase === "reporting" && "표로 정리하는 중입니다..."}
                {phase === "formatting" && "정리된 표의 서식을 만듭니다..."}
                {phase === "preparing" && "엑셀 파일과 PDF로 준비 중입니다..."}
              </p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="tax-ax-input-area">
        <textarea
          className="tax-ax-textarea"
          rows={2}
          placeholder={phase === "clarifying" ? "질문에 답변해 주시기 바랍니다…" : "세법 계산을 요청해 주시기 바랍니다… (예: 연봉 6,000만원 직장인의 근로소득공제 금액)"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={phase === "thinking" || phase === "executing" || phase === "reporting"}
        />
        <button
          className="btn btn-accent tax-ax-send"
          onClick={handleSend}
          disabled={!input.trim() || phase === "thinking" || phase === "executing" || phase === "reporting"}
        >
          ➤
        </button>
      </div>
    </aside>
  );
}
