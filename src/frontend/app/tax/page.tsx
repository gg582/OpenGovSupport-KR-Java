import { listFeatures, type Feature } from "../lib/api";
import SectionListing from "../components/SectionListing";

export const dynamic = "force-dynamic";

export default async function TaxPage() {
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
        section="tax"
        title="개인세무 — 안내"
        intro={{
          purpose:
            "법령에 명시된 세무 산식을 정규화하여 평가합니다. 연말정산·종합소득세·세액공제·법인세·상속세·증여세·부가가치세·근로장려금·단순경비율이 단일 룰엔진으로 처리됩니다.",
          basis:
            "「소득세법」「법인세법」「상속세 및 증여세법」「부가가치세법」「조세특례제한법」「소득세법 시행령」 등 공개 법령의 산식을 4가지 정규형(A 누진세 / B 한도성 비율 / C 임계공제 / D 구간 인센티브)으로 변환하여 평가하며, 모든 산술은 임의정밀(BigDecimal)로 수행되어 부동소수점 오차가 없습니다. 근거 법령·자격 판정·필요서류·제출 채널이 결과에 함께 표시됩니다.",
          output:
            "산출 결과는 참고용입니다. 본 사이트는 세무대리 행위를 수행하지 않으며 정확성·최신성을 보증하지 않습니다. 실제 신고는 반드시 홈택스(국세청) 또는 세무전문가를 통해 확정해야 합니다.",
        }}
      />
    </>
  );
}
