package com.opengov.support.primitive;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 8개 primitive 의 통합 반환 형태. 사용자 명세에 따라 모든 결과는
 * 다음 5가지 요소를 반드시 포함한다:
 *
 * <ol>
 *   <li>{@code rawFormula} — 원시 산식 (문자열, 변수명 그대로)</li>
 *   <li>{@code substitutedVariables} — 변수 → 실제 대입값 (감사 추적용)</li>
 *   <li>{@code finalOutput} — 최종 산출 결과 (통상 BigDecimal 금액)</li>
 *   <li>{@code legalBasis} — 근거 법령 인용 (조문번호 포함)</li>
 *   <li>{@code eligibility} — 자격 판정 결과 (qualified + reasons + blockers)</li>
 * </ol>
 *
 * <p>{@code intermediate} 는 산식 중간값(부분 산출물)을 감사·UI 표시용으로 노출.
 * {@code primitive} 는 어느 정규형으로 평가되었는지 명시 (감사 추적용).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record StatutoryResult(
        StatutoryPrimitive primitive,
        String rawFormula,
        Map<String, Object> substitutedVariables,
        Object finalOutput,
        String legalBasis,
        Eligibility eligibility,
        Map<String, Object> intermediate) {

    public record Eligibility(boolean qualified, List<String> reasons, List<String> blockers) {
        public static Eligibility qualified(String reason) {
            return new Eligibility(true, List.of(reason), List.of());
        }

        public static Eligibility blocked(String blocker) {
            return new Eligibility(false, List.of(), List.of(blocker));
        }

        public static Eligibility of(boolean qualified, List<String> reasons, List<String> blockers) {
            return new Eligibility(qualified, reasons == null ? List.of() : reasons,
                    blockers == null ? List.of() : blockers);
        }
    }

    public static Builder builder(StatutoryPrimitive primitive) {
        return new Builder(primitive);
    }

    public static final class Builder {
        private final StatutoryPrimitive primitive;
        private String rawFormula = "";
        private final Map<String, Object> substituted = new LinkedHashMap<>();
        private Object finalOutput;
        private String legalBasis = "";
        private Eligibility eligibility;
        private final Map<String, Object> intermediate = new LinkedHashMap<>();

        private Builder(StatutoryPrimitive p) { this.primitive = p; }

        public Builder formula(String f) { this.rawFormula = f; return this; }

        public Builder var(String key, Object value) {
            this.substituted.put(key, value);
            return this;
        }

        public Builder vars(Map<String, Object> all) {
            this.substituted.putAll(all);
            return this;
        }

        public Builder output(Object v) { this.finalOutput = v; return this; }

        public Builder legalBasis(String b) { this.legalBasis = b; return this; }

        public Builder qualified(String reason) {
            this.eligibility = Eligibility.qualified(reason);
            return this;
        }

        public Builder blocked(String blocker) {
            this.eligibility = Eligibility.blocked(blocker);
            return this;
        }

        public Builder eligibility(Eligibility e) { this.eligibility = e; return this; }

        public Builder mid(String key, Object value) {
            this.intermediate.put(key, value);
            return this;
        }

        public StatutoryResult build() {
            Eligibility e = eligibility != null
                    ? eligibility
                    : Eligibility.qualified("자격 조건 명시 없음 — 산식만 평가");
            Object out = finalOutput == null ? BigDecimal.ZERO : finalOutput;
            return new StatutoryResult(primitive, rawFormula,
                    Map.copyOf(substituted), out, legalBasis, e,
                    Map.copyOf(intermediate));
        }
    }
}
