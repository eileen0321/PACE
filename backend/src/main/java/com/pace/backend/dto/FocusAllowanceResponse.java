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
         * 🔴 2026-08-13 추가 — **서버 시계로 계산한 오늘**. 클라이언트가 보낸 날짜와 무관하게 항상
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
    /**
     * 🔴 2026-08-15 — 여기가 UTC 고정이었던 것이 실사용 버그를 만들었다(사장님: "오늘 계속 테스트하던
     * 기기인데 왜 갑자기 출석 보상이 뜬 거야").
     *
     * 클라이언트의 todayStr()은 **기기 로컬 날짜**(한국이면 KST)인데 여기는 **UTC 날짜**를 돌려줬다.
     * 한국은 UTC+9라 매일 **KST 00:00~08:59 동안 서버가 '어제'를 오늘이라고 말한다.** 그 시간대에
     * 출석하면 lastCheckInDate가 어제 날짜로 박히고, KST 09:00에 UTC 날짜가 넘어가는 순간
     * `lastCheckInDate !== today`가 되어 **같은 하루에 출석 보상이 두 번** 나간다.
     * 오늘 실제로 그렇게 떴다.
     *
     * serverToday를 넣은 목적은 "기기 날짜 조작 방지"였지 "UTC 강제"가 아니었다 — 지켜야 할 것은
     * **시계의 출처**(서버)지 시간대가 아니다. 그래서 시계는 서버 것을 그대로 쓰고, 시간대만
     * 클라이언트가 알려준 오프셋을 적용한다. 사용자가 오프셋을 위조해도 얻을 수 있는 건 최대 하루치
     * 선취뿐이고, 그건 useAttendanceStore의 단조 가드(이미 받은 날짜보다 크지 않으면 미지급)가
     * 그다음 날 상쇄한다.
     */
    private static LocalDate todayIn(Integer tzOffsetMinutes) {
        java.time.ZoneOffset zone = java.time.ZoneOffset.UTC;
        if (tzOffsetMinutes != null) {
            // UTC 오프셋 유효 범위는 -12:00 ~ +14:00. 벗어난 값은 위조/버그이므로 UTC로 떨어뜨린다.
            int clamped = Math.max(-12 * 60, Math.min(14 * 60, tzOffsetMinutes));
            zone = java.time.ZoneOffset.ofTotalSeconds(clamped * 60);
        }
        return java.time.Instant.now().atOffset(zone).toLocalDate();
    }

    public static FocusAllowanceResponse of(FocusAllowance a, Integer tzOffsetMinutes) {
        return new FocusAllowanceResponse(
                a.getAllowanceDate(), a.getAdExtendCount(), a.isTimedOut(), a.getSessionEndsAt(),
                todayIn(tzOffsetMinutes));
    }

    public static FocusAllowanceResponse empty(LocalDate date, Integer tzOffsetMinutes) {
        return new FocusAllowanceResponse(date, 0, false, null, todayIn(tzOffsetMinutes));
    }
}
