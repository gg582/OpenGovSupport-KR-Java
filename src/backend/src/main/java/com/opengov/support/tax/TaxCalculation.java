package com.opengov.support.tax;

import com.opengov.support.tax.audit.TaxAudit;
import com.opengov.support.tax.audit.TaxInputValidator;
import com.opengov.support.tax.document.DocumentChecklist;
import com.opengov.support.tax.document.DocumentEngine;
import com.opengov.support.tax.eligibility.EligibilityEngine;
import com.opengov.support.tax.eligibility.EligibilityResult;
import com.opengov.support.tax.explain.Explainer;
import com.opengov.support.tax.explain.ExplanationStep;
import com.opengov.support.tax.formula.FormulaContext;
import com.opengov.support.tax.formula.FormulaEngine;
import com.opengov.support.tax.formula.FormulaResult;
import com.opengov.support.tax.rule.RuleRegistry;
import com.opengov.support.tax.rule.TaxRule;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.Result;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 세무 계산 오케스트레이터. 한 룰 ID에 대해
 * 입력검증 → 자격 → 산식 → 서류 → 설명 → 감사 의 6단 파이프라인을 한 번에 수행한다.
 *
 * <p>호출 흐름:
 * <pre>
 * userInput  → TaxInputValidator (비현실적 입력 거부)
 *            → FormulaContext.of(...)
 *            → RuleRegistry.get(year, ruleId)
 *            → EligibilityEngine.check
 *            → FormulaEngine.evaluate (자격 통과 시)
 *            → DocumentEngine.build
 *            → Explainer.render (Result.text)
 *            → TaxAudit.recordCall (감사 + 통계)
 * </pre>
 */
@Component
public class TaxCalculation {

    private final RuleRegistry registry;
    private final EligibilityEngine eligibilityEngine;
    private final FormulaEngine formulaEngine;
    private final DocumentEngine documentEngine;
    private final Explainer explainer;
    private final TaxInputValidator validator;
    private final TaxAudit audit;

    public TaxCalculation(RuleRegistry registry,
                          EligibilityEngine eligibilityEngine,
                          FormulaEngine formulaEngine,
                          DocumentEngine documentEngine,
                          Explainer explainer,
                          TaxInputValidator validator,
                          TaxAudit audit) {
        this.registry = registry;
        this.eligibilityEngine = eligibilityEngine;
        this.formulaEngine = formulaEngine;
        this.documentEngine = documentEngine;
        this.explainer = explainer;
        this.validator = validator;
        this.audit = audit;
    }

    public Result run(int year, String ruleId, Map<String, Object> input) {
        long startNs = System.nanoTime();
        try {
            validator.validate(ruleId, input);
        } catch (ApiException e) {
            audit.recordRejection(ruleId, e.getMessage());
            throw e;
        }

        TaxRule rule = registry.get(year, ruleId)
                .orElseThrow(() -> {
                    String msg = String.format("세무 규칙을 찾을 수 없습니다: %s (%d년)", ruleId, year);
                    audit.recordRejection(ruleId, msg);
                    return ApiException.badRequest(msg);
                });

        FormulaContext ctx = FormulaContext.of(input);

        EligibilityResult eligibility = eligibilityEngine.check(rule, ctx);
        FormulaResult formula = eligibility.qualified()
                ? formulaEngine.evaluate(rule, ctx)
                : null;
        DocumentChecklist documents = documentEngine.build(rule);
        String text = explainer.render(rule, eligibility, formula, documents);
        List<ExplanationStep> steps = explainer.renderSteps(rule, eligibility, formula, documents);

        long durationMs = (System.nanoTime() - startNs) / 1_000_000L;
        audit.recordCall(ruleId, year, eligibility, formula, durationMs);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("ruleId", rule.ruleId());
        data.put("category", rule.category());
        data.put("year", year);
        data.put("legalSource", rule.legalSource());
        data.put("explanationSteps", steps);
        data.put("eligibility", Map.of(
                "qualified", eligibility.qualified(),
                "reasons", eligibility.reasons(),
                "blockers", eligibility.blockers()));
        if (formula != null) {
            data.put("amount", formula.amount());
            data.put("intermediate", formula.intermediate());
        }
        data.put("documents", documents.documents());
        data.put("submissionChannels", documents.submissionChannels());

        return Result.of(rule.title(), text, data);
    }
}
