package com.opengov.support.tax.rule;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * 정규화된 세무 규칙 단위. JSON 직렬화 형태이며
 * {@code resources/tax-rules/{year}/{ruleId}.json} 으로 저장된다.
 *
 * <p>스키마 (사용자 명세 그대로):
 * <pre>
 * {
 *   "rule_id": "",
 *   "category": "",
 *   "title": "",
 *   "formula_type": "A|B|C|D",
 *   "formula_expression": "",
 *   "params": {},
 *   "eligibility": [],
 *   "required_documents": [],
 *   "submission_channels": [],
 *   "legal_source": ""
 * }
 * </pre>
 *
 * <p>{@code formula_type} 정의:
 * <ul>
 *   <li>A — 누진세 ({@code tax = x*r - c})</li>
 *   <li>B — 한도성 비율 ({@code credit = min(x, cap) * r})</li>
 *   <li>C — 임계공제 ({@code eligible = max(x - threshold, 0); credit = eligible * r})</li>
 *   <li>D — 구간 인센티브 (구간별 phase-in / 평탄 / phase-out)</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TaxRule(
        @JsonProperty("rule_id") String ruleId,
        @JsonProperty("category") String category,
        @JsonProperty("title") String title,
        @JsonProperty("formula_type") String formulaType,
        @JsonProperty("formula_expression") String formulaExpression,
        @JsonProperty("params") Map<String, Object> params,
        @JsonProperty("eligibility") List<EligibilityClause> eligibility,
        @JsonProperty("required_documents") List<DocumentSpec> requiredDocuments,
        @JsonProperty("submission_channels") List<String> submissionChannels,
        @JsonProperty("legal_source") String legalSource
) {
}
