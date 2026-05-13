from contextlib import asynccontextmanager
import os
import json

from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForCausalLM

MODEL_ID = os.getenv("MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct")
HF_TOKEN = os.getenv("HF_TOKEN")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8080")

# Load endpoints spec
ENDPOINTS_SPEC_PATH = os.path.join(os.path.dirname(__file__), "endpoints_spec.json")
ENDPOINTS_SPEC = ""
try:
    with open(ENDPOINTS_SPEC_PATH, "r", encoding="utf-8") as f:
        ENDPOINTS_SPEC = f.read().replace("${BASE_URL}", BASE_URL)
except Exception as e:
    print(f"[LLM] Warning: could not load endpoints_spec.json: {e}", flush=True)
    ENDPOINTS_SPEC = json.dumps(
        {
            "base_url": BASE_URL,
            "note": "ENDPOINTS_SPEC not loaded",
            "endpoints": [],
        },
        ensure_ascii=False,
    )

model = None
tokenizer = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, tokenizer
    print(f"[LLM] Loading model {MODEL_ID} …", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID, token=HF_TOKEN, trust_remote_code=True
    )
    model = ORTModelForCausalLM.from_pretrained(
        MODEL_ID, token=HF_TOKEN, trust_remote_code=True
    )
    print("[LLM] Model loaded.", flush=True)
    yield
    print("[LLM] Shutting down.", flush=True)


app = FastAPI(lifespan=lifespan)


class GenerateRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 512


class ChatMessage(BaseModel):
    role: str
    content: str


class PlanRequest(BaseModel):
    user_request: str
    history: list[ChatMessage] = []
    max_new_tokens: int = 1024


class FixRequest(BaseModel):
    original_request: str
    failed_plan: str
    error_info: str
    max_new_tokens: int = 1024


@app.get("/health")
def health():
    if model is None or tokenizer is None:
        return {"status": "loading"}
    return {"status": "ok"}


def _generate(prompt: str, max_new_tokens: int) -> str:
    inputs = tokenizer(prompt, return_tensors="pt")
    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=False,
    )
    # 입력 토큰 길이 이후의 토큰만 디코딩 (문자열 길이로 자륍면 토큰/문자 불일치로 결과가 망가짐)
    input_length = inputs.input_ids.shape[1]
    new_tokens = outputs[0][input_length:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)


@app.post("/generate")
def generate(req: GenerateRequest):
    generated_text = _generate(req.prompt, req.max_new_tokens)
    return {"generated_text": generated_text}


def _build_plan_prompt(user_request: str, history: list[ChatMessage]) -> str:
    system = f"""<|im_start|>system
너는 한국어 전문가이고, Spring Boot 기반의 복지 AX 서비스를 돕기 위한 웹 프로그래머야.

역할:
- 세법·복지·상속 분야의 산출식(formula)을 자동으로 연결하여 실행 플랜을 만든다.
- 사용자의 자연어 요청을 정확히 이해하고, 아래 제공된 사용 가능한 산출식 목록만 참고한다.
- 제공되지 않은 endpoint나 규칙은 절대 지어내지 않는다.

기본 URL: {BASE_URL}

행동 지침:
1. 반드시 유효한 JSON 오브젝트만 출력한다. 설명 문장, 마크다운 코드 블록( ``` ), 주석, 줄임표시(…), 또는 JSON 외 텍스트를 절대 포함하지 않는다.
2. 각 단계의 outputKey는 전체 플랜 내에서 고유해야 한다.
3. inputs의 값은 사용자 요청에서 직접 추출한 구체적인 숫자(예: 72000000)를 사용하며, 이전 단계 결과를 참조해야 할 경우에는 "__prev_<outputKey>__" 형태의 placeholder를 사용할 수 있다. 단, 기본적으로는 직접 값을 넣는다.
4. method는 기본적으로 "POST"이다.
5. description은 해당 단계가 무엇을 하는지 20자 이내 한국어로 요약한다.
6. 플랜은 사용자가 요청한 논리적 순서대로 배열한다.
7. 모든 입력값은 원(KRW) 단위의 숫자로 사용한다. 쉼표나 "원" 문자열은 제외한다.
8. year 필드는 기본적으로 생략 가능하며, 생략 시 2025가 기본값이다. 특정 연도를 명시해야 할 때만 포함한다.
9. 만약 사용자의 요청이 제공된 산출식으로 해결할 수 없다면, steps를 빈 배열로 두고 message 필드에 "지원하지 않는 요청입니다."라고만 한다.

JSON 출력 형식:
{{
  "steps": [
    {{
      "endpoint": "/api/tax/earned-income-deduction",
      "method": "POST",
      "inputs": {{ "grossSalary": 72000000 }},
      "outputKey": "earnedDeduction",
      "description": "근로소득공제 계산"
    }}
  ]
}}

사용 가능한 산출식 목록:
{ENDPOINTS_SPEC}
<|im_end|>"""

    lines = []
    for m in history:
        lines.append(f"<|im_start|>{m.role}\n{m.content}<|im_end|>")
    history_text = "\n".join(lines)
    return f"{system}\n{history_text}\n<|im_start|>user\n{user_request}<|im_end|>\n<|im_start|>assistant\n"


def _build_fix_prompt(original_request: str, failed_plan: str, error_info: str) -> str:
    system = f"""<|im_start|>system
너는 한국어 전문가이고, Spring Boot 기반의 복지 AX 서비스를 돕기 위한 웹 프로그래머야.

역할:
- 이전에 생성한 AX 실행 플랜이 실패했을 때, 오류 원인을 분석하고 수정된 플랜을 생성한다.
- 절대 새로운 endpoint나 규칙을 지어내지 않는다.

기본 URL: {BASE_URL}

행동 지침:
1. 반드시 유효한 JSON 오브젝트만 출력한다.
2. 오류 원인을 분석하고, 입력값이 잘못되었으면 올바른 값으로 수정한다.
3. endpoint가 잘못되었으면 올바른 endpoint로 수정한다.
4. 입력값 타입이나 누락된 필드를 확인한다. 특히 year는 선택이나, 다른 필수 필드가 누락되지 않았는지 확인한다.
5. 모든 입력값은 원(KRW) 단위의 숫자로 사용한다. 쉼표나 "원" 문자열은 제외한다.
6. 수정된 플랜만 출력한다.

JSON 출력 형식:
{{
  "steps": [
    {{
      "endpoint": "/api/tax/earned-income-deduction",
      "method": "POST",
      "inputs": {{ "grossSalary": 72000000 }},
      "outputKey": "earnedDeduction",
      "description": "근로소득공제 계산"
    }}
  ],
  "analysis": "오류 원인 요약 (한 문장)"
}}

사용 가능한 산출식 목록:
{ENDPOINTS_SPEC}
<|im_end|>"""

    return f"""{system}
<|im_start|>user
원래 요청: {original_request}
실패한 플랜: {failed_plan}
오류 정보: {error_info}
<|im_end|>
<|im_start|>assistant
"""


@app.post("/ax/plan")
def ax_plan(req: PlanRequest):
    prompt = _build_plan_prompt(req.user_request, req.history)
    generated_text = _generate(prompt, req.max_new_tokens)
    result = generated_text.strip()
    return {"generated_text": result}


@app.post("/ax/fix")
def ax_fix(req: FixRequest):
    prompt = _build_fix_prompt(req.original_request, req.failed_plan, req.error_info)
    generated_text = _generate(prompt, req.max_new_tokens)
    result = generated_text.strip()
    return {"generated_text": result}
