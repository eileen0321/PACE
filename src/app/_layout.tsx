import { useEffect, useCallback, useState, useRef } from 'react';
import { ActivityIndicator, AppState, InteractionManager, Linking, LogBox, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// 개발(LogBox) 전용 소음 억제 — RevenueCat SDK가 시뮬레이터(StoreKit 없음)에서 "issue with your
// configuration" 경고를 반복 출력해 개발 화면을 덮는다(계정삭제 녹화 등에 방해). LogBox는 프로덕션
// 빌드엔 아예 없으므로 이 설정은 실제 앱 동작·심사와 완전히 무관하다(개발 화면만 깔끔해짐).
if (__DEV__) {
  LogBox.ignoreLogs(['[RevenueCat]', 'There is an issue with your configuration', 'Purchases']);
}
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { autoNextService, bluetoothService, overlayService, syncAutoNextBuildFlag } from '../services/platform';
import { getOrphanedSessions, closeOrphanedSession, endSession as endSessionRow, startSession as startSessionRow } from '../database/repositories/sessionsRepository';
import { backfillSleepFromHistory } from '../services/sleepBackfill';
import { getTodayUsageMinutes } from '../database/repositories/statsRepository';
import { useSessionStore } from '../store/useSessionStore';
import { useTimerStore } from '../store/useTimerStore';
import { useFlipStore } from '../store/useFlipStore';
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
import { ErrorBoundary } from '../components/ErrorBoundary';
import { checkAndForceUpdate, getUpdateDiagnostics, getUpdateNativeLog, type ForceUpdatePhase } from '../services/updates';
import { checkVersionGate } from '../services/appVersionGate';
import { configureAdsForTesting } from '../services/ads/adsConfig';
import { prefetchShortsEntryPolicy } from '../services/shortsEntry';
import { ensureAdsConsent } from '../services/ads/adsConsent';
import { useAdsConsentStore } from '../store/useAdsConsentStore';
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
  // 2026-08-01 사용자 지시("포커스 다 쓰면... 누르면 광고 보고 시간주면 되잖아") — 네이티브
  // "FOCUS OFF" 배지가 타임아웃 후 탭됐을 때 광고 없이 바로 재활성화할지(프리미엄) 앱을 열어
  // 보상형 광고 모달로 보낼지(무료) 판단하려면 네이티브가 구독 상태를 알아야 한다. 이 함수가
  // isPremium이 바뀔 때마다(부팅 1회 + 구독 상태 변경마다) 항상 호출되는 유일한 지점이라 여기서
  // 같이 밀어준다 — 아래 얼리 리턴(무료 전용 로직)보다 먼저 실행해야 true 값도 항상 전달된다.
  if (Platform.OS === 'android') bluetoothService.setIsPremium(isPremium).catch(() => {});
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
  // 2026-07-27 감사 발견 — 위 focusSessionDurationMinutes push와 달리 sleepStillnessMinutes는
  // 이 push가 없으면 이미 도는 중인 세션이 다운그레이드 이후에도 계속 프리미엄 시절 임계값(최대
  // 20분)으로 동작했다. setSleepStillnessMinutes는 라이브 값이라 지금 도는 세션에도 즉시 반영됨.
  if (Platform.OS === 'android' && patch.sleepStillnessMinutes !== undefined) {
    bluetoothService.setSleepStillnessMinutes(FREE_SLEEP_STILLNESS_MINUTES).catch(() => {});
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
  // 2026-08-01 사용자 지적("가이드 뜰때는 가이드 다 뜨고 홈에가야 출석 완료가 떠야지") — 이 효과가
  // RootLayout 마운트 즉시(빈 deps) 실행돼서, 최초 실행이라 index.tsx가 /onboarding으로 리다이렉트
  // 하는 것과 완전히 동시에 축하 팝업이 떴다. DailyCheckInModal은 이 파일에서 <Stack> 밖(=항상 최상단)
  // 에 렌더되므로 onboarding 위에 그대로 겹쳐 보였다. pathname이 '/onboarding'인 동안은 체크인 자체를
  // 미루고, 온보딩을 벗어난(=홈 등 실제 화면에 도달한) 최초 시점에만 1회 실행한다 — 온보딩이 필요
  // 없는 기존 사용자는 pathname이 곧장 홈이 되므로 예전과 동일하게 즉시 실행된다(회귀 없음).
  const [checkInEarned, setCheckInEarned] = useState<number | null>(null);
  // 스플래시(브랜딩 로고) 종료 신호 — 출석 팝업을 스플래시 완료+홈 노출 후에만 띄우려 여기서 선언(TDZ 회피).
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);
  const pathname = usePathname();
  const hasCheckedInRef = useRef(false);
  useEffect(() => {
    if (hasCheckedInRef.current) return;
    // 온보딩(가이드)뿐 아니라 앱 콜드스타트 로딩 순간(RootIndex '/' — 리다이렉트 직전)도 스킵해야 한다.
    // 이걸 안 걸면 온보딩이 필요한 신규 사용자에서 '/' 프레임에 출석 팝업이 온보딩보다 먼저 떠버린다.
    // 실제 화면(홈 등 '/home')에 도달한 최초 시점에만 1회 발동 → 가이드 다 본 뒤 홈에서 팝업.
    if (pathname === '/' || pathname === '/onboarding') return;
    // 2026-08-03 사장님 지적("스플래시 완료하고 홈이 다 보일 때 떠야지") — pathname이 '/home'이 되는
    // 순간은 JS 스플래시(AnimatedSplash, ~950ms+FadeOut 400ms)가 아직 화면을 덮고 있는 시점이라, 그때
    // 팝업을 띄우면 스플래시 위로 먼저 떠 보였다. (1) 스플래시가 끝나(showAnimatedSplash=false) 홈이
    // 실제로 드러난 뒤에만 발동하고, (2) InteractionManager.runAfterInteractions로 홈 첫 렌더·스플래시
    // FadeOut 인터랙션이 모두 끝난 다음에 팝업을 띄운다(RN 공식 권장 패턴).
    if (showAnimatedSplash) return;
    hasCheckedInRef.current = true;
    InteractionManager.runAfterInteractions(() => {
      useAttendanceStore.getState().checkInIfNeeded().then(({ checkedIn, earned }) => {
        if (checkedIn) {
          setCheckInEarned(earned);
          useAttendanceStore.getState().setCelebrationVisible(true);
        }
      }).catch(() => {});
    });
  }, [pathname, showAnimatedSplash]);

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

  // 2026-08-03 — EEA/영국 GDPR 동의(UMP). 구글 문서 기준으로 두 가지를 지킨다:
  // (1) 초기화 순서: `mobileAds().initialize()`는 개인정보를 처리하지 않으므로 동의 전에 불러도
  //     정책상 문제없다. 막아야 하는 건 초기화가 아니라 광고의 **로드**다 — 그건 useAdsConsentStore로
  //     게이팅한다(AdBanner/rewardedAd 참고). 그래서 위 초기화는 예전 그대로 즉시 실행한다.
  // (2) 폼을 띄우는 시점: 사장님 지시("앱 가동하고 앱 다 뜨기 전에 하지 말고")대로 스플래시가 끝난
  //     뒤에만 시작한다. 구글의 UX 권고("Activity/View 컨텍스트가 준비된 뒤 시작해야 첫 실행에서
  //     깜빡임 없이 뜬다")와도 일치한다. 부팅 중에 띄우면 스플래시 위로 폼이 겹쳐 보인다.
  // requestInfoUpdate는 매 앱 실행마다 호출하는 것이 구글 권장이다(동의 상태·재동의 필요 여부가
  // 서버에서 바뀔 수 있음) — 이 효과는 스플래시가 끝날 때마다, 즉 콜드 스타트마다 한 번 돈다.
  //
  // 2026-08-04 사장님 지적("출시앱에 광고가 아예 안 뜬다") 조사 중 발견 — 이 효과는 예전에 스플래시
  // 종료 시 **딱 한 번만** 돌았다. ensureAdsConsent()는 절대 throw하지 않는 대신 실패를
  // canRequestAds=false로 돌려주는데(부팅 순간의 일시적 네트워크 실패로 충분히 일어난다), 재시도가
  // 없어서 그 한 번이 실패하면 앱을 완전히 껐다 켜기 전까지 배너가 영영 안 떴다 — 일시적 문제 하나로
  // 그 세션 광고 수익이 0이 된다. AdBanner의 로드 실패 백오프(2026-07-28)와 같은 이유로 여기도 넣는다.
  //
  // 재시도해도 사용자를 귀찮게 하지 않는다: gatherConsent()는 동의 상태가 이미 정해진 사용자에게 폼을
  // 다시 띄우지 않는다(loadAndShowConsentFormIfRequired가 "필요할 때만" 띄운다). 그래서 false가
  // "EEA에서 거부"든 "호출 실패"든 구분 없이 같은 경로로 재시도해도 안전하다.
  //
  // 성공하면 즉시 멈춘다. 포그라운드 복귀는 네트워크가 회복됐을 가능성이 가장 큰 시점이라 백오프와
  // 별개로 한 번 더 트리거한다(위 sleepBackfill/크레딧 reconcile 효과와 동일한 패턴).
  const setAdsConsent = useAdsConsentStore((s) => s.setConsent);
  useEffect(() => {
    if (showAnimatedSplash) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let attempt = 0;
    const MAX_ATTEMPTS = 4; // 5 → 10 → 20 → 40s. 그 뒤로는 포그라운드 복귀에만 기댄다.
    const run = async () => {
      // 이미 성공했으면 다시 부를 이유가 없다. 구글이 권장하는 "매 앱 실행 1회"는 콜드 스타트마다
      // 도는 이 효과 자체가 이미 만족한다.
      if (cancelled || inFlight || useAdsConsentStore.getState().canRequestAds) return;
      inFlight = true;
      const result = await ensureAdsConsent(); // throw 안 함 — 실패 시 canRequestAds=false로 온다
      inFlight = false;
      if (cancelled) return;
      setAdsConsent(result);
      // 2026-08-04 — 쇼츠 위 보상형 광고는 네이티브 액티비티가 띄우는데, 그쪽은 UMP 동의를 스스로
      // 알 방법이 없어 그동안 동의를 무시하고 요청하고 있었다(bluetoothService.android.ts 주석 참고).
      // 동의가 확정되는 이 지점에서 네이티브로 넘겨준다.
      if (Platform.OS === 'android') {
        bluetoothService.setAdsConsent(result.canRequestAds, result.canRequestPersonalizedAds).catch(() => {});
      }
      if (result.canRequestAds || attempt >= MAX_ATTEMPTS) return;
      const delay = 5000 * Math.pow(2, attempt);
      attempt += 1;
      timer = setTimeout(run, delay);
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || useAdsConsentStore.getState().canRequestAds) return;
      attempt = 0; // 네트워크가 회복됐을 수 있으니 백오프를 처음부터 다시
      if (timer) { clearTimeout(timer); timer = null; }
      run();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { sub.remove(); } catch {}
    };
  }, [showAnimatedSplash, setAdsConsent]);

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
        // 2026-08-04 — 여기도 벽시계로 duration을 기록하고 있었다. 사장님 결정("알약 기준이 맞지
        // 않아?")으로 사용 시간의 기준을 실시청으로 통일했는데, 프로세스가 죽어 고아가 된 세션만
        // 예전 기준으로 남으면 같은 통계 안에 두 자가 섞인다 — 하필 "폰을 켜둔 채 방치했다가 프로세스가
        // 죽은" 경우가 벽시계와 실시청의 차이가 가장 크게 벌어지는 상황이라 왜곡도 제일 크다.
        // 네이티브의 watched_seconds는 prefs에 있어 프로세스가 죽어도 남아있고, 이 정리는 콜드스타트에
        // 새 세션이 시작되기 전에 돌므로(settingsReady 직후) 아직 죽은 세션의 값이 그대로 들어있다.
        // ⚠️ 단 그 값은 "가장 최근 세션 하나"의 누적이라, 고아가 여러 개면 어느 것에 귀속되는지 알 수
        // 없다 — 그 경우엔 기존처럼 벽시계로 폴백한다(잘못 귀속시키는 것보다 낫다). iOS도 null → 폴백.
        const orphanWatchedSeconds = orphans.length === 1 && Platform.OS === 'android'
          ? await overlayService.getWatchedSeconds().catch(() => null)
          : null;
        for (const session of orphans) {
          const startedAtMs = new Date(session.startedAt).getTime();
          const wallClockSeconds = Math.max(0, Math.min(4 * 3600, Math.round((endedAtMs - startedAtMs) / 1000)));
          const durationSeconds = orphanWatchedSeconds != null
            ? Math.min(wallClockSeconds, Math.max(0, orphanWatchedSeconds))
            : wallClockSeconds;
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
              bluetoothVolumeKeySkipEnabled: settings.bluetoothVolumeKeySkipEnabled,
            }).catch(() => {});
          }
        }
      } catch {
        // 정리 실패는 조용히 무시 — 다음 콜드스타트에 다시 시도되고, 앱 사용 자체를 막으면 안 됨.
      }
    }).catch(() => {}); // 감사 MED — settingsReady(=initUser) rejection 시 unhandled 방지
    const subscriptionReady = initSubscription();
    // 2026-07-26 사용자 지시("무료일땐 Focus Session 10분 고정") — loadSettings()가 먼저 끝나야
    // (그래야 focusSessionDurationMinutes가 저장된 실제 값으로 채워짐) 아래 강제 적용이 방금 로드된
    // 값을 덮어쓰지 않는다 — 둘 다 끝난 뒤에만 실행.
    Promise.all([settingsReady, subscriptionReady]).then(() => {
      const isPremium = useSubscriptionStore.getState().isPremium;
      enforceFreeFocusSessionDuration(isPremium);
    }).catch(() => {}); // 감사 MED — 체인 rejection 시 unhandled 방지
    loadDailyBonus();
    // 2026-07-21 밤 감사 발견 — EXPO_PUBLIC_ENABLE_AUTO_NEXT는 JS 전용 플래그라 알약 탭/블루투스
    // 리모컨(네이티브에서 직접 setAutoMode 호출)을 못 막았다. 부팅 시 1회 네이티브에 실제 값을
    // 넘겨 setAutoMode(true) 자체를 게이트한다(services/platform/autoNextService.android.ts 참고).
    syncAutoNextBuildFlag();
    // 2026-08-04 사장님 지시("앱 시작하면서 가져왔다 사용자가 누르면 연결") — "Shorts with PACE"
    // 진입 정책을 미리 받아둔다. 탭하는 순간 네트워크를 기다리면 그게 곧 체감 지연이 된다
    // (services/shortsEntry.ts 주석에 근거·검증 상세).
    // ⚠️ Android 전용이다 — 이 정책은 "유튜브 앱을 어떻게 열지"를 정하는 것이고, iOS는 애초에
    // 외부 앱을 열지 않는다(앱 안의 Pace Feed가 IFrame 플레이어로 직접 재생). iOS에서 부르면
    // openShortsFeed()가 어차피 false로 즉시 반환하므로 결과는 같지만, 부팅마다 쓰이지도 않을
    // 네트워크 요청이 한 번씩 나간다 — 게이팅해서 그 낭비를 없앤다.
    // §4-1(2026-08-04) — iOS Pace Feed도 이 정책의 seedPool로 시드(첫 영상)를 뽑으므로 iOS도 프리페치한다
    // (예전엔 iOS 미사용이라 Android 게이팅했었음 — 94a22de). 부팅 때 받아둬 피드 탭 순간엔 캐시만 쓴다.
    prefetchShortsEntryPolicy();
    // 2026-08-03 출시 전 전수 검증에서 발견한 출시 차단 이슈 — 쇼츠 위 FOCUS 연장 보상광고는
    // 네이티브 액티비티(PaceRewardedAdActivity)가 띄우는데, 실광고 유닛/테스트 유닛 선택을 prefs의
    // use_real_ads로 하고 기본값이 false다. 그런데 그 값을 쓰는 코드가 앱 전체에 한 줄도 없어서,
    // 출시 빌드에서도 이 앱의 주 수익 경로가 영원히 구글 테스트 광고만 띄우는 상태였다(수익 0이고,
    // 실사용자에게 테스트 광고를 서빙하는 것 자체가 AdMob 정책 위반이다). 네이티브는 JS 빌드
    // 플래그를 스스로 알 수 없으므로 위 syncAutoNextBuildFlag와 같은 이유로 부팅 시 1회 밀어준다.
    if (Platform.OS === 'android') {
      bluetoothService.setUseRealAds(process.env.EXPO_PUBLIC_USE_REAL_ADS === 'true').catch(() => {});
    }
  }, [initUser, loadSettings, syncSettingsFromServer, initSubscription, loadDailyBonus]);

  // 2026-08-02 사장님 지시("쇼츠 보다 focus off 누르면 광고 볼래 크레딧 쓸래 팝업 뜨고, 광고 보겠다고
  // 하면 광고") — 그 선택 팝업은 쇼츠 위 네이티브 오버레이라 크레딧 잔액을 스스로 모른다(크레딧은 JS
  // 스토어에만 존재). 잔액이 바뀔 때마다 네이티브로 밀어주고, 반대로 네이티브 팝업에서 크레딧으로
  // 연장한 분량은 여기서 1회성으로 회수해 실제 스토어에서 차감한다(잔액의 진실원천은 JS).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const pushCredits = () => {
      const total = useFlipStore.getState().credits + useAttendanceStore.getState().bonusCredits;
      bluetoothService.setAvailableCredits(total).catch(() => {});
    };
    const reconcile = () => {
      bluetoothService.consumePendingCreditSpend().then((spent) => {
        if (spent > 0) {
          // 네이티브가 이미 연장은 해줬으므로 여기선 차감만. 휴식 크레딧 먼저, 모자라면 출석 보너스.
          const fromRest = useFlipStore.getState().spendCredits(Math.min(spent, useFlipStore.getState().credits));
          const remain = spent - fromRest;
          if (remain > 0) useAttendanceStore.getState().spendBonusCredits(remain);
        }
        pushCredits();
      }).catch(() => {});
    };
    reconcile();
    const unsubFlip = useFlipStore.subscribe(pushCredits);
    const unsubAttendance = useAttendanceStore.subscribe(pushCredits);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') reconcile(); });
    return () => { unsubFlip(); unsubAttendance(); sub.remove(); };
  }, []);

  // iOS 백그라운드 수면 감지(방법 B, 2026-07-28 사장님 결정 — 리서치로 백그라운드-오디오 방식이 iOS26
  // 불안정+배터리↑+심사리스크라 전환). CMMotionManager 실시간(useSleepGuard)은 "화면 켜고 조는" 포그라운드만
  // 잡는다 → 실제 수면(전원 끄고 잠)은 앱이 정지돼 0건이었다. 대신 모션 "보조프로세서"가 저압으로 항상
  // 기록하는 활동 이력을, 앱이 포그라운드로 돌아올 때 조회해 "최근 세션 구간에 ≥30분 연속 정지(=잠듦)"가
  // 있으면 그 시작을 잠든 시각으로 보정한다. 배터리 거의 0, 앱이 밤새 죽어도 이력은 남아 아침에 산출된다.
  const sleepBackfillUserId = useUserStore((s) => s.user?.id);
  useEffect(() => {
    if (!sleepBackfillUserId) return;
    const run = () => { backfillSleepFromHistory(useUserStore.getState().user?.id); };
    run();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') run(); });
    return () => { try { sub.remove(); } catch {} };
  }, [sleepBackfillUserId]);

  // 2026-07-27 밤 맥 세션 전수감사 발견(#1 블로커, Windows 인계) — overlay/index.tsx의
  // keepSessionAliveOnUnmountRef가 "화면만 Home으로 바꾸고 세션은 유지"하려고 네이티브 종료 호출을
  // 건너뛰는데, 그 unmount cleanup 안에 있던 DB 세션 종료(endSession) 호출까지 같이 건너뛰게
  // 만들어버렸다. 그 결과 리다이렉트가 걸릴 때마다(=거의 매 세션 시작 직후) 그 세션의 viewing_sessions
  // 행이 duration_seconds=0/ended_at=NULL로 영원히 열린 채 남고, getTodayUsageMinutes()는 이 값을
  // 그대로 합산하므로 실사용 시간이 전혀 반영 안 됐다 — remainingMinutes가 항상 가득 차 있어서
  // Daily Limit이 프로세스가 죽지 않는 한(=정상 사용 내내) 사실상 무력화된 상태였다(직접 실기기로
  // 재현 확인: Stats "이번주 시청"이 세션 진행 중 계속 그대로였음, 오버레이 알약 카운트다운은
  // 정상이었는데도). 위 콜드스타트 전용 orphan 정리(overlays consumeExpired 1회)와 별개로,
  // 포그라운드로 돌아올 때마다 "네이티브가 진짜로 세션을 끝냈다"는 신호를 확인해서 그 순간 열려있는
  // 세션 행을 정확한 사유/경과시간으로 닫는다. nativeExpiry가 null이면(=아직 진짜로 안 끝남) 절대
  // 손대지 않는다 — 콜드스타트 블록과 달리 여기선 "프로세스가 죽었을 가능성"을 가정하지 않으므로,
  // 아직 유효하게 진행 중인 세션을 여기서 성급하게 닫으면 안 된다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const closeSessionOnNativeExpiry = async () => {
      const userId = useUserStore.getState().user?.id;
      if (!userId) return;
      try {
        const nativeExpiry = await overlayService.consumeExpired().catch(() => null);
        if (!nativeExpiry) return; // 아직 진짜로 안 끝남 — 콜드스타트 정리 블록이 따로 처리할 몫
        const openSessions = await getOrphanedSessions(userId); // "고아"가 아니라 그냥 ended_at IS NULL 조회
        if (!openSessions.length) return;
        const endedAtMs = nativeExpiry.sleepOnsetAtMs ?? Date.now();
        const endedAtIso = new Date(endedAtMs).toISOString();
        // 2026-08-04 — 네이티브 만료(수면감지/한도도달)로 닫는 이 경로도 벽시계를 쓰고 있었다.
        // 사용 시간 기준을 실시청으로 통일했으므로(위 고아 정리 경로와 동일한 이유) 여기도 맞춘다.
        // 이 시점엔 네이티브가 세션을 막 끝낸 직후라 watched_seconds가 그 세션의 값 그대로다.
        // 열린 세션이 여러 개면 어느 것에 귀속되는지 알 수 없어 벽시계로 폴백한다.
        const expiredWatchedSeconds = openSessions.length === 1
          ? await overlayService.getWatchedSeconds().catch(() => null)
          : null;
        for (const session of openSessions) {
          const startedAtMs = new Date(session.startedAt).getTime();
          // 감사 MEDIUM3(2026-07-27) — 콜드스타트 정리 경로(위)와 동일하게 4h 상한을 둔다. 예전엔 이
          // 전경 경로만 clamp가 없어, sleepOnsetAtMs 없이 reason만 온 경우 endedAtMs=now라 오래 열려있던
          // 세션이 통짜 wall-clock으로 기록돼 통계/일일한도를 오염시킬 수 있었다.
          const wallClockSeconds = Math.max(0, Math.min(4 * 3600, Math.round((endedAtMs - startedAtMs) / 1000)));
          const durationSeconds = expiredWatchedSeconds != null
            ? Math.min(wallClockSeconds, Math.max(0, expiredWatchedSeconds))
            : wallClockSeconds;
          await endSessionRow(session.id, durationSeconds, session.videosWatched ?? 0, nativeExpiry.reason, nativeExpiry.sleepOnsetAtMs ? endedAtIso : undefined);
        }
        useSessionStore.getState().finish();
      } catch {
        // 실패해도 다음 포그라운드 복귀에 재시도 — 앱 사용 자체를 막지 않음.
      }
    };
    closeSessionOnNativeExpiry();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') closeSessionOnNativeExpiry();
    });
    return () => sub.remove();
  }, []);

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
        // 2026-08-01 크래시 감사 F2 — New Arch/bridgeless에선 미처리 네이티브 reject가 하드 크래시로
        // 이어질 수 있다. sync throw와 async reject 둘 다 방어(권한 요청 실패는 무해하게 무시).
        try {
          const p = autoNextService.requestPermission() as Promise<unknown> | void;
          if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
        } catch { /* 무해 */ }
      }
    });
    return () => sub.remove();
  }, []);

  // 2026-07-22 사용자 지시 — OTA(무선 업데이트) "강제 푸쉬". 콜드스타트 + 포그라운드 복귀마다
  // 체크(services/updates 참고 — dev 클라이언트/네트워크 실패/다운로드 실패는 전부 조용히 스킵,
  // 절대 사용자를 막지 않는다). 다운로드/재시작 단계에서만 짧게 블로킹 화면을 보여줘 갑자기
  // 화면이 리로드되는 것처럼 보이지 않게 한다(진행 상태 없이 순간 리로드되면 크래시처럼 보임).
  const [updatePhase, setUpdatePhase] = useState<ForceUpdatePhase | null>(null);

  // 2026-08-08 사장님 지시 — 스토어 강제 업데이트 게이트.
  // OTA는 JS만 고치고, 우리 runtimeVersion 정책이 appVersion이라 **같은 앱 버전 바이너리에만** 도달한다.
  // 즉 낡은 바이너리(예: 1.0.0)에 머문 사용자는 네이티브 수정도, 그 버전용 OTA도 영영 못 받는다.
  // 그 사용자를 스토어로 올려보내는 유일한 경로다. 판정은 전부 서버(api/app-config.ts)가 하고,
  // 실패하면 무조건 통과시킨다(services/appVersionGate.ts의 fail-open 원칙).
  const [versionGate, setVersionGate] = useState<{ storeUrl: string } | null>(null);
  const loggedGateReasonRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      checkVersionGate()
        .then((r) => {
          if (cancelled) return;
          setVersionGate(r.blocked ? { storeUrl: r.storeUrl } : null);
          if (r.blocked) {
            console.warn(`[versionGate] blocked build=${r.currentBuild} min=${r.minBuild} version=${r.currentVersion}`);
          } else if (!loggedGateReasonRef.current) {
            // 2026-08-08 — **부팅당 1회만** 판정 사유를 남긴다. 이게 없으면 "차단 안 됨"이
            // 서버가 통과시킨 것(ok)인지, 서버에 못 닿아 통과한 것(fetch-failed)인지 구분할 수 없어
            // "게이트가 켜져 있는데 아무도 안 막힌다"를 영영 진단하지 못한다(실제로 이번에 주소를
            // 잘못 넣어 항상 fetch-failed로 통과하던 상태를 이 구분으로 잡았다).
            // 포그라운드 복귀마다 찍으면 소음이라 첫 판정에만 남긴다.
            loggedGateReasonRef.current = true;
            console.warn(`[versionGate] pass reason=${r.reason}`);
          }
        })
        .catch(() => {}); // checkVersionGate는 throw하지 않지만 방어적으로 한 겹 더
    };
    run();
    // 사용자가 스토어에서 업데이트하고 돌아오면 다시 검사해 차단을 스스로 풀어준다
    // (안 그러면 업데이트를 마치고도 앱을 껐다 켜야 한다).
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') run(); });
    return () => { cancelled = true; sub.remove(); };
  }, []);
  useEffect(() => {
    // 2026-08-06 — 지금 돌고 있는 번들의 신원을 부팅 때 한 줄 남긴다. "OTA를 쐈는데 왜 안 와?"는
    // 이 값들(채널/런타임버전/현재 업데이트ID/내장번들 여부)이 없으면 추측만 하게 된다 — 오늘 광고
    // 문제를 로그 없이 조사하느라 헤맸던 것과 같은 교훈. `__DEV__` 게이트를 일부러 안 건다:
    // 정작 필요한 순간이 출시빌드다(AdBanner 실패 로그와 동일한 판단).
    const d = getUpdateDiagnostics();
    console.warn(
      `[updates] enabled=${d.isEnabled} embedded=${d.isEmbeddedLaunch} channel=${d.channel} ` +
        `runtimeVersion=${d.runtimeVersion} updateId=${d.updateId}`
    );
    const runCheck = () => {
      checkAndForceUpdate((phase) => setUpdatePhase(phase))
        .then((result) => {
          // 결과도 남긴다 — 특히 check-failed/download-failed는 사용자에게 아무 표시가 안 나가므로
          // (의도된 설계: 업데이트 실패로 앱을 막지 않는다) 로그가 유일한 단서다.
          if (result.status === 'check-failed' || result.status === 'download-failed' || result.status === 'reload-failed') {
            console.warn(`[updates] ${result.status}:`, String((result.error as Error)?.message ?? result.error));
            // 2026-08-06 — 실패했을 때만 네이티브 로그를 함께 남긴다. 서명 실패/런타임버전 불일치
            // 같은 진짜 원인은 JS로 안 올라오고 expo-updates 네이티브 로그에만 남는다.
            // 성공 경로에선 부르지 않는다(불필요한 네이티브 왕복 + 로그 소음).
            getUpdateNativeLog()
              .then((lines) => { if (lines.length) console.warn('[updates] native log:', lines.slice(-8).join(' | ')); })
              .catch(() => {});
          } else if (result.status === 'reloading') {
            console.warn(`[updates] reloading (rollback=${result.rollback})`);
          }
        })
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

  // ⚠️ 네이티브 스플래시 숨김은 여기(루트 레이아웃)가 아니라 AnimatedSplash의 onLayoutReady에서 한다 —
  // 루트 레이아웃 시점엔 AnimatedSplash가 아직 안 그려져 있어 여기서 숨기면 갭(번쩍/끊김)이 생겼다.
  // 폴백: AnimatedSplash가 어떤 이유로든 안 뜨는 경우(showAnimatedSplash=false)엔 여기서 숨긴다.
  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded && !showAnimatedSplash) SplashScreen.hideAsync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsLoaded]);

  // 스플래시: 네이티브 런치스크린은 "로고 없는 단색 #060709"(app.json splash에서 image 제거)로 두고,
  // 브랜딩 로고는 이 AnimatedSplash(JS)가 담당한다 → 앱 실행 시 "첫 아이콘이 잠깐 떴다 사라지는"
  // 네이티브 런치 아이콘 플래시(사장님 지적)가 사라지고, 단색 배경에서 곧바로 애니메이션 스플래시
  // 하나만 자연스럽게 뜬다. (expo-splash-screen은 폰트 로딩 동안 단색 #060709만 유지.)
  // (showAnimatedSplash 상태는 위 출석 팝업 게이팅 때문에 상단으로 이동해 선언됨.)

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#060709' }} onLayout={onLayoutRootView}>
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
            {/* ⚠️ DEV 전용 WKWebView Shorts POC(원안 ①) — 프로덕션 제출 금지. 화면 자체는 __DEV__ 스텁이지만
                라우트 등록도 릴리즈에선 아예 빼서 pace://dev/shorts-poc 도달 자체를 막는다(감사 M1, 2026-07-27). */}
            {__DEV__ && <Stack.Screen name="dev/shorts-poc" options={{ presentation: 'fullScreenModal' }} />}
          </Stack>
          <ToastHost />
          {/* 2026-08-08 사장님 지시 — "업데이트가 필요해요 전에 출석 보상이 뜨면 어떻게 해.
              업데이트가 필요한 경우 업데이트 후 출석 보상이 나와야 하고".
              강제 업데이트 안내가 떠 있는 동안에는 출석 축하 팝업을 띄우지 않는다. checkInEarned
              상태는 그대로 유지되므로, 사용자가 스토어에서 업데이트하고 돌아와 게이트가 풀리면
              (AppState 'active' 재검사) 그때 자연스럽게 이 팝업이 뜬다 — 보상을 잃지 않는다. */}
          <DailyCheckInModal
            visible={checkInEarned !== null && !versionGate}
            earned={checkInEarned ?? 0}
            onDismiss={() => {
              setCheckInEarned(null);
              useAttendanceStore.getState().setCelebrationVisible(false);
            }}
          />
          {(updatePhase === 'downloading' || updatePhase === 'reloading') && (
            <View style={styles.updateOverlay} pointerEvents="auto">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.updateText}>
                {updatePhase === 'downloading' ? t('home.updateDownloading') : t('home.updateApplying')}
              </Text>
            </View>
          )}
          {/* 강제 업데이트 안내 — 2026-08-08 사장님 지시로 **전체화면에서 홈 위 모달로 변경**
              ("왜 전창이야 앱 홈에서 띄워서 누르면 이동해야지"). 배경을 반투명 딤으로 두어 홈이
              그대로 보이고, 카드만 떠서 "이게 무슨 앱인지" 맥락이 유지된다.
              닫기 버튼이 없는 것은 그대로 의도다(그게 "강제"의 정의) — 딤 영역도 터치를 먹어
              뒤로 빠져나갈 수 없다.
              ⚠️ 스플래시(zIndex 더 위)보다 아래라 부팅 첫 프레임에 번쩍이지 않는다. */}
          {versionGate && (
            <View style={styles.forceUpdateBackdrop} pointerEvents="auto">
              <View style={styles.forceUpdateCard}>
                <Text style={styles.forceUpdateTitle}>{t('home.forceUpdateTitle')}</Text>
                <Text style={styles.forceUpdateBody}>{t('home.forceUpdateBody')}</Text>
                <Pressable
                  style={styles.forceUpdateButton}
                  onPress={() => {
                    // 2026-08-08 실기기에서 확인 — https://play.google.com/... 로 열면 스토어 앱이
                    // "항목을 찾을 수 없습니다"를 띄우는 경우가 있다(비공개 테스트 트랙처럼 그 계정에
                    // 목록이 안 보이는 상태). 네이티브 스킴(market://, itms-apps://)은 스토어 앱을
                    // 곧바로 열어 이 문제를 덜 겪으므로 **먼저 시도하고, 실패하면 웹 URL로 폴백**한다.
                    // 어느 쪽도 못 열면 조용히 넘어간다 — 여기서 throw하면 모달이 먹통처럼 보인다.
                    const web = versionGate.storeUrl;
                    const native = Platform.OS === 'android'
                      ? web.replace('https://play.google.com/store/apps/', 'market://')
                      : web.replace('https://apps.apple.com/', 'itms-apps://apps.apple.com/');
                    Linking.openURL(native).catch(() => {
                      Linking.openURL(web).catch(() => {});
                    });
                  }}
                >
                  <Text style={styles.forceUpdateButtonText}>{t('home.forceUpdateButton')}</Text>
                </Pressable>
              </View>
            </View>
          )}
          {showAnimatedSplash && (
            <AnimatedSplash
              onComplete={() => setShowAnimatedSplash(false)}
              // 네이티브 런치스크린은 이 JS 스플래시가 실제로 그려진 뒤에 숨긴다(갭/번쩍 방지).
              onLayoutReady={() => SplashScreen.hideAsync().catch(() => {})}
            />
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
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
  // 강제 업데이트 안내 — updateOverlay(zIndex 200)보다 위. OTA 적용 중 화면과 겹칠 일은 거의
  // 없지만, 겹치면 "업데이트하러 가라"는 쪽이 보여야 사용자가 할 일이 명확해진다.
  // 전체화면이 아니라 **딤 + 카드**다(2026-08-08 지시) — 뒤로 홈이 보여야 맥락이 유지된다.
  forceUpdateBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 300,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  forceUpdateCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    gap: 12,
  },
  forceUpdateTitle: {
    fontFamily: typography.displayFontFamilyBold,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  forceUpdateBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  forceUpdateButton: {
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  forceUpdateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  updateText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: typography.bodyFontFamilyBold,
  },
});
