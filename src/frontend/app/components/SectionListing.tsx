"use client";

import Link from "next/link";
import { useState } from "react";
import type { Feature } from "../lib/api";
import { filterAvailable } from "../lib/api";

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
  const available = filterAvailable(filtered);
  const grouped = new Map<string, { title: string; items: Feature[] }>();
  for (const f of available) {
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

      {available.length === 0 && (
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
          {countLeaves(items)}건
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
            <TreeRow key={f.id} feature={f} index={i + 1} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TreeRow({
  feature,
  index,
  depth = 0,
}: {
  feature: Feature;
  index: number;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = feature.children && feature.children.length > 0;
  const isLeaf = !hasChildren;
  const href = `/features/${encodeURI(feature.id)}`;

  return (
    <>
      <tr className={depth > 0 ? "bg-navy/[0.02]" : ""}>
        <td className="text-center font-mono text-navy/70 hidden md:table-cell">
          {String(index).padStart(2, "0")}
        </td>
        <td>
          <div className="flex items-center" style={{ paddingLeft: `${depth * 16}px` }}>
            {hasChildren && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="mr-1.5 text-[10px] text-navy/40 w-4 text-center"
                aria-label={open ? "접기" : "펼치기"}
              >
                {open ? "▼" : "▶"}
              </button>
            )}
            {isLeaf ? (
              <Link
                href={href}
                className="font-semibold text-navy hover:text-accent"
              >
                ▶ {feature.title}
              </Link>
            ) : (
              <span className="font-semibold text-navy/80">{feature.title}</span>
            )}
          </div>
        </td>
        <td className="text-navy/80">{feature.summary}</td>
        <td className="text-center hidden md:table-cell">
          {isLeaf && (
            <Link
              href={href}
              className="btn-secondary !py-1 !px-2 text-xs"
            >
              실행 →
            </Link>
          )}
        </td>
      </tr>
      {hasChildren && open &&
        feature.children!.map((child, ci) => (
          <TreeRow
            key={child.id}
            feature={child}
            index={index}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

function countLeaves(features: Feature[]): number {
  let n = 0;
  for (const f of features) {
    if (!f.children || f.children.length === 0) {
      n++;
    } else {
      n += countLeaves(f.children);
    }
  }
  return n;
}
