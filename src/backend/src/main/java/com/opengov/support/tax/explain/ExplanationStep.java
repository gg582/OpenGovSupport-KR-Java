package com.opengov.support.tax.explain;

/**
 * 설명 단계 한 줄. 라벨(예: "[근거]", "[자격]", "[산식]", "[대입]", "[결과]") + 본문.
 */
public record ExplanationStep(String label, String body) {

    public static ExplanationStep of(String label, String body) {
        return new ExplanationStep(label, body);
    }
}
