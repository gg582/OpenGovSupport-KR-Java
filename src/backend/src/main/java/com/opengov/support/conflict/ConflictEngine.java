package com.opengov.support.conflict;

import tools.jackson.databind.ObjectMapper;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 법령간 적용 충돌 검출 + 우선순위 해소 엔진.
 *
 * <p>사용자가 활성화한 룰 ID 집합을 받아:
 * <ol>
 *   <li>각 룰의 {@code conflictsWith} 매트릭스 검색 → 충돌 페어 추출</li>
 *   <li>{@code precedence} 가 낮은 룰이 우선 — 충돌 시 해당 룰만 활성화 유지</li>
 *   <li>활성/비활성/충돌 페어 집합을 반환 → UI 가 그래프 위에 빨강/녹색으로 오버레이</li>
 * </ol>
 *
 * <p>룰 정의: {@code resources/conflict-rules.json}.
 */
@Component
public class ConflictEngine {

    private final ObjectMapper mapper;
    private Map<String, Map<String, Object>> rulesById = Map.of();
    private List<Map<String, Object>> precedenceOrder = List.of();

    public ConflictEngine(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @PostConstruct
    @SuppressWarnings("unchecked")
    public void load() throws IOException {
        ClassPathResource res = new ClassPathResource("conflict-rules.json");
        try (InputStream in = res.getInputStream()) {
            Map<String, Object> doc = mapper.readValue(in,
                    mapper.getTypeFactory().constructMapType(LinkedHashMap.class, String.class, Object.class));
            Object rules = doc.get("rules");
            Map<String, Map<String, Object>> map = new LinkedHashMap<>();
            if (rules instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof Map<?, ?> m) {
                        Map<String, Object> r = (Map<String, Object>) m;
                        String id = String.valueOf(r.get("id"));
                        map.put(id, r);
                    }
                }
            }
            this.rulesById = map;
            Object pord = doc.get("precedenceOrder");
            if (pord instanceof List<?> list) {
                List<Map<String, Object>> p = new ArrayList<>();
                for (Object item : list) {
                    if (item instanceof Map<?, ?> mm) p.add((Map<String, Object>) mm);
                }
                this.precedenceOrder = List.copyOf(p);
            }
        }
    }

    /** 한 페어의 충돌 결과. */
    public record Conflict(
            String a, String b,
            String winner, String loser,
            int aPrecedence, int bPrecedence,
            String reason, String winnerLegalBasis) {}

    public Map<String, Object> detect(Set<String> activeRuleIds) {
        Set<String> active = new HashSet<>(activeRuleIds);
        List<Conflict> conflicts = new ArrayList<>();
        Set<String> suppressed = new HashSet<>();

        // 모든 페어 검사 — N 작음 (수십). O(N²) 충분.
        List<String> ids = new ArrayList<>(active);
        for (int i = 0; i < ids.size(); i++) {
            for (int j = i + 1; j < ids.size(); j++) {
                String a = ids.get(i);
                String b = ids.get(j);
                if (conflictsBetween(a, b)) {
                    int pa = precedence(a);
                    int pb = precedence(b);
                    String winner = pa <= pb ? a : b;
                    String loser = pa <= pb ? b : a;
                    suppressed.add(loser);
                    Map<String, Object> wmeta = rulesById.get(winner);
                    String reason = wmeta == null ? "" : String.valueOf(wmeta.getOrDefault("reason", ""));
                    String legal = wmeta == null ? "" : String.valueOf(wmeta.getOrDefault("legalBasis", ""));
                    conflicts.add(new Conflict(a, b, winner, loser, pa, pb, reason, legal));
                }
            }
        }
        Set<String> activeAfter = new HashSet<>(active);
        activeAfter.removeAll(suppressed);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("activeBefore", active);
        out.put("conflicts", conflicts);
        out.put("suppressed", suppressed);
        out.put("activeAfter", activeAfter);
        out.put("rulesById", rulesById);
        out.put("precedenceOrder", precedenceOrder);
        return out;
    }

    @SuppressWarnings("unchecked")
    private boolean conflictsBetween(String a, String b) {
        Map<String, Object> ra = rulesById.get(a);
        if (ra != null && ra.get("conflictsWith") instanceof List<?> l) {
            for (Object o : l) {
                if (b.equals(String.valueOf(o))) return true;
            }
        }
        Map<String, Object> rb = rulesById.get(b);
        if (rb != null && rb.get("conflictsWith") instanceof List<?> l) {
            for (Object o : l) {
                if (a.equals(String.valueOf(o))) return true;
            }
        }
        return false;
    }

    private int precedence(String id) {
        Map<String, Object> r = rulesById.get(id);
        if (r == null) return 99;
        Object p = r.get("precedence");
        return p instanceof Number n ? n.intValue() : 99;
    }

    public Map<String, Map<String, Object>> rules() {
        return rulesById;
    }
}
