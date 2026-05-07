package com.opengov.support.web.controller;

import com.opengov.support.runtime.DeferredJobRegistry;
import com.opengov.support.solver.RangeSolver;
import com.opengov.support.tax.TaxStandards;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Min/Max range explorer + Reverse calculation.
 *
 * <p>POST /api/dashboard/solver
 * <pre>
 * {
 *   "mode": "max | min | invert",
 *   "ruleId": "rent-credit",
 *   "year": 2026,
 *   "sweepVar": "rentPaid",
 *   "targetField": "amount",
 *   "target": 1200000,
 *   "constraint": "EQUAL | LTE | GTE",
 *   "input": { "salary": 50000000 },
 *   "lo": 0, "hi": 100000000, "tol": 1000
 * }
 * </pre>
 */
@RestController
@RequestMapping("/api/dashboard/solver")
public class SolverController {

    private final RangeSolver solver;
    private final DeferredJobRegistry jobs;

    public SolverController(RangeSolver solver, DeferredJobRegistry jobs) {
        this.solver = solver;
        this.jobs = jobs;
    }

    /**
     * 동기 solve — 빠른 케이스 (이분탐색 60회 미만, 룰 1종) 한정.
     * 더 비싼 작업은 {@code POST /api/dashboard/solver/async} 로 deferred 응답 사용.
     */
    @PostMapping
    public Map<String, Object> solve(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        String mode = JsonBody.str(body, "mode");
        String ruleId = JsonBody.str(body, "ruleId");
        if (ruleId.isEmpty()) throw ApiException.badRequest("ruleId 필수.");
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = TaxStandards.currentYear();
        String sweepVar = JsonBody.str(body, "sweepVar");
        if (sweepVar.isEmpty()) throw ApiException.badRequest("sweepVar 필수.");
        String targetField = JsonBody.str(body, "targetField");
        if (targetField.isEmpty()) targetField = "amount";

        BigDecimal target = bd(JsonBody.dbl(body, "target"));
        String constraint = JsonBody.str(body, "constraint");
        RangeSolver.Mode cmode = switch (constraint.toUpperCase()) {
            case "LTE" -> RangeSolver.Mode.LTE;
            case "GTE" -> RangeSolver.Mode.GTE;
            default -> RangeSolver.Mode.EQUAL;
        };

        @SuppressWarnings("unchecked")
        Map<String, Object> input = body.get("input") instanceof Map<?, ?> m
                ? (Map<String, Object>) m
                : new LinkedHashMap<>();

        BigDecimal lo = body.containsKey("lo") ? bd(JsonBody.dbl(body, "lo")) : BigDecimal.ZERO;
        BigDecimal hi = body.containsKey("hi") ? bd(JsonBody.dbl(body, "hi")) : new BigDecimal("100000000000");
        BigDecimal tol = body.containsKey("tol") ? bd(JsonBody.dbl(body, "tol")) : BigDecimal.ONE;
        RangeSolver.Bound bound = new RangeSolver.Bound(lo, hi, tol);

        return switch (mode.toLowerCase()) {
            case "min" -> solver.minimize(ruleId, year, input, sweepVar, targetField, target, cmode, bound);
            case "invert" -> solver.invert(ruleId, year, input, sweepVar, targetField, target, bound);
            default -> solver.maximize(ruleId, year, input, sweepVar, targetField, target, cmode, bound);
        };
    }

    /** 비동기 solve — 즉시 202 + Location: /api/dashboard/jobs/{id} */
    @PostMapping("/async")
    public ResponseEntity<Map<String, Object>> solveAsync(
            @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> snap = body == null ? Map.of() : Map.copyOf(body);
        String jobId = jobs.submit("solver", () -> solve(snap));
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

    private static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }
}
