"""
network-agent
=============
LLM 이 생성한 AX 실행 플랜(JSON)을 해석하여 백엔드 API 를 순차 호출하고
결과를 집계·반환하는 서비스.

- ```json 블록 자동 추출
- __prev_<outputKey>__ / __prev_<outputKey>.field.sub__ placeholder 해석
- GET/POST/PUT/DELETE 및 기타 HTTP method 지원
- 플랜 sanity check + LLM feedback retry (최대 5회)
"""

import ast
import json
import os
import re
from typing import Any, Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

BASE_URL = os.getenv("BASE_URL", "http://backend:8080").rstrip("/")
DEFAULT_TIMEOUT = int(os.getenv("DEFAULT_TIMEOUT", "30"))
LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://llm:8000").rstrip("/")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))

app = FastAPI()

# ------------------------------------------------------------------
# Load endpoints spec for sanity-check
# ------------------------------------------------------------------
ENDPOINTS_SPEC_PATH = os.path.join(os.path.dirname(__file__), "endpoints_spec.json")
VALID_ENDPOINTS: set[str] = set()
try:
    with open(ENDPOINTS_SPEC_PATH, "r", encoding="utf-8") as f:
        spec = json.load(f)
    for ep in spec.get("endpoints", []):
        endpoint = ep.get("endpoint", "")
        if endpoint:
            VALID_ENDPOINTS.add(endpoint)
    print(f"[NetworkAgent] Loaded {len(VALID_ENDPOINTS)} endpoints from spec.", flush=True)
except Exception as e:
    print(f"[NetworkAgent] Warning: could not load endpoints_spec.json: {e}", flush=True)


# ------------------------------------------------------------------
# Models
# ------------------------------------------------------------------
class ExecuteRequest(BaseModel):
    plan: Optional[str] = None          # LLM 이 낸 원본 문자열 (markdown 가능)
    steps: Optional[list[dict]] = None  # 이미 파싱된 steps
    base_url: Optional[str] = None      # 오버라이드


class ExecuteResponse(BaseModel):
    success: bool
    results: list[dict]
    final_result: Optional[Any] = None
    message: str


# ------------------------------------------------------------------
# JSON / markdown 추출
# ------------------------------------------------------------------
def _repair_json(text: str) -> Optional[str]:
    """자주 발생하는 JSON 문법 오류를 자가 수정. 문자열 낶은 보존하며 문자열 바깥만 고친다."""
    if not text:
        return None

    # 1) 마크다운/코드 블록 제거
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    body = m.group(1).strip() if m else text.strip()

    # 2) 중괄호 최외곽 추출
    m = re.search(r"(\{.*\})", body, re.DOTALL)
    body = m.group(1).strip() if m else body

    # --- 문자열 보존 ---
    placeholders: dict[str, str] = {}
    counter = 0

    def _save(m: re.Match) -> str:
        nonlocal counter
        key = f"__STR_{counter:04d}__"
        counter += 1
        placeholders[key] = m.group(0)
        return key

    # double quote / single quote 문자열 각각 보존
    temp = re.sub(r'"(?:\\.|[^"\\])*"', _save, body)
    temp = re.sub(r"'(?:\\.|[^'\\])*'", _save, temp)

    # 3) 문자열 바깥 후처리
    # 주석 제거
    temp = re.sub(r"//.*?\n", "\n", temp)
    temp = re.sub(r"/\*.*?\*/", "", temp, flags=re.DOTALL)
    # 제어 문자 제거
    temp = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", temp)
    # Python 리터럴 -> JSON 리터럴
    temp = re.sub(r"\bTrue\b", "true", temp)
    temp = re.sub(r"\bFalse\b", "false", temp)
    temp = re.sub(r"\bNone\b", "null", temp)
    # unquoted key (identifier 형태)
    temp = re.sub(r"([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:", r'\1"\2":', temp)
    # missing comma 보정
    temp = re.sub(r"}\s*{", "},{", temp)
    temp = re.sub(r"}\s*\[", "},[", temp)
    temp = re.sub(r"]\s*{", "],{", temp)
    temp = re.sub(r"]\s*\[", "],[", temp)
    temp = re.sub(r'"\s*"', '","', temp)
    temp = re.sub(r'"\s*\{', '",{', temp)
    temp = re.sub(r'"\s*\[', '",[', temp)
    temp = re.sub(r"}\s*\"", '},"', temp)
    temp = re.sub(r"]\s*\"", '],"', temp)
    temp = re.sub(r":\s*\.(\d+)", r":0.\1", temp)   # .5 -> 0.5
    # trailing comma
    temp = re.sub(r",(\s*[}\]])", r"\1", temp)
    # 불완전 종료 보완
    open_braces = temp.count("{") - temp.count("}")
    open_brackets = temp.count("[") - temp.count("]")
    if open_braces > 0:
        temp += "}" * open_braces
    if open_brackets > 0:
        temp += "]" * open_brackets

    # --- 문자열 복원 ---
    for key, val in placeholders.items():
        temp = temp.replace(key, val)

    # single quote 복원: 남아있는 'key':'value' 형태를 "key":"value"로
    temp = re.sub(r"'([^']*?)'\s*:", r'"\1":', temp)
    temp = re.sub(r":\s*'([^']*?)'", r': "\1"', temp)

    return temp


def _extract_json(text: str) -> Optional[dict]:
    """마크다운 코드 블록(```json ... ```) 또는 중괄호 최외곽 매칭으로 JSON 을 추출.
    실패 시 자가 수정(repair) 및 ast.literal_eval fallback 을 시도한다."""
    if not text:
        return None

    candidates = []
    # 1) 코드 블록
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if m:
        candidates.append(m.group(1).strip())

    # 2) 중괄호 최외곽
    m = re.search(r"(\{.*\})", text, re.DOTALL)
    if m:
        candidates.append(m.group(1).strip())

    # 3) 전체 문자열
    candidates.append(text.strip())

    for raw in candidates:
        # 순수 JSON
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        # repair
        repaired = _repair_json(raw)
        if repaired:
            try:
                return json.loads(repaired)
            except json.JSONDecodeError:
                pass
        # ast.literal_eval fallback (Python dict/list literal 지원)
        try:
            m2 = re.search(r"(\{.*\})", raw, re.DOTALL)
            if m2:
                data = ast.literal_eval(m2.group(1))
                if isinstance(data, dict):
                    return json.loads(json.dumps(data))
        except Exception:
            pass
    return None


# ------------------------------------------------------------------
# 자연어 숫자 정규화 (조/억/만/천/백/십 등)
# ------------------------------------------------------------------
_KOREAN_UNITS = {
    "조": 10 ** 12,
    "천억": 10 ** 11,
    "백억": 10 ** 10,
    "십억": 10 ** 9,
    "억": 10 ** 8,
    "천만": 10 ** 7,
    "백만": 10 ** 6,
    "십만": 10 ** 5,
    "만": 10 ** 4,
    "천": 10 ** 3,
    "백": 10 ** 2,
    "십": 10 ** 1,
    "일": 1,
}


def normalize_korean_number(text: str) -> Any:
    """한국어 숫자 표현을 정수로 변환. 변환 불가 시 원본 반환.
    예: '5천만원' → 50000000, '1억 2천만' → 120000000
    """
    if not isinstance(text, str):
        return text

    # 공백/쉼표/통화·단위 접미사 제거
    s = text.replace(",", "").replace(" ", "").replace("원", "").replace("개", "").replace("명", "")

    # 이미 순수 숫자면 int 로
    if re.fullmatch(r"-?\d+", s):
        return int(s)

    # (숫자)(단위) 반복 매칭
    pattern = re.compile(r"(\d+)(조|천억|백억|십억|억|천만|백만|십만|만|천|백|십|일)")
    matches = pattern.findall(s)
    if not matches:
        return text  # 변환 불가 → 원본 유지

    total = 0
    for num_str, unit in matches:
        total += int(num_str) * _KOREAN_UNITS[unit]
    return total


def _normalize_inputs(value: Any) -> Any:
    """inputs 전체를 순회하며 문자열 값 중 한국어 숫자를 정규화."""
    if isinstance(value, str):
        return normalize_korean_number(value)
    if isinstance(value, dict):
        return {k: _normalize_inputs(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_inputs(item) for item in value]
    return value


# ------------------------------------------------------------------
# Placeholder 해석 (최대한 다양하게)
# ------------------------------------------------------------------
def _resolve_placeholders(value: Any, context: dict) -> Any:
    """
    context = { outputKey: response_data, ... }

    지원 패턴:
      - __prev_키__            → 이전 단계 전체 응답 객체
      - __prev_키.필드__       → dict 필드 1단계
      - __prev_키.a.b.0.c__   → 중첩 필드 + 리스트 인덱스
      - 문자열이 숫자 모양이면 int/float 로 캐스팅
    """
    if isinstance(value, str):
        # 전체 매칭: __prev_key__
        full = re.fullmatch(r"__prev_([a-zA-Z0-9_-]+)__", value)
        if full:
            key = full.group(1)
            resolved = context.get(key)
            if resolved is None:
                return value
            # 숫자 문자열이면 숫자 타입으로 변환
            if isinstance(resolved, str):
                if resolved.lstrip("-").replace(".", "", 1).isdigit():
                    return float(resolved) if "." in resolved else int(resolved)
            return resolved

        # 중첩 필드 매칭: __prev_key.path.to.field__
        nested = re.fullmatch(r"__prev_([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_.-]+))__", value)
        if nested:
            key = nested.group(1)
            path = nested.group(2).split(".")
            obj = context.get(key)
            for seg in path:
                if isinstance(obj, dict):
                    obj = obj.get(seg)
                elif isinstance(obj, list) and seg.isdigit():
                    idx = int(seg)
                    obj = obj[idx] if 0 <= idx < len(obj) else None
                else:
                    obj = None
                if obj is None:
                    break
            if obj is not None:
                return obj
        return value

    if isinstance(value, dict):
        return {k: _resolve_placeholders(v, context) for k, v in value.items()}

    if isinstance(value, list):
        return [_resolve_placeholders(item, context) for item in value]

    return value


# ------------------------------------------------------------------
# Sanity Check
# ------------------------------------------------------------------
_ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def _sanity_check_plan(steps: list[dict]) -> tuple[bool, str]:
    """플랜 구조/문법 sanity check.

    Returns:
        (ok, error_message)
    """
    if not isinstance(steps, list):
        return False, f"'steps' must be a list, got {type(steps).__name__}"

    # 빈 배열은 지원 불가 응답으로 간주 → 유효
    if len(steps) == 0:
        return True, ""

    output_keys: set[str] = set()

    for idx, step in enumerate(steps):
        if not isinstance(step, dict):
            return False, f"Step {idx} is not an object."

        # 필수 필드
        endpoint = step.get("endpoint")
        method = step.get("method", "POST")
        inputs = step.get("inputs", {})
        output_key = step.get("outputKey") or step.get("output_key")
        description = step.get("description", "")

        if not endpoint:
            return False, f"Step {idx}: 'endpoint' is missing."
        if not isinstance(endpoint, str):
            return False, f"Step {idx}: 'endpoint' must be a string."
        if not endpoint.startswith("/"):
            return False, f"Step {idx}: 'endpoint' must start with '/': {endpoint}"

        # endpoint가 spec에 있는지 확인 (spec 로드 실패 시 스킵)
        if VALID_ENDPOINTS and endpoint not in VALID_ENDPOINTS:
            return False, f"Step {idx}: unknown endpoint '{endpoint}'."

        method_str = (method or "POST").upper()
        if method_str not in _ALLOWED_METHODS:
            return False, f"Step {idx}: unsupported method '{method_str}'."

        if not isinstance(inputs, dict):
            return False, f"Step {idx}: 'inputs' must be an object."

        if not output_key:
            return False, f"Step {idx}: 'outputKey' is missing."
        if not isinstance(output_key, str):
            return False, f"Step {idx}: 'outputKey' must be a string."
        if output_key in output_keys:
            return False, f"Step {idx}: duplicate outputKey '{output_key}'."
        output_keys.add(output_key)

        if not isinstance(description, str):
            return False, f"Step {idx}: 'description' must be a string."

        # year 필드 범위 검사
        year = inputs.get("year")
        if year is not None:
            try:
                year_int = int(year)
                if not (1900 <= year_int <= 2100):
                    return False, f"Step {idx}: 'year' must be between 1900 and 2100, got {year}."
            except (ValueError, TypeError):
                return False, f"Step {idx}: 'year' must be an integer, got {year}."

        # placeholder 문법 기본 검사
        def _check_placeholders(v: Any, path: str = "inputs") -> Optional[str]:
            if isinstance(v, str):
                placeholders = re.findall(r"__prev_([a-zA-Z0-9_.-]+)__", v)
                for ph in placeholders:
                    # 중첩 경로는 절(.)으로 분리, 마지막은 키 이름
                    parts = ph.split(".")
                    key = parts[0]
                    if key == output_key:
                        return f"Step {idx}: placeholder '{v}' refers to its own outputKey '{key}' (circular)."
            elif isinstance(v, dict):
                for kk, vv in v.items():
                    err = _check_placeholders(vv, f"{path}.{kk}")
                    if err:
                        return err
            elif isinstance(v, list):
                for i, vv in enumerate(v):
                    err = _check_placeholders(vv, f"{path}[{i}]")
                    if err:
                        return err
            return None

        ph_err = _check_placeholders(inputs)
        if ph_err:
            return False, ph_err

    return True, ""


# ------------------------------------------------------------------
# LLM feedback (call /ax/fix)
# ------------------------------------------------------------------
async def _call_llm_fix(original_request: str, failed_plan: str, error_info: str) -> Optional[str]:
    """LLM Service 의 /ax/fix 를 호출하여 수정된 플랜을 받는다.
    network-agent는 규칙 기반 엄격 검증을 수행하므로, JSON 문법 오류나 스펙 위반은 즉시 거부된다."""
    strict_prefix = (
        "[NETWORK-AGENT STRICT VALIDATION]\n"
        "network-agent는 규칙 기반 엄격 검증을 수행합니다. "
        "잘못된 JSON 문법, 없는 endpoint, 누락된 필드, 잘못된 데이터 타입은 즉시 거부됩니다. "
        "반드시 유효한 JSON 객체에 'steps' 배엘만 포함하여 출력하세요. 다른 설명은 절대 넣지 마세요.\n\n"
    )
    payload = {
        "original_request": original_request,
        "failed_plan": failed_plan,
        "error_info": strict_prefix + error_info,
        "max_new_tokens": 512,
    }
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.post(f"{LLM_SERVICE_URL}/ax/fix", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("generated_text")
    except Exception as e:
        print(f"[NetworkAgent] LLM fix call failed: {e}", flush=True)
        return None


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/execute", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest):
    base_url = (req.base_url or BASE_URL).rstrip("/")

    # ---------- steps 추출 & sanity check with retry ----------
    raw_plan: Optional[str] = req.plan
    steps: Optional[list[dict]] = req.steps
    error_history: list[str] = []
    parsed_steps: list[dict] = []

    for attempt in range(1, MAX_RETRIES + 1):
        current_steps: list[dict] = []

        if steps is not None and attempt == 1:
            current_steps = steps
        elif raw_plan:
            parsed = _extract_json(raw_plan)
            if parsed is None:
                ok, err = False, "JSON 파싱 실패. 유효한 JSON 객체를 출력해야 합니다."
                current_steps = []
            elif not isinstance(parsed, dict):
                ok, err = False, f"JSON 루트는 객체(dict)여야 합니다. 현재: {type(parsed).__name__}"
                current_steps = []
            elif "steps" not in parsed:
                ok, err = False, "JSON에 'steps' 필드가 누락되었습니다."
                current_steps = []
            else:
                current_steps = parsed.get("steps", [])
                ok, err = _sanity_check_plan(current_steps)
            # ok/err이 위에서 새로 할당되었으면 바로 아래 if ok 로 점프
            if ok:
                parsed_steps = current_steps
                break
            # 오류 기록 후 피드백 루프로 진입 (아래 공통 코드와 합침)
            error_history.append(f"시도 {attempt}: {err}")
            print(f"[NetworkAgent] Sanity check failed (attempt {attempt}/{MAX_RETRIES}): {err}", flush=True)

            if attempt >= MAX_RETRIES:
                return ExecuteResponse(
                    success=False,
                    results=[],
                    message=f"Sanity check {MAX_RETRIES}회 실패. " + " | ".join(error_history),
                )

            failed_plan_text = raw_plan
            fix_context = err
            if error_history[:-1]:
                fix_context += "\n이전 오류:\n" + "\n".join(error_history[:-1])

            fixed_text = await _call_llm_fix(
                original_request="AX plan execution",
                failed_plan=failed_plan_text,
                error_info=fix_context,
            )
            if fixed_text:
                raw_plan = fixed_text
                steps = None
            else:
                return ExecuteResponse(
                    success=False,
                    results=[],
                    message=f"LLM fix 호출 실패 (attempt {attempt}). " + " | ".join(error_history),
                )
            continue
        else:
            return ExecuteResponse(
                success=False,
                results=[],
                message="'plan' (원본 문자열) 또는 'steps' (파싱된 배열) 중 하나는 필수입니다.",
            )

        ok, err = _sanity_check_plan(current_steps)
        if ok:
            parsed_steps = current_steps
            break

        error_history.append(f"시도 {attempt}: {err}")
        print(f"[NetworkAgent] Sanity check failed (attempt {attempt}/{MAX_RETRIES}): {err}", flush=True)

        if attempt >= MAX_RETRIES:
            return ExecuteResponse(
                success=False,
                results=[],
                message=f"Sanity check {MAX_RETRIES}회 실패. " + " | ".join(error_history),
            )

        # 피드백 → LLM fix 호출
        failed_plan_text = raw_plan or json.dumps({"steps": current_steps}, ensure_ascii=False)
        fix_context = err
        if error_history[:-1]:
            fix_context += "\n이전 오류:\n" + "\n".join(error_history[:-1])

        fixed_text = await _call_llm_fix(
            original_request="AX plan execution",
            failed_plan=failed_plan_text,
            error_info=fix_context,
        )
        if fixed_text:
            raw_plan = fixed_text
            steps = None
        else:
            # LLM fix 호출 실패 시 마지막 오류와 함께 중단
            return ExecuteResponse(
                success=False,
                results=[],
                message=f"LLM fix 호출 실패 (attempt {attempt}). " + " | ".join(error_history),
            )

    # ---------- 실행 ----------
    results: list[dict] = []
    context: dict[str, Any] = {}  # outputKey -> response data

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        for idx, step in enumerate(parsed_steps):
            endpoint = step.get("endpoint", "")
            method = (step.get("method", "POST") or "POST").upper()
            inputs = step.get("inputs", {})
            output_key = step.get("outputKey") or step.get("output_key")
            description = step.get("description", "")

            resolved_inputs = _resolve_placeholders(inputs, context)
            resolved_inputs = _normalize_inputs(resolved_inputs)
            url = f"{base_url}{endpoint}"

            try:
                if method == "GET":
                    resp = await client.get(url, params=resolved_inputs)
                elif method == "POST":
                    resp = await client.post(url, json=resolved_inputs)
                elif method == "PUT":
                    resp = await client.put(url, json=resolved_inputs)
                elif method == "PATCH":
                    resp = await client.patch(url, json=resolved_inputs)
                elif method == "DELETE":
                    resp = await client.delete(url, params=resolved_inputs)
                else:
                    resp = await client.request(method, url, json=resolved_inputs)

                resp.raise_for_status()
                ct = resp.headers.get("content-type", "")
                data = resp.json() if ct.startswith("application/json") else resp.text

            except httpx.HTTPStatusError as e:
                return ExecuteResponse(
                    success=False,
                    results=results + [{
                        "step": idx,
                        "endpoint": endpoint,
                        "description": description,
                        "error": f"HTTP {e.response.status_code}: {e.response.text}",
                        "status_code": e.response.status_code,
                    }],
                    message=f"Step {idx} 실패 ({endpoint}): HTTP {e.response.status_code}",
                )
            except Exception as e:
                return ExecuteResponse(
                    success=False,
                    results=results + [{
                        "step": idx,
                        "endpoint": endpoint,
                        "description": description,
                        "error": str(e),
                    }],
                    message=f"Step {idx} 실패 ({endpoint}): {e}",
                )

            if output_key:
                context[output_key] = data

            results.append({
                "step": idx,
                "endpoint": endpoint,
                "description": description,
                "status_code": resp.status_code,
                "output_key": output_key,
                "data": data,
            })

    final = results[-1]["data"] if results else None
    return ExecuteResponse(
        success=True,
        results=results,
        final_result=final,
        message="모든 단계 성공" if results else "실행할 단계가 없습니다.",
    )
