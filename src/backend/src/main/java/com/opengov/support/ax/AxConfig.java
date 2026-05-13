package com.opengov.support.ax;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * AX 모듈 설정 활성화.
 * 이 클래스를 제거하면 AX 관련 빈 전체가 스캔 대상에서 빠진다.
 */
@Configuration
@EnableConfigurationProperties(AxProperties.class)
public class AxConfig {
}
