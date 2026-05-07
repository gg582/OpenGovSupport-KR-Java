package com.opengov.support.runtime;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 결정적 토큰버킷 rate limit + 누적 위반 시 임시 IP 차단 + 통계.
 *
 * <p>모든 산식은 결정적이므로 동일 IP 의 폭주 호출은 의미가 없다 — 따라서 비교적 보수적인
 * 한도(초당 10회 / 분당 120회)를 두고 5분 구간 내 누적 거부 횟수가 임계를 넘으면
 * {@link #BLOCK_MS} 동안 그 IP 를 차단한다.
 *
 * <p>저장은 in-memory ConcurrentHashMap — 인스턴스 재시작 시 리셋. 멀티노드 환경에서는
 * 외부 redis 등으로 교체. 본 구현은 단일 인스턴스 + DDoS 1차 방어.
 *
 * <p>인증·세션 미사용 — 익명 공개 API. X-Forwarded-For 의 첫 항목을 신뢰 (리버스 프록시).
 */
@Component
public class RateLimitFilter {

    /** 1초 윈도우 토큰 한도. */
    public static final int RPS_LIMIT = 10;
    /** 1분 윈도우 토큰 한도. */
    public static final int RPM_LIMIT = 120;
    /** 1시간 윈도우 토큰 한도 — 일일 폭주 방지. */
    public static final int RPH_LIMIT = 3000;

    /** 5분 내 거부 누적이 이 횟수를 넘으면 임시 차단. */
    public static final int ABUSE_THRESHOLD = 60;
    public static final long ABUSE_WINDOW_MS = 5 * 60 * 1000L;
    public static final long BLOCK_MS = 15 * 60 * 1000L;

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final AtomicLong totalAllowed = new AtomicLong();
    private final AtomicLong totalBlocked = new AtomicLong();
    private final AtomicLong totalIpBlocks = new AtomicLong();

    public Snapshot snapshot() {
        // 차단된 IP 수 카운트.
        long now = System.currentTimeMillis();
        int currentlyBlocked = 0;
        int activeIps = 0;
        for (Bucket b : buckets.values()) {
            if (b.blockedUntil > now) currentlyBlocked++;
            if (now - b.lastSeen < ABUSE_WINDOW_MS) activeIps++;
        }
        return new Snapshot(
                buckets.size(),
                activeIps,
                currentlyBlocked,
                totalAllowed.get(),
                totalBlocked.get(),
                totalIpBlocks.get());
    }

    /** 디버그용 IP별 상태 — 운영자가 즉시 확인. */
    public Map<String, Object> debugIps(int limit) {
        Map<String, Object> out = new LinkedHashMap<>();
        long now = System.currentTimeMillis();
        int n = 0;
        for (Map.Entry<String, Bucket> e : buckets.entrySet()) {
            if (n++ >= limit) break;
            Bucket b = e.getValue();
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("rpsTokens", b.rpsTokens);
            r.put("rpmTokens", b.rpmTokens);
            r.put("rphTokens", b.rphTokens);
            r.put("rejects5m", b.recentRejects);
            r.put("blockedUntilEpochMs", b.blockedUntil);
            r.put("blocked", b.blockedUntil > now);
            r.put("lastSeenAgoMs", now - b.lastSeen);
            out.put(e.getKey(), r);
        }
        return out;
    }

    /** {@code true} 면 통과, {@code false} 면 차단. */
    boolean allow(String ip, long nowMs) {
        Bucket b = buckets.computeIfAbsent(ip, k -> new Bucket(nowMs));
        synchronized (b) {
            b.refill(nowMs);
            // 임시 차단 중?
            if (b.blockedUntil > nowMs) {
                totalBlocked.incrementAndGet();
                return false;
            }
            // 토큰 1개 차감.
            if (b.rpsTokens >= 1 && b.rpmTokens >= 1 && b.rphTokens >= 1) {
                b.rpsTokens--;
                b.rpmTokens--;
                b.rphTokens--;
                b.lastSeen = nowMs;
                totalAllowed.incrementAndGet();
                // 거부 카운터 자연 감쇠.
                if (nowMs - b.lastReject > ABUSE_WINDOW_MS) b.recentRejects = 0;
                return true;
            }
            // 거부.
            b.recentRejects++;
            b.lastReject = nowMs;
            totalBlocked.incrementAndGet();
            if (b.recentRejects >= ABUSE_THRESHOLD && b.blockedUntil <= nowMs) {
                b.blockedUntil = nowMs + BLOCK_MS;
                totalIpBlocks.incrementAndGet();
            }
            return false;
        }
    }

    void prune(long nowMs) {
        // 30분 이상 미사용 IP 제거 — 메모리 누수 방지.
        Iterator<Map.Entry<String, Bucket>> it = buckets.entrySet().iterator();
        while (it.hasNext()) {
            Bucket b = it.next().getValue();
            if (b.blockedUntil > nowMs) continue;
            if (nowMs - b.lastSeen > 30 * 60 * 1000L) it.remove();
        }
    }

    @Bean
    public FilterRegistrationBean<Filter> registerRateLimitFilter() {
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>(new IpFilter());
        reg.addUrlPatterns("/api/*");
        // pool 보다 먼저 — 거부될 요청이 풀을 점유하지 않도록.
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 50);
        return reg;
    }

    final class IpFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, jakarta.servlet.ServletException {
            HttpServletRequest req = (HttpServletRequest) request;
            HttpServletResponse res = (HttpServletResponse) response;
            String ip = clientIp(req);
            long now = System.currentTimeMillis();

            // 정기 prune — 1024 호출당 1회.
            if ((now & 0x3FF) == 0) prune(now);

            // 통계·헬스체크는 rate limit 면제.
            String path = req.getRequestURI();
            if (path != null && (
                    path.equals("/api/health") ||
                    path.startsWith("/api/runtime/stats"))) {
                chain.doFilter(req, res);
                return;
            }

            if (!allow(ip, now)) {
                Bucket b = buckets.get(ip);
                long retryAfter = 1;
                if (b != null && b.blockedUntil > now) {
                    retryAfter = Math.max(1, (b.blockedUntil - now) / 1000);
                }
                res.setHeader("Retry-After", Long.toString(retryAfter));
                res.setHeader("X-RateLimit-Limit", String.format("%d/s, %d/m, %d/h", RPS_LIMIT, RPM_LIMIT, RPH_LIMIT));
                res.setHeader("X-RateLimit-IP", ip);
                res.setStatus(429);
                res.setContentType("application/json;charset=UTF-8");
                res.getWriter().write(
                        "{\"error\":\"rate limit exceeded\",\"retryAfterSeconds\":" + retryAfter + "}");
                return;
            }
            chain.doFilter(req, res);
        }
    }

    /** X-Forwarded-For (앞쪽) → X-Real-IP → remoteAddr 순으로 IP 결정. */
    private static String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isEmpty()) {
            int comma = xff.indexOf(',');
            String head = comma > 0 ? xff.substring(0, comma) : xff;
            head = head.trim();
            if (!head.isEmpty()) return head;
        }
        String real = req.getHeader("X-Real-IP");
        if (real != null && !real.isEmpty()) return real.trim();
        String remote = req.getRemoteAddr();
        return remote == null ? "unknown" : remote;
    }

    /** 토큰버킷 + 임시 차단 카운터. {@link #refill} 은 호출 시점에 윈도우 양만큼 보충. */
    private static final class Bucket {
        long lastRefill;
        double rpsTokens;
        double rpmTokens;
        double rphTokens;
        int recentRejects;
        long lastReject;
        long blockedUntil;
        long lastSeen;

        Bucket(long now) {
            this.lastRefill = now;
            this.lastSeen = now;
            this.rpsTokens = RPS_LIMIT;
            this.rpmTokens = RPM_LIMIT;
            this.rphTokens = RPH_LIMIT;
        }

        void refill(long now) {
            long elapsed = now - lastRefill;
            if (elapsed <= 0) return;
            this.rpsTokens = Math.min(RPS_LIMIT, rpsTokens + elapsed * (RPS_LIMIT / 1000.0));
            this.rpmTokens = Math.min(RPM_LIMIT, rpmTokens + elapsed * (RPM_LIMIT / 60_000.0));
            this.rphTokens = Math.min(RPH_LIMIT, rphTokens + elapsed * (RPH_LIMIT / 3_600_000.0));
            this.lastRefill = now;
        }
    }

    public record Snapshot(
            int trackedIps,
            int activeIps,
            int blockedIps,
            long totalAllowed,
            long totalBlocked,
            long totalIpBlocks) {}
}
