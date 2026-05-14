from contextlib import asynccontextmanager
import os
import json
import asyncio
import re
from collections import OrderedDict

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
ENDPOINTS_SPEC_SUMMARY = ""
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


def _summarize_spec(spec_text: str) -> str:
    """43KB JSON 전체를 LLM 프롬프트에 넣으면 토큰이 폭발해 OOM/timeout 이 발생한다.
    endpoint/method/inputs/outputs 만 간결히 요약한다."""
    try:
        data = json.loads(spec_text)
        lines = []
        for ep in data.get("endpoints", []):
            ins = ", ".join(i.get("name", "") for i in ep.get("inputs", []))
            outs = ", ".join(o.get("name", "") for o in ep.get("outputs", []))
            lines.append(
                f"- {ep.get('endpoint', '')} [{ep.get('method', 'POST')}] "
                f"{ep.get('title', '')} → 입력({ins}) 출력({outs})"
            )
        return "\n".join(lines)
    except Exception:
        # fallback: raw JSON 앞부분만
        return spec_text[:1500]


ENDPOINTS_SPEC_SUMMARY = _summarize_spec(ENDPOINTS_SPEC)
print(f"[LLM] Endpoints spec: {len(ENDPOINTS_SPEC)} chars -> summary {len(ENDPOINTS_SPEC_SUMMARY)} chars", flush=True)

model = None
tokenizer = None

# ------------------------------------------------------------------
# 원시적·휘발적 인메모리 RAG 캐시 (토큰 과소비 방지)
# ------------------------------------------------------------------
GENERATION_CACHE: OrderedDict[str, str] = OrderedDict()
CACHE_MAX_SIZE = 50


def _cache_key(user_request: str, history_len: int = 0) -> str:
    """요청 텍스트를 정규화하여 캐시 키 생성."""
    normalized = re.sub(r"\s+", " ", user_request.strip().lower())
    return f"{history_len}:{normalized}"


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
    max_new_tokens: int = 512


class FixRequest(BaseModel):
    original_request: str
    failed_plan: str
    error_info: str
    max_new_tokens: int = 512


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
        # SLLM이 지정된 형식에서 벗어나지 않도록 EOS 토큰을 강제
        eos_token_id=tokenizer.encode("<|im_end|>", add_special_tokens=False)[0]
        if tokenizer.encode("<|im_end|>", add_special_tokens=False)
        else None,
        pad_token_id=tokenizer.pad_token_id,
    )
    # 입력 토큰 길이 이후의 토큰만 디코딩 (문자열 길이로 자륾면 토큰/문자 불일치로 결과가 망가짐)
    input_length = inputs.input_ids.shape[1]
    new_tokens = outputs[0][input_length:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)


async def _generate_async(prompt: str, max_new_tokens: int) -> str:
    """CPU 집약적인 ONNX generate 를 이벤트 루프를 블록하지 않도록 별도 스레드에서 실행."""
    return await asyncio.to_thread(_generate, prompt, max_new_tokens)


@app.post("/generate")
async def generate(req: GenerateRequest):
    generated_text = await _generate_async(req.prompt, req.max_new_tokens)
    return {"generated_text": generated_text}


def _build_plan_prompt(user_request: str, history: list[ChatMessage]) -> str:
    # 근본적인 추론(리즈닝) 구조를 강제: 상태 결정 → 자기검증 → JSON 출력
    system = f"""<|im_start|>system
너는 세법 계산 JSON 플랜 생성기야. 오직 유효한 JSON 객첼만 출력해야 한다.

[추론 프로토콜 - 반드시 이 순서로 사고한 뒤 JSON을 출력]
1. 입력 파싱: 사용자 문장에서 숫자와 연도를 추출한다.
   - "5,000만원", "5000만원" → 50000000
   - "1억 2천만원" → 120000000
   - "원", ",", "만원" 등의 문자는 모두 제거하고 정수만 남긴다.
2. 의도 분류: 사용자가 원하는 계산이 무엇인지 "사용 가능한 산출식 목록"에서 찾는다.
3. 상태 결정: 아래 3가지 상태 중 정확히 하나만 선택한다. 절대 두 개 이상의 상태를 혼용하지 않는다.

[상태A - 계산가능]
조건: 핵심 숫자(예: 연봉)가 명확히 추출되었고, 해당하는 endpoint가 목록에 존재한다.
출력 규칙:
- "clarification_needed": false  (반드시 false)
- "steps": [{{"endpoint":"...","method":"POST","inputs":{{...}},"outputKey":"...","description":"..."}}]  (1개 이상)
- "needed_fields"는 절대 포함하지 않는다.

[상태B - 정볼부족]
조건: 핵심 숫자(연봉, 소득 등)가 없거나, endpoint에 필요한 필수 입력(예: year)이 누락되었다.
출력 규칙:
- "clarification_needed": true  (반드시 true)
- "steps": []  (반드시 빈 배열)
- "needed_fields": ["누락된필드1", "누락된필드2"]  (필수)
- "message": "추가로 필요한 정보는 <필드>입니다."

[상태C - 지원불가]
조건: 세법 계산과 전혀 관련 없는 요청(예: 날씨, 요리, 우주여행)이다.
출력 규칙:
- "clarification_needed": false
- "steps": []  (반드시 빈 배열)
- "message": "지원하지 않는 요청입니다."
- "needed_fields"는 절대 포함하지 않는다.

[자기검증 체크리스트 - JSON 출력 직전에 스스로 확인]
□ steps가 비어 있고 clarification_needed가 false인가? → 금지. 상태B 또는 C로 재분류.
□ needed_fields가 있는데 clarification_needed가 false인가? → 금지. 반드시 true로 수정.
□ steps가 1개 이상인데 clarification_needed가 true인가? → 금지. 반드시 false로 수정.
□ endpoint가 "사용 가능한 산출식 목록"에 없는가? → 금지. 유사한 항목으로 매칭하거나 상태C로 처리.
□ inputs에 쉼표(,)나 "원" 같은 문자가 남아 있는가? → 금지. 순수 정수만 사용.

[금지 사항]
- JSON 앞뒤에 설명, 마크다운, 주석, 줄임표를 붙이지 않는다.
- "가장 유사한 항목으로 가정해서 진행하시겠습니까?" 같은 모호한 message를 상태A에서 사용하지 않는다. 상태A는 바로 계산한다.
- 상태B에서 "이대로 진행해도 될까요?"라고 묻지 않는다. 대신 "추가로 필요한 정보는 ...입니다"라고 명확히 요구한다.

사용 가능한 산출식 목록:
{ENDPOINTS_SPEC_SUMMARY}
<|im_end|>"""

    # Few-shot은 최소화: 성공 케이스 1개, 정볼부족 케이스 1개
    few_shots = """<|im_start|>user
연봉 5,000만원 직장인의 근로소득공제 금액을 알려줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":false,"steps":[{"endpoint":"/api/tax/earned-income-deduction","method":"POST","inputs":{"grossSalary":50000000},"outputKey":"earnedDed","description":"근로소득공제 계산"}]}<|im_end|>
<|im_start|>user
근로소득공제 계산해줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":true,"steps":[],"needed_fields":["연봉(총급여)"],"message":"추가로 필요한 정보는 연봉(총급여)입니다."}<|im_end|>"""

    lines = []
    for m in history:
        lines.append(f"<|im_start|>{m.role}\n{m.content}<|im_end|>")
    history_text = "\n".join(lines)

    return f"{system}\n{few_shots}\n{history_text}\n<|im_start|>user\n{user_request}<|im_end|>\n<|im_start|>assistant\n"


def _build_fix_prompt(original_request: str, failed_plan: str, error_info: str) -> str:
    system = f"""<|im_start|>system
너는 JSON 플랜 수정기야. 오직 수정된 유효한 JSON 객첼만 출력해야 한다. 절대 설명, 마크다운, 주석, 줄임표를 추가하지 마.

규칙:
1. 출력은 반드시 아래 형식의 JSON 객체 하나만이다. JSON 앞뒤에 어떤 텍스트도 올 수 없다.
2. 오류 원인을 분석하여 입력값, endpoint, method, outputKey, inputs 등을 수정한다.
3. 모든 입력값은 원(KRW) 단위 정수 숫자만 사용한다.
4. 제공되지 않은 endpoint나 규칙은 절대 지어내지 않는다.
5. 수정된 플랜만 출력한다.

JSON 형식:
{{"steps":[{{"endpoint":"/api/tax/earned-income-deduction","method":"POST","inputs":{{"grossSalary":72000000}},"outputKey":"earnedDed","description":"근로소득공제 계산"}}],"analysis":"오류 원인 요약"}}

사용 가능한 산출식 목록:
{ENDPOINTS_SPEC_SUMMARY}
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
async def ax_plan(req: PlanRequest):
    prompt = _build_plan_prompt(req.user_request, req.history)

    # 원시적 인메모리 캐시 조회
    cache_key = _cache_key(req.user_request, len(req.history))
    cached = GENERATION_CACHE.get(cache_key)
    if cached:
        print(f"[LLM] Cache hit {cache_key[:16]}...", flush=True)
        return {"generated_text": cached}

    generated_text = await _generate_async(prompt, req.max_new_tokens)
    result = generated_text.strip()

    # 캐시 저장 (LRU)
    GENERATION_CACHE[cache_key] = result
    if len(GENERATION_CACHE) > CACHE_MAX_SIZE:
        GENERATION_CACHE.popitem(last=False)

    return {"generated_text": result}


@app.post("/ax/fix")
async def ax_fix(req: FixRequest):
    prompt = _build_fix_prompt(req.original_request, req.failed_plan, req.error_info)
    generated_text = await _generate_async(prompt, req.max_new_tokens)
    result = generated_text.strip()
    return {"generated_text": result}
