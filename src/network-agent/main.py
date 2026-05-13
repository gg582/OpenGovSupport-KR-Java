"""
network-agent
=============
LLM 이 생성한 AX 실행 플랜(JSON)을 해석하여 백엔드 API 를 순차 호출하고
결과를 집계·반환하는 서비스.

- ```json 블록 자동 추출
- __prev_<outputKey>__ / __prev_<outputKey>.field.sub__ placeholder 해석
- GET/POST/PUT/DELETE 및 기타 HTTP method 지원
"""

import json
import os
import re
from typing import Any, Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

BASE_URL = os.getenv("BASE_URL", "http://backend:8080").rstrip("/")
DEFAULT_TIMEOUT = int(os.getenv("DEFAULT_TIMEOUT", "30"))

app = FastAPI()


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
def _extract_json(text: str) -> Optional[dict]:
    """마크다운 코드 블록(```json ... ```) 또는 중괄호 최외곽 매칭으로 JSON 을 추출."""
    # 1) 코드 블록
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 2) 중괄호 최외곽
    m = re.search(r"(\{.*\})", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 3) 전체 문자열
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
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
# Endpoints
# ------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/execute", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest):
    base_url = (req.base_url or BASE_URL).rstrip("/")

    # ---------- steps 추출 ----------
    steps: list[dict] = []
    if req.steps:
        steps = req.steps
    elif req.plan:
        parsed = _extract_json(req.plan)
        if parsed and isinstance(parsed, dict):
            steps = parsed.get("steps", [])
        if not steps:
            return ExecuteResponse(
                success=False,
                results=[],
                message="플랜에서 steps 를 추출할 수 없습니다. plan 이 유효한 JSON 이거나 ```json 블록을 포함해야 합니다.",
            )
    else:
        return ExecuteResponse(
            success=False,
            results=[],
            message="'plan' (원본 문자열) 또는 'steps' (파싱된 배열) 중 하나는 필수입니다.",
        )

    results: list[dict] = []
    context: dict[str, Any] = {}  # outputKey -> response data

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        for idx, step in enumerate(steps):
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
