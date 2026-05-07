/**
 * 빌트인 그래프 템플릿. 사용자는 "템플릿 로드" 메뉴로 즉시 시작.
 */

import { GRID } from "./types";
import type { GraphDoc } from "./types";

const cell = (cx: number, cy: number) => ({
  x: cx * GRID.size,
  y: cy * GRID.size,
});

export const TEMPLATES: GraphDoc[] = [
  {
    id: "tpl_tax",
    name: "종합소득세 파이프라인",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "총급여",
          value: 60000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(14, 2),
        data: {
          kind: "formula",
          label: "근로소득공제",
          rule: "deduction-ladder/earned-income",
          inputs: [{ id: "salary", name: "salary", label: "총급여" }],
          outputs: [{ id: "deduction", name: "deduction", label: "공제액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(2, 10),
        data: {
          kind: "input",
          label: "과세표준",
          value: 50000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(14, 10),
        data: {
          kind: "formula",
          label: "종합소득세",
          rule: "comprehensive-income-tax",
          inputs: [
            { id: "taxableIncome", name: "taxableIncome", label: "과세표준" },
          ],
          outputs: [{ id: "amount", name: "amount", label: "산출세액" }],
        },
      },
      {
        id: "n5",
        type: "stat",
        position: cell(26, 10),
        data: {
          kind: "output",
          label: "결정세액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n6",
        type: "stat",
        position: cell(26, 18),
        data: {
          kind: "legal",
          label: "「소득세법」 §55",
          citation: "「소득세법」 제55조 (8단계 누진세율)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "salary" },
      { id: "e2", source: "n3", sourceHandle: "v", target: "n4", targetHandle: "taxableIncome" },
      { id: "e3", source: "n4", sourceHandle: "amount", target: "n5", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_welfare",
    name: "복지 자격 통합 파이프라인",
    kind: "welfare",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "근로소득(월)",
          value: 1500000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "사업소득(월)",
          value: 0,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(2, 14),
        data: {
          kind: "input",
          label: "일반재산",
          value: 50000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(2, 20),
        data: {
          kind: "input",
          label: "금융재산",
          value: 5000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n5",
        type: "stat",
        position: cell(16, 10),
        data: {
          kind: "formula",
          label: "소득인정액",
          rule: "recognized-income",
          inputs: [
            { id: "salary", name: "salary", label: "근로" },
            { id: "businessIncome", name: "businessIncome", label: "사업" },
            { id: "generalProperty", name: "generalProperty", label: "일반재산" },
            { id: "financialAssets", name: "financialAssets", label: "금융재산" },
          ],
          outputs: [
            { id: "recognizedIncome", name: "recognizedIncome", label: "소득인정액" },
          ],
        },
      },
      {
        id: "n6",
        type: "stat",
        position: cell(16, 22),
        data: {
          kind: "input",
          label: "가구원수",
          value: 3,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n7",
        type: "stat",
        position: cell(30, 10),
        data: {
          kind: "formula",
          label: "중위소득 비율",
          rule: "median-ratio",
          inputs: [
            { id: "recognizedIncome", name: "recognizedIncome", label: "소득인정액" },
            { id: "householdSize", name: "householdSize", label: "가구원수" },
          ],
          outputs: [{ id: "ratio", name: "ratio", label: "비율" }],
        },
      },
      {
        id: "n8",
        type: "stat",
        position: cell(44, 10),
        data: {
          kind: "output",
          label: "자격 분기",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n5", targetHandle: "salary" },
      { id: "e2", source: "n2", sourceHandle: "v", target: "n5", targetHandle: "businessIncome" },
      { id: "e3", source: "n3", sourceHandle: "v", target: "n5", targetHandle: "generalProperty" },
      { id: "e4", source: "n4", sourceHandle: "v", target: "n5", targetHandle: "financialAssets" },
      { id: "e5", source: "n5", sourceHandle: "recognizedIncome", target: "n7", targetHandle: "recognizedIncome" },
      { id: "e6", source: "n6", sourceHandle: "v", target: "n7", targetHandle: "householdSize" },
      { id: "e7", source: "n7", sourceHandle: "ratio", target: "n8", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_inheritance",
    name: "상속 우선순위 파이프라인",
    kind: "inheritance",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "상속재산 총액",
          value: 1500000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "배우자 수",
          value: 1,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(2, 14),
        data: {
          kind: "input",
          label: "자녀 수",
          value: 2,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(2, 20),
        data: {
          kind: "input",
          label: "부모 수",
          value: 0,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n5",
        type: "stat",
        position: cell(20, 10),
        data: {
          kind: "formula",
          label: "법정 상속분",
          rule: "inheritance-priority",
          inputs: [
            { id: "totalEstate", name: "totalEstate", label: "총액" },
            { id: "spouseCount", name: "spouseCount", label: "배우자" },
            { id: "childCount", name: "childCount", label: "자녀" },
            { id: "parentCount", name: "parentCount", label: "부모" },
          ],
          outputs: [{ id: "shares", name: "shares", label: "분배" }],
        },
      },
      {
        id: "n6",
        type: "stat",
        position: cell(38, 10),
        data: {
          kind: "output",
          label: "분배 결과",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n5", targetHandle: "totalEstate" },
      { id: "e2", source: "n2", sourceHandle: "v", target: "n5", targetHandle: "spouseCount" },
      { id: "e3", source: "n3", sourceHandle: "v", target: "n5", targetHandle: "childCount" },
      { id: "e4", source: "n4", sourceHandle: "v", target: "n5", targetHandle: "parentCount" },
      { id: "e5", source: "n5", sourceHandle: "shares", target: "n6", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_vat",
    name: "부가가치세 파이프라인",
    kind: "vat",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 4),
        data: {
          kind: "input",
          label: "매출 공급가액",
          value: 100000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(2, 12),
        data: {
          kind: "input",
          label: "매입 공급가액",
          value: 60000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(18, 8),
        data: {
          kind: "formula",
          label: "VAT 차분",
          rule: "vat-delta",
          inputs: [
            { id: "salesSupplyAmount", name: "salesSupplyAmount", label: "매출" },
            { id: "purchaseSupplyAmount", name: "purchaseSupplyAmount", label: "매입" },
          ],
          outputs: [{ id: "payable", name: "payable", label: "납부세액" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(34, 8),
        data: {
          kind: "output",
          label: "납부 / 환급",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n3", targetHandle: "salesSupplyAmount" },
      { id: "e2", source: "n2", sourceHandle: "v", target: "n3", targetHandle: "purchaseSupplyAmount" },
      { id: "e3", source: "n3", sourceHandle: "payable", target: "n4", targetHandle: "v" },
    ],
  },
];
