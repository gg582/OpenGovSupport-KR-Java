package com.opengov.support.llm;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
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
        return proxy("/generate", body);
    }

    @PostMapping("/ax/plan")
    public ResponseEntity<?> axPlan(@RequestBody Map<String, Object> body) {
        return proxy("/ax/plan", body);
    }

    @PostMapping("/ax/fix")
    public ResponseEntity<?> axFix(@RequestBody Map<String, Object> body) {
        return proxy("/ax/fix", body);
    }

    @PostMapping("/agent/execute")
    public ResponseEntity<?> agentExecute(@RequestBody Map<String, Object> body) {
        try {
            return restTemplate.postForEntity("http://network-agent:8000/execute", body, Object.class);
        } catch (HttpServerErrorException e) {
            return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAs(Object.class));
        } catch (ResourceAccessException e) {
            return ResponseEntity.status(503).body(Map.of("error", "Network agent unavailable"));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        try {
            return restTemplate.getForEntity(llmUrl + "/health", Object.class);
        } catch (ResourceAccessException e) {
            return ResponseEntity.status(503).body(Map.of("status", "unavailable"));
        }
    }

    private ResponseEntity<?> proxy(String path, Map<String, Object> body) {
        try {
            return restTemplate.postForEntity(llmUrl + path, body, Object.class);
        } catch (HttpServerErrorException e) {
            return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAs(Object.class));
        } catch (ResourceAccessException e) {
            return ResponseEntity.status(503).body(Map.of("error", "LLM service unavailable"));
        }
    }
}
