package com.opengov.support.tax.document;

import com.opengov.support.tax.rule.DocumentSpec;

import java.util.List;

/**
 * 필요서류 체크리스트.
 *
 * <ul>
 *   <li>{@code documents} — 서류 명세 목록 (이름·발급기관·온라인발급·제출처)</li>
 *   <li>{@code submissionChannels} — 룰의 제출 채널 (예: 홈택스, 회사 연말정산 시스템)</li>
 * </ul>
 */
public record DocumentChecklist(List<DocumentSpec> documents, List<String> submissionChannels) {
}
