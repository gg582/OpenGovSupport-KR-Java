package com.opengov.support.ax;

import java.util.List;

/**
 * Qwen 이 생성한 AX 실행 플랜 — JSON 언마셜 대상.
 */
public class AxPlan {

    private List<AxStep> steps;

    public List<AxStep> getSteps() {
        return steps;
    }

    public void setSteps(List<AxStep> steps) {
        this.steps = steps;
    }
}
