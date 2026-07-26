import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useFlipStore } from '../../store/useFlipStore';
import { useAttendanceStore } from '../../store/useAttendanceStore';
import { overlayService, autoNextService } from '../../services/platform';
import { showRewardedAd } from '../../services/ads/rewardedAd';
import { startSession, endSession as endSessionRow, logOverlayEvent } from '../../database/repositories/sessionsRepository';
import { getTodayUsageMinutes } from '../../database/repositories/statsRepository';
import { notifyAccessibilityNeeded, notifyBreakReminder, notifyLimitReached, notifyLowTime } from '../../services/notifications';
import { pushUnsyncedSessions } from '../../services/sync/backendSync';
import { CURATED_VIDEOS } from '../../constants/curatedVideos';
import { launchPlatformApp } from '../../constants/supportedApps';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import type { AppShieldTarget, SessionEndStatus } from '../../types/models';

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];

// 세션 시작 직후 화면. 실기기 프로덕션에서는 여기서 사용자가 홈 버튼/앱 스위처로 YouTube 등으로
// 전환하고, Android는 시스템 오버레이가, iOS는 Live Activity가 이어서 표시를 담당한다
// (PACE_ARCHITECTURE.md 참고). 아래 "underlying content" 영역은 실제 프로덕션에는 존재하지 않고,
// 네이티브 오버레이/Live Activity 모듈이 붙기 전까지 개발/테스트에서 오버레이-위-콘텐츠 상호작용을
// 눈으로 확인하기 위한 시뮬레이터일 뿐이다(healthy-shorts-assistant ShortsPlayer.tsx의 데모 콘텐츠 이식).
export default function OverlaySessionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  // 2026-07-22 실기기 검증 중 발견 — 세션이 콜드 스타트로 곧장 이 화면부터 시작된 경우(탭 화면을
  // 거치지 않아 네비게이션 히스토리가 비어있음) router.back()이 "GO_BACK 처리 안 됨" 개발자 경고를
  // 내며 아무 데도 이동하지 못했다. 뒤로 갈 화면이 있으면 back, 없으면 Home으로 교체 이동.
  const exitOverlay = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

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
        exitOverlay();
      }
    }, 60_000);

    return () => {
      clearInterval(tickInterval);
      if (sessionIdRef.current && user.id) {
        const durationSeconds = sessionStartedAtMsRef.current
          ? Math.max(0, Math.round((Date.now() - sessionStartedAtMsRef.current) / 1000))
          : 0;
        const sessionId = sessionIdRef.current;
        const userId = user.id;
        const endReason = endReasonRef.current;
        // 2026-07-26 — PaceAccessibilityService가 실제 재생위치 신호(끝남/되감김 감지)로 센 진짜
        // 시청 편수를 읽는다(자동넘김이든 사용자가 직접 넘겼든 다 포함). iOS/접근성 꺼짐은 항상 0 —
        // 예전엔 개발용 시뮬레이터의 videoIndex를 가짜로 흘려보내다 고쳐서 정직하게 0을 기록했는데
        // (아래 원래 있던 주석 참고), 이제는 Android에서 진짜 값을 셀 수 있게 됐다. endSession()
        // (네이티브 stop → 카운터 리셋) 호출 전에 먼저 읽어야 한다.
        overlayService.getVideoWatchCount().then((videosWatched) => (
          endSessionRow(sessionId, durationSeconds, videosWatched, endReason)
        )).then(() => pushUnsyncedSessions(userId)).catch(() => {});
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
  // 있었는지 사후 확인해 JS 쪽 뒷정리(DB 세션 기록/exitOverlay())만 뒤늦게 완료하는 역할 — Pace가
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
        exitOverlay();
      }).catch(() => {});
    };
    consumeIfExpired(); // 화면이 이미 백그라운드 만료 이후 다시 마운트되는 경우 대비
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') consumeIfExpired();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-07-26 사용자 지시("자동넘김 30회 도달하면 멈추고 광고 보면 20회씩 추가") — 위
  // consumeExpired()와 정확히 같은 이유·같은 패턴: YouTube가 전면에 있는 동안 Pace의 JS 타이머는
  // 백그라운드 throttle로 죽어있을 수 있어, 네이티브가 이미 판단해둔 "한도 도달" 신호를 Pace가 다시
  // 포그라운드로 돌아올 때마다(AppState 'active') 1회성으로 소비 확인한다. 프리미엄이면 네이티브가
  // 애초에 한도 체크를 안 하므로 이 신호가 발생할 일이 없지만, 방어적으로 한 번 더 확인한다.
  const [showCapModal, setShowCapModal] = useState(false);
  const [watchingAd, setWatchingAd] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const checkCap = () => {
      if (!hasSessionStartedRef.current) return;
      if (useSubscriptionStore.getState().isPremium) return;
      autoNextService.consumeAutoNextCapReached().then((reached) => {
        if (reached) setShowCapModal(true);
      }).catch(() => {});
    };
    checkCap();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkCap();
    });
    return () => sub.remove();
  }, []);

  // 2026-07-26 사용자 지시(외부 AI 조언 반영, "저장하고 있다가 다시 노티") — 접근성 권한이 삼성 One UI
  // 배터리 최적화로 세션 도중 조용히 꺼지는 걸 이번 세션 내내 겪었다. 네이티브(PaceOverlayService.
  // performTick)가 "이전엔 켜져 있었는데 지금은 꺼졌다"는 전이를 이미 감지해뒀으면, Pace로 돌아올
  // 때마다(위 두 효과와 동일한 이유로 AppState 'active') 1회성 소비 확인 후 기존 재활성화 안내
  // 알림(notifyAccessibilityNeeded)을 띄운다 — 사용자가 직접 설정에서 상태를 확인해야만 알 수 있던
  // 것을 능동적으로 알려준다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const checkAccessibilityRevoked = () => {
      if (!hasSessionStartedRef.current) return;
      overlayService.consumeAccessibilityRevoked().then((revoked) => {
        if (revoked) notifyAccessibilityNeeded().catch(() => {});
      }).catch(() => {});
    };
    checkAccessibilityRevoked();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAccessibilityRevoked();
    });
    return () => sub.remove();
  }, []);

  const onWatchAdForMore = () => {
    setWatchingAd(true);
    showRewardedAd().then((result) => {
      setWatchingAd(false);
      if (result === 'earned') {
        autoNextService.extendAutoNextCap(20).catch(() => {});
        setShowCapModal(false);
        useToastStore.getState().show(t('overlay.autoNextExtendedToast', { extend: 20 }));
      } else if (result === 'failed') {
        useToastStore.getState().show(t('overlay.autoNextAdFailed'));
      }
      // 'closed_without_reward'(끝까지 안 보고 닫음) — 모달을 유지해 다시 시도할 수 있게 한다.
    });
  };

  // 2026-07-26 사용자 지시("휴식 시간 → 크레딧 적립 → 크레딧으로 이어보기") — Flip Mode(폰 내려놓기)로
  // 모은 크레딧을 광고 대신(또는 광고와 나란히) 써서 Focus Session 한도를 늘린다. 1크레딧 = 영상 1편
  // 연장(적립도 1분=1크레딧으로 단순한 1:1이라 소비도 동일 비율로 맞춤). 전액을 한 번에 쓴다 —
  // 부분 사용 UI(슬라이더 등)까지는 과했다고 판단, "모은 만큼 이어본다"는 단순한 약속이 지금 카피와도
  // 맞음. 2026-07-26 추가 — 매일 출석 보너스(useAttendanceStore.bonusCredits, 매일 리셋 안 되는
  // 별도 지갑)도 같은 자리에서 합산해서 함께 쓴다.
  const restCredits = useFlipStore((s) => s.credits);
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  const totalCredits = restCredits + bonusCredits;
  const onUseCredits = () => {
    const spentRest = useFlipStore.getState().spendCredits(restCredits);
    const spentBonus = useAttendanceStore.getState().spendBonusCredits(bonusCredits);
    const spent = spentRest + spentBonus;
    if (spent <= 0) return;
    autoNextService.extendAutoNextCap(spent).catch(() => {});
    setShowCapModal(false);
    useToastStore.getState().show(t('overlay.autoNextExtendedToast', { extend: spent }));
  };

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
    exitOverlay();
  };

  const video = CURATED_VIDEOS[videoIndex];

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.overlayLayer} edges={['top']}>
        {/* 2026-07-21 밤 사용자 지시(PACE_ARCHITECTURE.md "런치 플로우 단순화") — 콜드 스타트가
            이제 탭 대신 바로 이 화면으로 오므로, Home/Focus/Stats/Settings에 접근할 경로가 이
            화면 자체에 있어야 한다. 오른쪽 위 앱 아이콘 → 탭 네비게이션으로 이동(세션 자체는
            네이티브 오버레이/YouTube에서 계속 진행 중이므로 세션을 끊지 않음). */}
        <Pressable
          onPress={() => router.push('/(tabs)/home')}
          hitSlop={10}
          style={[styles.appIconBtn, { top: insets.top + spacing.sm }]}
          accessibilityRole="button"
          accessibilityLabel={t('overlay.openApp')}
        >
          <Text style={styles.appIconBtnText}>P</Text>
        </Pressable>
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
                useToastStore.getState().show(t('overlay.minutesAdded', { n: amount }));
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

      <Modal visible={showCapModal} transparent animationType="fade" onRequestClose={() => setShowCapModal(false)}>
        <View style={styles.capModalBackdrop}>
          <View style={styles.capModalCard}>
            <Text style={styles.capModalTitle}>{t('overlay.autoNextCapReachedTitle')}</Text>
            <Text style={styles.capModalMessage}>{t('overlay.autoNextCapReachedMessage', { cap: 30 })}</Text>
            <Pressable
              style={[styles.capModalBtn, styles.capModalBtnPrimary, watchingAd && styles.capModalBtnDisabled]}
              onPress={onWatchAdForMore}
              disabled={watchingAd}
            >
              {watchingAd ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={styles.capModalBtnPrimaryText}>{t('overlay.watchAdForMore', { extend: 20 })}</Text>
              )}
            </Pressable>
            {totalCredits > 0 && (
              <Pressable
                style={[styles.capModalBtn, styles.capModalBtnCredits]}
                onPress={onUseCredits}
                disabled={watchingAd}
              >
                <Text style={styles.capModalBtnCreditsText}>{t('overlay.useCreditsForMore', { credits: totalCredits })}</Text>
              </Pressable>
            )}
            <Pressable style={styles.capModalBtn} onPress={() => setShowCapModal(false)} disabled={watchingAd}>
              <Text style={styles.capModalBtnText}>{t('overlay.notNow')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  // paddingTop 40 — appIconBtn(절대 위치, 높이 32 + 위 여백 8)이 차지하는 공간만큼 OverlayBar를
  // 아래로 밀어서 겹치지 않게(둘 다 우측 정렬이라 안 밀면 "P" 아이콘과 "NEXT ON" 칩이 겹쳤음,
  // 2026-07-22 실기기 확인 후 수정). appIconBtn 자신은 absolute라 이 padding 영향 안 받음.
  overlayLayer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: 40 },
  // top은 useSafeAreaInsets()로 인라인 오버라이드됨(position:absolute라 SafeAreaView의 padding이
  // 자식에 적용 안 돼 상태바와 겹치던 버그 수정, 2026-07-22).
  appIconBtn: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 11,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIconBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: typography.bodyFontFamilyExtrabold },
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
  // 2026-07-26 — 무료 Focus Session 자동넘김 한도 도달 시 보상형 광고 유도 모달.
  capModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  capModalCard: { width: '100%', maxWidth: 360, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  capModalTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.bodyFontFamilyBold },
  capModalMessage: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },
  capModalBtn: { borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  capModalBtnPrimary: { backgroundColor: colors.primary },
  capModalBtnDisabled: { opacity: 0.7 },
  capModalBtnPrimaryText: { color: colors.background, fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
  capModalBtnCredits: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' },
  capModalBtnCreditsText: { color: colors.successLight, fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
  capModalBtnText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
});
