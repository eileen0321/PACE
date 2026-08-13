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
        Instant sessionEndsAt,
        /**
         * 🔴 2026-08-13 추가 — **서버가 아는 오늘(UTC)**. 클라이언트가 보낸 날짜와 무관하게 항상
         * 서버 시각으로 채운다.
         *
         * 왜 필요한가: 출석 크레딧(+5/일)이 기기 로컬 날짜만 보고 지급돼서, 설정에서 날짜를 N번
         * 바꾸면 5N 크레딧이 그대로 쌓였다. 그 크레딧은 포커스 세션 연장에 광고 대신 쓸 수 있으므로
         * **광고를 한 번도 안 보고 무제한 연장**이 가능했다(광고 3회 한도는 sanitizeDate로 막았는데
         * 크레딧 경로가 그대로 남아 있었다 — QA_FULL_TEST 발견 10).
         *
         * 출석 전용 테이블/엔드포인트를 새로 파는 대신 **이미 매 부팅 호출되는 이 응답에 신뢰 가능한
         * 날짜를 얹는다** — 새 마이그레이션·배포 리스크 없이 클라이언트가 "진짜 오늘"을 알 수 있다.
         * 오프라인이면 클라이언트가 로컬 날짜로 폴백한다(이 앱의 fail-open 원칙 — 비행기 안에서
         * 출석이 안 되면 정상 사용자가 손해다).
         */
        LocalDate serverToday
) {
    // ⚠️ 이름을 `serverToday()`로 두면 record 컴포넌트의 접근자와 충돌한다(접근자는 public이어야 함).
    private static LocalDate utcToday() {
        return LocalDate.now(java.time.ZoneOffset.UTC);
    }

    public static FocusAllowanceResponse of(FocusAllowance a) {
        return new FocusAllowanceResponse(
                a.getAllowanceDate(), a.getAdExtendCount(), a.isTimedOut(), a.getSessionEndsAt(), utcToday());
    }

    public static FocusAllowanceResponse empty(LocalDate date) {
        return new FocusAllowanceResponse(date, 0, false, null, utcToday());
    }
}
