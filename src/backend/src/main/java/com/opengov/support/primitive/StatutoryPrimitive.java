package com.opengov.support.primitive;

/**
 * 사용자 명세서의 8가지 정규화된 정통 산식 단위(primitive). 이 시스템의 모든 계산은
 * 정확히 이 8개 중 하나로 분류되며, 각 primitive 는 결정적 순수함수로 구현된다.
 *
 * <p>설계 원칙:
 * <ul>
 *   <li>외부 API 호출 금지 — 모든 입력은 사용자 제공 변수 + 법정 표 만 사용</li>
 *   <li>확률적 추정 금지 — 동일 입력 → 동일 출력</li>
 *   <li>실시간 정부 DB 의존 금지 — 모든 표는 코드/리소스로 박혀 있음</li>
 * </ul>
 */
public enum StatutoryPrimitive {

    /** 1 누진세 — {@code tax = x*r − c}. 종합소득세·법인세·상속세·증여세. */
    PROGRESSIVE_TAX,

    /** 2 공제 사다리 — 구간별 piecewise-linear (ex. 근로소득공제 5단계). */
    DEDUCTION_LADDER,

    /** 3 한도성 세액공제 — {@code credit = min(x, cap) × r}. 의료비·월세·연금·교육비·기부금. */
    CAPPED_CREDIT,

    /** 4 구간 인센티브 — phase-in / plateau / phase-out (근로장려금·복지 감액). */
    PHASE_INCENTIVE,

    /** 5 부가세 차분 — {@code payable = (sales − purchase) × 10%}. */
    VAT_DELTA,

    /** 6 소득인정액 — 소득평가액 + 재산 환산액 (생계·의료·주거·교육 급여 진입 변수). */
    RECOGNIZED_INCOME,

    /** 7 중위소득 비율 — 소득인정액 ÷ 가구원수별 기준중위소득 → 급여 자격 분기. */
    MEDIAN_INCOME_RATIO,

    /** 8 법정 우선순위 트리 — 「민법」 제1000~1009조 상속 순위 + 대습 + 유류분. */
    LEGAL_PRIORITY_TREE
}
