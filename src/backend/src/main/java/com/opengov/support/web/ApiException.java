package com.opengov.support.web;

import org.springframework.http.HttpStatus;

/** 클라이언트 입력 오류를 표현하는 예외. {@link GlobalErrorHandler}가 JSON으로 변환한다. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }

    public HttpStatus status() {
        return status;
    }
}
