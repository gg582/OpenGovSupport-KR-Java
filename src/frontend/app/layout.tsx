import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { listFeatures, type Feature } from "./lib/api";
import LNB from "./components/LNB";

export const metadata: Metadata = {
  title: "사회복지 계산식 포털",
  description: "사적이전소득 / 이자소득 / 재산상담 / 상속분 / 긴급공제 / 해외체류 등 자주 쓰이는 사회복지 계산을 웹에서 직접 실행합니다.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let features: Feature[] = [];
  try {
    features = await listFeatures();
  } catch {
    // backend unreachable — render empty LNB; pages will surface the error
  }

  return (
    <html lang="ko">
      <body>
        <header className="bg-navy text-white">
          <div className="mx-auto max-w-[1400px] px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="font-semibold tracking-tighter text-base">
                사회복지 계산식 포털
              </Link>
              <span className="text-[11px] text-white/60 font-mono">v1.0 / Go · Next.js</span>
            </div>
            <nav className="flex items-center gap-5 text-sm text-white/85">
              <Link href="/" className="hover:text-white">전체 기능</Link>
              <Link href="/runtime" className="hover:text-white">런타임 상태</Link>
              <span className="opacity-50 cursor-not-allowed select-none" aria-disabled="true">도움말</span>
            </nav>
          </div>
        </header>

        <div className="mx-auto max-w-[1400px] px-6 py-6 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
          <aside className="md:sticky md:top-6 md:self-start">
            <LNB features={features} />
          </aside>
          <main className="min-w-0">{children}</main>
        </div>

        <footer className="border-t border-line bg-white">
          <div className="mx-auto max-w-[1400px] px-6 py-5 text-xs text-navy/60 flex flex-wrap gap-x-6 gap-y-1">
            <span>법령 기반 공개정보 산식</span>
            <span>백엔드: Go (net/http) · 워커풀 + 코얼레서</span>
            <span>프런트엔드: Next.js (App Router) · Tailwind</span>
            <span className="ml-auto">© 행정업무 보조 도구 · 일반 배포용</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
