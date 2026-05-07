import Link from "next/link";
import { listFeatures, type Feature } from "./lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let features: Feature[] = [];
  let error: string | null = null;
  try {
    features = await listFeatures();
  } catch (e) {
    error = (e as Error).message;
  }

  const welfare = features.filter((f) => f.section === "welfare");
  const tax = features.filter((f) => f.section === "tax");

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="panel-header">안내</div>
        <div className="px-4 py-4 text-sm text-navy/85 leading-relaxed">
          법령에 명시된 산식만 코드로 평가합니다. 개인세무(연말정산·종합소득세·법인세·상속세·증여세·부가가치세·세액공제)와
          사회복지(중위소득·기초연금·재산변동 등) 두 섹션으로 분리되어 있습니다.
        </div>
      </section>

      <section className="panel border-amber-300 bg-amber-50">
        <div className="panel-header text-amber-900">면책 고지</div>
        <div className="px-4 py-3 text-sm text-amber-900 leading-relaxed space-y-2">
          <p>
            본 사이트는 세무사·세무대리 행위를 수행하지 않으며, 산출 결과의 정확성·완전성·최신성을
            보증하지 않습니다. 산식 자체는 「소득세법」「법인세법」「상속세 및 증여세법」
            「부가가치세법」「국민기초생활보장법」「조세특례제한법」 등 공개 법령에 근거하나,
            케이스별 적용 여부와 예외 처리는 사용자가 직접 확인해야 합니다.
          </p>
          <p>
            산출 결과는 신고·납부·수급의 효력을 갖지 않습니다. 실제 신고는 반드시
            홈택스(국세청) / 복지로(보건복지부) / 정부24 / 세무전문가를 통해 확정하시기 바랍니다.
          </p>
        </div>
      </section>

      {error && (
        <div className="panel border-red-300 bg-red-50">
          <div className="panel-header text-red-700">백엔드 연결 실패</div>
          <div className="px-4 py-3 text-sm text-red-700 font-mono">{error}</div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <SectionCard
          title="개인세무"
          href="/tax"
          count={tax.length}
          summary="법령 정규화 산식 — 종합소득세·근로소득공제·연말정산 합성, 의료비·월세·교육비·연금·기부금·자녀 세액공제, 근로장려금, 단순경비율, 법인세·상속세·증여세·부가가치세 산출."
          legal="「소득세법」「법인세법」「상속세 및 증여세법」「부가가치세법」「조세특례제한법」 등"
        />
        <SectionCard
          title="사회복지"
          href="/welfare"
          count={welfare.length}
          summary="국민기초생활보장법·기초연금법 등 사회복지 행정에서 자주 쓰이는 산식 — 사적이전소득, 이자소득 공제, 재산변동, 상속분, 긴급공제, 해외체류 검토 등."
          legal="「국민기초생활보장법」, 「기초연금법」, 「민법」 제1009조 외"
        />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  href,
  count,
  summary,
  legal,
}: {
  title: string;
  href: string;
  count: number;
  summary: string;
  legal: string;
}) {
  return (
    <section className="panel">
      <div className="panel-header flex-wrap">
        <span>{title}</span>
        <span className="ml-auto text-xs font-mono text-navy/50 font-normal">{count}건</span>
      </div>
      <div className="px-4 py-4 text-sm text-navy/85 leading-relaxed space-y-3">
        <p>{summary}</p>
        <p className="text-xs text-navy/60">근거 법령: {legal}</p>
        <Link href={href} className="btn-primary inline-block">
          {title} 기능 보기 →
        </Link>
      </div>
    </section>
  );
}
