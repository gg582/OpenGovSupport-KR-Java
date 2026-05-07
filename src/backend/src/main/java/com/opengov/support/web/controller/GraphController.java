package com.opengov.support.web.controller;

import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;

import tools.jackson.databind.ObjectMapper;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.annotation.PostConstruct;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * 통계산 그래프 영속화. 각 그래프는 정규화된 JSON (nodes/edges/meta) 으로 저장.
 *
 * <p>저장소: {@code ${user.home}/.opengov-graphs/{id}.json} 단일 파일 단위.
 * Postgres 로 교체할 때는 이 컨트롤러만 다시 구현 — JSON 스키마는 동일.
 *
 * <p>스키마 (예시):
 * <pre>
 * {
 *   "id": "tax-pipeline-202605",
 *   "name": "종합소득세 파이프라인",
 *   "kind": "tax|welfare|inheritance|vat|custom",
 *   "createdAt": "2026-05-07T03:35:00Z",
 *   "updatedAt": "...",
 *   "nodes": [...],
 *   "edges": [...]
 * }
 * </pre>
 */
@RestController
@RequestMapping("/api/dashboard/graphs")
public class GraphController {

    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final ObjectMapper mapper;
    private final Path storageDir;

    public GraphController(ObjectMapper mapper) {
        this.mapper = mapper;
        String home = System.getProperty("user.home");
        if (home == null || home.isEmpty()) home = System.getProperty("java.io.tmpdir");
        this.storageDir = Paths.get(home, ".opengov-graphs");
    }

    @PostConstruct
    public void init() throws IOException {
        Files.createDirectories(storageDir);
    }

    /** 모든 그래프 메타 (id/name/kind/updatedAt) 만 반환. */
    @GetMapping
    public List<Map<String, Object>> list() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        try (Stream<Path> s = Files.list(storageDir)) {
            for (Path p : s.filter(p -> p.toString().endsWith(".json")).toList()) {
                try {
                    Map<String, Object> raw = mapper.readValue(p.toFile(),
                            mapper.getTypeFactory().constructMapType(LinkedHashMap.class, String.class, Object.class));
                    Map<String, Object> meta = new LinkedHashMap<>();
                    meta.put("id", raw.get("id"));
                    meta.put("name", raw.get("name"));
                    meta.put("kind", raw.get("kind"));
                    meta.put("createdAt", raw.get("createdAt"));
                    meta.put("updatedAt", raw.get("updatedAt"));
                    int nodes = (raw.get("nodes") instanceof List<?> l) ? l.size() : 0;
                    int edges = (raw.get("edges") instanceof List<?> l) ? l.size() : 0;
                    meta.put("nodeCount", nodes);
                    meta.put("edgeCount", edges);
                    out.add(meta);
                } catch (RuntimeException ignored) {
                    // skip corrupted JSON
                }
            }
        }
        return out;
    }

    /** 단일 그래프 전체 로드. */
    @GetMapping("/{id}")
    public Map<String, Object> load(@PathVariable String id) throws IOException {
        Path p = pathFor(id);
        if (!Files.exists(p)) throw ApiException.badRequest("그래프를 찾을 수 없습니다: " + id);
        return mapper.readValue(p.toFile(),
                mapper.getTypeFactory().constructMapType(LinkedHashMap.class, String.class, Object.class));
    }

    /** 그래프 저장 (id 미제공 시 신규 발급). */
    @PostMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> body) throws IOException {
        if (body == null) throw ApiException.badRequest("본문이 비어 있습니다.");
        String id = JsonBody.str(body, "id");
        if (id.isEmpty()) {
            id = "g_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        }
        if (!SAFE_ID.matcher(id).matches()) {
            throw ApiException.badRequest("그래프 ID 는 [A-Za-z0-9_-]{1,64} 만 허용됩니다.");
        }
        String name = JsonBody.str(body, "name");
        if (name.isEmpty()) name = "이름 없음";
        String kind = JsonBody.str(body, "kind");
        if (kind.isEmpty()) kind = "custom";

        Map<String, Object> doc = new LinkedHashMap<>(body);
        doc.put("id", id);
        doc.put("name", name);
        doc.put("kind", kind);
        if (!doc.containsKey("createdAt")) doc.put("createdAt", Instant.now().toString());
        doc.put("updatedAt", Instant.now().toString());

        Path p = pathFor(id);
        byte[] bytes = mapper.writeValueAsBytes(doc);
        Path tmp = p.resolveSibling(p.getFileName().toString() + ".tmp");
        Files.write(tmp, bytes,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
        Files.move(tmp, p,
                java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                java.nio.file.StandardCopyOption.ATOMIC_MOVE);

        Map<String, Object> ack = new LinkedHashMap<>();
        ack.put("id", id);
        ack.put("name", name);
        ack.put("kind", kind);
        ack.put("updatedAt", doc.get("updatedAt"));
        ack.put("bytes", bytes.length);
        return ack;
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String id) throws IOException {
        Path p = pathFor(id);
        boolean removed = Files.deleteIfExists(p);
        Map<String, Object> ack = new LinkedHashMap<>();
        ack.put("id", id);
        ack.put("removed", removed);
        return ack;
    }

    private Path pathFor(String id) {
        if (!SAFE_ID.matcher(id).matches()) {
            throw ApiException.badRequest("그래프 ID 형식이 올바르지 않습니다.");
        }
        return storageDir.resolve(id + ".json");
    }

    /** 디버깅 용 — 저장 경로 노출 (운영자 검증). */
    @GetMapping("/_meta/storage")
    public Map<String, Object> storage() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("path", storageDir.toAbsolutePath().toString());
        m.put("exists", Files.exists(storageDir));
        return m;
    }
}
