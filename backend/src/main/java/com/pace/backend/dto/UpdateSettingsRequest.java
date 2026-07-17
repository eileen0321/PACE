package com.pace.backend.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.util.Map;

/**
 * client.ts settingsApi.updateSettings(patch)와 동일하게 부분 갱신 — null 필드는 변경하지 않는다.
 * appShields/perApp은 프론트 shape을 그대로 받아 opaque JSON으로 미러링(서버는 내용을 해석하지 않음).
 */
public record UpdateSettingsRequest(
        Boolean autoNext,
        @Min(1) @Max(240) Integer sleepTimerMinutes,
        @Min(1) @Max(1440) Integer dailyLimitMinutes,
        @Min(1) @Max(240) Integer breakIntervalMinutes,
        Boolean preSessionBreathing,
        Map<String, Object> appShields,
        Map<String, Object> perApp,
        String theme,
        String language
) {
}
