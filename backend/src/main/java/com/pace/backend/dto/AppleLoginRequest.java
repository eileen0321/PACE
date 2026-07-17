package com.pace.backend.dto;

import jakarta.validation.constraints.NotBlank;

/** name/authorizationCode는 Apple 최초 로그인 1회에만 온다(이후 재로그인 시 null) — client.ts와 동일 계약. */
public record AppleLoginRequest(
        @NotBlank(message = "identityToken은 필수입니다") String identityToken,
        String name,
        String authorizationCode
) {
}
