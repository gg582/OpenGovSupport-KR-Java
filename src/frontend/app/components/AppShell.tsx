"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import LNB from "./LNB";
import type { Feature } from "../lib/api";

export default function AppShell({
  features,
  children,
}: {
  features: Feature[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="bg-navy text-white sticky top-0 z-30 md:static">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button
              type="button"
              className="md:hidden -ml-2 p-2 rounded-sm hover:bg-white/10 focus:outline-none focus:shadow-focus"
              aria-label="메뉴 열기"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M3 5h14M3 10h14M3 15h14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <Link href="/" className="font-semibold tracking-tighter text-base truncate">
              사회복지 계산식 포털
            </Link>
            <span className="hidden md:inline text-[11px] text-white/60 font-mono">
              v1.0
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-5 text-sm text-white/85">
            <Link href="/" className="hover:text-white">
              전체 기능
            </Link>
            <Link href="/runtime" className="hover:text-white">
              런타임 상태
            </Link>
            <span className="opacity-50 cursor-not-allowed select-none" aria-disabled="true">
              도움말
            </span>
          </nav>
        </div>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <button
            type="button"
            aria-label="메뉴 닫기"
            className="absolute inset-0 bg-navy/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-[340px] bg-page shadow-xl flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between bg-navy text-white shrink-0">
              <span className="font-semibold tracking-tighter">기능 색인</span>
              <button
                type="button"
                aria-label="닫기"
                className="p-2 -mr-2 rounded-sm hover:bg-white/10 focus:outline-none focus:shadow-focus"
                onClick={() => setOpen(false)}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <LNB features={features} />
              <nav className="panel" aria-label="보조 메뉴">
                <div className="panel-header">기타</div>
                <ul className="py-1">
                  <li>
                    <Link
                      href="/runtime"
                      className="lnb-link"
                      aria-current={pathname === "/runtime" ? "page" : undefined}
                    >
                      <span>▣ 런타임 상태</span>
                    </Link>
                  </li>
                </ul>
              </nav>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-4 md:py-6 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 md:gap-6">
        <aside className="hidden md:block md:sticky md:top-6 md:self-start">
          <LNB features={features} />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-5 text-xs text-navy/60 flex flex-wrap gap-x-6 gap-y-1">
          <span>법령 기반 공개정보 산식</span>
          <span className="md:ml-auto">© 행정업무 보조 도구 · 일반 배포용</span>
        </div>
      </footer>
    </>
  );
}
