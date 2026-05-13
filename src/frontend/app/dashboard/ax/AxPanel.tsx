"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FORMULA_RULES } from "../lib/registry";
import { generateAxPlan, reportToQwen, loadQwen } from "./qwen-client";
import { executePlan, getAxConfig } from "./ax-api";
import type { AxPlan, AxExecutionResult } from "./types";
import AxProgressBar from "./AxProgressBar";

const MAX_WAIT_MS_DEFAULT = 180_000;

function buildEndpointInfo(): string {
  return Object.entries(FORMULA_RULES)
    .map(([key, meta]) => {
      const ins = meta.inputs.map((p) => `${p.name}: number`).join(", ");
      const outs = meta.outputs.map((p) => `${p.name}: number`).join(", ");
      return `- ${meta.endpoint} (rule: ${key}) → 입력 {${ins}}, 출력 {${outs}}`;
    })
    .join("\n");
}

export default function AxPanel() {
  const [request, setRequest] = useState("");
  const [planJson, setPlanJson] = useState("");
  const [phase, setPhase] = useState<
    | "idle"
    | "loading-model"
    | "generating"
    | "ready"
    | "executing"
    | "reporting"
    | "done"
    | "error"
  >("idle");
  const [result, setResult] = useState<AxExecutionResult | null>(null);
  const [finalAnswer, setFinalAnswer] = useState("");
  const [error, setError] = useState("");
  const [maxWaitMs, setMaxWaitMs] = useState(MAX_WAIT_MS_DEFAULT);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    getAxConfig()
      .then((c) => setMaxWaitMs(c.maxWaitSeconds * 1000))
      .catch(() => setMaxWaitMs(MAX_WAIT_MS_DEFAULT));
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    const start = Date.now();
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setElapsedMs(elapsed);
      if (elapsed >= maxWaitMs) clearTimer();
    }, 200);
  }, [clearTimer, maxWaitMs]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleGenerate = async () => {
    if (!request.trim()) return;
    setPhase("loading-model");
    setError("");
    try {
      await loadQwen();
      setPhase("generating");
      const endpointsInfo = buildEndpointInfo();
      const raw = await generateAxPlan(request, endpointsInfo);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      setPlanJson(jsonMatch ? jsonMatch[0] : raw);
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const handleExecute = async () => {
    if (!planJson.trim()) return;
    let plan: AxPlan;
    try {
      plan = JSON.parse(planJson);
    } catch {
      setError("JSON 플랜 파싱 실패");
      setPhase("error");
      return;
    }
    setPhase("executing");
    setError("");
    startTimer();
    try {
      const res = await executePlan(plan);
      clearTimer();
      setResult(res);
      setPhase("reporting");
      const report = await reportToQwen(
        res.overallSuccess,
        JSON.stringify(res, null, 2),
        request,
      );
      setFinalAnswer(report);
      setPhase("done");
    } catch (e) {
      clearTimer();
      setError((e as Error).message);
      setPhase("error");
    }
  };

  return (
    <aside className="dash-exec ax-panel">
      <h3>AX 서비스 — 자동 산출식 실행</h3>

      <div className="ax-section">
        <label className="ax-label">자연어 요청</label>
        <textarea
          className="ax-input"
          rows={3}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="예: 연봉 7200만원 직장인의 종합소득세를 계산해줘"
        />
        <button
          className="btn btn-accent"
          onClick={handleGenerate}
          disabled={phase === "loading-model" || phase === "generating"}
        >
          {phase === "loading-model"
            ? "모델 로딩 중…"
            : phase === "generating"
              ? "플랜 생성 중…"
              : "플랜 생성"}
        </button>
      </div>

      {planJson && (
        <div className="ax-section">
          <label className="ax-label">생성된 플랜 (수정 가능)</label>
          <textarea
            className="ax-input ax-json"
            rows={8}
            value={planJson}
            onChange={(e) => setPlanJson(e.target.value)}
          />
          <button
            className="btn btn-accent"
            onClick={handleExecute}
            disabled={phase === "executing" || phase === "reporting"}
          >
            {phase === "executing"
              ? "실행 중…"
              : phase === "reporting"
                ? "보고서 작성 중…"
                : "플랜 실행"}
          </button>
        </div>
      )}

      {(phase === "executing" || phase === "reporting") && (
        <div className="ax-section">
          <AxProgressBar elapsedMs={elapsedMs} maxMs={maxWaitMs} />
        </div>
      )}

      {error && (
        <div className="ax-section">
          <div className="ax-error">× {error}</div>
        </div>
      )}

      {finalAnswer && (
        <div className="ax-section">
          <label className="ax-label">Qwen 답변</label>
          <div className="ax-answer">{finalAnswer}</div>
        </div>
      )}

      {result && (
        <div className="ax-section">
          <label className="ax-label">실행 결과 요약</label>
          <div className="ax-summary">
            <span className={result.overallSuccess ? "ok" : "err"}>
              {result.overallSuccess ? "✓ 성공" : "× 실패"}
            </span>
            <span>{result.message}</span>
            <span>{result.elapsedMs}ms</span>
          </div>
        </div>
      )}
    </aside>
  );
}
