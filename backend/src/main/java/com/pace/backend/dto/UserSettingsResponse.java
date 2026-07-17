package com.pace.backend.dto;

import java.util.Map;

/** 필드명은 src/types/models.ts의 UserSettings와 1:1 — 프론트가 이미 실제 UI/SQLite와 연결된 진실원천. */
public record UserSettingsResponse(
        boolean autoNext,
        Integer sleepTimerMinutes,
        int dailyLimitMinutes,
        int breakIntervalMinutes,
        boolean preSessionBreathing,
        Map<String, Object> appShields,
        Map<String, Object> perApp,
        String theme,
        String language
) {
}
