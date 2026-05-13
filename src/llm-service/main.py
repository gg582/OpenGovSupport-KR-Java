from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForCausalLM

MODEL_ID = os.getenv("MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct")
HF_TOKEN = os.getenv("HF_TOKEN")

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


@app.get("/health")
def health():
    if model is None or tokenizer is None:
        return {"status": "loading"}
    return {"status": "ok"}


@app.post("/generate")
def generate(req: GenerateRequest):
    inputs = tokenizer(req.prompt, return_tensors="pt")
    outputs = model.generate(
        **inputs, max_new_tokens=req.max_new_tokens, do_sample=False
    )
    generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return {"generated_text": generated_text}
