package com.opengov.support.web.controller;

import com.opengov.support.tax.TaxCalculation;
import com.opengov.support.tax.TaxStandards;
import com.opengov.support.tax.composite.ComprehensiveRefund;
import com.opengov.support.tax.composite.YearEndSettlement;
import com.opengov.support.tax.rule.RuleRegistry;
import com.opengov.support.tax.rule.TaxRule;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.Result;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 개인세무 단일 진입점.
 *
 * <ul>
 *   <li>{@code /year-end-settlement} — 연말정산 통합 합성 시나리오</li>
 *   <li>{@code /comprehensive-income-refund} — 종합소득세 환급/추징 합성 시나리오</li>
 *   <li>{@code /{ruleId}} — 단일 룰 평가 (룰 ID 가 그대로 마지막 세그먼트)</li>
 * </ul>
 *
 * <p>요청 본문에 {@code year}(선택, 없으면 최신연도) + 룰별 변수.
 */
@RestController
@RequestMapping("/api/tax")
public class TaxController {

    private final TaxCalculation calculation;
    private final YearEndSettlement yearEnd;
    private final ComprehensiveRefund refund;
    private final RuleRegistry registry;

    public TaxController(TaxCalculation calculation,
                         YearEndSettlement yearEnd,
                         ComprehensiveRefund refund,
                         RuleRegistry registry) {
        this.calculation = calculation;
        this.yearEnd = yearEnd;
        this.refund = refund;
        this.registry = registry;
    }

    /** 보유한 모든 연도의 룰 ID 목록 (감사·갱신용). */
    @GetMapping("/rules")
    public Map<String, Object> rules() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("coverage", registry.coverage());
        return out;
    }

    /** 특정 연도의 룰 전체 노출. 법령 갱신 시 변경 내역 검토용. */
    @GetMapping("/rules/{year}")
    public List<TaxRule> rulesForYear(@PathVariable int year) {
        if (year < 1900 || year > 2100) {
            throw ApiException.badRequest("연도 범위 오류: " + year);
        }
        return registry.allFor(year);
    }

    @PostMapping("/year-end-settlement")
    public Result yearEndSettlement(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = TaxStandards.currentYear();
        return yearEnd.run(year, body);
    }

    @PostMapping("/comprehensive-income-refund")
    public Result comprehensiveIncomeRefund(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = TaxStandards.currentYear();
        return refund.run(year, body);
    }

    @PostMapping("/{ruleId}")
    public Result run(@PathVariable String ruleId,
                      @RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = TaxStandards.currentYear();
        return calculation.run(year, ruleId, body);
    }
}
