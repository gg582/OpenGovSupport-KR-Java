package com.opengov.support.tax.audit;

import com.opengov.support.tax.eligibility.EligibilityResult;
import com.opengov.support.tax.formula.FormulaResult;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 세무 룰 호출의 감사 로그 + 통계 카운터.
 *
 * <p>매 호출마다 한 줄 메시지를 SLF4J INFO 레벨로 기록하며 (운영에선
 * 별도 appender 로 파일·SIEM·CloudWatch 등으로 분기), 메모리에는 ruleId 별 호출수 +
 * qualified/blocked/rejected 누적치를 둔다 (경량 카운터, 영속화 없음).
 *
 * <p>감사 로그 항목:
 * <pre>
 * tax-audit ts=… ruleId=… year=… qualified=… amount=… durationMs=…
 * </pre>
 *
 * 입력 원문은 로그에 남기지 않는다 (PII 보호 — 산식 변수만 기록).
 */
@Component
public class TaxAudit {

    private static final Logger log = LoggerFactory.getLogger(TaxAudit.class);

    private final ConcurrentMap<String, AtomicLong> ruleCallCount = new ConcurrentHashMap<>();
    private final AtomicLong totalCalls = new AtomicLong();
    private final AtomicLong qualifiedCount = new AtomicLong();
    private final AtomicLong blockedCount = new AtomicLong();
    private final AtomicLong rejectedCount = new AtomicLong();

    public void recordCall(String ruleId,
                           int year,
                           EligibilityResult eligibility,
                           FormulaResult formula,
                           long durationMs) {
        totalCalls.incrementAndGet();
        ruleCallCount.computeIfAbsent(ruleId, k -> new AtomicLong()).incrementAndGet();
        if (eligibility.qualified()) qualifiedCount.incrementAndGet();
        else blockedCount.incrementAndGet();

        BigDecimal amount = formula == null
                ? BigDecimal.ZERO
                : formula.amount().setScale(0, RoundingMode.HALF_UP);
        log.info("tax-audit ts={} ruleId={} year={} qualified={} amount={} durationMs={}",
                Instant.now(),
                ruleId,
                year,
                eligibility.qualified(),
                amount.toPlainString(),
                durationMs);
    }

    public void recordRejection(String ruleId, String reason) {
        rejectedCount.incrementAndGet();
        log.warn("tax-rejected ruleId={} reason={}", ruleId, reason);
    }

    public Map<String, Object> snapshot() {
        Map<String, Long> perRule = new LinkedHashMap<>();
        ruleCallCount.forEach((k, v) -> perRule.put(k, v.get()));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("totalCalls", totalCalls.get());
        out.put("qualified", qualifiedCount.get());
        out.put("blocked", blockedCount.get());
        out.put("rejected", rejectedCount.get());
        out.put("byRule", perRule);
        return out;
    }
}
