package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDate;

@Entity
@Table(name = "daily_stats", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "stat_date"}))
@Getter
@Setter
@NoArgsConstructor
public class DailyStats {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "stat_date", nullable = false)
    private LocalDate statDate;

    @Column(name = "total_minutes", nullable = false)
    private int totalMinutes = 0;

    @Column(name = "total_videos", nullable = false)
    private int totalVideos = 0;

    @Column(name = "session_count", nullable = false)
    private int sessionCount = 0;

    @Column(name = "longest_session_seconds", nullable = false)
    private int longestSessionSeconds = 0;
}
