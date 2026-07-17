package com.pace.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

/** id는 클라이언트(SQLite sessionsRepository)가 이미 생성한 UUID를 그대로 넘긴다. */
public record SessionStartRequest(
        @NotBlank(message = "id는 필수입니다") String id,
        String platformApp,
        @NotNull(message = "startedAt은 필수입니다") LocalDateTime startedAt
) {
}
