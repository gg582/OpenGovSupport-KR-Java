package com.opengov.support.llm;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * LLM 서비스로 요청을 프록시하는 컨트롤러.
 * 프론트엔드는 WebGPU/CNN 대신 이 엔드포인트를 통해 서버 사이드 Qwen 을 사용한다.
 */
@RestController
@RequestMapping("/api/llm")
public class LlmProxyController {

    private static final Logger log = LoggerFactory.getLogger(LlmProxyController.class);
    private static final Set<String> SKIP_HEADERS = Set.of(
            "host", "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "transfer-encoding",
            "upgrade", "content-length", "authorization", "cookie", "set-cookie"
    );
    private final RestTemplate restTemplate = new RestTemplate();
    private final String llmUrl;

    public LlmProxyController(@Value("${llm.service.url:http://llm:8000}") String llmUrl) {
        this.llmUrl = llmUrl;
    }

    @PostMapping("/generate")
    public ResponseEntity<?> generate(@RequestBody Map<String, Object> body) {
        return postToLlm("/generate", body);
    }

    @PostMapping("/ax/plan")
    public ResponseEntity<?> axPlan(@RequestBody Map<String, Object> body) {
        return postToLlm("/ax/plan", body);
    }

    @PostMapping("/ax/fix")
    public ResponseEntity<?> axFix(@RequestBody Map<String, Object> body) {
        return postToLlm("/ax/fix", body);
    }

    @PostMapping("/agent/execute")
    public ResponseEntity<?> agentExecute(@RequestBody Map<String, Object> body) {
        return restTemplate.postForEntity("http://network-agent:8000/execute", body, Object.class);
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        try {
            ResponseEntity<byte[]> upstream = restTemplate.getForEntity(llmUrl + "/health", byte[].class);
            return copyResponse(upstream);
        } catch (RestClientResponseException e) {
            return errorFromUpstream(e);
        } catch (RestClientException e) {
            return badGateway("LLM health check upstream unavailable", e);
        }
    }

    private ResponseEntity<?> postToLlm(String path, Map<String, Object> body) {
        try {
            ResponseEntity<byte[]> upstream = restTemplate.postForEntity(llmUrl + path, body, byte[].class);
            return copyResponse(upstream);
        } catch (RestClientResponseException e) {
            return errorFromUpstream(e);
        } catch (RestClientException e) {
            return badGateway("LLM upstream unavailable for " + path, e);
        }
    }

    private ResponseEntity<byte[]> copyResponse(ResponseEntity<byte[]> upstream) {
        HttpHeaders headers = new HttpHeaders();
        copyHeaders(upstream.getHeaders(), headers);
        return ResponseEntity.status(upstream.getStatusCode())
                .headers(headers)
                .body(upstream.getBody());
    }

    private ResponseEntity<byte[]> errorFromUpstream(RestClientResponseException e) {
        HttpHeaders headers = new HttpHeaders();
        if (e.getResponseHeaders() != null) {
            copyHeaders(e.getResponseHeaders(), headers);
        }
        return ResponseEntity.status(e.getStatusCode())
                .headers(headers)
                .body(e.getResponseBodyAsByteArray());
    }

    private ResponseEntity<Map<String, String>> badGateway(String message, RestClientException e) {
        log.error(message, e);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "LLM upstream unavailable"));
    }

    private void copyHeaders(HttpHeaders source, HttpHeaders target) {
        source.forEach((name, values) -> {
            if (SKIP_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
                return;
            }
            values.forEach(v -> target.add(name, v));
        });
    }
}
