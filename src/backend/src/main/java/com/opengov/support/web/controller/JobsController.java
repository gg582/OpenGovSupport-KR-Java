package com.opengov.support.web.controller;

import com.opengov.support.runtime.DeferredJobRegistry;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 비동기 잡 폴링 — {@code POST /api/dashboard/jobs/{kind}} 형태의 deferred 응답을
 * 받은 클라이언트가 결과를 회수할 때 사용.
 *
 * <ul>
 *   <li>{@code GET /api/dashboard/jobs/{id}} — 상태 + 결과</li>
 *   <li>{@code DELETE /api/dashboard/jobs/{id}} — 취소</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/dashboard/jobs")
public class JobsController {

    private final DeferredJobRegistry jobs;

    public JobsController(DeferredJobRegistry jobs) {
        this.jobs = jobs;
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable String id) {
        DeferredJobRegistry.Job j = jobs.get(id);
        if (j == null) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "job not found");
            err.put("id", id);
            return ResponseEntity.status(404).body(err);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", j.id());
        body.put("status", j.status().name());
        body.put("kind", j.kind());
        body.put("createdAt", j.createdAtMs());
        body.put("startedAt", j.startedAtMs());
        body.put("finishedAt", j.finishedAtMs());
        if (j.status() == DeferredJobRegistry.Status.DONE) {
            body.put("result", j.result());
        } else if (j.status() == DeferredJobRegistry.Status.ERROR) {
            body.put("error", j.error());
        }
        HttpHeaders h = new HttpHeaders();
        if (j.status() == DeferredJobRegistry.Status.PENDING ||
                j.status() == DeferredJobRegistry.Status.RUNNING) {
            h.set("Retry-After", "1");
        }
        return ResponseEntity.ok().headers(h).body(body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> cancel(@PathVariable String id) {
        boolean ok = jobs.cancel(id);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", id);
        r.put("removed", ok);
        return r;
    }

    @GetMapping("/_meta/stats")
    public Map<String, Object> stats() {
        return jobs.snapshot();
    }
}
