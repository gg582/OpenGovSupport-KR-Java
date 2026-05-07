package com.opengov.support.tax.document;

import com.opengov.support.tax.rule.DocumentSpec;
import com.opengov.support.tax.rule.TaxRule;

import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 룰의 필요서류·발급기관·제출채널을 체크리스트로 묶어 반환.
 *
 * <p>법령 자체에는 "발급기관"이 명시되지 않은 경우가 대부분이므로,
 * 실무 안내 기준으로 {@code DocumentSpec} 에 직접 매핑한다 (정부24·국세청·국민건강보험공단 등).
 */
@Component
public class DocumentEngine {

    public DocumentChecklist build(TaxRule rule) {
        List<DocumentSpec> docs = rule.requiredDocuments() == null
                ? List.of() : rule.requiredDocuments();
        List<String> channels = rule.submissionChannels() == null
                ? List.of() : rule.submissionChannels();
        return new DocumentChecklist(docs, channels);
    }
}
