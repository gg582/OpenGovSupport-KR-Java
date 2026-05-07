package com.opengov.support.runtime;

import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/**
 * 비동기 잡 레지스트리. 비싼 산식(time machine, solver 다중 이분탐색 등)에 대해
 * 백엔드는 즉시 202 + jobId 를 응답하고, 클라이언트는 폴링으로 결과를 회수.
 *
 * <p>저장은 in-memory — 인스턴스 재시작 시 모든 잡 소실. TTL 30분 후 자동 GC.
 *
 * <p>잡 상태: PENDING → RUNNING → DONE | ERROR.
 */
@Component
public class DeferredJobRegistry {

    public enum Status { PENDING, RUNNING, DONE, ERROR }

    public record Job(
            String id,
            Status status,
            String error,
            Object result,
            long createdAtMs,
            long startedAtMs,
            long finishedAtMs,
            String kind) {}

    private static final long TTL_MS = 30 * 60 * 1000L;

    private final ExecutorService exec;
    private final ConcurrentHashMap<String, JobBox> jobs = new ConcurrentHashMap<>();
    private final AtomicLong submitted = new AtomicLong();
    private final AtomicLong completed = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();

    public DeferredJobRegistry() {
        // 가상 스레드 — 백엔드 통일.
        this.exec = Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("opengov-job-", 0).factory());
    }

    /** 잡 제출 — 즉시 ID 반환. */
    public String submit(String kind, Supplier<Object> work) {
        String id = "j_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        JobBox box = new JobBox(id, kind);
        jobs.put(id, box);
        submitted.incrementAndGet();
        exec.submit(() -> {
            box.startedAt = System.currentTimeMillis();
            box.status = Status.RUNNING;
            try {
                box.result = work.get();
                box.status = Status.DONE;
                completed.incrementAndGet();
            } catch (RuntimeException e) {
                box.error = e.getMessage();
                box.status = Status.ERROR;
                failed.incrementAndGet();
            } finally {
                box.finishedAt = System.currentTimeMillis();
            }
        });
        return id;
    }

    public Job get(String id) {
        JobBox box = jobs.get(id);
        if (box == null) return null;
        return new Job(box.id, box.status, box.error, box.result,
                box.createdAt, box.startedAt, box.finishedAt, box.kind);
    }

    public boolean cancel(String id) {
        JobBox box = jobs.remove(id);
        return box != null;
    }

    public Map<String, Object> snapshot() {
        long now = System.currentTimeMillis();
        // ttl GC.
        jobs.entrySet().removeIf(e -> {
            JobBox b = e.getValue();
            return (b.status == Status.DONE || b.status == Status.ERROR)
                    && (now - b.finishedAt) > TTL_MS;
        });

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("submitted", submitted.get());
        m.put("completed", completed.get());
        m.put("failed", failed.get());
        m.put("active", jobs.size());
        return m;
    }

    @PreDestroy
    public void shutdown() {
        exec.shutdown();
        try { exec.awaitTermination(3, TimeUnit.SECONDS); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    /** 내부 표현 — Job 레코드는 immutable, JobBox 는 in-flight 변경 허용. */
    private static final class JobBox {
        final String id;
        final String kind;
        final long createdAt = System.currentTimeMillis();
        volatile long startedAt;
        volatile long finishedAt;
        volatile Status status = Status.PENDING;
        volatile String error;
        volatile Object result;

        JobBox(String id, String kind) {
            this.id = id;
            this.kind = kind;
        }
    }
}
