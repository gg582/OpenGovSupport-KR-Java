package com.opengov.support.runtime;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/runtime")
public class RuntimeStatsController {

    private final BoundedRequestPool pool;
    private final RequestCoalescer coalescer;

    public RuntimeStatsController(BoundedRequestPool pool, RequestCoalescer coalescer) {
        this.pool = pool;
        this.coalescer = coalescer;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return Map.of(
                "pool", pool.snapshot(),
                "coalescer", coalescer.snapshot()
        );
    }
}
