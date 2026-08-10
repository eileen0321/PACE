package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 무료 사용자의 Focus Session 허용량(하루 광고 연장 횟수 / 타임아웃 여부 / 세션 마감시각)의 서버측
 * 진실원천. 지금까지 이 상태가 기기 로컬에만 있어서 앱을 지웠다 깔면 초기화됐다 — 상세 근거는
 * V7__focus_allowance.sql 주석 참고.
 */
@Entity
@Table(name = "focus_allowance", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "allowance_date"}))
@Getter
@Setter
@NoArgsConstructor
public class FocusAllowance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 클라이언트 로컬 날짜 — 서버 타임존으로 계산하면 자정 경계에서 사용자가 손해를 본다. */
    @Column(name = "allowance_date", nullable = false)
    private LocalDate allowanceDate;

    @Column(name = "ad_extend_count", nullable = false)
    private int adExtendCount = 0;

    @Column(name = "timed_out", nullable = false)
    private boolean timedOut = false;

    @Column(name = "session_ends_at")
    private Instant sessionEndsAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();
}
