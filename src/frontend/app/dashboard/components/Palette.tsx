"use client";

import { ALL_TEMPLATES, type NodeTemplate } from "../lib/registry";
import { useGraphStore } from "../lib/store";
import {
  SUBGRAPH_GROUP_LABEL,
  SUBGRAPH_TEMPLATES,
  type SubgraphTemplate,
} from "../lib/subgraphTemplates";

const GROUP_LABEL: Record<NodeTemplate["group"], string> = {
  io: "IO",
  data: "DATA",
  compute: "COMPUTE / FORMULA",
  control: "CONTROL",
  meta: "META",
  output: "OUTPUT",
};

const NODE_GROUP_ORDER: NodeTemplate["group"][] = [
  "io",
  "data",
  "control",
  "compute",
  "meta",
  "output",
];

const SUBGRAPH_GROUP_ORDER: SubgraphTemplate["group"][] = [
  "tax",
  "vat",
  "welfare",
  "inheritance",
  "compose",
];

export default function Palette() {
  const addNodeFromTemplate = useGraphStore((s) => s.addNodeFromTemplate);
  const addSubgraph = useGraphStore((s) => s.addSubgraph);
  const runAll = useGraphStore((s) => s.runAll);

  // 정형 패턴 — 그룹별.
  const subgraphsByGroup = SUBGRAPH_GROUP_ORDER.map((g) => ({
    group: g,
    items: SUBGRAPH_TEMPLATES.filter((t) => t.group === g),
  }));

  // 일반 노드 팔레트.
  const nodesByGroup = NODE_GROUP_ORDER.map((g) => ({
    group: g,
    items: ALL_TEMPLATES.filter((t) => t.group === g),
  }));

  return (
    <aside className="dash-palette">
      {/* ── 정형 패턴 — 최상단에 시각적으로 분리 ─────────── */}
      <div className="group" style={{ color: "#f6c668", letterSpacing: "0.16em" }}>
        ▦ 정형 패턴 (TEMPLATE)
      </div>
      {subgraphsByGroup.map(({ group, items }) => (
        <div key={`sub-${group}`}>
          <div className="group" style={{ paddingTop: 8, fontSize: 9 }}>
            ㆍ {SUBGRAPH_GROUP_LABEL[group]}
          </div>
          {items.map((tpl) => (
            <button
              key={tpl.id}
              className="chip subgraph-chip"
              data-kind="formula"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/opengov-subgraph", tpl.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => {
                addSubgraph(tpl);
                queueMicrotask(() => runAll());
              }}
              title={`${tpl.description}${tpl.legalBasis ? "\n" + tpl.legalBasis : ""}`}
            >
              <span
                className="dot"
                style={{ background: "#f6c668", boxShadow: "0 0 0 1px #594028" }}
              />
              <span>
                <span className="lbl" style={{ color: "#f6c668" }}>
                  {tpl.name}
                </span>
                <span className="hint">{tpl.description}</span>
              </span>
            </button>
          ))}
        </div>
      ))}

      {/* ── 단일 노드 ─────────── */}
      <div
        className="group"
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid #2a313e",
        }}
      >
        ◇ 단일 노드 (NODE)
      </div>
      {nodesByGroup.map(({ group, items }) => (
        <div key={group}>
          <div className="group" style={{ paddingTop: 8, fontSize: 9 }}>
            ㆍ {GROUP_LABEL[group]}
          </div>
          {items.map((tpl) => {
            const k =
              tpl.kind === "formula" ? `formula:${tpl.rule}` : `${tpl.kind}`;
            return (
              <button
                key={k}
                className="chip"
                data-kind={tpl.kind}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/opengov-node", JSON.stringify(tpl));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => {
                  addNodeFromTemplate(tpl, { x: 3 * 32, y: 3 * 32 });
                  queueMicrotask(() => runAll());
                }}
                title={tpl.hint}
              >
                <span className="dot" />
                <span>
                  <span className="lbl">{tpl.label}</span>
                  {tpl.hint && <span className="hint">{tpl.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
