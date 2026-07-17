package com.pace.backend.dto;

import com.pace.backend.entity.ViewingSession;

import java.time.LocalDateTime;

public record SessionResponse(
        String id,
        String platformApp,
        LocalDateTime startedAt,
        LocalDateTime endedAt,
        int durationSeconds,
        int videosWatched,
        boolean autoNextUsed,
        String status
) {
    public static SessionResponse of(ViewingSession s) {
        return new SessionResponse(
                s.getId(), s.getPlatform(), s.getStartedAt(), s.getEndedAt(),
                s.getDurationSeconds(), s.getVideosWatched(), s.isAutoNextUsed(), s.getStatus()
        );
    }
}
