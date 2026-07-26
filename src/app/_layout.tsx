import { useEffect, useCallback, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { autoNextService, bluetoothService, overlayService, syncAutoNextBuildFlag } from '../services/platform';
import { getOrphanedSessions, closeOrphanedSession, startSession as startSessionRow } from '../database/repositories/sessionsRepository';
import { getTodayUsageMinutes } from '../database/repositories/statsRepository';
import { useSessionStore } from '../store/useSessionStore';
import { useTimerStore } from '../store/useTimerStore';
import type { ShortFormApp } from '../constants/apps';
import { useFonts } from 'expo-font';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUserStore } from '../store/useUserStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSubscriptionStore } from '../store/useSubscriptionStore';
import { useDailyBonusStore } from '../store/useDailyBonusStore';
import { useAttendanceStore } from '../store/useAttendanceStore';
import { useFlipMode } from '../hooks/useFlipMode';
import { ToastHost } from '../components/ui/ToastHost';
import { DailyCheckInModal } from '../components/ui/DailyCheckInModal';
import { AnimatedSplash } from '../components/ui/AnimatedSplash';
import { checkAndForceUpdate, type ForceUpdatePhase } from '../services/updates';
import { configureAdsForTesting } from '../services/ads/adsConfig';
import { useTranslation } from '../services/i18n';
import { colors, typography } from '../constants/theme';

const queryClient = new QueryClient();

// 2026-07-26 사용자 지시("무료일땐 10분으로 fix") — Focus Session 지속시간은 Settings에서
// [5,10,20,30,60]분 중 고를 수 있었는데, 무료 사용자는 10분으로 고정하고 보상형 광고로만 늘릴 수
// 있게 한다(프리미엄은 기존처럼 자유 선택). isPremium이 false로 바뀔 때마다(로그아웃/구독 만료 등)
// 강제로 되돌려 프리미엄이었을 때 골라둔 값이 그대로 남지 않게 한다.
const FREE_FOCUS_SESSION_DURATION_MINUTES = 10;
// 2026-07-26 사장님 결정(D8, "고급 취침모드") — 무진동 수면감지 임계값도 같은 원칙: 무료는 10분
// 고정, 프리미엄만 Settings에서 5~20분 사이 직접 조절. isPremium이 false로 바뀔 때마다 위
// focusSessionDurationMinutes와 동일한 패턴으로 강제 리셋.
const FREE_SLEEP_STILLNESS_MINUTES = 10;
function enforceFreeFocusSessionDuration(isPremium: boolean) {
  if (isPremium) return;
  const current = useSettingsStore.getState().settings;
  const patch: { focusSessionDurationMinutes?: number; sleepStillnessMinutes?: number } = {};
  if (current.focusSessionDurationMinutes !== FREE_FOCUS_SESSION_DURATION_MINUTES) {
    patch.focusSessionDurationMinutes = FREE_FOCUS_SESSION_DURATION_MINUTES;
  }
  if (current.sleepStillnessMinutes !== FREE_SLEEP_STILLNESS_MINUTES) {
    patch.sleepStillnessMinutes = FREE_SLEEP_STILLNESS_MINUTES;
  }
  if (Object.keys(patch).length === 0) return;
  useSettingsStore.getState().update(patch);
  if (Platform.OS === 'android' && patch.focusSessionDurationMinutes !== undefined) {
    bluetoothService.setFocusSessionDurationMinutes(FREE_FOCUS_SESSION_DURATION_MINUTES).catch(() => {});
  }
}

SplashScreen.preventAutoHideAsync().catch(() => {});
// 실제 광고 단위 ID를 첫 광고 요청 전에 등록된 개발기기에서는 항상 테스트 광고로 받도록 고정
// (adsConfig.ts 참고 — 실수로 실제 광고를 탭해 계정 정지되는 것을 막는 안전장치).
configureAdsForTesting();

// healthy-shorts-assistant(1) 리서치 결과: 프로토타입은 본문 전체에 Inter를 기본 폰트로 깔고
// (Plus Jakarta Sans는 히어로 헤드라인 한두 곳에만, JetBrains Mono는 숫자에만) 있는데, Pace는
// 지금까지 헤드라인/숫자 외 나머지 텍스트가 전부 시스템 기본 폰트(Roboto/San Francisco)로 남아
// 있었다 — 이게 "촌스럽다"는 인상의 핵심 원인. Text.defaultProps로 Inter Regular를 전역
// 기본값으로 깔아 모든 컴포넌트를 일일이 수정하지 않고 한 번에 적용.
// @ts-expect-error defaultProps는 RN 타입에 없지만 공식적으로 지원되는 전역 기본 스타일 패턴
Text.defaultProps = Text.defaultProps || {};
// @ts-expect-error 위와 동일
Text.defaultProps.style = [{ fontFamily: 'Inter_400Regular' }];

export default function RootLayout() {
  const { t } = useTranslation();
  const initUser = useUserStore((s) => s.init);
  const loadSettings = useSettingsStore((s) => s.load);
  const syncSettingsFromServer = useSettingsStore((s) => s.syncFromServer);
  const initSubscription = useSubscriptionStore((s) => s.init);
  const loadDailyBonus = useDailyBonusStore((s) => s.load);

  // 2026-07-26 사용자 지시("매일 출석하기") — 부팅마다 오늘 처음 앱을 연 것인지 확인, 맞으면 크레딧
  // 지급 + 축하 팝업. checkInIfNeeded()가 내부에서 "오늘 이미 출석했으면 no-op"을 보장하므로 여기서
  // 매 부팅마다 불러도 하루 1번만 실제로 지급된다.
  const [checkInEarned, setCheckInEarned] = useState<number | null>(null);
  useEffect(() => {
    useAttendanceStore.getState().checkInIfNeeded().then(({ checkedIn, earned }) => {
      if (checkedIn) setCheckInEarned(earned);
    }).catch(() => {});
  }, []);

  // Flip Mode(스펙 §4-A) — 앱이 떠 있는 동안 전역으로 "내려놓은 시간(쉬는시간)"을 측정한다.
  // iOS(CMMotionManager)/Android(SensorManager) 둘 다 실제 감지, 포그라운드에서만 동작(§4-A 제약).
  useFlipMode({ enabled: true });

  // AdMob 초기화 — 무료 사용자 배너(AdBanner)가 로드되려면 앱 시작 시 mobileAds().initialize()를
  // 1회 호출해야 한다(안 하면 배너가 onAdFailedToLoad로 조용히 사라져 "안 뜨는" 것처럼 보임).
  // AdBanner와 동일한 방어적 require — 네이티브 미링크(재빌드 전)여도 앱이 안 죽게.
  useEffect(() => {
    try {
      const mobileAds = require('react-native-google-mobile-ads').default;
      mobileAds().initialize().catch(() => {});
    } catch (e) {
      if (__DEV__) console.warn('[ads] initialize 스킵(네이티브 미링크):', String(e));
    }
  }, []);

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    // initUser()가 끝나야 토큰 유무(로그인 성공 vs 로컬 전용 게스트 폴백)가 확정되므로, 그 이후에
    // syncFromServer를 불러야 불필요한 401(→자동로그아웃)을 피할 수 있다(services/sync/backendSync
    // 참고 — 토큰 없으면 그 안에서 스스로 스킵하지만, 순서를 지켜 의도를 명확히 한다).
    const settingsReady = (async () => {
      await initUser();
      await loadSettings();
      syncSettingsFromServer().catch(() => {});
    })();
    // 2026-07-26 감사 발견(재부팅/강제종료/크래시 예외처리 감사) — overlay/index.tsx의 세션 종료
    // DB write는 컴포넌트 unmount cleanup에 묶여 있어서, 프로세스가 재부팅·강제종료·크래시로 죽으면
    // 그 정리가 아예 안 돌고 viewing_sessions 행이 ended_at=NULL로 영원히 고아가 된다(시청 시간
    // 유실 + 내보내기에 유령 행 계속 남음). 콜드스타트마다 1회 확인해서 정리 — initUser()가 끝나
    // user.id가 확정된 뒤에만 의미가 있으므로 settingsReady에 이어붙인다. Android는 겸사겸사
    // overlayService.consumeExpired()도 1회 불러 native 쪽 만료 사유(sleep_detected 등)를 실제로
    // "소비"한다 — 안 그러면 다음 세션 시작(PaceOverlayService의 ACTION_START)이 그 사유를 아무도
    // 안 읽은 채 조용히 리셋해버린다(감사 발견 원문 참고).
    settingsReady.then(async () => {
      const userId = useUserStore.getState().user?.id;
      if (!userId) return;
      try {
        const orphans = await getOrphanedSessions(userId);
        if (!orphans.length) return;
        const nativeExpiry = Platform.OS === 'android' ? await overlayService.consumeExpired().catch(() => null) : null;
        const endedAtMs = nativeExpiry?.sleepOnsetAtMs ?? Date.now();
        const endedAtIso = new Date(endedAtMs).toISOString();
        for (const session of orphans) {
          const startedAtMs = new Date(session.startedAt).getTime();
          const durationSeconds = Math.max(0, Math.min(4 * 3600, Math.round((endedAtMs - startedAtMs) / 1000)));
          await closeOrphanedSession(session.id, durationSeconds, endedAtIso);
        }
        // 2026-07-26 사용자 지적("유튜브는 PIP로 계속 도는데 Pace 추적/오버레이는 안 살아남", "화면을
        // 다시 키웠을 때 오버레이를 띄운다던지") — 삼성 배터리 최적화 등으로 프로세스 자체가
        // 죽으면(위 orphan 정리 대상), YouTube 자체는 별개 프로세스라 계속 재생/PIP로 남아있을 수
        // 있는데 Pace 쪽 추적만 끊긴 채 방치됐다. `nativeExpiry`가 null이면(=sleep_detected/
        // daily_limit_reached처럼 정당하게 끝난 게 아니라 그냥 프로세스가 죽어서 끊긴 것) 그리고
        // 고아 세션이 정확히 1개뿐이면(여러 개면 사용자가 이미 오래 떠나있었다는 뜻이라 자동 재개가
        // 오히려 어색함) — 앱을 다시 열자마자(=화면을 다시 키운 순간) 같은 플랫폼으로 추적/오버레이를
        // 즉시 재개한다. 완전히 새 세션으로 시작(남은시간은 오늘 실사용량 기준 새로 계산)하므로 기존
        // "고아 세션 정리" 자체는 그대로 두고 그 위에 이어붙이는 형태.
        if (Platform.OS === 'android' && !nativeExpiry && orphans.length === 1 && overlayService.supportsSystemOverlay) {
          const settings = useSettingsStore.getState().settings;
          const bonusMinutes = useDailyBonusStore.getState().extraMinutes;
          const todayUsedMinutes = await getTodayUsageMinutes(userId);
          const remainingMinutes = Math.max(0, settings.dailyLimitMinutes + bonusMinutes - todayUsedMinutes);
          if (remainingMinutes > 0) {
            const platformApp = orphans[0].platformApp as ShortFormApp | null;
            const newId = await startSessionRow(userId, platformApp);
            useSessionStore.getState().start({ sessionId: newId, platformApp });
            useTimerStore.getState().startSession({
              sessionId: newId,
              remainingMinutes,
              sleepTimerMinutes: settings.sleepTimerMinutes,
              breakIntervalMinutes: settings.breakIntervalMinutes,
            });
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
              sleepStillnessMinutes: settings.sleepStillnessMinutes,
            }).catch(() => {});
          }
        }
      } catch {
        // 정리 실패는 조용히 무시 — 다음 콜드스타트에 다시 시도되고, 앱 사용 자체를 막으면 안 됨.
      }
    });
    const subscriptionReady = initSubscription();
    // 2026-07-26 사용자 지시("무료일땐 Focus Session 10분 고정") — loadSettings()가 먼저 끝나야
    // (그래야 focusSessionDurationMinutes가 저장된 실제 값으로 채워짐) 아래 강제 적용이 방금 로드된
    // 값을 덮어쓰지 않는다 — 둘 다 끝난 뒤에만 실행.
    Promise.all([settingsReady, subscriptionReady]).then(() => {
      const isPremium = useSubscriptionStore.getState().isPremium;
      enforceFreeFocusSessionDuration(isPremium);
    });
    loadDailyBonus();
    // 2026-07-21 밤 감사 발견 — EXPO_PUBLIC_ENABLE_AUTO_NEXT는 JS 전용 플래그라 알약 탭/블루투스
    // 리모컨(네이티브에서 직접 setAutoMode 호출)을 못 막았다. 부팅 시 1회 네이티브에 실제 값을
    // 넘겨 setAutoMode(true) 자체를 게이트한다(services/platform/autoNextService.android.ts 참고).
    syncAutoNextBuildFlag();
  }, [initUser, loadSettings, syncSettingsFromServer, initSubscription, loadDailyBonus]);

  // 실기기(Galaxy Note20, 시스템 라이트 모드)에서 하단 내비게이션 바 영역이 흰색으로 보였던 진짜
  // 원인은 android/styles.xml의 Theme.AppCompat.DayNight가 시스템 라이트/다크를 따라가던 것 —
  // NoActionBar(항상 다크)로 교체하고 windowBackground/navigationBarColor(transparent)를
  // 네이티브 테마에서 직접 고정했다(android/app/src/main/res/values/styles.xml 참고). SDK 57부터
  // Android가 edge-to-edge를 강제해서 expo-navigation-bar의 setBackgroundColorAsync/
  // setButtonStyleAsync가 아예 제거됐다(AGENTS.md 경고대로 API가 바뀜) — 남은 건 아이콘 색만
  // 제어하는 setStyle뿐이라 그것만 사용.
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setStyle('light');
    }
  }, []);

  // 2026-07-26 — isPremium이 바뀔 때마다(구매 완료, 복원, RC CustomerInfo 리스너 갱신, 로그아웃 등)
  // Focus Session 무료 고정시간 강제 적용을 계속 동기화. 부팅 시 1회는 위 initSubscription().then()이 담당.
  useEffect(() => {
    const unsub = useSubscriptionStore.subscribe((state, prevState) => {
      if (state.isPremium !== prevState.isPremium) {
        enforceFreeFocusSessionDuration(state.isPremium);
      }
    });
    return unsub;
  }, []);

  // 2026-07-19: notifyAccessibilityNeeded() 알림 탭 처리 — data.action을 보고 바로 접근성 설정으로
  // 보낸다(services/notifications/index.ts 참고). 앱이 백그라운드/종료 상태에서 탭해도 콜드 스타트 후
  // 이 리스너가 붙으면 마지막으로 탭한 알림의 response를 즉시 재전달해주는 expo-notifications 동작을
  // 그대로 활용 — 별도의 "초기 알림" 처리 코드 불필요.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.action === 'open-accessibility-settings') {
        autoNextService.requestPermission();
      }
    });
    return () => sub.remove();
  }, []);

  // 2026-07-22 사용자 지시 — OTA(무선 업데이트) "강제 푸쉬". 콜드스타트 + 포그라운드 복귀마다
  // 체크(services/updates 참고 — dev 클라이언트/네트워크 실패/다운로드 실패는 전부 조용히 스킵,
  // 절대 사용자를 막지 않는다). 다운로드/재시작 단계에서만 짧게 블로킹 화면을 보여줘 갑자기
  // 화면이 리로드되는 것처럼 보이지 않게 한다(진행 상태 없이 순간 리로드되면 크래시처럼 보임).
  const [updatePhase, setUpdatePhase] = useState<ForceUpdatePhase | null>(null);
  useEffect(() => {
    const runCheck = () => {
      checkAndForceUpdate((phase) => setUpdatePhase(phase))
        .catch(() => {
          // reloadAsync 네이티브 예외 — services/updates 설계상 여기까지 올라온다. 다음 포그라운드
          // 복귀 때 재시도되므로 여기선 조용히 삼킨다(unhandled rejection 방지).
        })
        .finally(() => {
          // 'reloading' 단계에서 성공했으면 곧 앱 자체가 재시작되므로 이 setState는 의미 없어진다 —
          // 실패(스킵/에러)로 끝난 경우에만 블로킹 화면을 원래대로 되돌린다.
          setUpdatePhase(null);
        });
    };
    runCheck();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runCheck();
    });
    return () => sub.remove();
  }, []);

  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // 스플래시: 네이티브 런치스크린은 "로고 없는 단색 #060709"(app.json splash에서 image 제거)로 두고,
  // 브랜딩 로고는 이 AnimatedSplash(JS)가 담당한다 → 앱 실행 시 "첫 아이콘이 잠깐 떴다 사라지는"
  // 네이티브 런치 아이콘 플래시(사장님 지적)가 사라지고, 단색 배경에서 곧바로 애니메이션 스플래시
  // 하나만 자연스럽게 뜬다. (expo-splash-screen은 폰트 로딩 동안 단색 #060709만 유지.)
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* 2026-07-18: 앱이 항상-다크 테마로 고정되면서 상태바도 시스템 설정과 무관하게 항상 밝은
              아이콘("light") 고정 — style="auto"는 OS의 라이트/다크 모드를 따라가는데, 이 앱은 더
              이상 그걸 따르지 않는다. */}
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* 2026-07-26 사용자 지시 — Instagram Stories 제스처 가이드 참고 이미지대로, 별도
                풀스크린이 아니라 앱 위에 반투명 오버레이로 띄운다(quick-control-sheet와 동일한
                transparentModal 패턴, 애니메이션만 슬라이드 대신 페이드). */}
            <Stack.Screen name="onboarding/index" options={{ presentation: 'transparentModal', animation: 'fade' }} />
            <Stack.Screen name="auth/index" />
            <Stack.Screen name="paywall/index" options={{ presentation: 'modal' }} />
            {/* 2026-07-25 — RN Modal의 edge-to-edge 내비게이션 바 투명도 버그(expo/expo#39749) 회피용.
                상세 이유는 quick-control-sheet.tsx 상단 주석 참고. */}
            <Stack.Screen name="quick-control-sheet" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
            {/* iOS Pace Feed(자체 대체 피드 플레이어) — 2026-07-18 iOS 전략 확정. 풀스크린 재생. */}
            <Stack.Screen name="feed/index" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            {/* ⚠️ DEV 전용 WKWebView Shorts POC(원안 ①) — 프로덕션 제출 금지. dev/shorts-poc.tsx의 __DEV__ 가드 참고. */}
            <Stack.Screen name="dev/shorts-poc" options={{ presentation: 'fullScreenModal' }} />
          </Stack>
          <ToastHost />
          <DailyCheckInModal
            visible={checkInEarned !== null}
            earned={checkInEarned ?? 0}
            onDismiss={() => setCheckInEarned(null)}
          />
          {(updatePhase === 'downloading' || updatePhase === 'reloading') && (
            <View style={styles.updateOverlay} pointerEvents="auto">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.updateText}>
                {updatePhase === 'downloading' ? t('home.updateDownloading') : t('home.updateApplying')}
              </Text>
            </View>
          )}
          {showAnimatedSplash && <AnimatedSplash onComplete={() => setShowAnimatedSplash(false)} />}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  updateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  updateText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: typography.bodyFontFamilyBold,
  },
});
