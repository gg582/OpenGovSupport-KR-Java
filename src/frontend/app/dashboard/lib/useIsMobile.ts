"use client";

import { useEffect, useState } from "react";

/**
 * 모바일 판정 훅.
 *
 * 폭이 좁거나 (~767px 이하) 포인터가 거친(coarse) 환경이면 모바일로 본다.
 * SSR 단계에서는 false 를 반환해 데스크톱 마크업이 우선 hydrate 되도록 함.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const widthMq = window.matchMedia("(max-width: 767px)");
    const pointerMq = window.matchMedia("(pointer: coarse)");

    const update = () => {
      // 폭 + (좁거나 거친 포인터) 조합. 태블릿 가로 화면처럼
      // 폭은 충분하지만 터치 입력만 가능한 케이스도 모바일로 취급.
      setIsMobile(widthMq.matches || (pointerMq.matches && window.innerWidth < 1024));
    };
    update();

    widthMq.addEventListener("change", update);
    pointerMq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      widthMq.removeEventListener("change", update);
      pointerMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return isMobile;
}
