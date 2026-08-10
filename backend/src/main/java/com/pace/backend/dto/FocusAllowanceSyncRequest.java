package com.pace.backend.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 클라이언트가 자기 로컬 상태를 올린다. 서버는 **덮어쓰지 않고 병합**한다 — 카운트는 max,
 * timedOut은 OR. 클라이언트가 0을 올린다고 서버 기록이 지워지면 앱 재설치가 곧 초기화가 되어
 * 이 기능의 목적 자체가 무너진다.
 *
 * date는 클라이언트 로컬 날짜다(서버 타임존으로 계산하면 자정 경계에서 사용자가 손해를 본다).
 */
public record FocusAllowanceSyncRequest(
        @NotNull(message = "date는 필수입니다") LocalDate date,
        @PositiveOrZero(message = "adExtendCount는 0 이상이어야 합니다") int adExtendCount,
        boolean timedOut,
        Instant sessionEndsAt
) {
}
