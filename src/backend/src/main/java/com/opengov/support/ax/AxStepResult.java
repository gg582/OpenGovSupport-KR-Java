package com.opengov.support.ax;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * AX 단계별 실행 결과.
 */
public class AxStepResult {

    private String outputKey;
    private JsonNode response;
    private boolean success;
    private String error;
    private String description;

    public String getOutputKey() {
        return outputKey;
    }

    public void setOutputKey(String outputKey) {
        this.outputKey = outputKey;
    }

    public JsonNode getResponse() {
        return response;
    }

    public void setResponse(JsonNode response) {
        this.response = response;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
}
