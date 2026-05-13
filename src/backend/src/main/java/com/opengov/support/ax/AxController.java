package com.opengov.support.ax;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * AX(Automation eXecution) REST API.
 */
@RestController
@RequestMapping("/api/ax")
public class AxController {

    private final AxAutomationService automationService;
    private final AxProperties axProperties;

    public AxController(AxAutomationService automationService, AxProperties axProperties) {
        this.automationService = automationService;
        this.axProperties = axProperties;
    }

    /**
     * AX 플랜 실행.
     */
    @PostMapping("/execute")
    public ResponseEntity<AxExecutionResult> execute(@RequestBody AxPlan plan) {
        AxExecutionResult result = automationService.execute(plan);
        return ResponseEntity.ok(result);
    }

    /**
     * AX 설정 조회 (maxWaitSeconds 만 노출).
     */
    @GetMapping("/config")
    public ResponseEntity<AxConfigResponse> config() {
        AxConfigResponse resp = new AxConfigResponse();
        resp.setMaxWaitSeconds(axProperties.getMaxWaitSeconds());
        return ResponseEntity.ok(resp);
    }

    public static class AxConfigResponse {
        private int maxWaitSeconds;

        public int getMaxWaitSeconds() {
            return maxWaitSeconds;
        }

        public void setMaxWaitSeconds(int maxWaitSeconds) {
            this.maxWaitSeconds = maxWaitSeconds;
        }
    }
}
