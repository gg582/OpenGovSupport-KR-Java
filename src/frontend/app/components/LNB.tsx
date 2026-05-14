"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Feature } from "../lib/api";
import { filterAvailable } from "../lib/api";

export default function LNB({
  features,
  section,
}: {
  features: Feature[];
  section: "welfare" | "tax";
}) {
  const pathname = usePathname();
  const filtered = features.filter((f) => f.section === section);
  const available = filterAvailable(filtered);
  const grouped = new Map<string, { title: string; items: Feature[] }>();
  for (const f of available) {
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
            <span className="text-[11px] font-mono text-navy/50">{available.length}</span>
          </Link>
        </li>
        {Array.from(grouped.entries()).map(([key, { title, items }]) => (
          <li key={key} className="border-t border-line/70 mt-1 pt-1">
            <div className="lnb-section">
              <span className="font-mono mr-1.5">{key.split("_")[0]}</span>
              {title}
            </div>
            <ul>
              {items.map((f) => (
                <TreeItem key={f.id} feature={f} pathname={pathname} />
              ))}
            </ul>
          </li>
        ))}
        {available.length === 0 && (
          <li className="px-3 py-3 text-xs text-navy/55">
            등록된 기능이 없습니다.
          </li>
        )}
      </ul>
    </nav>
  );
}

function TreeItem({
  feature,
  pathname,
  depth = 0,
}: {
  feature: Feature;
  pathname: string;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = feature.children && feature.children.length > 0;
  const href = `/features/${encodeURI(feature.id)}`;
  const active = pathname === href;
  const isLeaf = !hasChildren;

  return (
    <li>
      <div
        className="lnb-link"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {hasChildren && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="mr-1 text-[10px] text-navy/40 w-4 text-center"
            aria-label={open ? "접기" : "펼치기"}
          >
            {open ? "▼" : "▶"}
          </button>
        )}
        {isLeaf ? (
          <Link
            href={href}
            className="flex-1 truncate"
            aria-current={active ? "page" : undefined}
          >
            {feature.title}
          </Link>
        ) : (
          <span className="flex-1 truncate font-medium">{feature.title}</span>
        )}
        <span className="text-[11px] font-mono text-navy/40 shrink-0 ml-2">
          {feature.id.split("/").pop()}
        </span>
      </div>
      {hasChildren && open && (
        <ul>
          {feature.children!.map((child) => (
            <TreeItem
              key={child.id}
              feature={child}
              pathname={pathname}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
