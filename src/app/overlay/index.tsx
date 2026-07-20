import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { OverlayBar } from '../../components/overlays/OverlayBar'; // Metro가 .android.tsx/.ios.tsx를 자동 선택
import { OverlayExpandedCard } from '../../components/overlays/shared/OverlayExpandedCard';
import { PlatformMimicOverlay } from '../../components/overlays/PlatformMimicOverlay';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useUserStore } from '../../store/useUserStore';
import { useAutoNextStore } from '../../store/useAutoNextStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useToastStore } from '../../store/useToastStore';
import { overlayService, autoNextService } from '../../services/platform';
import { startSession, endSession as endSessionRow, logOverlayEvent } from '../../database/repositories/sessionsRepository';
import { getTodayUsageMinutes } from '../../database/repositories/statsRepository';
import { notifyBreakReminder, notifyLimitReached, notifyLowTime } from '../../services/notifications';
import { pushUnsyncedSessions } from '../../services/sync/backendSync';
import { CURATED_VIDEOS } from '../../constants/curatedVideos';
import { SUPPORTED_APPS } from '../../constants/supportedApps';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import type { AppShieldTarget, SessionEndStatus } from '../../types/models';

// Android: 선택한 플랫폼 앱을 실제로 연다(공식 딥링크 스킴 → 실패 시 웹 폴백) — "제품 전략 피벗"의
// "Start → App Picker → 선택 앱 실행" 흐름 중 앱 실행 부분. iOS는 Pace Player 방향이 POC 검증 전이라
// (PACE_ARCHITECTURE.md "iOS Pace Player 성립 가능성 검증" 참고) 아직 아무 것도 하지 않는다 —
// 여기서 실제 앱을 열지 않고 이 dev 시뮬레이터 화면을 그대로 보여주는 것이 검증 전 상태에 대한
// 정직한 표현이다(가짜 Player UI를 미리 만들지 않음).
async function launchPlatformApp(platform: AppShieldTarget | undefined) {
  if (Platform.OS !== 'android' || !platform) return;
  const app = SUPPORTED_APPS[platform as keyof typeof SUPPORTED_APPS];
  if (!app) return;
  // 2026-07-18 실기기 검증 중 발견한 실버그: YouTube는 `vnd.youtube://`(커스텀 스킴)로 열면 앱이
  // 설치돼 있을 때 항상 "성공"으로 catch를 안 타서, Shorts 전용 URL인 webFallback
  // (m.youtube.com/shorts)이 영영 안 쓰이고 매번 YouTube 홈 탭만 열렸다("Shorts 카드를 눌렀는데
  // YouTube 홈이 뜬다"는 사용자 지적으로 발견). https Shorts URL은 Android App Links로 앱이 설치돼
  // 있으면 네이티브 앱의 Shorts 탭으로, 안 돼있으면 브라우저로 자동 라우팅되므로 —
  // 커스텀 스킴 우선순위를 뒤집어 App Link(webFallback)를 먼저 시도.
  try {
    await Linking.openURL(app.webFallback);
  } catch {
    await Linking.openURL(app.androidScheme).catch(() => {});
  }
}

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];

// 세션 시작 직후 화면. 실기기 프로덕션에서는 여기서 사용자가 홈 버튼/앱 스위처로 YouTube 등으로
// 전환하고, Android는 시스템 오버레이가, iOS는 Live Activity가 이어서 표시를 담당한다
// (PACE_ARCHITECTURE.md 참고). 아래 "underlying content" 영역은 실제 프로덕션에는 존재하지 않고,
// 네이티브 오버레이/Live Activity 모듈이 붙기 전까지 개발/테스트에서 오버레이-위-콘텐츠 상호작용을
// 눈으로 확인하기 위한 시뮬레이터일 뿐이다(healthy-shorts-assistant ShortsPlayer.tsx의 데모 콘텐츠 이식).
export default function OverlaySessionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { platform } = useLocalSearchParams<{ platform?: AppShieldTarget }>();
  const user = useUserStore((s) => s.user);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const timer = useTimerStore();
  const autoNextRuntime = useAutoNextStore();
  const bonusMinutes = useDailyBonusStore((s) => s.extraMinutes);
  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const [expanded, setExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [videoIndex, setVideoIndex] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const endReasonRef = useRef<SessionEndStatus>('manual_stop');
  const sessionStartedAtMsRef = useRef<number | null>(null);
  const hasAutoEndedRef = useRef(false);
  // remainingMinutes/isSessionActive 둘 다 스토어 초기값이 0/false라, 아래 useEffect가 "세션이 실제로
  // 시작됐는지"를 isSessionActive만으로 구분할 수 없다(0 도달로 자동종료된 순간에도 동일값이 됨).
  // 이 ref로 "startSession()이 실제로 호출됐는지"를 별도로 추적한다.
  const hasSessionStartedRef = useRef(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const id = await startSession(user.id, platform ?? null);
      sessionIdRef.current = id;
      sessionStartedAtMsRef.current = Date.now();
      // 2026-07-18: useSessionStore가 정의만 되고 어디서도 안 쓰이던 죽은 상태였다 — Home의
      // "지금 실제로 어떤 플랫폼이 활성 세션인지" 표시(플랫폼 카드 상태 점 초록 펄스)가 이 스토어를
      // 진실원천으로 쓰도록 여기서 실제로 채운다.
      useSessionStore.getState().start({ sessionId: id, platformApp: platform ?? null });
      const todayUsedMinutes = await getTodayUsageMinutes(user.id);
      const remainingMinutes = Math.max(0, settings.dailyLimitMinutes + useDailyBonusStore.getState().extraMinutes - todayUsedMinutes);
      timer.startSession({
        sessionId: id,
        remainingMinutes,
        sleepTimerMinutes: settings.sleepTimerMinutes,
        breakIntervalMinutes: settings.breakIntervalMinutes,
      });
      hasSessionStartedRef.current = true;
      // 2026-07-20 Focus Session 리디자인 — 세션을 시작하자마자 권한이 없다고 온보딩 팝업을 끼워
      // 넣지 않는다(사용자 지적: "핸즈프리 팝업이 세션 시작을 막는 것처럼 보인다"). 접근성은 이제
      // 핸즈프리 자동넘김이라는 보조 기능에만 필요하고, 실제 앱 보기(launchPlatformApp) 자체와는
      // 무관하다 — 권한이 있으면 조용히 자동넘김을 시작하고, 없으면 그냥 시작 안 할 뿐 팝업으로
      // 끼어들지 않는다. 온보딩 시트는 사용자가 실제로 핸즈프리 컨트롤(알약 AUTO 배지, Focus 탭
      // 가드 행)을 직접 탭할 때만 그 자리에서 뜬다.
      if (settings.autoNext) {
        autoNextService.hasPermission().then((granted) => {
          if (granted) autoNextRuntime.start(null);
        });
      }
      // Android 실기기에서 native 모듈이 링크돼 있으면 시스템 오버레이도 함께 띄운다(미링크 시 no-op).
      // 2026-07-19: Sleep Timer/Break Reminder/알림 설정까지 전부 네이티브가 자기 완결적으로
      // 담당하도록 세션 시작 시점 값을 함께 넘긴다(같은 파일 하단 tick 주석 참고).
      overlayService.startSession({
        dailyLimitMinutes: settings.dailyLimitMinutes,
        remainingMinutes,
        autoNext: settings.autoNext,
        sleepTimerMinutes: settings.sleepTimerMinutes ?? 0,
        breakIntervalMinutes: settings.breakIntervalMinutes,
        notifyRemaining: settings.notifyRemaining,
        notifyLimit: settings.notifyLimit,
        notifyBreak: settings.notifyBreak,
        hardBlockMode: settings.hardBlockMode,
      }).catch(() => {});
      launchPlatformApp(platform).catch(() => {});
    })();

    // 2026-07-18 실기기 검증 중 발견: useTimerStore.tickMinute()을 호출하는 곳이 코드 전체에
    // 어디에도 없었다 — 남은시간/수면타이머/휴식리마인더 카운트다운이 세션 시작 값에서 실제로는
    // 한 번도 줄어들지 않는 치명적 버그. 여기서 1분마다 직접 틱을 돌린다(네이티브 포그라운드
    // 서비스가 아직 JS로 틱 이벤트를 보내지 않으므로 JS 인터벌이 유일한 소스).
    //
    // ⚠️ 2차 버그(같은 날 실기기 재검증 중 발견): 처음엔 이 틱과 별개로 아래
    // `useEffect(..., [timer.remainingMinutes, ...])`가 네이티브 오버레이 갱신
    // (overlayService.updateRemaining)을 담당했는데, 사용자가 YouTube로 나가서 Pace가
    // 백그라운드로 가면 이 effect가 다시는 안 돈다 — 60초+ 실기기 실측으로 확인(logcat에
    // updateRemaining 호출이 최초 1회 이후 전혀 안 찍힘). 원인: Zustand 상태(zustand의
    // getState/setState)는 React 렌더 사이클과 무관하게 즉시 갱신되지만, 그 상태를 "구독"해서
    // 반응하는 useEffect는 컴포넌트가 리렌더돼야 실행되는데, 액티비티가 백그라운드로 가면 RN이
    // 리렌더/커밋을 지연·중단시킨다 — 오버레이 알약은 여전히 "15m Left"에 멈춰있는데 실제
    // 남은시간은 계속 줄어드는(=시간제어가 사실상 무력화되는) 심각한 버그였다. 고침: 틱 콜백
    // 안에서 setState 이후의 최신 값을 직접 읽어 네이티브로 즉시 밀어준다 — React 렌더/effect에
    // 전혀 의존하지 않는 순수 명령형 경로라 백그라운드에서도 동일하게 동작(setInterval 자체는
    // JS 엔진 타이머라 액티비티 가시성과 무관하게 계속 돈다).
    // ⚠️ 2026-07-19: 위 4가지(오버레이 텍스트 갱신/세션 자동 종료/Break Reminder 알림/저시간·한도도달
    // 알림)를 Android에서도 이 JS 틱이 계속 담당하면, 같은 걸 이제 네이티브(PaceOverlayService)도
    // 독립적으로 판단·발송하므로 알림이 두 번 뜨거나 서로 다른 시점에 남은시간을 판단해 어긋날 수
    // 있다 — Daily Limit뿐 아니라 Sleep Timer/Break Reminder/저시간경고/한도도달 알림 전부 네이티브가
    // 자기 완결적으로 담당하도록 확장했으므로(PaceOverlayService.kt 주석 참고), Android에서는 이
    // 알림 발송/만료 판정 로직을 더 이상 돌리지 않는다 — tickMinute()만 계속 불러서 화면(확장 카드
    // 등)에 보여줄 로컬 숫자만 갱신한다. iOS는 이 네이티브 카운트다운이 없으므로(Screen Time이 대신
    // 차단) 기존 로직을 그대로 유지.
    const tickInterval = setInterval(() => {
      if (!hasSessionStartedRef.current) return; // 세션 시작 비동기 처리가 아직 안 끝났으면 스킵(0 오판 방지)
      const before = useTimerStore.getState(); // tick 전 스냅샷 — 종료 사유 판정용(아래 참고)
      useTimerStore.getState().tickMinute();
      if (Platform.OS === 'android') return;
      const fresh = useTimerStore.getState();

      if (fresh.remainingMinutes === 5 || fresh.remainingMinutes === 1) {
        notifyLowTime(fresh.remainingMinutes).catch(() => {});
      }

      if (fresh.nextBreakInMinutes === 0 && settings.breakIntervalMinutes > 0) {
        notifyBreakReminder().catch(() => {});
        if (user?.id) logOverlayEvent(user.id, sessionIdRef.current, 'BREAK_REMINDER').catch(() => {});
        useTimerStore.setState({ nextBreakInMinutes: settings.breakIntervalMinutes });
      }

      if (!hasAutoEndedRef.current && (fresh.remainingMinutes <= 0 || fresh.sleepTimerRemainingMinutes === 0)) {
        hasAutoEndedRef.current = true;
        // tickMinute()이 endSession()으로 remaining을 0으로 리셋한 뒤라 fresh만 보면 수면타이머 만료도
        // 'daily_limit_reached'로 오판된다(감사 발견). tick 전 스냅샷(before)으로 판정 — daily limit이
        // 이번 tick에 0에 도달(before.remaining<=1)하면 daily, 아니면 수면타이머 만료.
        endReasonRef.current = before.remainingMinutes <= 1 ? 'daily_limit_reached' : 'sleep_timer_expired';
        if (endReasonRef.current === 'daily_limit_reached') notifyLimitReached().catch(() => {});
        router.back();
      }
    }, 60_000);

    return () => {
      clearInterval(tickInterval);
      if (sessionIdRef.current && user.id) {
        const durationSeconds = sessionStartedAtMsRef.current
          ? Math.max(0, Math.round((Date.now() - sessionStartedAtMsRef.current) / 1000))
          : 0;
        // 2026-07-19 버그 수정(사용자 지적): videoIndex는 이 화면 자체가 그리는 "개발용 시뮬레이터
        // 콘텐츠"(CURATED_VIDEOS를 setTimeout으로 순환시키는 데모 루프, 아래 참고)의 진행 상황일
        // 뿐이다 — 실제 세션에서는 Android가 진짜 YouTube/Instagram/TikTok 앱을 열고(launchPlatformApp)
        // 이 화면은 그 뒤에서 보이지도 않게 깔려 있으므로, 사용자가 그 안에서 실제로 몇 개를 봤는지
        // Pace가 알 방법이 전혀 없다(다른 앱 내부 재생 상태를 관찰할 API가 없음). 그런데도 이 가짜
        // videoIndex가 그대로 videos_watched로 DB에 저장되고 있었다 — Focus/Stats 탭의 "오늘 본
        // 영상 수"가 실사용 중엔 사실상 의미 없는 숫자였던 원인. 실제로 셀 수 없는 값을 가짜로 채우는
        // 대신 정직하게 0으로 기록한다("죽은 코드/가짜 데이터로 남기지 말라"는 이 세션의 원칙과 동일).
        endSessionRow(sessionIdRef.current, durationSeconds, 0, endReasonRef.current)
          .then(() => pushUnsyncedSessions(user.id))
          .catch(() => {});
        logOverlayEvent(user.id, sessionIdRef.current, 'SESSION_STOP', endReasonRef.current).catch(() => {});
      }
      timer.endSession();
      autoNextRuntime.stop();
      overlayService.endSession().catch(() => {});
      useSessionStore.getState().finish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 2026-07-19: Android에서 실제 시간 소진(Daily Limit 또는 Sleep Timer) 시 "오버레이가 사라지고
  // 서비스가 멈추는" 차단 + 저시간/한도도달/Break Reminder 알림 발송까지 전부 이제 네이티브
  // (PaceOverlayService.tickRunnable)가 자기 완결적으로 즉시 수행한다(PaceOverlayService.kt 주석
  // 참고) — 알림은 이미 발송됐으므로 여기서 또 쏘지 않는다. 이 effect는 그 네이티브 차단이 실제로
  // 있었는지 사후 확인해 JS 쪽 뒷정리(DB 세션 기록/router.back())만 뒤늦게 완료하는 역할 — Pace가
  // 다시 포그라운드로 돌아올 때마다(AppState 'active') consumeExpired()로 사유를 1회 소비한다.
  useEffect(() => {
    const consumeIfExpired = () => {
      if (!hasSessionStartedRef.current || hasAutoEndedRef.current) return;
      overlayService.consumeExpired().then((reason) => {
        if (!reason || hasAutoEndedRef.current) return;
        hasAutoEndedRef.current = true;
        endReasonRef.current = reason;
        useTimerStore.setState(
          reason === 'sleep_timer_expired' ? { sleepTimerRemainingMinutes: 0 } : { remainingMinutes: 0 }
        );
        router.back();
      }).catch(() => {});
    };
    consumeIfExpired(); // 화면이 이미 백그라운드 만료 이후 다시 마운트되는 경우 대비
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') consumeIfExpired();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto Next 시뮬레이션: 실제로는 services/platform의 autoNextService(Android)가 담당 —
  // 여기서는 dev 시뮬레이터에서 데모 영상이 끝나면 다음 영상으로 넘어가는 흉내만 낸다.
  useEffect(() => {
    if (!isPlaying || !settings.autoNext) return;
    const video = CURATED_VIDEOS[videoIndex];
    const t = setTimeout(() => {
      setVideoIndex((i) => (i + 1) % CURATED_VIDEOS.length);
      if (user?.id) logOverlayEvent(user.id, sessionIdRef.current, 'AUTO_NEXT', video.id).catch(() => {});
    }, video.durationSeconds * 100);
    return () => clearTimeout(t);
  }, [isPlaying, settings.autoNext, videoIndex, user?.id]);

  const onStop = () => {
    endReasonRef.current = 'manual_stop';
    timer.endSession();
    router.back();
  };

  const video = CURATED_VIDEOS[videoIndex];

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.overlayLayer} edges={['top']}>
        <OverlayBar
          remainingMinutes={timer.remainingMinutes}
          autoNextEnabled={settings.autoNext}
          onToggleAutoNext={() => updateSettings({ autoNext: !settings.autoNext })}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
        {!expanded && (timer.remainingMinutes === 5 || timer.remainingMinutes === 1) && (
          <View style={styles.lowTimeToast}>
            <Feather name="clock" size={14} color="#000000" />
            <Text style={styles.lowTimeToastText}>
              {timer.remainingMinutes === 1 ? t('overlay.lowTimeWarningSingular', { n: 1 }) : t('overlay.lowTimeWarningPlural', { n: timer.remainingMinutes })}
            </Text>
          </View>
        )}
        {expanded && (
          <View style={styles.expandedWrap}>
            <OverlayExpandedCard
              todayUsedMinutes={effectiveDailyLimitMinutes - timer.remainingMinutes}
              dailyLimitMinutes={effectiveDailyLimitMinutes}
              remainingMinutes={timer.remainingMinutes}
              autoNextEnabled={settings.autoNext}
              onToggleAutoNext={() => updateSettings({ autoNext: !settings.autoNext })}
              sleepTimerMinutes={settings.sleepTimerMinutes}
              onCycleSleepTimer={() => {
                const idx = SLEEP_TIMER_OPTIONS.indexOf(settings.sleepTimerMinutes ?? 0);
                updateSettings({ sleepTimerMinutes: SLEEP_TIMER_OPTIONS[(idx + 1) % SLEEP_TIMER_OPTIONS.length] || null });
              }}
              isPlaying={isPlaying}
              onTogglePlaying={() => { setIsPlaying((v) => !v); setExpanded(false); }}
              onStop={onStop}
              onExtend={(amount) => {
                useDailyBonusStore.getState().addMinutes(amount);
                const newRemaining = useTimerStore.getState().addMinutes(amount);
                overlayService.updateRemaining(newRemaining).catch(() => {});
                useToastStore.getState().show(`+${amount}m added`);
              }}
            />
          </View>
        )}
      </SafeAreaView>

      {/* --- 개발용 시뮬레이터 콘텐츠(프로덕션에는 없음, 실제 숏폼 앱이 이 자리를 대체) ---
          healthy-shorts-assistant(3) ShortsPlayer.tsx의 플랫폼별(YouTube/Instagram/TikTok) 상단바
          + 하단 메타데이터 + 우측 액션 레일을 이식(PlatformMimicOverlay 참고) — 중앙엔 카테고리
          태그만 남기고 제목/설명/작성자는 하단 메타데이터로 옮겨서 중복 표시를 없앴다. */}
      <View style={styles.simContent}>
        <Text style={styles.simCategory}>{video.category}</Text>
      </View>
      {platform && <PlatformMimicOverlay platform={platform} video={video} />}

      <View style={styles.devBadge}>
        <Text style={styles.devBadgeText}>{t('overlay.devSimulator')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  overlayLayer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  expandedWrap: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  // healthy-shorts-assistant(1)에 새로 추가된 "5분/1분 남음" 저시간 경고 토스트 이식 — 오버레이의
  // 상시 상태(하지 말 것 원칙)가 아니라 일회성 넛지라 "하단 플레이어 컨트롤 금지" 원칙과 무관.
  lowTimeToast: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: 'rgba(245,158,11,0.9)', // colors.warning(#F59E0B) @ 90%
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  lowTimeToastText: { color: '#000000', fontFamily: typography.bodyFontFamilyBold, fontSize: 12, flexShrink: 1 },
  simContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  simCategory: { color: '#30D158', fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1, backgroundColor: 'rgba(48,209,88,0.1)', borderWidth: 1, borderColor: 'rgba(48,209,88,0.2)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  devBadge: { position: 'absolute', bottom: spacing.lg, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  devBadgeText: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontFamily: typography.bodyFontFamilyBold, letterSpacing: 0.5 },
});
