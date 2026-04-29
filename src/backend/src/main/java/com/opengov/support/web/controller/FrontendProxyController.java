package com.opengov.support.web.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
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

    private static final Set<String> SKIP_HEADERS = Set.of(
            "host", "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "transfer-encoding",
            "upgrade", "content-length"
    );

    private final HttpClient httpClient = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

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

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(target))
                    .timeout(Duration.ofSeconds(30));

            String method = request.getMethod();
            if (body.length > 0) {
                reqBuilder.method(method, HttpRequest.BodyPublishers.ofByteArray(body));
            } else if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)
                    || "DELETE".equalsIgnoreCase(method) || "OPTIONS".equalsIgnoreCase(method)) {
                reqBuilder.method(method, HttpRequest.BodyPublishers.noBody());
            } else {
                reqBuilder.method(method, HttpRequest.BodyPublishers.ofByteArray(new byte[0]));
            }

            Enumeration<String> headerNames = request.getHeaderNames();
            while (headerNames.hasMoreElements()) {
                String name = headerNames.nextElement();
                if (SKIP_HEADERS.contains(name.toLowerCase())) {
                    continue;
                }
                try {
                    reqBuilder.header(name, request.getHeader(name));
                } catch (IllegalArgumentException ignored) {
                    // skip headers restricted by the JDK HttpClient
                }
            }

            reqBuilder.header("X-Real-IP", request.getRemoteAddr());
            reqBuilder.header("X-Forwarded-For", request.getRemoteAddr());
            reqBuilder.header("X-Forwarded-Proto", request.isSecure() ? "https" : "http");

            HttpResponse<byte[]> upstream = httpClient.send(
                    reqBuilder.build(), HttpResponse.BodyHandlers.ofByteArray());

            HttpHeaders responseHeaders = new HttpHeaders();
            upstream.headers().map().forEach((name, values) -> {
                if (!SKIP_HEADERS.contains(name.toLowerCase())) {
                    values.forEach(v -> responseHeaders.add(name, v));
                }
            });

            return ResponseEntity.status(upstream.statusCode())
                    .headers(responseHeaders)
                    .body(upstream.body());

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ResponseEntity.status(502).body(null);
        } catch (IOException e) {
            return ResponseEntity.status(502).body(null);
        }
    }
}
