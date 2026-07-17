package com.pace.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pace.backend.dto.ApiErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * 인증 자체가 안 된 요청(토큰 없음/만료/불일치)은 Spring Security 기본값인 403이 아니라 401을 반환한다.
 * client.ts의 unauthorizedHandler가 정확히 `res.status === 401`일 때만 자동 로그아웃을 트리거하므로
 * (client.ts:53-56), 여기서 403을 내려주면 그 흐름이 깨진다 — GlobalExceptionHandler와 동일한
 * {success:false, message, code} 응답 shape을 유지한다.
 */
@Component
@RequiredArgsConstructor
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authException)
            throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(objectMapper.writeValueAsString(
                ApiErrorResponse.of("인증이 필요합니다", "UNAUTHORIZED")));
    }
}
