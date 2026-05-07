import Link from "next/link";
import type { Feature } from "../lib/api";

export default function SectionListing({
  features,
  section,
  title,
  intro,
}: {
  features: Feature[];
  section: "welfare" | "tax";
  title: string;
  intro: { purpose: string; basis: string; output: string };
}) {
  const filtered = features.filter((f) => f.section === section);
  const grouped = new Map<string, { title: string; items: Feature[] }>();
  for (const f of filtered) {
    if (!grouped.has(f.domainKey)) {
      grouped.set(f.domainKey, { title: f.domainTitle, items: [] });
    }
    grouped.get(f.domainKey)!.items.push(f);
  }

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="panel-header">{title}</div>
        <div className="px-4 py-4 text-sm text-navy/85 leading-relaxed grid md:grid-cols-3 gap-4">
          <div>
            <div className="font-semibold mb-1 panel-sub-header">목적</div>
            {intro.purpose}
          </div>
          <div>
            <div className="font-semibold mb-1 panel-sub-header">법령 기반</div>
            {intro.basis}
          </div>
          <div>
            <div className="font-semibold mb-1 panel-sub-header">출력</div>
            {intro.output}
          </div>
        </div>
      </section>

      {Array.from(grouped.entries()).map(([key, { title: gTitle, items }]) => (
        <DomainSection key={key} domainKey={key} title={gTitle} items={items} />
      ))}

      {filtered.length === 0 && (
        <div className="panel">
          <div className="panel-header">기능 없음</div>
          <div className="px-4 py-4 text-sm text-navy/70">
            현재 섹션에 등록된 기능이 없습니다.
          </div>
        </div>
      )}
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
            <th className="w-[50px] hidden md:table-cell">No.</th>
            <th className="w-[220px]">기능명</th>
            <th>설명</th>
            <th className="w-[100px] text-center hidden md:table-cell">실행</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, i) => (
            <tr key={f.id}>
              <td className="text-center font-mono text-navy/70 hidden md:table-cell">
                {String(i + 1).padStart(2, "0")}
              </td>
              <td>
                <Link
                  href={`/features/${encodeURI(f.id)}`}
                  className="font-semibold text-navy hover:text-accent"
                >
                  ▶ {f.title}
                </Link>
              </td>
              <td className="text-navy/80">{f.summary}</td>
              <td className="text-center hidden md:table-cell">
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
