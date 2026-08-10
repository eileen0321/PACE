package com.pace.backend.dto;

import com.pace.backend.entity.FocusAllowance;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 오늘의 Focus 허용량 상태. 클라이언트는 이 값을 로컬과 합쳐(카운트는 max, timedOut은 OR) 채택한다 —
 * 앱을 지웠다 깔아도 서버가 기억하므로 무료분이 초기화되지 않는다.
 */
public record FocusAllowanceResponse(
        LocalDate date,
        int adExtendCount,
        boolean timedOut,
        Instant sessionEndsAt
) {
    public static FocusAllowanceResponse of(FocusAllowance a) {
        return new FocusAllowanceResponse(a.getAllowanceDate(), a.getAdExtendCount(), a.isTimedOut(), a.getSessionEndsAt());
    }

    public static FocusAllowanceResponse empty(LocalDate date) {
        return new FocusAllowanceResponse(date, 0, false, null);
    }
}
