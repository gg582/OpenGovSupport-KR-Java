// Node 런타임 — Edge 런타임의 cross-origin rewrite 제약을 우회한다.
// 데스크톱(Electron) 모드에서 Java 백엔드는 임의 포트에 떠 있고 BACKEND_URL 로 주입되는데,
// 미들웨어의 NextResponse.rewrite() 는 Next 14 standalone + cross-origin 조합에서 500 을 토하므로
// 명시적 fetch 프록시로 대체한다.

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backendBase(): string {
  return process.env.BACKEND_URL || "http://localhost:8080";
}

async function proxy(req: NextRequest): Promise<Response> {
  const inUrl = new URL(req.url);
  const target = new URL(inUrl.pathname + inUrl.search, backendBase());

  // hop-by-hop 헤더와 Next 내부 헤더는 제거.
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === "host" ||
      k === "connection" ||
      k === "content-length" ||
      k === "transfer-encoding" ||
      k.startsWith("x-middleware-") ||
      k.startsWith("x-invoke-")
    ) return;
    headers.set(key, value);
  });

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
    // @ts-expect-error — undici 전용
    duplex: "half",
  };

  const upstream = await fetch(target, init);

  // 응답 헤더에서도 hop-by-hop 제거.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === "transfer-encoding" ||
      k === "connection" ||
      k === "keep-alive"
    ) return;
    respHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
