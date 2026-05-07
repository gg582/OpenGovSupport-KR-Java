package com.opengov.support.runtime;

import com.opengov.support.tax.audit.TaxAudit;
import com.opengov.support.tax.rule.RuleRegistry;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/runtime")
public class RuntimeStatsController {

    private final BoundedRequestPool pool;
    private final RequestCoalescer coalescer;
    private final TaxAudit taxAudit;
    private final RuleRegistry ruleRegistry;

    public RuntimeStatsController(BoundedRequestPool pool,
                                  RequestCoalescer coalescer,
                                  TaxAudit taxAudit,
                                  RuleRegistry ruleRegistry) {
        this.pool = pool;
        this.coalescer = coalescer;
        this.taxAudit = taxAudit;
        this.ruleRegistry = ruleRegistry;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        Map<String, Object> tax = new LinkedHashMap<>();
        tax.put("audit", taxAudit.snapshot());
        tax.put("rules", ruleRegistry.coverage());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("pool", pool.snapshot());
        out.put("coalescer", coalescer.snapshot());
        out.put("tax", tax);
        return out;
    }
}
