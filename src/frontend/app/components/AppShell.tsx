"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import LNB from "./LNB";
import { SECTIONS, sectionOf, type Feature } from "../lib/api";
import { useGraphStore } from "../dashboard/lib/store";

export default function AppShell({
  features,
  children,
}: {
  features: Feature[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const uiMode = useGraphStore((s) => s.uiMode);
  const setUIMode = useGraphStore((s) => s.setUIMode);
  const isDashboard = pathname === "/dashboard";

  // Initialize section based on URL, but allow it to persist across feature navigations
  const [currentSection, setCurrentSection] = useState<"welfare" | "tax">(sectionOf(pathname));

  useEffect(() => {
    setOpen(false);
    // Only update section state if we explicitly navigated to a section root
    if (pathname === "/tax") setCurrentSection("tax");
    else if (pathname === "/welfare") setCurrentSection("welfare");
    else if (pathname === "/") setCurrentSection("tax"); // default
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
              정부지원·세무 계산
            </Link>
          </div>
          <nav className="hidden md:flex items-center gap-5 text-sm text-white/85">
            {SECTIONS.map((s) => {
              const active = currentSection === s.key;
              return (
                <Link
                  key={s.key}
                  href={s.href}
                  onClick={() => setCurrentSection(s.key)}
                  className={
                    active
                      ? "text-white border-b-2 border-white pb-3 -mb-3"
                      : "hover:text-white"
                  }
                  aria-current={active ? "page" : undefined}
                >
                  {s.label}
                </Link>
              );
            })}
            <span className="opacity-30">|</span>
            <Link href="/dashboard" className="hover:text-white">
              실행 대시보드
            </Link>
            <Link href="/runtime" className="hover:text-white">
              런타임 상태
            </Link>
            {isDashboard && (
              <>
                <span className="opacity-30">|</span>
                <button
                  type="button"
                  onClick={() => setUIMode("easy")}
                  className={uiMode === "easy" ? "text-white border-b-2 border-white pb-3 -mb-3" : "hover:text-white"}
                >
                  쉬운 모드
                </button>
                <button
                  type="button"
                  onClick={() => setUIMode("expert")}
                  className={uiMode === "expert" ? "text-white border-b-2 border-white pb-3 -mb-3" : "hover:text-white"}
                >
                  전문가 모드
                </button>
              </>
            )}
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
              <nav className="panel" aria-label="섹션 전환">
                <div className="panel-header">섹션</div>
                <ul className="py-1">
                  {SECTIONS.map((s) => (
                    <li key={s.key}>
                      <Link
                        href={s.href}
                        onClick={() => setCurrentSection(s.key)}
                        className="lnb-link"
                        aria-current={currentSection === s.key ? "page" : undefined}
                      >
                        <span>▣ {s.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <LNB features={features} section={currentSection} />
              <nav className="panel" aria-label="보조 메뉴">
                <div className="panel-header">기타</div>
                <ul className="py-1">
                  <li>
                    <Link
                      href="/dashboard"
                      className="lnb-link"
                      aria-current={pathname === "/dashboard" ? "page" : undefined}
                    >
                      <span>▣ 실행 대시보드</span>
                    </Link>
                  </li>
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
              {pathname === "/dashboard" && (
                <nav className="panel" aria-label="UI 모드 전환">
                  <div className="panel-header">모드</div>
                  <ul className="py-1">
                    <li>
                      <button
                        type="button"
                        className="lnb-link w-full text-left"
                        onClick={() => setUIMode("easy")}
                        aria-current={uiMode === "easy" ? "page" : undefined}
                      >
                        <span>{uiMode === "easy" ? "▣ 쉬운 모드" : "쉬운 모드"}</span>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="lnb-link w-full text-left"
                        onClick={() => setUIMode("expert")}
                        aria-current={uiMode === "expert" ? "page" : undefined}
                      >
                        <span>{uiMode === "expert" ? "▣ 전문가 모드" : "전문가 모드"}</span>
                      </button>
                    </li>
                  </ul>
                </nav>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-4 md:py-6 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 md:gap-6">
        <aside className="hidden md:block md:sticky md:top-6 md:self-start">
          <LNB features={features} section={currentSection} />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-5 text-xs text-navy/60 space-y-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>법령 기반 공개정보 산식</span>
            <span className="md:ml-auto">© 행정업무 보조 도구 · 일반 배포용</span>
          </div>
          <div className="text-navy/65 leading-relaxed">
            <strong>면책 고지.</strong> 본 사이트는 세무사·세무대리 행위를 수행하지 않으며,
            산출 결과의 정확성·완전성·최신성을 보증하지 않습니다. 산식 자체는 「소득세법」
            「법인세법」「상속세 및 증여세법」「부가가치세법」「국민기초생활보장법」「조세특례제한법」 등
            공개 법령에 근거하나, 케이스별 적용 여부와 예외 처리는 사용자가 직접 확인해야 합니다.
          </div>
          <div className="text-navy/65 leading-relaxed">
            산출 결과는 신고·납부·수급의 효력을 갖지 않습니다. 실제 신고는 반드시
            홈택스(국세청) / 복지로(보건복지부) / 정부24 / 세무전문가를 통해 확정하시기 바랍니다.
          </div>
        </div>
      </footer>
    </>
  );
}
