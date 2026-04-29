package com.opengov.support.runtime;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

import java.io.IOException;
import java.time.Duration;

/** 가장 바깥 레이어 — 메서드/경로/지연 로깅. (CORS 다음, 풀 직전) */
@Configuration
public class RequestLoggingFilter {

    private static final Logger LOG = LoggerFactory.getLogger(RequestLoggingFilter.class);

    @Bean
    public FilterRegistrationBean<Filter> registerLoggingFilter() {
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>(new LoggingFilter());
        reg.addUrlPatterns("/api/*");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 50);
        return reg;
    }

    static final class LoggingFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
            HttpServletRequest req = (HttpServletRequest) request;
            long t0 = System.nanoTime();
            try {
                chain.doFilter(request, response);
            } finally {
                Duration d = Duration.ofNanos(System.nanoTime() - t0);
                LOG.info("{} {} ({}ms)", req.getMethod(), req.getRequestURI(),
                        String.format("%.3f", d.toNanos() / 1_000_000.0));
            }
        }
    }
}
