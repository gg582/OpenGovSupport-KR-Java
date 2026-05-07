import "./globals.css";
import type { Metadata, Viewport } from "next";
import { listFeatures, type Feature } from "./lib/api";
import AppShell from "./components/AppShell";

export const metadata: Metadata = {
  title: "정부지원·세무 계산",
  description: "사회복지(중위소득·기초연금·재산변동·해외체류 등)와 개인세무(연말정산·종합소득세·세액공제) 산식을 법령 그대로 코드로 평가합니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        <AppShell features={features}>{children}</AppShell>
      </body>
    </html>
  );
}
