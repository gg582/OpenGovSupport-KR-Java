package com.opengov.support.welfare;

import com.opengov.support.domain.Standards;
import com.opengov.support.primitive.StatutoryPrimitive;
import com.opengov.support.primitive.StatutoryResult;
import com.opengov.support.primitive.VatDeltaEngine;
import com.opengov.support.primitive.DeductionLadderEngine;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 복지 + 비세무 primitive 오케스트레이터.
 *
 * <p>한 번의 호출로 다음 흐름을 평가:
 * <pre>
 * RecognizedIncomeEngine → MedianIncomeRatioEngine
 *                       → (option) 해외체류 정지 검토
 *                       → 자격 결과 종합
 * </pre>
 */
@Component
public class WelfareCalculation {

    private final RecognizedIncomeEngine recognizedIncome;
    private final MedianIncomeRatioEngine medianRatio;
    private final LegalPriorityTreeEngine legalTree;
    private final VatDeltaEngine vatDelta;
    private final DeductionLadderEngine deductionLadder;

    public WelfareCalculation(RecognizedIncomeEngine recognizedIncome,
                              MedianIncomeRatioEngine medianRatio,
                              LegalPriorityTreeEngine legalTree,
                              VatDeltaEngine vatDelta,
                              DeductionLadderEngine deductionLadder) {
        this.recognizedIncome = recognizedIncome;
        this.medianRatio = medianRatio;
        this.legalTree = legalTree;
        this.vatDelta = vatDelta;
        this.deductionLadder = deductionLadder;
    }

    public RecognizedIncomeEngine recognizedIncome() { return recognizedIncome; }
    public MedianIncomeRatioEngine medianRatio() { return medianRatio; }
    public LegalPriorityTreeEngine legalTree() { return legalTree; }
    public VatDeltaEngine vatDelta() { return vatDelta; }
    public DeductionLadderEngine deductionLadder() { return deductionLadder; }

    /**
     * 통합 자격 판정 — 소득인정액 → 비율 → 4급여 자격.
     * 해외체류 일수가 임계 초과 시 정지 사유로 추가.
     */
    public Map<String, Object> eligibilityFlow(
            int year,
            int householdSize,
            RecognizedIncomeEngine.Input riInput,
            int overseasDays,
            String overseasRuleKey) {

        StatutoryResult ri = recognizedIncome.evaluate(riInput);
        BigDecimal recognized = ri.finalOutput() instanceof BigDecimal bd ? bd : BigDecimal.ZERO;

        StatutoryResult mr = medianRatio.evaluate(
                new MedianIncomeRatioEngine.Input(year, householdSize, recognized));

        boolean overseasSuspended = false;
        String overseasReason = null;
        int threshold = Standards.overseasThreshold(overseasRuleKey);
        if (overseasDays > threshold) {
            overseasSuspended = true;
            overseasReason = String.format(
                    "해외체류 누적 %d일 > 임계 %d일 — %s 자격 정지",
                    overseasDays, threshold,
                    overseasRuleKey == null ? "기초생활" : overseasRuleKey);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("recognizedIncome", ri);
        out.put("medianRatio", mr);
        out.put("overseasThresholdDays", threshold);
        out.put("overseasDays", overseasDays);
        out.put("overseasSuspended", overseasSuspended);
        if (overseasReason != null) out.put("overseasReason", overseasReason);

        // 최종 자격 — 비율 통과 ∧ 해외체류 정지 아님.
        boolean qualified = mr.eligibility().qualified() && !overseasSuspended;
        out.put("qualified", qualified);
        out.put("primitivesUsed", List.of(
                StatutoryPrimitive.RECOGNIZED_INCOME.name(),
                StatutoryPrimitive.MEDIAN_INCOME_RATIO.name()));
        return out;
    }
}
