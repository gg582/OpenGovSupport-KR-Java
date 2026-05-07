package com.opengov.support.tax.rule;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * 자격 판정 단위. {@code variable}이 {@code op}/{@code value} 조건을 만족해야 통과.
 *
 * <p>지원 연산자: {@code lt, lte, gt, gte, eq, ne, present, absent}
 *
 * <p>예: 의료비 세액공제 — {@code variable=medicalExpense, op=gt, value=0,
 * message="의료비 지출액이 있어야 합니다."}
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EligibilityClause(
        @JsonProperty("variable") String variable,
        @JsonProperty("op") String op,
        @JsonProperty("value") BigDecimal value,
        @JsonProperty("message") String message
) {
}
