import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "통합 계산 실행 대시보드 — 정부지원·세무 계산",
  description:
    "결정적 산식 그래프 — n8n 스타일 워크플로우 + draw.io 직교 라우팅 + 회계/세무 + 정부 룰 엔진. 모든 산식은 Java 백엔드에서 실행.",
};

export default function Page() {
  return <Dashboard />;
}
