package com.opengov.support.ax;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AX(Automation eXecution) 서비스 설정.
 * Spring Injection 으로 최대 대기 시간 등을 외부에서 설정할 수 있다.
 */
@ConfigurationProperties(prefix = "opengov.ax")
public class AxProperties {

    /** 단일 AX 플랜 실행 최대 대기 시간(초). 기본 180초. */
    private int maxWaitSeconds = 180;

    public int getMaxWaitSeconds() {
        return maxWaitSeconds;
    }

    public void setMaxWaitSeconds(int maxWaitSeconds) {
        this.maxWaitSeconds = maxWaitSeconds;
    }
}
