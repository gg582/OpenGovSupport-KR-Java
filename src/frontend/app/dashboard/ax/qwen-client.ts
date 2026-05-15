/**
 * 서버 사이드 Qwen 실행 클라이언트.
 *
 * <p>브라우저 내 WebGPU/CNN 실행 대신 백엔드 /api/llm/generate 를 호출한다.
 * 이 파일만 삭제하면 AX 모듈 전체를 쉽게 제거할 수 있다.</p>
 */

import { FORMULA_RULES } from "../lib/registry";

export function isQwenLoading(): boolean {
  return false;
}

/** 브라우저가 WebGPU 를 지원하는지 확인. (서버 사이드에서는 항상 true) */
export function isWebGpuSupported(): boolean {
  return true;
}

export async function loadQwen(_modelId?: string) {
  // 서버 사이드 모델이므로 클라이언트에서 로드할 필요 없음
  return true;
}

async function callGenerate(prompt: string, max_new_tokens: number): Promise<string> {
  const res = await fetch("/api/llm/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, max_new_tokens }),
  });
  if (!res.ok) {
    throw new Error(`LLM 요청 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const text: string = data.generated_text ?? "";
  return text;
}

export async function generateAxPlan(
  userRequest: string,
  _endpointsInfo: string,
  _modelId?: string,
): Promise<string> {
  const res = await fetch("/api/llm/ax/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_request: userRequest, history: [] }),
  });
  if (!res.ok) {
    throw new Error(`LLM 플랜 생성 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.generated_text ?? "").trim();
}

export async function fixAxPlan(
  originalRequest: string,
  failedPlan: string,
  errorInfo: string,
  domain: AxDomain = "tax",
): Promise<string> {
  const res = await fetch("/api/llm/ax/fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      original_request: originalRequest,
      failed_plan: failedPlan,
      error_info: errorInfo,
      domain,
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM 플랜 수정 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.generated_text ?? "").trim();
}

export async function reportToQwen(
  success: boolean,
  resultJson: string,
  originalRequest: string,
  tableHtml: string = "",
  _modelId?: string,
): Promise<string> {
  const prompt = success
    ? buildSuccessPrompt(originalRequest, resultJson, tableHtml)
    : buildFailurePrompt(originalRequest, resultJson);
  const text = await callGenerate(prompt, 512);
  // 서버는 생성된 텍스트만 반환하므로 slice 불필요
  return text.trim();
}

/* ------------------------------------------------------------------ */
/*  AX — 도메인별 endpoint 필터링                                       */
/* ------------------------------------------------------------------ */

export type AxDomain = "tax" | "welfare";

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

function buildEndpointInfo(domain: AxDomain): string {
  return Object.entries(FORMULA_RULES)
    .filter(([, meta]) => {
      if (domain === "tax") return meta.endpoint.startsWith("/api/tax/");
      if (domain === "welfare") return meta.endpoint.startsWith("/api/statutory/");
      return true;
    })
    .map(([key, meta]) => {
      const ins = meta.inputs.map((p) => `${p.name}: number`).join(", ");
      const outs = meta.outputs.map((p) => `${p.name}: number`).join(", ");
      return `- ${meta.endpoint} (rule: ${key}) → 입력 {${ins}}, 출력 {${outs}}`;
    })
    .join("\n");
}

/**
 * 멀티턴 AX 대화.
 * @returns AI 의 응답 문자열. JSON 플랜이 포함될 수 있음.
 */
export async function generateAxChatResponse(
  messages: ChatMessage[],
  domain: AxDomain = "tax",
  _modelId?: string,
): Promise<string> {
  // 마지막 메시지가 사용자 요청, 나머지는 history
  const userRequest = messages.filter((m) => m.role === "user").pop()?.content ?? "";
  const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("/api/llm/ax/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_request: userRequest, history, domain }),
  });
  if (!res.ok) {
    throw new Error(`LLM 요청 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.generated_text ?? "").trim();
}

/* ------------------------------------------------------------------ */
/*  Prompt builders                                                    */
/* ------------------------------------------------------------------ */

function buildPlanPrompt(userRequest: string, endpointsInfo: string): string {
  return `<|im_start|>system
너는 한국어 전문가이고, Spring Boot 기반의 복지 AX 서비스를 돕기 위한 웹 프로그래머야.

역할:
- 세법·복지·상속 분야의 산출식( formula )을 자동으로 연결하여 실행 플랜을 만든다.
- 사용자의 자연어 요청을 정확히 이해하고, 아래 제공된 사용 가능한 산출식 목록만 참고한다.
- 제공되지 않은 endpoint나 규칙은 절대 지어내지 않는다.

행동 지침:
1. 반드시 유효한 JSON 오브젝트만 출력한다. 설명 문장, 마크다운 코드 블록( \`\`\` ), 주석, 줄임표시(…), 또는 JSON 외 텍스트를 절대 포함하지 않는다.
2. 각 단계의 outputKey 는 전체 플랜 내에서 고유해야 한다.
3. inputs 의 값은 사용자 요청에서 직접 추출한 구체적인 숫자(예: 72000000)를 사용하며, 이전 단계 결과를 참조해야 할 경우에는 "__prev_<outputKey>__" 형태의 placeholder 를 사용할 수 있다. 단, 기본적으로는 직접 값을 넣는다.
4. method 는 기본적으로 "POST" 이다.
5. description 은 해당 단계가 무엇을 하는지 20자 이내 한국어로 요약한다.
6. 플랜은 사용자가 요청한 논리적 순서대로 배열한다.
7. 만약 사용자의 요청이 제공된 산출식으로 해결할 수 없다면, steps 를 빈 배열로 두고 message 필드에 "지원하지 않는 요청입니다."라고만 한다.

JSON 출력 형식:
{
  "steps": [
    {
      "endpoint": "/api/tax/earned-income-deduction",
      "method": "POST",
      "inputs": { "grossSalary": 72000000 },
      "outputKey": "earnedDeduction",
      "description": "근로소득공제 계산"
    }
  ]
}

사용 가능한 산출식 목록:
${endpointsInfo}
<|im_end|>
<|im_start|>user
${userRequest}
<|im_end|>
<|im_start|>assistant
`;
}

function buildSuccessPrompt(originalRequest: string, resultJson: string, tableHtml: string): string {
  return `<|im_start|>system
너는 세무 AX 리포터다. 아래 실행 결과를 받아서 깔끔한 HTML 테이블로 정리하여 출력한다.

행동 지침:
1. 출력은 반드시 유효한 HTML fragment(table 태그) 하나만. <html>, <head>, <body>는 금지.
2. table은 class="ax-report-table"를 가진다.
3. 아래 제공된 정확한 산출 결과 테이블의 값을 그대로 사용. 숫자는 절대 변경하지 마라.
4. 금액은 천 단위 구분자(,)와 "원" 단위를 붙인다.
5. 마크다운, 코드 블록(${"`"}${"`"}${"`"}), 설명 텍스트는 절대 포함하지 않는다.
6. HTML 태그는 <table>, <thead>, <tbody>, <tr>, <th>, <td>만 사용.
7. 사과나 변명은 금지.
<|im_end|>
<|im_start|>user
원래 요청: ${originalRequest}

정확한 산출 결과 테이블:
${tableHtml}

AX 실행 결과 JSON: ${resultJson}
<|im_end|>
<|im_start|>assistant
`;
}

function buildFailurePrompt(originalRequest: string, resultJson: string): string {
  return `<|im_start|>system
너는 세무 AX 리포터다. 아래 오류 정보를 받아서 깔끔한 HTML 테이블로 정리하여 출력한다.

행동 지침:
1. 출력은 반드시 유효한 HTML fragment(table 태그) 하나만. <html>, <head>, <body>는 금지.
2. table은 class="ax-report-table"를 가진다.
3. 실패한 step의 산출 단계, 항목, 오류 내용을 행으로 표시한다.
4. 마크다운, 코드 블록(${"`"}${"`"}${"`"}), 설명 텍스트는 절대 포함하지 않는다.
5. HTML 태그는 <table>, <thead>, <tbody>, <tr>, <th>, <td>만 사용.
<|im_end|>
<|im_start|>user
원래 요청: ${originalRequest}
AX 실패 정보: ${resultJson}
<|im_end|>
<|im_start|>assistant
`;
}

function buildAxChatPrompt(messages: ChatMessage[], domain: AxDomain = "tax"): string {
  const endpointsInfo = buildEndpointInfo(domain);
  const domainLabel = domain === "tax" ? "세무" : "복지";
  const domainDesc = domain === "tax" ? "세법 계산" : "복지 자격·급여 계산";

  const system = `<|im_start|>system
너는 ${domainLabel} AX다. 쓸데없는 말 하지 말고 필요한 것만 딱 말한다.

역할:
- ${domainDesc} 요청이 들어오면 제공된 산출식 목록만 사용해 JSON 플랜을 생성.
- 목록에 없는 endpoint나 규칙은 절대 지어내지 않음.
- 정보가 부족하면 직설적으로 묻는다.
- 일반 질문은 짧게 답변.

행동 지침:
1. 계산 요청 → JSON 플랜 출력.
2. 정보 부족 → 필요한 것을 직설적으로 질문.
3. 일반 질문 → 평문으로 짧게 답변.
4. JSON 플랜 형식:
{"steps":[{"endpoint":"/api/tax/earned-income-deduction","method":"POST","inputs":{"grossSalary":72000000},"outputKey":"earnedDed","description":"근로소득공제 계산"}]}
5. JSON 외 텍스트는 평문. 마크다운 코드 블록( \`\`\` ) 금지.
6. outputKey는 고유. inputs는 구체적인 숫자만.

사용 가능한 산출식 목록:
${endpointsInfo}
<|im_end|>`;

  const history = messages
    .map(
      (m) =>
        `<|im_start|>${m.role}\n${m.content}<|im_end|>`,
    )
    .join("\n");

  return `${system}\n${history}\n<|im_start|>assistant\n`;
}
