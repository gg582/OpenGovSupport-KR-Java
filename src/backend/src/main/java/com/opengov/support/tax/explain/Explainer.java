package com.opengov.support.tax.explain;

import com.opengov.support.tax.document.DocumentChecklist;
import com.opengov.support.tax.eligibility.EligibilityResult;
import com.opengov.support.tax.formula.FormulaResult;
import com.opengov.support.tax.rule.DocumentSpec;
import com.opengov.support.tax.rule.TaxRule;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * 자격·산식·서류 결과를 한국어 설명문으로 직렬화.
 * 출력은 {@code Result.text} 필드에 그대로 들어가는 모노스페이스 친화 텍스트.
 *
 * <p>모든 결과 텍스트의 첫 줄에는 [면책] 안내가 강제로 부착된다.
 */
@Component
public class Explainer {

    public String render(TaxRule rule,
                         EligibilityResult eligibility,
                         FormulaResult formula,
                         DocumentChecklist documents) {
        List<ExplanationStep> steps = renderSteps(rule, eligibility, formula, documents);
        StringBuilder b = new StringBuilder();
        for (ExplanationStep s : steps) {
            b.append(s.label());
            if (s.body() != null && !s.body().isEmpty()) b.append(' ').append(s.body());
            b.append('\n');
        }
        return b.toString();
    }

    public List<ExplanationStep> renderSteps(TaxRule rule,
                                             EligibilityResult eligibility,
                                             FormulaResult formula,
                                             DocumentChecklist documents) {
        List<ExplanationStep> steps = new ArrayList<>();
        steps.add(ExplanationStep.of("[면책]",
                "본 산출은 법령의 공개 산식을 코드로 평가한 참고 자료이며, 신고·납부의 효력을 갖지 않습니다. " +
                "실제 신고는 홈택스(국세청) 또는 세무전문가를 통해 확정하십시오."));
        steps.add(ExplanationStep.of("[근거 법령]", rule.legalSource() == null ? "(미기재)" : rule.legalSource()));
        steps.add(ExplanationStep.of("[항목]", rule.title() + " (" + rule.category() + ")"));

        if (eligibility.qualified()) {
            steps.add(ExplanationStep.of("[자격 판정]", "적용 가능"));
            for (String r : eligibility.reasons()) {
                steps.add(ExplanationStep.of("  ·", r));
            }
        } else {
            steps.add(ExplanationStep.of("[자격 판정]", "적용 불가"));
            for (String r : eligibility.blockers()) {
                steps.add(ExplanationStep.of("  ·", r));
            }
        }

        steps.add(ExplanationStep.of("[산식]", rule.formulaExpression() == null ? "" : rule.formulaExpression()));
        if (formula != null) {
            Object eval = formula.intermediate().get("evaluation");
            if (eval != null) steps.add(ExplanationStep.of("[대입]", eval.toString()));
            steps.add(ExplanationStep.of("[결과]", won(formula.amount())));
        }

        if (documents != null && !documents.documents().isEmpty()) {
            steps.add(ExplanationStep.of("[필요서류]", ""));
            for (DocumentSpec d : documents.documents()) {
                String online = d.onlineIssuance() ? "온라인 발급 가능" : "방문 발급";
                String note = d.note() == null || d.note().isEmpty() ? "" : " · " + d.note();
                steps.add(ExplanationStep.of("  ·",
                        String.format("%s (발급: %s, %s, 제출: %s)%s",
                                d.name(), d.issuer(), online, d.submitTo(), note)));
            }
        }
        if (documents != null && !documents.submissionChannels().isEmpty()) {
            steps.add(ExplanationStep.of("[제출 채널]", String.join(", ", documents.submissionChannels())));
        }
        return steps;
    }

    private static String won(BigDecimal v) {
        BigDecimal rounded = v.setScale(0, RoundingMode.HALF_UP);
        return String.format("%,d원", rounded.toBigInteger());
    }
}
