package com.opengov.support.ax;

import java.util.List;

/**
 * AX 플랜 전체 실행 결과.
 */
public class AxExecutionResult {

    private boolean overallSuccess;
    private List<AxStepResult> stepResults;
    private long elapsedMs;
    private String message;

    public boolean isOverallSuccess() {
        return overallSuccess;
    }

    public void setOverallSuccess(boolean overallSuccess) {
        this.overallSuccess = overallSuccess;
    }

    public List<AxStepResult> getStepResults() {
        return stepResults;
    }

    public void setStepResults(List<AxStepResult> stepResults) {
        this.stepResults = stepResults;
    }

    public long getElapsedMs() {
        return elapsedMs;
    }

    public void setElapsedMs(long elapsedMs) {
        this.elapsedMs = elapsedMs;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
