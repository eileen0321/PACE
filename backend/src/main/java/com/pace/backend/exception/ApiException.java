package com.pace.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 도메인 예외 → GlobalExceptionHandler가 {success:false, message, code} 형태로 일괄 변환한다.
 * jlpt-master는 컨트롤러마다 ad-hoc Map 응답을 반복했는데(전역 처리 부재), Pace는 이 타입 하나로 통일.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static ApiException notFound(String code, String message) {
        return new ApiException(HttpStatus.NOT_FOUND, code, message);
    }

    public static ApiException unauthorized(String code, String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, code, message);
    }

    public static ApiException badRequest(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message);
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
