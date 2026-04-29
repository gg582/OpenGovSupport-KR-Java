package com.opengov.support.runtime;

import com.opengov.support.config.RuntimeProperties;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 동일한 요청(method+path+body)을 하나의 핸들러 호출로 코얼레싱.
 * 리더는 핸들러를 한 번 호출해 응답을 메모리에 캡처하고, follower들은 캐시된 응답을 그대로 받는다.
 */
@Component
public class RequestCoalescer {

    private final boolean enabled;
    private final int shardCount;
    private final Shard[] shards;

    private final AtomicLong total = new AtomicLong();
    private final AtomicLong hits = new AtomicLong();

    @Autowired
    public RequestCoalescer(RuntimeProperties props) {
        this.enabled = props.getCoalescer().isEnabled();
        int s = props.getCoalescer().getShards();
        int p = 1;
        while (p < Math.max(1, s)) p <<= 1;
        this.shardCount = p;
        this.shards = new Shard[shardCount];
        for (int i = 0; i < shardCount; i++) shards[i] = new Shard();
    }

    public Snapshot snapshot() {
        return new Snapshot(total.get(), hits.get());
    }

    @Bean
    public FilterRegistrationBean<Filter> registerCoalescerFilter() {
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>(new CoalescerFilter());
        reg.addUrlPatterns("/api/*");
        // Run AFTER the pool filter (higher order = inner)
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 200);
        return reg;
    }

    final class CoalescerFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
            HttpServletRequest req = (HttpServletRequest) request;
            HttpServletResponse res = (HttpServletResponse) response;

            String method = req.getMethod();
            if (!enabled || (!"GET".equals(method) && !"POST".equals(method))) {
                chain.doFilter(request, response);
                return;
            }
            total.incrementAndGet();

            byte[] bodyBytes = req.getInputStream().readAllBytes();
            String key = digest(method, req.getRequestURI(), bodyBytes);
            int shardIdx = (key.charAt(0) + (key.charAt(1) << 4)) & (shardCount - 1);
            Shard shard = shards[shardIdx];

            Flight existing;
            Flight created = null;
            synchronized (shard) {
                existing = shard.inflight.get(key);
                if (existing == null) {
                    created = new Flight();
                    shard.inflight.put(key, created);
                }
            }

            if (existing != null) {
                hits.incrementAndGet();
                if (!existing.completed) {
                    try {
                        existing.ready.await();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
                replay(res, existing);
                return;
            }

            Flight fl = created;
            BufferingResponse cap = new BufferingResponse(res);
            CachedRequest cachedReq = new CachedRequest(req, bodyBytes);
            try {
                chain.doFilter(cachedReq, cap);
                cap.flushWriter();
                fl.body = cap.body();
                fl.headers = cap.copyHeaders();
                fl.status = cap.status();
                fl.contentType = cap.getContentType();
                fl.completed = true;
            } finally {
                fl.ready.countDown();
                synchronized (shard) {
                    Flight cur = shard.inflight.get(key);
                    if (cur == fl) shard.inflight.remove(key);
                }
            }
            // Replay leader's captured bytes to its own response.
            replay(res, fl);
        }
    }

    private static void replay(HttpServletResponse res, Flight fl) throws IOException {
        if (fl.contentType != null) res.setContentType(fl.contentType);
        for (Map.Entry<String, List<String>> e : fl.headers.entrySet()) {
            for (String v : e.getValue()) {
                res.addHeader(e.getKey(), v);
            }
        }
        if (fl.status != 0) res.setStatus(fl.status);
        res.getOutputStream().write(fl.body);
        res.getOutputStream().flush();
    }

    private static String digest(String method, String path, byte[] body) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(method.getBytes());
            md.update((byte) 0);
            md.update(path.getBytes());
            md.update((byte) 0);
            md.update(body);
            byte[] sum = md.digest();
            StringBuilder hex = new StringBuilder(sum.length * 2);
            for (byte b : sum) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static final class Shard {
        final Map<String, Flight> inflight = new HashMap<>();
    }

    private static final class Flight {
        final CountDownLatch ready = new CountDownLatch(1);
        volatile boolean completed;
        byte[] body;
        Map<String, List<String>> headers;
        int status;
        String contentType;
    }

    public record Snapshot(long total, long hits) {}

    /** Re-readable request body wrapper. */
    private static final class CachedRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        CachedRequest(HttpServletRequest req, byte[] body) {
            super(req);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream bais = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public int read() { return bais.read(); }
                @Override public boolean isFinished() { return bais.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(jakarta.servlet.ReadListener listener) {}
            };
        }

        @Override
        public java.io.BufferedReader getReader() {
            return new java.io.BufferedReader(new java.io.InputStreamReader(getInputStream()));
        }
    }

    /** Buffers the entire response body so we can replay it later. */
    private static final class BufferingResponse extends HttpServletResponseWrapper {
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream(1024);
        private ServletOutputStream out;
        private PrintWriter writer;

        BufferingResponse(HttpServletResponse delegate) {
            super(delegate);
        }

        @Override
        public ServletOutputStream getOutputStream() {
            if (writer != null) throw new IllegalStateException("getWriter() already called");
            if (out == null) {
                out = new ServletOutputStream() {
                    @Override public boolean isReady() { return true; }
                    @Override public void setWriteListener(WriteListener listener) {}
                    @Override public void write(int b) { buffer.write(b); }
                    @Override public void write(byte[] b, int off, int len) { buffer.write(b, off, len); }
                };
            }
            return out;
        }

        @Override
        public PrintWriter getWriter() throws IOException {
            if (out != null) throw new IllegalStateException("getOutputStream() already called");
            if (writer == null) {
                String charset = getCharacterEncoding();
                if (charset == null) charset = "UTF-8";
                writer = new PrintWriter(new java.io.OutputStreamWriter(getOutputStream(), charset));
            }
            return writer;
        }

        void flushWriter() {
            if (writer != null) writer.flush();
        }

        byte[] body() {
            return buffer.toByteArray();
        }

        int status() {
            return getStatus();
        }

        Map<String, List<String>> copyHeaders() {
            Map<String, List<String>> out = new LinkedHashMap<>();
            for (String name : getHeaderNames()) {
                out.put(name, List.copyOf(getHeaders(name)));
            }
            return out;
        }
    }
}
