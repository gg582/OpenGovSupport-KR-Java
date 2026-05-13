/**
 * WebGPU 기반 브라우저 남아 Qwen 실행 클라이언트.
 *
 * <p>@huggingface/transformers 를 npm 에서 import 하지 않고
 * 런타임 CDN 로드로 번들링 문제를 완전히 회피한다.
 * 이 파일만 삭제하면 AX 모듈 전체를 쉽게 제거할 수 있다.</p>
 */

declare global {
  interface Window {
    transformers?: any;
  }
}

const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js";

let generator: any = null;
let loading = false;

export function isQwenLoading(): boolean {
  return loading;
}

async function loadTransformersFromCDN(): Promise<any> {
  if (window.transformers) return window.transformers;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TRANSFORMERS_CDN;
    script.async = true;
    script.onload = () => resolve(window.transformers);
    script.onerror = () => reject(new Error("Transformers.js CDN 로드 실패"));
    document.head.appendChild(script);
  });
}

export async function loadQwen(modelId = "onnx-community/Qwen2.5-1.5B-ONNX") {
  if (generator) return generator;
  loading = true;
  try {
    const { pipeline, env } = await loadTransformersFromCDN();
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    generator = await pipeline("text-generation", modelId, {
      device: "webgpu",
      dtype: "q4",
    });
    return generator;
  } finally {
    loading = false;
  }
}

export async function generateAxPlan(
  userRequest: string,
  endpointsInfo: string,
  modelId?: string,
): Promise<string> {
  const gen = await loadQwen(modelId);
  const prompt = buildPlanPrompt(userRequest, endpointsInfo);
  const output = await gen(prompt, {
    max_new_tokens: 1024,
    do_sample: false,
  });
  const text: string = output[0]?.generated_text ?? "";
  return text.slice(prompt.length).trim();
}

export async function reportToQwen(
  success: boolean,
  resultJson: string,
  originalRequest: string,
  modelId?: string,
): Promise<string> {
  const gen = await loadQwen(modelId);
  const prompt = success
    ? buildSuccessPrompt(originalRequest, resultJson)
    : buildFailurePrompt(originalRequest, resultJson);
  const output = await gen(prompt, { max_new_tokens: 512, do_sample: false });
  const text: string = output[0]?.generated_text ?? "";
  return text.slice(prompt.length).trim();
}

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

function buildSuccessPrompt(originalRequest: string, resultJson: string): string {
  return `<|im_start|>system
너는 한국어 전문가이고, Spring Boot 기반의 복지 AX 서비스를 돕기 위한 웹 프로그래머야.

역할:
- 세법·복지·상속 산출이 성공적으로 완료된 결과를 받아, 일반 사용자(비전문가)가 이해할 수 있게 친절하게 설명한다.

행동 지침:
1. 먼저 사용자의 원래 요청을 짧게 요약한다.
2. 주요 산출 결과(금액)는 천 단위 구분자(,)와 "원" 단위를 붙여 명확히 표시한다.
3. 계산 과정의 핵심 단계를 1~3문장으로 간결히 설명한다.
4. 관련 법령 근거가 있으면 한 줄로 언급한다.
5. 추가로 확인하면 좋을 사항(예: 기준 연도, 지방소득세 별도 등)이 있다면 짧게 덧붙인다.
6. 전문 용어는 괄호 안에 쉬운 풀이를 함께 제시한다.
7. 출력은 마크다운 없이 평문으로 한다.
<|im_end|>
<|im_start|>user
원래 요청: ${originalRequest}
AX 실행 결과: ${resultJson}
<|im_end|>
<|im_start|>assistant
`;
}

function buildFailurePrompt(originalRequest: string, resultJson: string): string {
  return `<|im_start|>system
너는 한국어 전문가이고, Spring Boot 기반의 복지 AX 서비스를 돕기 위한 웹 프로그래머야.

역할:
- 세법·복지·상속 산출 과정에서 오류가 발생했을 때, 사용자가 원인을 이해하고 다시 시도할 수 있도록 안내한다.

행동 지침:
1. 먼저 결과를 받아 정중하게 실패 사실을 알린다.
2. 실패 원인을 구체적으로 분석한다(예: 입력값 누락, 잘못된 자료형, 지원하지 않는 항목).
3. 사용자가 직접 수정하거나 확인할 수 있는 구체적인 방법을 단계별로 제시한다.
4. 재시도를 위한 팁(예: 입력값 단위 확인, 연도 선택 확인)을 덧붙인다.
5. 필요 시 대체 접근법(예: 관련 산출식 직접 사용)을 간단히 제안한다.
6. 출력은 마크다운 없이 평문으로 한다.
<|im_end|>
<|im_start|>user
원래 요청: ${originalRequest}
AX 실패 정보: ${resultJson}
<|im_end|>
<|im_start|>assistant
`;
}
