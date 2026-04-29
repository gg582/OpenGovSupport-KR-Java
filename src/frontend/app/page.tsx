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

  const grouped = new Map<string, { title: string; items: Feature[] }>();
  for (const f of features) {
    if (!grouped.has(f.domainKey)) {
      grouped.set(f.domainKey, { title: f.domainTitle, items: [] });
    }
    grouped.get(f.domainKey)!.items.push(f);
  }

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="panel-header">포털 안내</div>
        <div className="px-4 py-4 text-sm text-navy/85 leading-relaxed grid md:grid-cols-3 gap-4">
          <div>
            <div className="font-semibold mb-1 panel-sub-header">목적</div>
            사회복지 업무에서 자주 쓰이는 16종 계산을 한 화면에서 실행합니다. 모든 기능이 좌측 색인에 노출됩니다.
          </div>
          <div>
            <div className="font-semibold mb-1 panel-sub-header">법령 기반</div>
            중위소득·기초연금·차감율 등 공개된 법정 기준값을 폼 기본값으로 자동 채워주며, 케이스에 따라 값을 직접 보정할 수 있습니다.
          </div>
          <div>
            <div className="font-semibold mb-1 panel-sub-header">출력</div>
            계산 결과는 즉시 화면에 표시되고 클립보드 복사 / 인쇄 미리보기(PDF 저장)로 내보낼 수 있습니다.
          </div>
        </div>
      </section>

      {error && (
        <div className="panel border-red-300 bg-red-50">
          <div className="panel-header text-red-700">백엔드 연결 실패</div>
          <div className="px-4 py-3 text-sm text-red-700 font-mono">{error}</div>
        </div>
      )}

      {Array.from(grouped.entries()).map(([key, { title, items }]) => (
        <DomainSection key={key} domainKey={key} title={title} items={items} />
      ))}
    </div>
  );
}

function DomainSection({
  domainKey,
  title,
  items,
}: {
  domainKey: string;
  title: string;
  items: Feature[];
}) {
  return (
    <section className="panel">
      <div className="panel-header flex-wrap">
        <span>
          <span className="font-mono text-xs text-navy/50 mr-2">{domainKey}</span>
          {title}
        </span>
        <span className="ml-auto text-xs font-mono text-navy/50 font-normal">
          {items.length}건
        </span>
      </div>
      <table className="gov-table">
        <thead>
          <tr>
            <th className="w-[50px]">No.</th>
            <th className="w-[220px]">기능명</th>
            <th>설명</th>
            <th className="w-[100px] text-center">실행</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, i) => (
            <tr key={f.id}>
              <td className="text-center font-mono text-navy/70">{String(i + 1).padStart(2, "0")}</td>
              <td>
                <Link
                  href={`/features/${encodeURI(f.id)}`}
                  className="font-semibold text-navy hover:text-accent"
                >
                  ▶ {f.title}
                </Link>
              </td>
              <td className="text-navy/80">{f.summary}</td>
              <td className="text-center">
                <Link
                  href={`/features/${encodeURI(f.id)}`}
                  className="btn-secondary !py-1 !px-2 text-xs"
                >
                  실행 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
