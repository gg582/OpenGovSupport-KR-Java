package com.opengov.support.tax.formula;

/**
 * 정규화된 세무 산식의 4가지 형태. 사용자 명세의 Type A~D 와 1:1 대응.
 *
 * <ul>
 *   <li>{@link #A} — 누진세 ({@code tax = x*r - c})</li>
 *   <li>{@link #B} — 한도성 비율 ({@code credit = min(x, cap) * r})</li>
 *   <li>{@link #C} — 임계공제 ({@code eligible = max(x - threshold, 0); credit = eligible * r})</li>
 *   <li>{@link #D} — 구간 인센티브 (phase-in / 평탄 / phase-out)</li>
 * </ul>
 */
public enum FormulaType {
    A, B, C, D;

    public static FormulaType parse(String s) {
        if (s == null) throw new IllegalArgumentException("formula_type 누락");
        return switch (s.trim().toUpperCase()) {
            case "A", "PROGRESSIVE", "PROGRESSIVE_BRACKET" -> A;
            case "B", "CAPPED", "CAPPED_PERCENTAGE" -> B;
            case "C", "THRESHOLD", "THRESHOLD_BASED" -> C;
            case "D", "PIECEWISE", "PIECEWISE_INCENTIVE" -> D;
            default -> throw new IllegalArgumentException("알 수 없는 산식 유형: " + s);
        };
    }
}
