package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "viewing_session")
@Getter
@Setter
@NoArgsConstructor
public class ViewingSession {

    /** 클라이언트(SQLite sessionsRepository)가 이미 생성한 UUID를 그대로 PK로 재사용한다. */
    @Id
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    private String platform;

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "ended_at")
    private LocalDateTime endedAt;

    @Column(name = "duration_seconds", nullable = false)
    private int durationSeconds = 0;

    @Column(name = "videos_watched", nullable = false)
    private int videosWatched = 0;

    @Column(name = "auto_next_used", nullable = false)
    private boolean autoNextUsed = false;

    /** 'completed' | 'daily_limit_reached' | 'sleep_timer_expired' | 'manual_stop' — 로컬과 동일 문자열 그대로 저장. */
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
