package com.pace.backend.dto;

import java.util.Map;

/** 에러 응답만 이 shape으로 통일한다. 성공 응답은 래핑하지 않음 — client.ts의 request&lt;T&gt;()가
 * res.json()을 그대로 T로 캐스팅하므로(AuthResult 등 top-level 필드), 성공 바디까지 래핑하면
 * 기존 클라이언트 계약이 깨진다. */
public record ApiErrorResponse(boolean success, String message, String code, Map<String, String> details) {
    public static ApiErrorResponse of(String message, String code) {
        return new ApiErrorResponse(false, message, code, null);
    }

    public static ApiErrorResponse of(String message, String code, Map<String, String> details) {
        return new ApiErrorResponse(false, message, code, details);
    }
}
