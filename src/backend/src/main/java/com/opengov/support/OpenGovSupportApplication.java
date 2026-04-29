package com.opengov.support;

import com.opengov.support.config.RuntimeProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(RuntimeProperties.class)
public class OpenGovSupportApplication {
    public static void main(String[] args) {
        SpringApplication.run(OpenGovSupportApplication.class, args);
    }
}
