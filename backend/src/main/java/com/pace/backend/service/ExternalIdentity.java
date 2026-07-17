package com.pace.backend.service;

/** Google/Apple 토큰 검증 결과 — 이메일은 필수(유저 upsert 키), 이름은 없을 수 있음(Apple 재로그인 등). */
public record ExternalIdentity(String email, String name) {
}
