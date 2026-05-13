/**
 * 빌트인 그래프 서식. 사용자는 "서식 불러오기" 메뉴로 즉시 시작.
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
          value: 72000000,
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
          value: 42000000,
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
          value: 2500000,
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
          value: 30000000,
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
        id: "n9",
        type: "stat",
        position: cell(44, 22),
        data: {
          kind: "legal",
          label: "「국민기초생활보장법」§8조의2",
          citation: "「국민기초생활보장법」 제8조의2 (급여별 선정기준)",
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
          value: 2000000000,
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
  {
    id: "tpl_year_end",
    name: "연말정산 통합 시뮬레이터",
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
          rule: "earned-income-deduction",
          inputs: [{ id: "grossSalary", name: "grossSalary", label: "총급여" }],
          outputs: [{ id: "deduction", name: "deduction", label: "공제액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "인적공제대상수",
          value: 2,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(2, 14),
        data: {
          kind: "input",
          label: "연금계좌납입액",
          value: 3000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n5",
        type: "stat",
        position: cell(2, 20),
        data: {
          kind: "input",
          label: "의료비지출액",
          value: 5000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n6",
        type: "stat",
        position: cell(2, 26),
        data: {
          kind: "input",
          label: "월세연간액",
          value: 6000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n7",
        type: "stat",
        position: cell(2, 32),
        data: {
          kind: "input",
          label: "자녀수",
          value: 2,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n8",
        type: "stat",
        position: cell(14, 32),
        data: {
          kind: "formula",
          label: "자녀세액공제",
          rule: "child-credit",
          inputs: [{ id: "childCount", name: "childCount", label: "자녀수" }],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n9",
        type: "stat",
        position: cell(30, 16),
        data: {
          kind: "output",
          label: "결정세액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n10",
        type: "stat",
        position: cell(30, 24),
        data: {
          kind: "legal",
          label: "「소득세법」§47·§55·§59조의2~4",
          citation: "「소득세법」 제47조, 제55조, 제59조의2~4 (근로소득공제·종합소득세·세액공제)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "grossSalary" },
      { id: "e2", source: "n7", sourceHandle: "v", target: "n8", targetHandle: "childCount" },
    ],
  },
  {
    id: "tpl_corporate",
    name: "법인세 산출",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "과세표준",
          value: 500000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(16, 8),
        data: {
          kind: "formula",
          label: "법인세",
          rule: "corporate-tax",
          inputs: [{ id: "taxableIncome", name: "taxableIncome", label: "과세표준" }],
          outputs: [{ id: "amount", name: "amount", label: "산출세액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(32, 8),
        data: {
          kind: "output",
          label: "납부세액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(32, 14),
        data: {
          kind: "legal",
          label: "「법인세법」§55",
          citation: "「법인세법」 제55조 (4단계 누진세율)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "taxableIncome" },
      { id: "e2", source: "n2", sourceHandle: "amount", target: "n3", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_inheritance_tax",
    name: "상속세 산출",
    kind: "inheritance",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 4),
        data: {
          kind: "input",
          label: "상속재산총액",
          value: 2000000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(2, 10),
        data: {
          kind: "input",
          label: "배우자공제",
          value: 500000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(2, 16),
        data: {
          kind: "input",
          label: "자녀공제",
          value: 100000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(18, 10),
        data: {
          kind: "formula",
          label: "상속세과세표준",
          rule: "inheritance-tax",
          inputs: [{ id: "inheritanceBase", name: "inheritanceBase", label: "과세표준" }],
          outputs: [{ id: "amount", name: "amount", label: "산출세액" }],
        },
      },
      {
        id: "n5",
        type: "stat",
        position: cell(34, 10),
        data: {
          kind: "output",
          label: "상속세액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n6",
        type: "stat",
        position: cell(34, 16),
        data: {
          kind: "legal",
          label: "「상속세법」§26",
          citation: "「상속세 및 증여세법」 제26조 (상속세 세율)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n4", targetHandle: "inheritanceBase" },
    ],
  },
  {
    id: "tpl_earned_income_credit",
    name: "근로장려금 산정",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "총급여등소득",
          value: 8000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(16, 8),
        data: {
          kind: "formula",
          label: "근로장려금",
          rule: "earned-income-credit",
          inputs: [{ id: "householdIncome", name: "householdIncome", label: "총소득" }],
          outputs: [{ id: "amount", name: "amount", label: "장려금액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(32, 8),
        data: {
          kind: "output",
          label: "지급액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(32, 14),
        data: {
          kind: "legal",
          label: "「조특법」§100조의3",
          citation: "「조세특례제한법」 제100조의3 (근로장려세제)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "householdIncome" },
      { id: "e2", source: "n2", sourceHandle: "amount", target: "n3", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_marriage",
    name: "결혼 세액공제",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "혼인신고 해당",
          value: "해당",
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(16, 8),
        data: {
          kind: "formula",
          label: "결혼공제액",
          rule: "marriage-credit",
          inputs: [
            { id: "isMarriedInPeriod", name: "isMarriedInPeriod", label: "해당여부" },
            { id: "claimedBefore", name: "claimedBefore", label: "이전공제" },
            { id: "spouseClaim", name: "spouseClaim", label: "배우자여부" },
          ],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(32, 8),
        data: {
          kind: "output",
          label: "공제금액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(32, 14),
        data: {
          kind: "legal",
          label: "「소득세법」§59조의4 ⑩",
          citation: "「소득세법」 제59조의4 ⑩ (결혼 세액공제)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "isMarriedInPeriod" },
      { id: "e2", source: "n2", sourceHandle: "amount", target: "n3", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_sports",
    name: "체육시설 이용료 공제",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 8),
        data: {
          kind: "input",
          label: "체육시설 이용료",
          value: 2400000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(16, 8),
        data: {
          kind: "formula",
          label: "체육공제액",
          rule: "sports-credit",
          inputs: [{ id: "sportsExpense", name: "sportsExpense", label: "이용료" }],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(32, 8),
        data: {
          kind: "output",
          label: "공제금액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(32, 14),
        data: {
          kind: "legal",
          label: "「소득세법」§59조의4 ③",
          citation: "「소득세법」 제59조의4 ③ (체육시설 이용료 세액공제)",
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "sportsExpense" },
      { id: "e2", source: "n2", sourceHandle: "amount", target: "n3", targetHandle: "v" },
    ],
  },
  {
    id: "tpl_welfare_eligibility",
    name: "복지 통합 자격 평가",
    kind: "welfare",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "근로소득(월)",
          value: 1800000,
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
          value: 25000000,
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
          value: 3000000,
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
          outputs: [{ id: "recognizedIncome", name: "recognizedIncome", label: "소득인정액" }],
        },
      },
      {
        id: "n6",
        type: "stat",
        position: cell(16, 22),
        data: {
          kind: "input",
          label: "가구원수",
          value: 2,
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
      {
        id: "n9",
        type: "stat",
        position: cell(44, 22),
        data: {
          kind: "legal",
          label: "「국민기초생활보장법」§8조의2",
          citation: "「국민기초생활보장법」 제8조의2 (급여별 선정기준)",
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

  // ── 자녀 세액공제 ─────────────────────────────────────────────────
  {
    id: "tpl_child_credit",
    name: "자녀 세액공제",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "자녀 수",
          value: 2,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(14, 2),
        data: {
          kind: "formula",
          label: "자녀 세액공제",
          rule: "child-credit",
          inputs: [{ id: "childCount", name: "childCount", label: "자녀수" }],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(26, 2),
        data: {
          kind: "output",
          label: "공제액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "childCount" },
      { id: "e2", source: "n2", sourceHandle: "amount", target: "n3", targetHandle: "v" },
    ],
  },

  // ── 의료비 세액공제 ───────────────────────────────────────────────
  {
    id: "tpl_medical_credit",
    name: "의료비 세액공제",
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
        position: cell(2, 10),
        data: {
          kind: "input",
          label: "의료비",
          value: 5000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(14, 6),
        data: {
          kind: "formula",
          label: "의료비 세액공제",
          rule: "medical-expense-credit",
          inputs: [
            { id: "salary", name: "salary", label: "총급여" },
            { id: "medicalExpense", name: "medicalExpense", label: "의료비" },
          ],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(26, 6),
        data: {
          kind: "output",
          label: "공제액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n3", targetHandle: "salary" },
      { id: "e2", source: "n2", sourceHandle: "v", target: "n3", targetHandle: "medicalExpense" },
      { id: "e3", source: "n3", sourceHandle: "amount", target: "n4", targetHandle: "v" },
    ],
  },

  // ── 월세 세액공제 ─────────────────────────────────────────────────
  {
    id: "tpl_rent_credit",
    name: "월세 세액공제",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "총급여",
          value: 55000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(2, 10),
        data: {
          kind: "input",
          label: "연간 월세",
          value: 8400000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(14, 6),
        data: {
          kind: "formula",
          label: "월세 세액공제",
          rule: "rent-credit",
          inputs: [
            { id: "salary", name: "salary", label: "총급여" },
            { id: "rentPaid", name: "rentPaid", label: "월세" },
          ],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(26, 6),
        data: {
          kind: "output",
          label: "공제액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n3", targetHandle: "salary" },
      { id: "e2", source: "n2", sourceHandle: "v", target: "n3", targetHandle: "rentPaid" },
      { id: "e3", source: "n3", sourceHandle: "amount", target: "n4", targetHandle: "v" },
    ],
  },

  // ── 연금계좌 세액공제 ─────────────────────────────────────────────
  {
    id: "tpl_pension_credit",
    name: "연금계좌 세액공제",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "총급여",
          value: 70000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(2, 10),
        data: {
          kind: "input",
          label: "연금 납입액",
          value: 6000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(14, 6),
        data: {
          kind: "formula",
          label: "연금계좌 세액공제",
          rule: "pension-credit",
          inputs: [
            { id: "salary", name: "salary", label: "총급여" },
            { id: "pensionContribution", name: "pensionContribution", label: "납입액" },
          ],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n4",
        type: "stat",
        position: cell(26, 6),
        data: {
          kind: "output",
          label: "공제액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n3", targetHandle: "salary" },
      { id: "e2", source: "n2", sourceHandle: "v", target: "n3", targetHandle: "pensionContribution" },
      { id: "e3", source: "n3", sourceHandle: "amount", target: "n4", targetHandle: "v" },
    ],
  },

  // ── 기부금 세액공제 ───────────────────────────────────────────────
  {
    id: "tpl_donation_credit",
    name: "기부금 세액공제",
    kind: "tax",
    nodes: [
      {
        id: "n1",
        type: "stat",
        position: cell(2, 2),
        data: {
          kind: "input",
          label: "기부금",
          value: 3000000,
          outputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
      {
        id: "n2",
        type: "stat",
        position: cell(14, 2),
        data: {
          kind: "formula",
          label: "기부금 세액공제",
          rule: "donation-credit",
          inputs: [{ id: "donation", name: "donation", label: "기부금" }],
          outputs: [{ id: "amount", name: "amount", label: "공제액" }],
        },
      },
      {
        id: "n3",
        type: "stat",
        position: cell(26, 2),
        data: {
          kind: "output",
          label: "공제액",
          inputs: [{ id: "v", name: "v", label: "값" }],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "v", target: "n2", targetHandle: "donation" },
      { id: "e2", source: "n2", sourceHandle: "amount", target: "n3", targetHandle: "v" },
    ],
  },
];
