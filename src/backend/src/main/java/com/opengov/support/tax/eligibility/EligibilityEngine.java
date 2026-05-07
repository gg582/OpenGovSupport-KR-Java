package com.opengov.support.tax.eligibility;

import com.opengov.support.tax.formula.FormulaContext;
import com.opengov.support.tax.rule.EligibilityClause;
import com.opengov.support.tax.rule.TaxRule;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 자격 판정. 룰의 {@code eligibility} 조항을 모두 평가하여 통과/불통 사유를 누적.
 *
 * <p>지원 연산자:
 * <ul>
 *   <li>{@code lt, lte, gt, gte} — 부등호</li>
 *   <li>{@code eq, ne} — 동등성</li>
 *   <li>{@code present} — 0이 아닐 것 (입력됨)</li>
 *   <li>{@code absent} — 0일 것 (입력 안 됨)</li>
 * </ul>
 *
 * 모든 비교는 {@link BigDecimal#compareTo}로 수행 — IEEE 754 부동소수점 비교 오차 없음.
 */
@Component
public class EligibilityEngine {

    public EligibilityResult check(TaxRule rule, FormulaContext ctx) {
        List<EligibilityClause> clauses = rule.eligibility();
        if (clauses == null || clauses.isEmpty()) {
            return new EligibilityResult(true,
                    List.of("자격 제한 조항 없음 — 모든 입력자가 본 산식 적용 대상."),
                    List.of());
        }
        List<String> reasons = new ArrayList<>();
        List<String> blockers = new ArrayList<>();
        for (EligibilityClause c : clauses) {
            BigDecimal v = ctx.num(c.variable());
            BigDecimal target = c.value() == null ? BigDecimal.ZERO : c.value();
            boolean ok = test(c.op(), v, target);
            String desc = describe(c, v, target);
            if (ok) reasons.add(desc + " → 통과");
            else blockers.add(desc + " → 미충족" + (c.message() == null ? "" : " (" + c.message() + ")"));
        }
        return new EligibilityResult(blockers.isEmpty(), reasons, blockers);
    }

    private static boolean test(String op, BigDecimal v, BigDecimal t) {
        if (op == null) return true;
        int cmp = v.compareTo(t);
        return switch (op) {
            case "lt" -> cmp < 0;
            case "lte" -> cmp <= 0;
            case "gt" -> cmp > 0;
            case "gte" -> cmp >= 0;
            case "eq" -> cmp == 0;
            case "ne" -> cmp != 0;
            case "present" -> v.signum() != 0;
            case "absent" -> v.signum() == 0;
            default -> throw new IllegalArgumentException("알 수 없는 연산자: " + op);
        };
    }

    private static String describe(EligibilityClause c, BigDecimal actual, BigDecimal target) {
        String op = switch (c.op() == null ? "" : c.op()) {
            case "lt" -> "<";
            case "lte" -> "≤";
            case "gt" -> ">";
            case "gte" -> "≥";
            case "eq" -> "=";
            case "ne" -> "≠";
            case "present" -> "값 있음";
            case "absent" -> "값 없음";
            default -> c.op();
        };
        if ("present".equals(c.op()) || "absent".equals(c.op())) {
            return String.format("[%s] %s (실제: %s)", c.variable(), op, format(actual));
        }
        return String.format("[%s] %s %s (실제: %s)",
                c.variable(), op, format(target), format(actual));
    }

    private static String format(BigDecimal v) {
        BigDecimal stripped = v.stripTrailingZeros();
        if (stripped.scale() <= 0) {
            return String.format("%,d", stripped.toBigInteger());
        }
        return stripped.toPlainString();
    }
}
