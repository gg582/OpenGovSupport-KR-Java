package com.opengov.support.config;

import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.catalina.connector.Connector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

/**
 * Configures HTTPS support when {@code server.ssl.enabled=true}:
 * <ul>
 *   <li>Adds a plain-HTTP connector on {@code server.http-port} (default 80)
 *       for external HTTP → HTTPS redirects.</li>
 *   <li>Adds an internal HTTP connector on {@code server.internal-port} (default 8080)
 *       so the Next.js frontend container can reach the API without TLS.</li>
 *   <li>Registers a filter that issues 301 redirects for requests arriving on
 *       {@code server.http-port} only; the internal port is left unrestricted.</li>
 * </ul>
 */
@Configuration
@ConditionalOnProperty(name = "server.ssl.enabled", havingValue = "true")
public class HttpsConfig {

    @Value("${server.http-port:80}")
    private int httpPort;

    @Value("${server.port:443}")
    private int httpsPort;

    @Value("${server.internal-port:8080}")
    private int internalPort;

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> additionalConnectors() {
        return factory -> factory.addAdditionalConnectors(
                httpConnector(httpPort),
                httpConnector(internalPort)
        );
    }

    @Bean
    public FilterRegistrationBean<Filter> httpsRedirectFilter() {
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>((req, res, chain) -> {
            HttpServletRequest request = (HttpServletRequest) req;
            HttpServletResponse response = (HttpServletResponse) res;

            if (request.getLocalPort() == httpPort) {
                String host = request.getServerName();
                // Reject requests with a Host header that contains URL-special characters
                // to prevent open-redirect abuse.
                if (host == null || !host.matches("[a-zA-Z0-9][a-zA-Z0-9.\\-:]*")) {
                    response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                    return;
                }
                String path = request.getRequestURI();
                String query = request.getQueryString();
                String redirectUrl = "https://" + host
                        + (httpsPort != 443 ? ":" + httpsPort : "")
                        + path
                        + (query != null ? "?" + query : "");
                response.setStatus(HttpServletResponse.SC_MOVED_PERMANENTLY);
                response.setHeader("Location", redirectUrl);
                return;
            }
            chain.doFilter(req, res);
        });
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 50);
        return reg;
    }

    private static Connector httpConnector(int port) {
        Connector connector = new Connector("org.apache.coyote.http11.Http11NioProtocol");
        connector.setScheme("http");
        connector.setPort(port);
        connector.setSecure(false);
        return connector;
    }
}
