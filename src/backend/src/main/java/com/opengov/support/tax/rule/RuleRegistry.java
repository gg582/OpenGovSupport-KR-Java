package com.opengov.support.tax.rule;

import tools.jackson.databind.ObjectMapper;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@code resources/tax-rules/{year}/*.json} 디렉터리에서 세무 규칙을 로딩하는 레지스트리.
 *
 * <p>법령 갱신 시:
 * <ol>
 *   <li>새 연도 디렉터리 생성 (예: {@code tax-rules/2027/}).</li>
 *   <li>변경된 규칙 JSON만 새 연도 폴더에 복사 후 수치 갱신.</li>
 *   <li>변경되지 않은 규칙은 직전 연도가 자동으로 fallback.</li>
 * </ol>
 *
 * <p>스레드 안전: {@code ConcurrentHashMap} 기반. 시작 시 1회 로드 후 read-only.
 */
@Component
public class RuleRegistry {

    private static final Pattern YEAR_DIR =
            Pattern.compile("tax-rules/(\\d{4})/");

    private final ObjectMapper mapper;

    /** rules[year][ruleId] = TaxRule */
    private final Map<Integer, Map<String, TaxRule>> rules = new ConcurrentHashMap<>();

    public RuleRegistry(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @PostConstruct
    public void load() throws IOException {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        Resource[] resources = resolver.getResources("classpath*:tax-rules/*/*.json");
        for (Resource r : resources) {
            String url = r.getURL().toString();
            Matcher m = YEAR_DIR.matcher(url);
            if (!m.find()) continue;
            int year = Integer.parseInt(m.group(1));
            try (InputStream in = r.getInputStream()) {
                TaxRule rule = mapper.readValue(in, TaxRule.class);
                rules.computeIfAbsent(year, y -> new ConcurrentHashMap<>())
                        .put(rule.ruleId(), rule);
            }
        }
    }

    /** 해당 연도의 규칙. 없으면 가장 가까운 직전 연도로 fallback. */
    public Optional<TaxRule> get(int year, String ruleId) {
        TreeMap<Integer, Map<String, TaxRule>> sorted = new TreeMap<>(rules);
        for (Integer y : sorted.descendingKeySet()) {
            if (y > year) continue;
            TaxRule r = sorted.get(y).get(ruleId);
            if (r != null) return Optional.of(r);
        }
        return Optional.empty();
    }

    /** 가장 최신 연도의 모든 규칙 (UI 인덱스용). */
    public List<TaxRule> latest() {
        TreeMap<Integer, Map<String, TaxRule>> sorted = new TreeMap<>(rules);
        if (sorted.isEmpty()) return List.of();
        return List.copyOf(sorted.lastEntry().getValue().values());
    }

    /** 특정 연도의 모든 규칙 (해당 연도에 정의된 것만, fallback 없음). */
    public List<TaxRule> allFor(int year) {
        Map<String, TaxRule> m = rules.get(year);
        return m == null ? List.of() : List.copyOf(m.values());
    }

    /** 보유 연도 목록 (감사용). */
    public Map<Integer, Integer> coverage() {
        Map<Integer, Integer> out = new HashMap<>();
        rules.forEach((y, m) -> out.put(y, m.size()));
        return out;
    }
}
