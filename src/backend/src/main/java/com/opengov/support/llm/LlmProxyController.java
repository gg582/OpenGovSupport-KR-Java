package com.opengov.support.llm;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * LLM 서비스로 요청을 프록시하는 컨트롤러.
 * 프론트엔드는 WebGPU/CNN 대신 이 엔드포인트를 통해 서버 사이드 Qwen 을 사용한다.
 */
@RestController
@RequestMapping("/api/llm")
public class LlmProxyController {

    private final RestTemplate restTemplate = new RestTemplate();
    private final String llmUrl;

    public LlmProxyController(@Value("${llm.service.url:http://llm:8000}") String llmUrl) {
        this.llmUrl = llmUrl;
    }

    @PostMapping("/generate")
    public ResponseEntity<?> generate(@RequestBody Map<String, Object> body) {
        return restTemplate.postForEntity(llmUrl + "/generate", body, Object.class);
    }

    @PostMapping("/ax/plan")
    public ResponseEntity<?> axPlan(@RequestBody Map<String, Object> body) {
        return restTemplate.postForEntity(llmUrl + "/ax/plan", body, Object.class);
    }

    @PostMapping("/ax/fix")
    public ResponseEntity<?> axFix(@RequestBody Map<String, Object> body) {
        return restTemplate.postForEntity(llmUrl + "/ax/fix", body, Object.class);
    }

    @PostMapping("/agent/execute")
    public ResponseEntity<?> agentExecute(@RequestBody Map<String, Object> body) {
        return restTemplate.postForEntity("http://network-agent:8000/execute", body, Object.class);
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        return restTemplate.getForEntity(llmUrl + "/health", Object.class);
    }
}
