package com.opengov.support.web.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.net.URI;
import java.util.Enumeration;
import java.util.Set;

/**
 * Catch-all reverse proxy that forwards every request not matched by a more
 * specific Spring MVC mapping to the Next.js frontend container.
 *
 * <p>Spring MVC path-specificity rules guarantee that all {@code /api/**}
 * controllers take priority — only truly unmatched paths reach this handler.
 */
@Controller
public class FrontendProxyController {

    private static final Logger log = LoggerFactory.getLogger(FrontendProxyController.class);

    private static final Set<String> SKIP_HEADERS = Set.of(
            "host", "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "transfer-encoding",
            "upgrade", "content-length"
    );

    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${opengov.frontend-url:http://frontend:3000}")
    private String frontendUrl;

    @RequestMapping("/**")
    public ResponseEntity<byte[]> proxy(HttpServletRequest request) {

        String path = request.getRequestURI();
        String query = request.getQueryString();

        // Prevent SSRF: reject paths that embed a scheme or authority component.
        if (path.contains("://") || path.contains("@")) {
            return ResponseEntity.badRequest().body(null);
        }

        String target = frontendUrl + path + (query != null ? "?" + query : "");

        try {
            byte[] body = request.getInputStream().readAllBytes();
            HttpHeaders requestHeaders = new HttpHeaders();

            Enumeration<String> headerNames = request.getHeaderNames();
            while (headerNames.hasMoreElements()) {
                String name = headerNames.nextElement();
                if (SKIP_HEADERS.contains(name.toLowerCase())) {
                    continue;
                }
                Enumeration<String> values = request.getHeaders(name);
                while (values.hasMoreElements()) {
                    requestHeaders.add(name, values.nextElement());
                }
            }

            requestHeaders.set("X-Real-IP", request.getRemoteAddr());
            requestHeaders.set("X-Forwarded-For", request.getRemoteAddr());
            requestHeaders.set("X-Forwarded-Proto", request.isSecure() ? "https" : "http");

            ResponseEntity<byte[]> upstream;
            try {
                upstream = restTemplate.exchange(
                        URI.create(target),
                        HttpMethod.valueOf(request.getMethod()),
                        new org.springframework.http.HttpEntity<>(body, requestHeaders),
                        byte[].class
                );
            } catch (RestClientResponseException e) {
                HttpHeaders responseHeaders = new HttpHeaders();
                e.getResponseHeaders().forEach((name, values) -> {
                    if (!SKIP_HEADERS.contains(name.toLowerCase())) {
                        values.forEach(v -> responseHeaders.add(name, v));
                    }
                });
                return ResponseEntity.status(e.getStatusCode())
                        .headers(responseHeaders)
                        .body(e.getResponseBodyAsByteArray());
            }

            HttpHeaders responseHeaders = new HttpHeaders();
            upstream.getHeaders().forEach((name, values) -> {
                if (!SKIP_HEADERS.contains(name.toLowerCase())) {
                    values.forEach(v -> responseHeaders.add(name, v));
                }
            });

            return ResponseEntity.status(upstream.getStatusCode())
                    .headers(responseHeaders)
                    .body(upstream.getBody());
        } catch (IOException | RestClientException | IllegalArgumentException e) {
            log.error("Frontend proxy failed for {} {}", request.getMethod(), target, e);
            return ResponseEntity.status(502).body(null);
        }
    }
}
