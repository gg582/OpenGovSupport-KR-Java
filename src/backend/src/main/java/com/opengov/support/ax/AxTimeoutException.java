package com.opengov.support.ax;

/**
 * AX 실행 제한 시간 초과 예외.
 */
public class AxTimeoutException extends RuntimeException {

    public AxTimeoutException(String message) {
        super(message);
    }
}
