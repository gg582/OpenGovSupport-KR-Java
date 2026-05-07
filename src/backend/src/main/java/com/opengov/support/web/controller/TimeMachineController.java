package com.opengov.support.web.controller;

import com.opengov.support.domain.Standards;
import com.opengov.support.runtime.DeferredJobRegistry;
import com.opengov.support.tax.TaxCalculation;
import com.opengov.support.tax.TaxStandards;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Legal Time Machine — 동일 입력을 여러 연도 룰셋에서 실행하고 결과 + delta 를 반환.
 *
 * <p>해당 룰이 특정 연도 디렉터리에 정의돼 있지 않으면 {@code RuleRegistry} 의 fallback 으로
 * 직전 연도가 사용된다 — 이로써 "변경 없는 연도" 에 대해서도 결과가 일관된다.
 *
 * <p>요청:
 * <pre>
 * POST /api/dashboard/time-machine
 * {
 *   "ruleId": "comprehensive-income-tax",
 *   "years": [2024, 2025, 2026],
 *   "input": { "taxableIncome": 88000000 }
 * }
 * </pre>
 */
@RestController
@RequestMapping("/api/dashboard/time-machine")
public class TimeMachineController {

    private static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    private final TaxCalculation calculation;
    private final DeferredJobRegistry jobs;

    public TimeMachineController(TaxCalculation calculation, DeferredJobRegistry jobs) {
        this.calculation = calculation;
        this.jobs = jobs;
    }

    /** 보유 연도 목록 — 세무(룰 디렉터리) ∪ 복지(Standards). */
    @GetMapping("/years")
    public Map<String, Object> years() {
        Map<String, Object> out = new LinkedHashMap<>();
        TreeSet<Integer> all = new TreeSet<>();
        all.addAll(TaxStandards.SUPPORTED_YEARS);
        all.addAll(Standards.SUPPORTED_YEARS);
        out.put("years", new ArrayList<>(all).reversed());
        out.put("currentYear", TaxStandards.currentYear());
        out.put("taxYears", TaxStandards.SUPPORTED_YEARS);
        out.put("welfareYears", Standards.SUPPORTED_YEARS);
        return out;
    }

    @PostMapping
    public Map<String, Object> run(@RequestBody Map<String, Object> body) {
        if (body == null) throw ApiException.badRequest("본문이 비어 있습니다.");
        String ruleId = JsonBody.str(body, "ruleId");
        if (ruleId.isEmpty()) throw ApiException.badRequest("ruleId 필수.");

        Object yearsRaw = body.get("years");
        List<Integer> years = new ArrayList<>();
        if (yearsRaw instanceof List<?> l) {
            for (Object o : l) {
                if (o instanceof Number n) years.add(n.intValue());
                else if (o instanceof String s) {
                    try { years.add(Integer.parseInt(s.trim())); } catch (NumberFormatException ignored) {}
                }
            }
        }
        if (years.isEmpty()) {
            // 기본 — 보유 연도 전체.
            TreeSet<Integer> all = new TreeSet<>();
            all.addAll(TaxStandards.SUPPORTED_YEARS);
            all.addAll(Standards.SUPPORTED_YEARS);
            years = new ArrayList<>(all);
        }

        Object inputRaw = body.get("input");
        Map<String, Object> input = inputRaw instanceof Map<?, ?> m
                ? coerceMap(m) : Map.of();

        List<Map<String, Object>> resultsByYear = new ArrayList<>();
        BigDecimal previous = null;
        for (int y : years) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("year", y);
            try {
                Map<String, Object> bodyForYear = new LinkedHashMap<>(input);
                bodyForYear.put("year", y);
                var result = calculation.run(y, ruleId, bodyForYear);
                Map<String, Object> data = result.data();
                Object amount = data == null ? null : data.get("amount");
                if (amount == null && data != null) amount = data.get("finalOutput");
                BigDecimal current = toBd(amount);
                entry.put("amount", current);
                entry.put("title", result.title());
                entry.put("data", data);
                if (previous != null) {
                    BigDecimal delta = current.subtract(previous, MC);
                    entry.put("deltaFromPrevious", delta);
                    entry.put("deltaPct", previous.signum() == 0
                            ? BigDecimal.ZERO
                            : delta.multiply(BigDecimal.valueOf(100), MC)
                                    .divide(previous, 4, RoundingMode.HALF_UP));
                }
                previous = current;
            } catch (RuntimeException e) {
                entry.put("error", e.getMessage());
            }
            resultsByYear.add(entry);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ruleId", ruleId);
        out.put("years", years);
        out.put("input", input);
        out.put("results", resultsByYear);
        // 통합 delta 표 — 첫 연도 대비.
        if (!resultsByYear.isEmpty()) {
            BigDecimal base = toBd(resultsByYear.get(0).get("amount"));
            List<Map<String, Object>> deltaTable = new ArrayList<>();
            for (Map<String, Object> e : resultsByYear) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("year", e.get("year"));
                BigDecimal cur = toBd(e.get("amount"));
                row.put("amount", cur);
                row.put("deltaFromBase", cur.subtract(base, MC));
                deltaTable.add(row);
            }
            out.put("deltaTable", deltaTable);
        }
        return out;
    }

    /** 비동기 — 5+ 연도 비교 등 비싼 워크로드. */
    @PostMapping("/async")
    public ResponseEntity<Map<String, Object>> runAsync(@RequestBody Map<String, Object> body) {
        Map<String, Object> snap = body == null ? Map.of() : Map.copyOf(body);
        String jobId = jobs.submit("time-machine", () -> run(snap));
        Map<String, Object> ack = new LinkedHashMap<>();
        ack.put("jobId", jobId);
        ack.put("status", "PENDING");
        ack.put("location", "/api/dashboard/jobs/" + jobId);
        return ResponseEntity
                .accepted()
                .location(URI.create("/api/dashboard/jobs/" + jobId))
                .header("Retry-After", "1")
                .body(ack);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> coerceMap(Map<?, ?> raw) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : raw.entrySet()) {
            m.put(String.valueOf(e.getKey()), e.getValue());
        }
        return m;
    }

    private static BigDecimal toBd(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal b) return b;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        try { return new BigDecimal(v.toString().replace(",", "").trim()); }
        catch (NumberFormatException e) { return BigDecimal.ZERO; }
    }
}
