package com.pace.backend.service;

import com.pace.backend.dto.FocusAllowanceResponse;
import com.pace.backend.dto.FocusAllowanceSyncRequest;
import com.pace.backend.entity.FocusAllowance;
import com.pace.backend.repository.FocusAllowanceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * 2026-08-10 하루에 나온 버그 중 **재발 방지 가치가 가장 큰** 규칙을 고정한다.
 *
 * 왜 이 서비스가 최우선인가 — 이날의 사고 사슬이 전부 여기로 모인다:
 *   1. 마감시각·타임아웃 플래그가 화면 컴포넌트(useRef/useState)에만 있어서 화면을 나갔다 오면
 *      광고 게이트가 통째로 풀렸다(982bbf1).
 *   2. 영속 스토어로 옮겨도(AsyncStorage / SharedPreferences) **앱을 지웠다 깔면** 로컬이 통째로
 *      비어 같은 우회가 그대로 살아났다(사장님 지적).
 *   3. 그래서 서버를 진실원천으로 올렸고(40ec367), 기기 id가 재설치를 견디게 만들었다
 *      (Android SSAID 6d932ec / iOS Keychain d4e004d).
 * 즉 **재설치 차단의 마지막 보증이 이 병합 규칙**이다. 이게 "덮어쓰기"로 한 줄만 되돌아가면
 * 위 세 겹의 수정이 전부 무의미해지는데, 그 회귀는 코드를 봐도 눈에 잘 안 띈다(값을 그냥 대입하는
 * 것이 오히려 자연스러워 보인다). 사람 눈 대신 이 테스트가 지킨다.
 *
 * 기존 RevenueCatServiceTest와 같은 도구만 쓴다(JUnit 5 + Mockito + AssertJ). 새 프레임워크 없음.
 */
class FocusAllowanceServiceTest {

    private static final Long USER_ID = 42L;
    // 🔴 2026-08-13 — 고정 날짜를 쓰면 안 된다. 서버가 클라이언트 날짜를 ±1일로 클램프하게 되면서
    //   (FocusAllowanceService.sanitizeDate — 기기 날짜 조작으로 하루 3회 한도가 새로 생기던 우회 차단)
    //   과거의 고정 날짜는 전부 클램프 대상이 된다. 테스트는 "오늘"을 기준으로 잡아야 규칙과 어긋나지 않는다.
    private static final LocalDate TODAY = LocalDate.now(java.time.ZoneOffset.UTC);

    private FocusAllowanceRepository repository;
    private FocusAllowanceService service;

    @BeforeEach
    void setUp() {
        repository = mock(FocusAllowanceRepository.class);
        // save는 들어온 엔티티를 그대로 돌려준다 — 이 테스트가 보는 것은 "무엇을 저장하려 했는가"다.
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new FocusAllowanceService(repository);
    }

    /** 서버에 이미 남아 있는 오늘 기록. */
    private FocusAllowance stored(int adExtendCount, boolean timedOut, Instant sessionEndsAt) {
        FocusAllowance a = new FocusAllowance();
        a.setId(1L);
        a.setUserId(USER_ID);
        a.setAllowanceDate(TODAY);
        a.setAdExtendCount(adExtendCount);
        a.setTimedOut(timedOut);
        a.setSessionEndsAt(sessionEndsAt);
        when(repository.findByUserIdAndAllowanceDate(USER_ID, TODAY)).thenReturn(Optional.of(a));
        return a;
    }

    private FocusAllowanceResponse sync(int adExtendCount, boolean timedOut, Instant sessionEndsAt) {
        return service.sync(USER_ID, new FocusAllowanceSyncRequest(TODAY, adExtendCount, timedOut, sessionEndsAt));
    }

    // ── 카운트: max로만 움직인다 ─────────────────────────────────────────────────

    /**
     * 🔴 이 테스트가 이 파일의 존재 이유다.
     * 앱을 지웠다 깔면 클라이언트는 "오늘 광고 0회"를 들고 온다. 그걸 그대로 받으면 서버 기록이
     * 지워져 하루 3회 한도가 무한이 된다(사장님이 지적한 바로 그 경로).
     */
    @Test
    void 재설치한_앱이_0을_올려도_서버의_광고횟수는_유지된다() {
        FocusAllowance existing = stored(3, false, null);

        FocusAllowanceResponse result = sync(0, false, null);

        assertThat(result.adExtendCount()).isEqualTo(3);
        assertThat(existing.getAdExtendCount()).isEqualTo(3);
    }

    @Test
    void 실제로_늘어난_광고횟수는_반영된다() {
        stored(1, false, null);

        assertThat(sync(2, false, null).adExtendCount()).isEqualTo(2);
    }

    @Test
    void 기록이_없던_사용자는_새_행으로_시작한다() {
        when(repository.findByUserIdAndAllowanceDate(USER_ID, TODAY)).thenReturn(Optional.empty());

        FocusAllowanceResponse result = sync(1, false, null);

        assertThat(result.adExtendCount()).isEqualTo(1);
        assertThat(result.date()).isEqualTo(TODAY);
        verify(repository).save(any(FocusAllowance.class));
    }

    // ── timedOut: OR로만 움직인다 ───────────────────────────────────────────────

    /**
     * "시간이 다 돼서 꺼졌다"는 사실은 광고 게이트의 근거다. 클라이언트가 false를 올린다고
     * 풀리면, 앱을 지웠다 깔거나 로컬 저장소만 비워도 무료 10분이 다시 나간다.
     */
    @Test
    void 클라이언트가_timedOut_false를_올려도_서버의_true는_안_풀린다() {
        stored(3, true, null);

        assertThat(sync(0, false, null).timedOut()).isTrue();
    }

    @Test
    void 클라이언트가_timedOut_true를_올리면_서버에도_선다() {
        stored(0, false, null);

        assertThat(sync(0, true, null).timedOut()).isTrue();
    }

    // ── 마감시각: 지났으면 timedOut 확정, 연장이면 해제 ─────────────────────────

    /**
     * 앱을 껐다 켜서 게이트를 피하는 경로 차단(클라이언트 useFocusSessionStore.load()와 같은 판정).
     * 저장된 마감시각이 이미 과거면 그건 "시간이 다 된" 것이지 "세션이 남아 있는" 것이 아니다.
     */
    @Test
    void 저장된_마감시각이_이미_지났으면_timedOut으로_확정한다() {
        stored(0, false, Instant.now().minus(1, ChronoUnit.MINUTES));

        FocusAllowanceResponse result = sync(0, false, null);

        assertThat(result.timedOut()).isTrue();
        assertThat(result.sessionEndsAt()).isNull(); // 되살릴 세션은 없다
    }

    /** 클라이언트가 과거 마감시각을 올려도 같은 판정이다(껐다 켠 뒤 옛 상태를 올리는 경로). */
    @Test
    void 클라이언트가_지난_마감시각을_올려도_timedOut으로_확정한다() {
        when(repository.findByUserIdAndAllowanceDate(USER_ID, TODAY)).thenReturn(Optional.empty());

        FocusAllowanceResponse result = sync(0, false, Instant.now().minus(10, ChronoUnit.MINUTES));

        assertThat(result.timedOut()).isTrue();
        assertThat(result.sessionEndsAt()).isNull();
    }

    /**
     * 광고를 봤거나 크레딧을 썼다는 뜻이므로 여기서만 timedOut이 풀린다 —
     * "연장은 5분(FOCUS_SESSION_EXTEND_MINUTES)"이라는 규칙이 c542d25/982bbf1에서 고쳐진 그 지점이다.
     */
    @Test
    void 더_나중_마감시각이_오면_연장으로_보고_timedOut을_푼다() {
        stored(1, true, null);

        Instant extended = Instant.now().plus(5, ChronoUnit.MINUTES);
        FocusAllowanceResponse result = sync(1, false, extended);

        assertThat(result.timedOut()).isFalse();
        assertThat(result.sessionEndsAt()).isEqualTo(extended);
    }

    /**
     * ⚠️ 이 방향은 반대로 움직이면 안 된다 — 클라이언트가 자기 옛 마감시각을 올렸다고 서버에
     * 이미 반영된 연장이 짧아지면, 다른 기기/재설치본이 남의 세션을 깎게 된다.
     */
    @Test
    void 더_이른_마감시각은_기존_마감시각을_앞당기지_못한다() {
        Instant later = Instant.now().plus(9, ChronoUnit.MINUTES);
        stored(0, false, later);

        FocusAllowanceResponse result = sync(0, false, Instant.now().plus(2, ChronoUnit.MINUTES));

        assertThat(result.sessionEndsAt()).isEqualTo(later);
        assertThat(result.timedOut()).isFalse();
    }

    /**
     * 재설치 시나리오 전체를 한 번에 — 서버 3회/타임아웃 상태에서 갓 설치한 앱이 백지(0/false/null)를
     * 올린다. 아무것도 초기화되면 안 된다. (이 조합이 무너지면 40ec367 전체가 무의미해진다.)
     */
    @Test
    void 재설치_직후_백지_상태를_올려도_한도와_게이트가_그대로_남는다() {
        stored(3, true, null);

        FocusAllowanceResponse result = sync(0, false, null);

        assertThat(result.adExtendCount()).isEqualTo(3);
        assertThat(result.timedOut()).isTrue();
        assertThat(result.sessionEndsAt()).isNull();
    }

    // ── 조회 ────────────────────────────────────────────────────────────────────

    @Test
    void 기록이_없으면_빈_허용량을_돌려준다() {
        when(repository.findByUserIdAndAllowanceDate(USER_ID, TODAY)).thenReturn(Optional.empty());

        FocusAllowanceResponse result = service.get(USER_ID, TODAY);

        assertThat(result.date()).isEqualTo(TODAY);
        assertThat(result.adExtendCount()).isZero();
        assertThat(result.timedOut()).isFalse();
        assertThat(result.sessionEndsAt()).isNull();
    }

    @Test
    void 조회는_저장된_값을_그대로_돌려준다() {
        Instant endsAt = Instant.now().plus(3, ChronoUnit.MINUTES);
        stored(2, true, endsAt);

        FocusAllowanceResponse result = service.get(USER_ID, TODAY);

        assertThat(result.adExtendCount()).isEqualTo(2);
        assertThat(result.timedOut()).isTrue();
        assertThat(result.sessionEndsAt()).isEqualTo(endsAt);
    }

    // ── 보관 기간(f38b136) ──────────────────────────────────────────────────────

    /**
     * 지우는 것은 **지난 날짜뿐**이라는 것이 이 기능의 안전 근거다 — 오늘 행을 건드리면 자정 전에
     * 한도가 리셋돼 하루 3회가 무한이 된다. cutoff 계산이 그 경계를 지키는지 고정한다.
     */
    @Test
    void 보관기간_정리는_7일_이전_행만_지운다() {
        when(repository.deleteByAllowanceDateBefore(any())).thenReturn(0);

        service.purgeOldRows();

        verify(repository).deleteByAllowanceDateBefore(eq(LocalDate.now().minusDays(7)));
    }
/**
     * 🔴 2026-08-13 — 기기 날짜만 바꾸면 하루 3회 한도가 새로 생기던 우회를 막은 뒤 그 규칙을 고정한다.
     * 서버 날짜와 ±1일까지는 그대로 인정해야 한다(타임존 폭 UTC-12~UTC+14 = 26시간). 그 밖은 클램프.
     */
    @Test
    void 날짜가_서버와_1일_이내면_그대로_쓴다() {
        LocalDate yesterday = LocalDate.now(java.time.ZoneOffset.UTC).minusDays(1);
        when(repository.findByUserIdAndAllowanceDate(eq(USER_ID), eq(yesterday))).thenReturn(Optional.empty());

        service.get(USER_ID, yesterday);

        verify(repository).findByUserIdAndAllowanceDate(eq(USER_ID), eq(yesterday));
    }

    @Test
    void 날짜를_크게_돌리면_서버_날짜로_클램프한다() {
        LocalDate serverToday = LocalDate.now(java.time.ZoneOffset.UTC);
        LocalDate faked = serverToday.plusDays(30); // 기기 날짜를 한 달 앞으로
        when(repository.findByUserIdAndAllowanceDate(eq(USER_ID), eq(serverToday))).thenReturn(Optional.empty());

        service.get(USER_ID, faked);

        // 조작한 날짜가 아니라 서버 날짜로 조회돼야 한다 = 새 허용량이 생기지 않는다.
        verify(repository).findByUserIdAndAllowanceDate(eq(USER_ID), eq(serverToday));
        verify(repository, never()).findByUserIdAndAllowanceDate(eq(USER_ID), eq(faked));
    }
}
