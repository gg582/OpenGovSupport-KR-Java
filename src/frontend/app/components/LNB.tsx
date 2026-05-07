"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Feature } from "../lib/api";

export default function LNB({
  features,
  section,
}: {
  features: Feature[];
  section: "welfare" | "tax";
}) {
  const pathname = usePathname();
  const filtered = features.filter((f) => f.section === section);
  const grouped = new Map<string, { title: string; items: Feature[] }>();
  for (const f of filtered) {
    if (!grouped.has(f.domainKey)) {
      grouped.set(f.domainKey, { title: f.domainTitle, items: [] });
    }
    grouped.get(f.domainKey)!.items.push(f);
  }

  const sectionLabel = section === "tax" ? "개인세무" : "사회복지";
  const sectionHref = section === "tax" ? "/tax" : "/welfare";
  const homeActive = pathname === sectionHref;

  return (
    <nav className="panel" aria-label={`${sectionLabel} 기능 분류`}>
      <div className="panel-header">{sectionLabel} 기능 색인</div>
      <ul className="py-1">
        <li>
          <Link
            href={sectionHref}
            className="lnb-link"
            aria-current={homeActive ? "page" : undefined}
          >
            <span>▣ {sectionLabel} 전체 보기</span>
            <span className="text-[11px] font-mono text-navy/50">{filtered.length}</span>
          </Link>
        </li>
        {Array.from(grouped.entries()).map(([key, { title, items }]) => (
          <li key={key} className="border-t border-line/70 mt-1 pt-1">
            <div className="lnb-section">
              <span className="font-mono mr-1.5">{key.split("_")[0]}</span>
              {title}
            </div>
            <ul>
              {items.map((f) => {
                const href = `/features/${encodeURI(f.id)}`;
                const active = pathname === href;
                return (
                  <li key={f.id}>
                    <Link
                      href={href}
                      className="lnb-link"
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="truncate">{f.title}</span>
                      <span className="text-[11px] font-mono text-navy/40 shrink-0 ml-2">
                        {f.id.split("/")[1]}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-3 text-xs text-navy/55">
            등록된 기능이 없습니다.
          </li>
        )}
      </ul>
    </nav>
  );
}
