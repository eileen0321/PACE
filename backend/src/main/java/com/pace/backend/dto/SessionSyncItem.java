package com.pace.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

/**
 * 로컬 SQLite sessionsRepository.getUnsyncedSessions()가 만드는 ViewingSession shape과 동일 —
 * POST /stats/sync가 이 배열을 받아 upsert한다(오프라인 배치 동기화 본선).
 */
public record SessionSyncItem(
        @NotBlank(message = "id는 필수입니다") String id,
        String platformApp,
        @NotNull(message = "startedAt은 필수입니다") LocalDateTime startedAt,
        LocalDateTime endedAt,
        int durationSeconds,
        int videosWatched,
        boolean autoNextUsed,
        String status
) {
}
