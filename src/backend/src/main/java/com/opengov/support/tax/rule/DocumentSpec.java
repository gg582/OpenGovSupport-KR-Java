package com.opengov.support.tax.rule;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 필요서류 한 건의 명세.
 *
 * <ul>
 *   <li>{@code name} — 서류 한국어 정식 명칭 (예: 임대차계약서, 의료비 지급명세서)</li>
 *   <li>{@code issuer} — 발급기관 (예: 정부24, 국세청, 국민건강보험공단, 임대인)</li>
 *   <li>{@code onlineIssuance} — 온라인 발급 가능 여부 (JSON 키: {@code online_issuance})</li>
 *   <li>{@code submitTo} — 제출 채널 (JSON 키: {@code submit_to})</li>
 *   <li>{@code note} — 추가 안내 (선택)</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DocumentSpec(
        @JsonProperty("name") String name,
        @JsonProperty("issuer") String issuer,
        @JsonProperty("online_issuance") boolean onlineIssuance,
        @JsonProperty("submit_to") String submitTo,
        @JsonProperty("note") String note
) {
}
