package com.pace.backend.advice;

import com.pace.backend.dto.ApiErrorResponse;
import com.pace.backend.exception.ApiException;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.HashMap;
import java.util.Map;

/**
 * jlpt-master 최대 약점(전역 예외처리 부재, 컨트롤러마다 ad-hoc Map 응답 반복)을 개선하기 위해
 * Pace가 처음부터 도입 — 모든 에러 응답을 {success:false, message, code} 하나로 통일한다.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(ApiException e) {
        return ResponseEntity.status(e.getStatus()).body(ApiErrorResponse.of(e.getMessage(), e.getCode()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException e) {
        Map<String, String> details = new HashMap<>();
        e.getBindingResult().getFieldErrors().forEach(err ->
                details.put(err.getField(), err.getDefaultMessage()));
        return ResponseEntity.badRequest().body(ApiErrorResponse.of("요청 값이 올바르지 않습니다", "VALIDATION_ERROR", details));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleConstraintViolation(ConstraintViolationException e) {
        return ResponseEntity.badRequest().body(ApiErrorResponse.of(e.getMessage(), "VALIDATION_ERROR"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiErrorResponse> handleAccessDenied(AccessDeniedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiErrorResponse.of("접근 권한이 없습니다", "ACCESS_DENIED"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception e) {
        log.error("처리되지 않은 예외", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiErrorResponse.of("서버 내부 오류가 발생했습니다", "INTERNAL"));
    }
}
