package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "user_settings")
@Getter
@Setter
@NoArgsConstructor
public class UserSettings {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "auto_next", nullable = false)
    private boolean autoNext = true;

    @Column(name = "sleep_timer_minutes")
    private Integer sleepTimerMinutes;

    @Column(name = "daily_limit_minutes", nullable = false)
    private int dailyLimitMinutes = 60;

    @Column(name = "break_interval_minutes", nullable = false)
    private int breakIntervalMinutes = 20;

    @Column(name = "pre_session_breathing", nullable = false)
    private boolean preSessionBreathing = true;

    /** youtube/instagram/tiktok별 on-off — 프론트 AppShieldTarget과 동일 키. 서버는 opaque JSON으로만 미러. */
    @Column(name = "app_shields_json", length = 1000)
    private String appShieldsJson;

    /** 앱별 override({autoNext, dailyLimitMinutes}) — 프론트 AppSettingsOverride와 동일 shape. */
    @Column(name = "per_app_json", length = 2000)
    private String perAppJson;

    @Column(nullable = false, length = 16)
    private String theme = "system";

    @Column(nullable = false, length = 16)
    private String language = "system";

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = LocalDateTime.now();
    }

    public static UserSettings defaultsFor(Long userId) {
        UserSettings settings = new UserSettings();
        settings.setUserId(userId);
        return settings;
    }
}
