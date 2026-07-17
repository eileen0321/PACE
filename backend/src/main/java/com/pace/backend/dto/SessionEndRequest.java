package com.pace.backend.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

public record SessionEndRequest(
        @NotBlank(message = "id는 필수입니다") String id,
        @NotNull(message = "endedAt은 필수입니다") LocalDateTime endedAt,
        @Min(value = 0, message = "durationSeconds는 0 이상이어야 합니다") int durationSeconds,
        @Min(value = 0, message = "videosWatched는 0 이상이어야 합니다") int videosWatched,
        boolean autoNextUsed,
        String status
) {
}
