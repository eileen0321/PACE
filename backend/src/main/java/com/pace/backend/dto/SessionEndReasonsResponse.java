package com.pace.backend.dto;

/** 로컬 statsRepository.getSessionEndReasons()와 동일한 4개 사유 버킷. */
public record SessionEndReasonsResponse(
        int completed,
        int dailyLimitReached,
        int sleepTimerExpired,
        int manualStop
) {
}
