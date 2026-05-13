package com.opengov.support.ax;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

/**
 * AX 플랜을 순서대로 실행하는 오케스트레이터.
 *
 * <p>각 단계는 남아 웹 애플리케이션 남아 엔드포인트(로컬) 로 호출된다.
 * 이 방식으로 AX 모듈은 세무/복지/상속 등 개별 도메인 서비스에 직접 의존하지 않으며,
 * 모듈 자체를 삭제하거나 비활성화핫도 나머지 시스템이 영향을 받지 않는다.</p>
 */
@Service
public class AxAutomationService {

    private final RestTemplate restTemplate = new RestTemplate();
    private final int maxWaitSeconds;
    private final String baseUrl;

    public AxAutomationService(AxProperties properties,
                               @Value("${server.internal-port:8080}") int port) {
        this.maxWaitSeconds = properties.getMaxWaitSeconds();
        this.baseUrl = "http://localhost:" + port;
    }

    /**
     * 플랜을 순서대로 실행. 중간 단계 실패 시 즉시 중단하고 실패 결과를 반환.
     *
     * @throws AxTimeoutException 제한 시간 초과 시
     */
    public AxExecutionResult execute(AxPlan plan) {
        if (plan.getSteps() == null || plan.getSteps().isEmpty()) {
            AxExecutionResult empty = new AxExecutionResult();
            empty.setOverallSuccess(true);
            empty.setStepResults(List.of());
            empty.setElapsedMs(0);
            empty.setMessage("플랜에 실행 단계가 없습니다.");
            return empty;
        }

        List<AxStepResult> results = new ArrayList<>();
        long startTime = System.currentTimeMillis();
        long deadline = startTime + maxWaitSeconds * 1000L;

        for (int i = 0; i < plan.getSteps().size(); i++) {
            if (System.currentTimeMillis() > deadline) {
                throw new AxTimeoutException(
                        "AX 실행 제한 시간 " + maxWaitSeconds + "초 초과 (단계 " + (i + 1) + "/" + plan.getSteps().size() + ")"
                );
            }

            AxStep step = plan.getSteps().get(i);
            AxStepResult stepResult = executeStep(step);
            results.add(stepResult);

            if (!stepResult.isSuccess()) {
                return buildResult(results, startTime, false,
                        "단계 " + (i + 1) + " 실패: " + step.getOutputKey() + " — " + stepResult.getError());
            }
        }

        return buildResult(results, startTime, true,
                "모든 " + plan.getSteps().size() + "개 단계 성공");
    }

    private AxStepResult executeStep(AxStep step) {
        AxStepResult r = new AxStepResult();
        r.setOutputKey(step.getOutputKey());
        r.setDescription(step.getDescription());

        try {
            String url = baseUrl + step.getEndpoint();
            ResponseEntity<JsonNode> response;
            if ("GET".equalsIgnoreCase(step.getMethod())) {
                response = restTemplate.getForEntity(url, JsonNode.class, step.getInputs());
            } else {
                response = restTemplate.postForEntity(url, step.getInputs(), JsonNode.class);
            }
            r.setResponse(response.getBody());
            r.setSuccess(true);
        } catch (RestClientException e) {
            r.setSuccess(false);
            r.setError(e.getMessage());
        }
        return r;
    }

    private AxExecutionResult buildResult(List<AxStepResult> results,
                                          long startTime,
                                          boolean success,
                                          String message) {
        AxExecutionResult result = new AxExecutionResult();
        result.setOverallSuccess(success);
        result.setStepResults(results);
        result.setElapsedMs(System.currentTimeMillis() - startTime);
        result.setMessage(message);
        return result;
    }
}
