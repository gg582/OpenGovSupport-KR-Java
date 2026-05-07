package com.opengov.support.tax.formula;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 산식 평가 결과.
 *
 * <ul>
 *   <li>{@code amount} — 최종 산출 금액 (세액 / 공제액 / 환급액). {@link BigDecimal} 정수 원화 (scale=0).</li>
 *   <li>{@code intermediate} — 중간 변수 (설명용; 적용된 구간·rate·c 값 등)</li>
 * </ul>
 */
public record FormulaResult(BigDecimal amount, Map<String, Object> intermediate) {

    public static FormulaResult of(BigDecimal amount) {
        return new FormulaResult(amount, new LinkedHashMap<>());
    }
}
