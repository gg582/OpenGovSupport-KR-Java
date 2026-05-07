import { listFeatures, type Feature } from "../lib/api";
import SectionListing from "../components/SectionListing";

export const dynamic = "force-dynamic";

export default async function WelfarePage() {
  let features: Feature[] = [];
  let error: string | null = null;
  try {
    features = await listFeatures();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      {error && (
        <div className="panel border-red-300 bg-red-50 mb-6">
          <div className="panel-header text-red-700">백엔드 연결 실패</div>
          <div className="px-4 py-3 text-sm text-red-700 font-mono">{error}</div>
        </div>
      )}
      <SectionListing
        features={features}
        section="welfare"
        title="사회복지 — 안내"
        intro={{
          purpose:
            "「국민기초생활보장법」·「기초연금법」 등 사회복지 행정에서 자주 쓰이는 계산을 한 화면에서 실행합니다.",
          basis:
            "기준 중위소득·기초연금·차감율·법정 상속분 등 보건복지부 고시 및 법령상 공개 수치를 폼 기본값으로 자동 채워주며, 케이스에 따라 직접 보정할 수 있습니다.",
          output:
            "계산 결과는 즉시 표시되며 클립보드 복사 / 인쇄 미리보기(PDF 저장)로 내보낼 수 있습니다.",
        }}
      />
    </>
  );
}
