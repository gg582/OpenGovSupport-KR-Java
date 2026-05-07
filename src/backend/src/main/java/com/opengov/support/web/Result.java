package com.opengov.support.web;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/**
 * 모든 feature 엔드포인트가 반환하는 통합 응답.
 *
 * <p>PDF 출력은 프런트엔드 공용 버튼이 {@link #data}/{@link #text} 만으로 직접 인쇄 HTML 을 생성하므로,
 * 백엔드는 더 이상 인쇄용 HTML 을 미리 만들어 반환하지 않는다.
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record Result(
        String title,
        String text,
        Map<String, Object> data,
        List<String> notes) {

    public static Result of(String title, String text) {
        return new Result(title, text, null, null);
    }

    public static Result of(String title, String text, Map<String, Object> data) {
        return new Result(title, text, data, null);
    }
}
