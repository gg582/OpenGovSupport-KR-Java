package com.opengov.support.tax.eligibility;

import java.util.List;

/**
 * 자격 판정 결과.
 *
 * <ul>
 *   <li>{@code qualified} — 모든 자격조항을 만족하는지</li>
 *   <li>{@code reasons} — 통과 사유 (한국어 한 줄씩)</li>
 *   <li>{@code blockers} — 미충족 조항의 한국어 사유</li>
 * </ul>
 */
public record EligibilityResult(boolean qualified, List<String> reasons, List<String> blockers) {
}
