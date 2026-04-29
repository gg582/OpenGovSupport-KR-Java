package com.opengov.support.runtime;

import com.opengov.support.config.RuntimeProperties;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Servlet 필터 형태의 바운디드 워커 풀. fast/slow 두 큐가 있으며 fast 레인을 우선 드레인.
 * 두 큐가 모두 가득 차면 503 + Retry-After 로 백프레셔.
 */
@Component
public class BoundedRequestPool {

    private final int workers;
    private final BlockingQueue<Job> fast;
    private final BlockingQueue<Job> slow;
    private final long threshold;

    private final AtomicLong accepted = new AtomicLong();
    private final AtomicLong rejected = new AtomicLong();
    private final AtomicLong processed = new AtomicLong();
    private final AtomicInteger fastDepth = new AtomicInteger();
    private final AtomicInteger slowDepth = new AtomicInteger();
    private final AtomicLong latencyNs = new AtomicLong();

    private final Thread[] workerThreads;
    private volatile boolean stopping;

    @Autowired
    public BoundedRequestPool(RuntimeProperties props) {
        int w = props.getPool().getWorkers();
        if (w <= 0) w = Runtime.getRuntime().availableProcessors();
        this.workers = w;

        int q = props.getPool().getQueue();
        if (q < 1) q = 1;
        this.fast = new ArrayBlockingQueue<>(q);
        this.slow = new ArrayBlockingQueue<>(q);
        this.threshold = props.getPool().getFastThreshold();

        this.workerThreads = new Thread[workers];
        for (int i = 0; i < workers; i++) {
            Thread t = Thread.ofVirtual().name("opengov-pool-", i).unstarted(this::workerLoop);
            workerThreads[i] = t;
            t.start();
        }
    }

    public int workers() { return workers; }

    public Snapshot snapshot() {
        long p = processed.get();
        long avg = p > 0 ? (latencyNs.get() / p) / 1000 : 0;
        return new Snapshot(workers, fastDepth.get(), slowDepth.get(),
                accepted.get(), rejected.get(), p, avg);
    }

    /** 한 요청을 큐에 넣고 워커가 처리 완료할 때까지 대기. 큐 가득 차면 false. */
    boolean dispatch(HttpServletRequest req, HttpServletResponse res, FilterChain chain) {
        long size = req.getContentLengthLong();
        boolean small = size >= 0 && size < threshold;
        BlockingQueue<Job> primary = small ? fast : slow;
        BlockingQueue<Job> alt = small ? slow : fast;
        AtomicInteger primaryDepth = small ? fastDepth : slowDepth;
        AtomicInteger altDepth = small ? slowDepth : fastDepth;

        Job j = new Job(req, res, chain);
        if (primary.offer(j)) {
            primaryDepth.incrementAndGet();
            accepted.incrementAndGet();
        } else if (alt.offer(j)) {
            altDepth.incrementAndGet();
            accepted.incrementAndGet();
        } else {
            rejected.incrementAndGet();
            return false;
        }
        try {
            j.done.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return true;
    }

    private void workerLoop() {
        try {
            while (!stopping) {
                Job j = fast.poll();
                if (j != null) {
                    fastDepth.decrementAndGet();
                    run(j);
                    continue;
                }
                j = fast.poll(50, TimeUnit.MILLISECONDS);
                if (j != null) {
                    fastDepth.decrementAndGet();
                    run(j);
                    continue;
                }
                j = slow.poll(50, TimeUnit.MILLISECONDS);
                if (j != null) {
                    slowDepth.decrementAndGet();
                    run(j);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void run(Job j) {
        long t0 = System.nanoTime();
        try {
            j.chain.doFilter(j.req, j.res);
        } catch (Exception e) {
            try {
                j.res.sendError(500, "internal error");
            } catch (IOException ignored) {
                // best-effort
            }
        } finally {
            latencyNs.addAndGet(System.nanoTime() - t0);
            processed.incrementAndGet();
            j.done.countDown();
        }
    }

    @Bean
    public FilterRegistrationBean<Filter> registerPoolFilter() {
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>(new PoolFilter());
        reg.addUrlPatterns("/api/*");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 100);
        return reg;
    }

    final class PoolFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException {
            HttpServletRequest req = (HttpServletRequest) request;
            HttpServletResponse res = (HttpServletResponse) response;
            if (!dispatch(req, res, chain)) {
                res.setHeader("Retry-After", "1");
                res.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE,
                        "server is at capacity, retry shortly");
            }
        }
    }

    private static final class Job {
        final HttpServletRequest req;
        final HttpServletResponse res;
        final FilterChain chain;
        final CountDownLatch done = new CountDownLatch(1);

        Job(HttpServletRequest req, HttpServletResponse res, FilterChain chain) {
            this.req = req;
            this.res = res;
            this.chain = chain;
        }
    }

    public record Snapshot(
            int workers,
            int fastQueueDepth,
            int slowQueueDepth,
            long accepted,
            long rejected,
            long processed,
            long avgLatencyMicro) {}
}
