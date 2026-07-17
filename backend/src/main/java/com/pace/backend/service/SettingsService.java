package com.pace.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pace.backend.dto.UpdateSettingsRequest;
import com.pace.backend.dto.UserSettingsResponse;
import com.pace.backend.entity.UserSettings;
import com.pace.backend.repository.UserSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.Map;

/**
 * appShields/perApp은 서버가 내용을 해석하지 않고 프론트가 보낸 shape 그대로 JSON 텍스트로 미러링한다
 * (로컬 settingsRepository의 write-through 패턴과 동일 사상) — 앱 목록이 늘어나도 서버 스키마 변경 불필요.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SettingsService {

    private final UserSettingsRepository userSettingsRepository;
    private final ObjectMapper objectMapper;

    public UserSettingsResponse get(Long userId) {
        UserSettings settings = userSettingsRepository.findById(userId)
                .orElseGet(() -> UserSettings.defaultsFor(userId));
        return toResponse(settings);
    }

    @Transactional
    public UserSettingsResponse update(Long userId, UpdateSettingsRequest patch) {
        UserSettings settings = userSettingsRepository.findById(userId)
                .orElseGet(() -> UserSettings.defaultsFor(userId));

        if (patch.autoNext() != null) settings.setAutoNext(patch.autoNext());
        if (patch.sleepTimerMinutes() != null) settings.setSleepTimerMinutes(patch.sleepTimerMinutes());
        if (patch.dailyLimitMinutes() != null) settings.setDailyLimitMinutes(patch.dailyLimitMinutes());
        if (patch.breakIntervalMinutes() != null) settings.setBreakIntervalMinutes(patch.breakIntervalMinutes());
        if (patch.preSessionBreathing() != null) settings.setPreSessionBreathing(patch.preSessionBreathing());
        if (patch.appShields() != null) settings.setAppShieldsJson(writeJson(patch.appShields()));
        if (patch.perApp() != null) settings.setPerAppJson(writeJson(patch.perApp()));
        if (patch.theme() != null) settings.setTheme(patch.theme());
        if (patch.language() != null) settings.setLanguage(patch.language());

        return toResponse(userSettingsRepository.save(settings));
    }

    private UserSettingsResponse toResponse(UserSettings s) {
        return new UserSettingsResponse(
                s.isAutoNext(), s.getSleepTimerMinutes(), s.getDailyLimitMinutes(),
                s.getBreakIntervalMinutes(), s.isPreSessionBreathing(),
                readJson(s.getAppShieldsJson()), readJson(s.getPerAppJson()),
                s.getTheme(), s.getLanguage()
        );
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("appShields/perApp 직렬화 실패", e);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readJson(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (JsonProcessingException e) {
            log.warn("appShields/perApp JSON 파싱 실패, 빈 값으로 대체 — {}", e.getMessage());
            return Collections.emptyMap();
        }
    }
}
