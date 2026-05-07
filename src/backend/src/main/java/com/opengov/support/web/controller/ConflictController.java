package com.opengov.support.web.controller;

import com.opengov.support.conflict.ConflictEngine;
import com.opengov.support.web.JsonBody;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/dashboard/conflicts")
public class ConflictController {

    private final ConflictEngine engine;

    public ConflictController(ConflictEngine engine) {
        this.engine = engine;
    }

    /** 모든 정의된 충돌 룰 — UI 자동 생성용. */
    @GetMapping("/rules")
    public Map<String, Object> rules() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rules", engine.rules());
        return out;
    }

    /** 활성 룰 ID 집합을 받아 충돌 검출 + 우선순위 해소 결과 반환. */
    @PostMapping
    public Map<String, Object> detect(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        Set<String> active = new HashSet<>();
        Object a = body.get("activeRuleIds");
        if (a instanceof Iterable<?> it) {
            for (Object o : it) {
                String s = JsonBody.str(Map.of("v", o), "v");
                if (!s.isEmpty()) active.add(s);
            }
        }
        return engine.detect(active);
    }
}
