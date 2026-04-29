package com.opengov.support.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/** 모든 feature 엔드포인트가 반환하는 통합 응답 형태. */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record Result(
        String title,
        String text,
        Map<String, Object> data,
        @JsonProperty("html") String html,
        List<String> notes) {

    public static Result of(String title, String text) {
        return new Result(title, text, null, null, null);
    }

    public static Result of(String title, String text, Map<String, Object> data) {
        return new Result(title, text, data, null, null);
    }

    public static Result html(String title, String text, String html, Map<String, Object> data) {
        return new Result(title, text, data, html, null);
    }
}
