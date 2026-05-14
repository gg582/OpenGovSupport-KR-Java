package com.opengov.support.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** Feature describes one user-facing calculator. */
public record Feature(
        String id,
        String section,
        String domainKey,
        String domainTitle,
        String title,
        String summary,
        List<Input> inputs,
        List<Feature> children,
        Boolean composite,
        List<String> requires) {

    /** Leaf feature — 실제 계산기 (children 없음). */
    public static Feature leaf(String id, String section, String domainKey,
                               String domainTitle, String title, String summary,
                               List<Input> inputs) {
        return leaf(id, section, domainKey, domainTitle, title, summary, inputs, null);
    }

    /** Leaf feature with prerequisite feature ids. */
    public static Feature leaf(String id, String section, String domainKey,
                               String domainTitle, String title, String summary,
                               List<Input> inputs, List<String> requires) {
        return new Feature(id, section, domainKey, domainTitle, title, summary,
                           inputs, null, null, requires);
    }

    /** Group feature — 하위 children 만 보유하는 그룹핑 노드. */
    public static Feature group(String id, String section, String domainKey,
                                String domainTitle, String title, String summary,
                                List<Feature> children) {
        return new Feature(id, section, domainKey, domainTitle, title, summary,
                           List.of(), children, null, null);
    }

    /** Composite feature — 합성 시나리오. 자체 입력 + 하위 children 동시 보유. */
    public static Feature composite(String id, String section, String domainKey,
                                    String domainTitle, String title, String summary,
                                    List<Input> inputs, List<Feature> children) {
        return new Feature(id, section, domainKey, domainTitle, title, summary,
                           inputs, children, Boolean.TRUE, null);
    }

    public static final String SECTION_WELFARE = "welfare";
    public static final String SECTION_TAX = "tax";

    /** Input describes a single form field rendered by the frontend. */
    public record Input(
            String name,
            String label,
            String kind,
            String placeholder,
            @JsonProperty("default") String defaultValue,
            String help,
            List<String> options,
            List<Input> columns,
            Boolean required) {

        public static InputBuilder of(String name, String label, String kind) {
            return new InputBuilder(name, label, kind);
        }
    }

    public static final class InputBuilder {
        private final String name;
        private final String label;
        private final String kind;
        private String placeholder;
        private String defaultValue;
        private String help;
        private List<String> options;
        private List<Input> columns;
        private Boolean required;

        InputBuilder(String name, String label, String kind) {
            this.name = name;
            this.label = label;
            this.kind = kind;
        }

        public InputBuilder placeholder(String s) { this.placeholder = s; return this; }
        public InputBuilder defaultValue(String s) { this.defaultValue = s; return this; }
        public InputBuilder help(String s) { this.help = s; return this; }
        public InputBuilder options(List<String> v) { this.options = v; return this; }
        public InputBuilder columns(List<Input> v) { this.columns = v; return this; }
        public InputBuilder required(boolean v) { this.required = v ? Boolean.TRUE : null; return this; }

        public Input build() {
            return new Input(name, label, kind, placeholder, defaultValue, help, options, columns, required);
        }
    }
}
