package com.pace.backend.dto;

/** POST /auth/refresh 응답 — client.ts의 `{ token: string }`과 동일. */
public record TokenResponse(String token) {
}
