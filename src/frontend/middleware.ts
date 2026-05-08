import { NextRequest, NextResponse } from "next/server";

// 데스크톱(Electron) 모드에서는 백엔드가 임의 포트에서 뜨고 BACKEND_URL 로 주입된다.
// next.config 의 rewrites 는 빌드 시점 destination 이 박혀버리므로, 런타임에 env 를
// 매 요청 읽어 프록시하는 미들웨어로 처리한다.
export function middleware(req: NextRequest): NextResponse {
  const backend = process.env.BACKEND_URL || "http://localhost:8080";
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, backend);
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: ["/api/:path*"],
};
