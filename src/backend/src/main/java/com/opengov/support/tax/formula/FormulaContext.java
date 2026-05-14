package com.opengov.support.tax.formula;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 산식 평가 시점의 변수 바인딩 컨텍스트. 두 종류:
 *
 * <ul>
 *   <li>{@code nums} — 임의정밀 숫자 변수 ({@link BigDecimal}). 세무 산식 부동소수점 오차 방지.</li>
 *   <li>{@code texts} — 텍스트형 변수 (industry, stage 등). {@code rateMap}/{@code capMap}의 키 룩업용.</li>
 * </ul>
 *
 * <p>입력 변환 규칙:
 * <ul>
 *   <li>{@link BigDecimal} → 그대로</li>
 *   <li>{@link Long}/{@link Integer} → 정확한 {@link BigDecimal}</li>
 *   <li>{@link Double}/{@link Float} → {@code toString()} 경유 (Jackson의 USE_BIG_DECIMAL_FOR_FLOATS 가
 *       활성화돼 있으면 애초에 Double로 들어오지 않음)</li>
 *   <li>String → 콤마/공백 제거 후 {@link BigDecimal} 파싱 시도, 실패시 텍스트만 저장</li>
 * </ul>
 */
public final class FormulaContext {

    private final Map<String, BigDecimal> nums = new LinkedHashMap<>();
    private final Map<String, String> texts = new LinkedHashMap<>();

    public static FormulaContext of(Map<String, ?> raw) {
        FormulaContext c = new FormulaContext();
        if (raw == null) return c;
        raw.forEach(c::bind);
        return c;
    }

    public FormulaContext bind(String name, Object v) {
        if (v == null) return this;
        if (v instanceof BigDecimal bd) {
            nums.put(name, bd);
            return this;
        }
        if (v instanceof Number n) {
            // toString() 경유로 Double 의 binary 부정확성을 우회
            nums.put(name, new BigDecimal(n.toString()));
            return this;
        }
        if (v instanceof Boolean b) {
            nums.put(name, b ? BigDecimal.ONE : BigDecimal.ZERO);
            return this;
        }
        String s = v.toString();
        texts.put(name, s);
        // 한국어/영문 boolean 매핑 — select 입력값을 수치로 해석
        if ("해당".equals(s) || "예".equals(s) || "true".equalsIgnoreCase(s) || "yes".equalsIgnoreCase(s)) {
            nums.put(name, BigDecimal.ONE);
            return this;
        }
        if ("미해당".equals(s) || "아니오".equals(s) || "false".equalsIgnoreCase(s) || "no".equalsIgnoreCase(s)) {
            nums.put(name, BigDecimal.ZERO);
            return this;
        }
        if ("배우자도".equals(s)) {
            nums.put(name, BigDecimal.ONE);
            return this;
        }
        if ("본인만".equals(s)) {
            nums.put(name, BigDecimal.ZERO);
            return this;
        }
        try {
            nums.put(name, new BigDecimal(s.replace(",", "").trim()));
        } catch (NumberFormatException ignored) {
            // 텍스트 전용 (industry, stage 같은 것)
        }
        return this;
    }

    public FormulaContext put(String name, BigDecimal v) {
        nums.put(name, v);
        return this;
    }

    public BigDecimal num(String name) {
        return nums.getOrDefault(name, BigDecimal.ZERO);
    }

    public String text(String name) {
        return texts.getOrDefault(name, "");
    }

    public boolean has(String name) {
        return nums.containsKey(name) || texts.containsKey(name);
    }

    public Map<String, BigDecimal> snapshot() {
        return Map.copyOf(nums);
    }
}
