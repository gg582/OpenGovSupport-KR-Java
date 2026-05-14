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

MODEL_ID = os.getenv("MODEL_ID", "Qwen/Qwen2.5-1.5B-Instruct")
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
    # SLLM(1.5B)에 최적화: 단순 system + 다양한 Few-shot 패턴 + 핵심 규칙 반복
    system = f"""<|im_start|>system
너는 세법 계산 JSON 플랜 생성기야. 오직 유효한 JSON 객첼만 출력해야 한다. 설명, 마크다운, 주석, 줄임표를 절대 붙이지 마.

[생각 순서]
1. 숫자 추출: "5,000만원"→50000000, "1억 2천"→120000000. 쉼표,"원","만원"은 모두 제거하고 순수 정수만 남긴다.
2. 의도 분류: 사용자가 원하는 계산이 무엇인지 "사용 가능한 산출식 목록"에서 찾는다.
3. 상태 결정 후 JSON만 출력:

- 계산가능: 핵심 숫자가 명확하고 endpoint가 목록에 있거나 유사하면 바로 매칭한다.
  → "clarification_needed":false, steps:[{{"endpoint":"...","method":"POST","inputs":{{...}},"outputKey":"...","description":"..."}}]
- 정볼부족: 핵심 숫자(연봉·소득 등)나 필수 입력(year 등)이 누락됐다.
  → "clarification_needed":true, steps:[], "needed_fields":["필드명"], "message":"추가로 필요한 정보는 <필드>입니다."
- 지원불가: 세법 계산과 전혀 관련 없는 요청(날씨·요리·우주여행 등).
  → "clarification_needed":false, steps:[], "message":"지원하지 않는 요청입니다."

[검증]
- steps가 비고 clarification_needed가 false면 안 된다. 반드시 상태B 또는 C로 변경.
- needed_fields가 있으면 clarification_needed는 반드시 true.
- inputs에 쉼표나 "원" 문자가 남아 있으면 안 된다.

사용 가능한 산출식 목록:
{ENDPOINTS_SPEC_SUMMARY}
<|im_end|>"""

    # Few-shot: SLLM이 패턴을 확실히 모방하도록 성공/정볼부족/지원불가/정보과잉 모두 포함
    few_shots = """<|im_start|>user
연봉 5,000만원 직장인의 근로소득공제 금액을 알려줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":false,"steps":[{"endpoint":"/api/tax/earned-income-deduction","method":"POST","inputs":{"grossSalary":50000000},"outputKey":"earnedDed","description":"근로소득공제 계산"}]}<|im_end|>
<|im_start|>user
2024년 소득 1억 원인데 공제 다 계산해줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":false,"steps":[{"endpoint":"/api/tax/earned-income-deduction","method":"POST","inputs":{"grossSalary":100000000,"year":2024},"outputKey":"earnedDed","description":"근로소득공제 계산"}]}<|im_end|>
<|im_start|>user
근로소득공제 계산해줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":true,"steps":[],"needed_fields":["연봉(총급여)"],"message":"추가로 필요한 정보는 연봉(총급여)입니다."}<|im_end|>
<|im_start|>user
우주여행 비용 계산해줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":false,"steps":[],"message":"지원하지 않는 요청입니다."}<|im_end|>
<|im_start|>user
연봉 3300만원, 만 23세, 차량 없음, 10분위 가정의 세대원, 경기 거주, 군면제자인 사람 환급금 취합해줘<|im_end|>
<|im_start|>assistant
{"clarification_needed":true,"steps":[],"needed_fields":["연도","부양가족 수","기납부세액"],"message":"추가로 필요한 정보는 연도, 부양가족 수, 기납부세액입니다."}<|im_end|>"""

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
