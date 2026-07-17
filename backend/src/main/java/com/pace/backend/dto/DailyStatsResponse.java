package com.pace.backend.dto;

import com.pace.backend.entity.DailyStats;

import java.time.LocalDate;

public record DailyStatsResponse(
        LocalDate date,
        int totalMinutes,
        int totalVideos,
        int sessionCount,
        int longestSessionSeconds
) {
    public static DailyStatsResponse of(DailyStats d) {
        return new DailyStatsResponse(d.getStatDate(), d.getTotalMinutes(), d.getTotalVideos(),
                d.getSessionCount(), d.getLongestSessionSeconds());
    }

    public static DailyStatsResponse empty(LocalDate date) {
        return new DailyStatsResponse(date, 0, 0, 0, 0);
    }
}
