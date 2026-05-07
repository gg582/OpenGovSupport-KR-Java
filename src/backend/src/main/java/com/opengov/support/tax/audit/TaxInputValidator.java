package com.opengov.support.tax.audit;

import com.opengov.support.web.ApiException;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;

/**
 * 세무 입력 sanity 검증. 룰엔진 진입 전에 비현실적 입력을 거부.
 *
 * <p>검증 항목:
 * <ul>
 *   <li>음수 금액 거부 ({@code year} 등 메타값은 예외)</li>
 *   <li>비현실적 상한 — 1조원(10^12) 초과 단일 변수 거부 (오타·DoS 방지)</li>
 *   <li>{@code year} 1900~2100 범위</li>
 * </ul>
 *
 * <p>본 검증기는 fraud detection 의 1차 방어선일 뿐, 실제 자격 판정은
 * {@code EligibilityEngine} 에서 룰별 조항으로 수행한다.
 */
@Component
public class TaxInputValidator {

    /** 단일 입력값의 비현실적 상한 (1조원). */
    public static final BigDecimal MAX_REASONABLE_AMOUNT = new BigDecimal("1000000000000");

    private static final BigDecimal MIN_YEAR = new BigDecimal("1900");
    private static final BigDecimal MAX_YEAR = new BigDecimal("2100");

    /** 음수 허용 변수 (입력으로 음수가 들어와도 무방한 경우). 현재 없음. */
    private static final Set<String> NEGATIVE_ALLOWED = Set.of();

    public void validate(String ruleId, Map<String, Object> input) {
        if (input == null) return;
        for (Map.Entry<String, Object> e : input.entrySet()) {
            String key = e.getKey();
            Object value = e.getValue();
            if (value == null) continue;
            BigDecimal num = coerce(value);
            if (num == null) continue; // 텍스트 (industry, stage 등) → 통과

            if ("year".equals(key)) {
                if (num.compareTo(MIN_YEAR) < 0 || num.compareTo(MAX_YEAR) > 0) {
                    throw ApiException.badRequest(
                            String.format("연도 범위 오류: year=%s (1900~2100 허용)",
                                    num.toPlainString()));
                }
                continue;
            }

            if (num.signum() < 0 && !NEGATIVE_ALLOWED.contains(key)) {
                throw ApiException.badRequest(
                        String.format("음수 입력은 허용되지 않습니다: %s=%s (룰: %s)",
                                key, format(num), ruleId));
            }

            if (num.abs().compareTo(MAX_REASONABLE_AMOUNT) > 0) {
                throw ApiException.badRequest(
                        String.format("비현실적 금액: %s=%s (단일 변수 1조원 상한, 룰: %s)",
                                key, format(num), ruleId));
            }
        }
    }

    private static BigDecimal coerce(Object v) {
        if (v instanceof BigDecimal bd) return bd;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        if (v instanceof Boolean b) return b ? BigDecimal.ONE : BigDecimal.ZERO;
        try {
            return new BigDecimal(v.toString().replace(",", "").trim());
        } catch (NumberFormatException e) {
            return null; // 텍스트
        }
    }

    private static String format(BigDecimal v) {
        BigDecimal stripped = v.stripTrailingZeros();
        if (stripped.scale() <= 0) {
            return String.format("%,d", stripped.toBigInteger());
        }
        return stripped.toPlainString();
    }
}
