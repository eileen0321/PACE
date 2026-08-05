import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { OverlayBar } from '../../components/overlays/OverlayBar'; // Metro가 .android.tsx/.ios.tsx를 자동 선택
import { OverlayExpandedCard } from '../../components/overlays/shared/OverlayExpandedCard';
import { PlatformMimicOverlay } from '../../components/overlays/PlatformMimicOverlay';
import { PaceMenu } from '../../components/overlays/PaceMenu';
import { SavedVideoListOverlay } from '../../components/overlays/SavedVideoListOverlay';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useUserStore } from '../../store/useUserStore';
import { useAutoNextStore } from '../../store/useAutoNextStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useToastStore } from '../../store/useToastStore';
import { overlayService, autoNextService, bluetoothService } from '../../services/platform';
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
// 2026-08-02 — 홈 카드 탭이 발급한 autostart 토큰 중 "이미 소비한" 마지막 값. 컴포넌트 밖(모듈
// 스코프)에 둬야 이 화면이 다시 마운트돼도 값이 유지돼 재소비를 막을 수 있다. ref/state로는 안 된다
// (마운트마다 초기화되므로 정확히 막아야 할 재마운트 경로에서 무력해짐).
let lastConsumedAutostart: string | null = null;

export default function OverlaySessionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // autostart: 홈에서 "Shorts with PACE" 카드를 탭해 들어온 경로에만, 매 탭마다 새 토큰으로 붙는다
  // (home.tsx 참고). 이 화면은 아직 소비하지 않은 새 토큰이 있을 때만 세션을 시작하고 대상 앱을
  // 실행한다 — "앱으로" 복귀 등으로 같은 라우트가 재마운트될 때는 토큰이 이미 소비된 값이라
  // 아무 것도 하지 않는다(고정값 '1'로는 파라미터가 그대로 남아 재사용돼 막지 못했다, 실기기 확인).
  const { platform, autostart } = useLocalSearchParams<{ platform?: AppShieldTarget; autostart?: string }>();
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
  // 2026-07-31 사장님 지시 — 오버레이 "P" 아이콘을 누르면 곧장 앱으로 가는 대신, [앱으로/Shorts HOT/
  // Saved/Favorite] 4개 메뉴가 뜬다. Shorts HOT은 백엔드 인프라가 별도 작업(PACE_PROJECT_MANAGEMENT.md
  // 2026-07-31 참고)이라 이번 커밋에선 메뉴 항목만 자리를 잡아두고 토스트로 안내한다 — 가짜 빈 목록을
  // 보여주는 것보다 정직하게 "아직 준비 중"이 낫다는 기존 원칙(가짜 데이터 금지)을 그대로 따른다.
  const [showPaceMenu, setShowPaceMenu] = useState(false);
  const [activeSavedList, setActiveSavedList] = useState<'capture' | 'favorite' | null>(null);
  // 2026-07-26 사용자 지적("화면 작아지고 나면 앱화면이 까만색으로 보임") — 아래 useFocusEffect가
  // Home으로 router.replace하기 전까지 이 화면의 DEV SIMULATOR 검은 배경이 한두 프레임 그대로
  // 커밋돼 보인다(리다이렉트는 화면전환 애니메이션 뒤에야 완료됨). 리다이렉트가 걸리는 순간
  // 이 값을 true로 올려 아래 렌더가 즉시 아무것도 안 그리게(null) 해서 그 검은 프레임 자체를 없앤다.
  const [redirectingToHome, setRedirectingToHome] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  // 2026-07-26 감사 발견 — 기본값이 'manual_stop'이면, Activity가 백그라운드 sleep-detect 직후
  // Recents에서 스와이프돼 destroy될 때(=consumeExpired 효과가 AppState 'active' 전이를 한 번도
  //못 받고 unmount) 실제로는 sleep_detected/daily_limit_reached였는데도 항상 manual_stop으로
  // 잘못 기록됐다. null로 시작해 "아직 아무 종료 판정도 없었다"를 구분하고, unmount cleanup에서
  // 이 값이 null이면 네이티브에 마지막으로 한 번 더 물어본 뒤에만 manual_stop으로 폴백한다.
  const endReasonRef = useRef<SessionEndStatus | null>(null);
  // 2026-07-26 — sleep_detected일 때만 채워짐(네이티브가 무진동 임계값을 "넘긴" 시각이 아니라
  // 실제 "마지막으로 움직인" 시각, epoch ms) — 아래 cleanup에서 세션 ended_at을 정확히 기록하는 데 씀.
  const sleepOnsetAtMsRef = useRef<number | null>(null);
  const sessionStartedAtMsRef = useRef<number | null>(null);
  const hasAutoEndedRef = useRef(false);
  // remainingMinutes/isSessionActive 둘 다 스토어 초기값이 0/false라, 아래 useEffect가 "세션이 실제로
  // 시작됐는지"를 isSessionActive만으로 구분할 수 없다(0 도달로 자동종료된 순간에도 동일값이 됨).
  // 이 ref로 "startSession()이 실제로 호출됐는지"를 별도로 추적한다.
  const hasSessionStartedRef = useRef(false);
  // 2026-07-26 감사 발견(치명적 회귀) — 아래 "black screen 리다이렉트"가 이 화면을 router.replace로
  // 나가면서 컴포넌트를 언마운트시키는데, 그 언마운트 cleanup이 무조건 overlayService.endSession()
  // (네이티브 ACTION_STOP — 알약/틱 알람/추적 전부 종료)을 불렀다 — 즉 "화면만 Home으로 바꾸고
  // 세션은 그대로 두려던" 원래 의도와 정반대로, 리다이렉트할 때마다 진짜 세션을 죽이고 있었다
  // (실기기 재현: 오버레이 알약이 사라지고 dumpsys alarm에 PaceTickReceiver reason=alarm_cancelled가
  // 남음). 이 ref가 true면 cleanup이 "진짜 종료"가 아니라 "그냥 화면 전환"임을 알고 네이티브
  // 종료/DB 세션-종료 기록을 스킵한다.
  const keepSessionAliveOnUnmountRef = useRef(false);

  // 2026-07-22 실기기 검증 중 발견 — 세션이 콜드 스타트로 곧장 이 화면부터 시작된 경우(탭 화면을
  // 거치지 않아 네비게이션 히스토리가 비어있음) router.back()이 "GO_BACK 처리 안 됨" 개발자 경고를
  // 내며 아무 데도 이동하지 못했다. 뒤로 갈 화면이 있으면 back, 없으면 Home으로 교체 이동.
  const exitOverlay = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  // 2026-07-26 사용자 지적("유튜브 창 닫으면 pace앱이 계속 까만화면만 보여주고 개판") — 이 화면
  // 아래쪽의 "underlying content"(DEV SIMULATOR)는 위 33번째 줄 주석대로 프로덕션엔 존재하면 안 되는
  // 개발용 목업일 뿐인데, 세션 시작 후 YouTube로 전환했다가(launchPlatformApp) 뒤로가기/최근앱으로
  // 이 화면으로 돌아오면(=Pace 액티비티가 다시 포그라운드) 실사용자 눈엔 텅 빈 검은 화면처럼 보였다.
  // Android는 이미 실제 네이티브 시스템 오버레이(알약)가 세션 중 항상 떠 있어 이 화면이 굳이 다시
  // 보일 필요가 없으므로, 포커스를 다시 받을 때마다(=사용자가 이 화면으로 돌아올 때마다) 곧바로
  // Home으로 리다이렉트한다 — 세션/오버레이 자체는 그대로 유지되고 화면 전환만 일어남. iOS는 이
  // 화면이 실제 시뮬레이터 콘텐츠 역할을 계속 해야 하므로(Live Activity가 오버레이를 대신하지만
  // 화면 자체는 Pace Feed 진입 전 상태를 보여줌) 건드리지 않는다.
  useFocusEffect(
    useCallback(() => {
      // 2026-08-02 사장님 지적("이런 거 안 띄우기로 했잖아", "지금 또 나오잖아" — 검은 DEV SIMULATOR
      // 목업 화면이 계속 노출됨) — hasSessionStartedRef 조건을 제거한다. 이 조건 때문에 "이 화면에
      // 처음 진입한 그 순간"에는 리다이렉트가 안 걸렸다(선언 순서상 이 useFocusEffect가 세션 시작
      // 이펙트보다 먼저 실행돼 그 시점엔 항상 false). 그래서 카드 탭 → 유튜브로 나갔다가 "앱으로"로
      // 복귀할 때처럼 이 화면이 뒤늦게 마운트되는 경로에서는 목업이 그대로 사용자에게 보였다.
      // Android에서는 네이티브 시스템 오버레이(알약)가 세션 표시를 전담하므로 이 화면이 보일 이유가
      // 애초에 없다 — 조건 없이 항상 Home으로 보낸다. 세션 시작 이펙트는 네비게이션과 무관하게
      // 계속 실행되고, keepSessionAliveOnUnmountRef=true라 언마운트 cleanup이 세션을 죽이지 않는다.
      if (Platform.OS === 'android' && overlayService.supportsSystemOverlay) {
        keepSessionAliveOnUnmountRef.current = true;
        setRedirectingToHome(true);
        router.replace('/(tabs)/home');
      }
    }, [router])
  );

  // 2026-07-26 밤 사용자 실기기 재현("작은 화면 갔다가 상단 알림 눌러 앱으로 복귀하니 까만
  // DEV SIMULATOR 화면") — 위 useFocusEffect는 Expo Router의 JS 네비게이션 스택 포커스 변화에만
  // 반응한다. YouTube로 나갔다가(launchPlatformApp) 알림/최근앱으로 Pace 액티비티만 다시
  // 포그라운드로 가져오는 경우는 JS 라우트 자체가 한 번도 안 바뀌었으므로(이 화면이 스택 최상단에
  // 계속 있었음) useFocusEffect가 재발동하지 않는다 — 그래서 리다이렉트가 안 걸리고 DEV SIMULATOR
  // 콘텐츠(iOS용 목업, 어두운 배경)가 그대로 보였다. consumeIfExpired/checkAccessibilityRevoked와
  // 동일한 AppState 'active' 패턴으로 액티비티 자체의 포그라운드 복귀를 추가로 감지한다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const redirectIfNeeded = () => {
      if (overlayService.supportsSystemOverlay && hasSessionStartedRef.current && !keepSessionAliveOnUnmountRef.current) {
        keepSessionAliveOnUnmountRef.current = true;
        setRedirectingToHome(true);
        router.replace('/(tabs)/home');
      }
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') redirectIfNeeded();
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (!user?.id) return;
    // 2026-08-01 사용자 재현("P메뉴 앱으로 눌렀는데 쇼츠로 자동복귀") — 이 이펙트는 원래 "이
    // 화면에 처음 진입할 때 딱 한 번" 세션을 시작한다고 가정하고 무조건 startSession(새 DB row)+
    // launchPlatformApp(YouTube 재실행)까지 실행했는데, 실제로는 아무 멱등 가드가 없었다. 세션이
    // 이미 useSessionStore에 'running'으로 떠 있는 상태에서(=진짜 세션이 계속 도는 중) 이 화면이
    // 무슨 이유로든(딥링크 재진입, 네비게이션 레이스 등) 다시 마운트되면 매번 새 DB 세션 row를
    // 만들고 launchPlatformApp으로 YouTube를 다시 열어버렸다 — "앱으로"를 눌러도 곧장 쇼츠로
    // 되돌아가 보이는 증상과 정확히 일치. 이미 실행 중이면 아무 것도 다시 하지 않는다.
    // 2026-08-02 — 상태 가드(status === 'running')만으로는 계속 샜다. 실기기 추적 로그로 확정한
    // 실제 시퀀스: 마운트 시엔 세션이 running이라 그 가드에서 곧장 return하는데, 이때 autostart
    // 토큰을 "소비하지 않은 채" 빠져나간다 → 나중에 "앱으로"로 Pace에 복귀해 이 화면이 다시
    // 마운트될 때 그 미소비 토큰이 그대로 살아 있어 통과 → 새 세션 + launchPlatformApp(유튜브
    // 재실행)이 돌아 쇼츠로 튕겼다(로그: 카드 탭 13초 뒤 overlay.effect -> launchPlatformApp).
    // 따라서 토큰 소비를 무조건 최우선으로 한다 — 한 번의 카드 탭은 최대 한 번만 세션을 시작할 수
    // 있고, 어떤 경로로 재마운트되든 두 번째부터는 반드시 막힌다.
    const token = autostart ?? null;
    const alreadyConsumed = token === null || token === lastConsumedAutostart;
    if (token !== null) lastConsumedAutostart = token;
    // 2026-08-02 실기기 발견("이런 거 안 띄우기로 했잖아" — 검은 DEV SIMULATOR 목업 화면에 갇힘) —
    // 아래 두 조기 return이 hasSessionStartedRef만 세우고 끝나서, 이 화면이 그대로 남아 개발용
    // 목업(CURATED_VIDEOS 더미 콘텐츠)이 사용자에게 보였다. 위쪽 useFocusEffect의 Home 리다이렉트는
    // 이 화면이 포커스를 "받는 순간"에만 돌고 그때는 아직 이 ref가 false라 안 걸린다(선언 순서상
    // useFocusEffect가 이 이펙트보다 먼저 실행됨). 세션을 시작하지 않고 빠져나가는 경로에서는
    // 그 자리에서 직접 Home으로 보낸다 — 세션/네이티브 오버레이는 그대로 두고 화면만 전환
    // (keepSessionAliveOnUnmountRef=true라 언마운트 cleanup이 세션을 죽이지 않는다).
    const bailToHome = () => {
      hasSessionStartedRef.current = true;
      if (Platform.OS === 'android' && overlayService.supportsSystemOverlay) {
        keepSessionAliveOnUnmountRef.current = true;
        setRedirectingToHome(true);
        router.replace('/(tabs)/home');
      }
    };
    if (alreadyConsumed) {
      bailToHome();
      return;
    }
    if (useSessionStore.getState().status === 'running') {
      bailToHome();
      return;
    }
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
        sleepStillnessMinutes: settings.sleepStillnessMinutes,
        bluetoothVolumeKeySkipEnabled: settings.bluetoothVolumeKeySkipEnabled,
      }).catch(() => {});
      // 2026-08-02 실기기 추적 로그로 근본원인 확정 — 여기 있던 launchPlatformApp(대상 앱 재실행)을
      // 제거한다. 타임라인이 전부를 말해줬다:
      //   11:01:37  home.startSession -> launchPlatformApp   (카드 탭, 유튜브 열림)
      //   11:01:50  home.push /overlay                        (13초 뒤!)
      //   11:01:50  overlay.effect -> launchPlatformApp       (유튜브 또 열림 → 쇼츠로 튕김)
      // 카드를 탭하면 ConnectingOverlay 애니메이션이 시작되는데 곧바로 유튜브가 전면으로 나가면서
      // 그 애니메이션이 멈춘다. 그러다 "앱으로"로 Pace에 복귀하는 순간 재개·완료되며 그제서야
      // /overlay로 라우팅되고, 이 이펙트가 유튜브를 다시 열어 사용자를 쇼츠로 되돌려보냈다 —
      // "앱으로 눌렀는데 쇼츠로 감"의 실제 정체(오늘 여러 번 재현). 앱 실행은 home.startSession이
      // 탭 시점에 이미 했으므로(그래야 백그라운드 액티비티 시작 제한에 안 걸림) 여기서의 실행은
      // 언제나 중복이다. 세션 시작(DB row/네이티브/타이머)은 그대로 두고 재실행만 없앤다.
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
      // 🔴 2026-08-06 사장님 지적("쇼츠를 안 보고 있는데도 시간이 흐르는 거야?") — 안드로이드는
      //   네이티브에서 "지금 감시 대상 앱 창이 보이는가"로 게이팅하는데(PaceAccessibilityService.
      //   isLikelyPlaying), iOS는 이 JS 틱이 유일한 카운트다운이면서 **아무 조건도 안 봤다.**
      //   앱이 활성이 아니면(다른 앱으로 나감/화면 잠금) 보고 있지 않은 것이 확실하므로 차감하지
      //   않는다. 이때 시계도 함께 리셋해야 한다 — 안 그러면 그 구간이 복귀 첫 틱에 몰려서 깎인다.
      //   ⚠️ iOS 한정으로만 건다. 안드로이드는 이 JS 값이 화면 표시용이고 실제 카운트다운은
      //     네이티브가 담당하므로(아래 `Platform.OS === 'android'` 조기 반환) 여기서 또 게이팅하면
      //     네이티브와 표시가 어긋난다.
      if (Platform.OS !== 'android' && AppState.currentState !== 'active') {
        useTimerStore.getState().resetTickClock();
        return;
      }
      const before = useTimerStore.getState(); // tick 전 스냅샷 — 종료 사유 판정용(아래 참고)
      useTimerStore.getState().tickMinute();
      if (Platform.OS === 'android') return;
      const fresh = useTimerStore.getState();

      // 2026-08-06 — 경과시간 기준으로 바뀌면서 한 틱에 2분 이상 지나갈 수 있게 됐다. `=== 5`처럼
      // 정확한 값만 보면 그 값을 건너뛸 때 알림이 영영 안 뜬다 → 경계 통과 판정으로 바꾼다
      // (네이티브 performTick의 저시간 알림과 동일한 수정).
      if ((before.remainingMinutes > 5 && fresh.remainingMinutes <= 5) ||
          (before.remainingMinutes > 1 && fresh.remainingMinutes <= 1)) {
        notifyLowTime(fresh.remainingMinutes).catch(() => {});
      }

      if (fresh.nextBreakInMinutes != null && fresh.nextBreakInMinutes <= 0 && settings.breakIntervalMinutes > 0) {
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
      // 2026-07-26 감사 발견(치명적 회귀, 위 keepSessionAliveOnUnmountRef 선언부 참고) — 위
      // useFocusEffect가 "그냥 화면만 Home으로 바꾸는" 리다이렉트를 걸어둔 상태면, 아래 세션-종료
      // 로직(DB 기록/네이티브 ACTION_STOP)을 전부 건너뛴다 — 실제로는 세션이 안 끝났으므로.
      if (keepSessionAliveOnUnmountRef.current) return;
      if (sessionIdRef.current && user.id) {
        const sessionId = sessionIdRef.current;
        const userId = user.id;
        const startedAtMs = sessionStartedAtMsRef.current;
        (async () => {
          // 2026-07-26 감사 발견 — endReasonRef가 아직 null이면(tick 기반 daily-limit/sleep-timer
          // 판정도, AppState 'active' 기반 consumeExpired 효과도 한 번도 못 돈 채 unmount) 네이티브에
          // 마지막으로 한 번 더 물어본다 — Activity가 sleep-detect 직후 Recents에서 스와이프돼
          // destroy될 때처럼, 실제로는 sleep_detected/daily_limit_reached인데 아무 판정도 못 받고
          // 여기 도달하는 경우를 잡기 위해서다. 그래도 null이면(진짜 수동 종료) manual_stop.
          if (endReasonRef.current == null && Platform.OS === 'android') {
            const result = await overlayService.consumeExpired().catch(() => null);
            if (result) {
              endReasonRef.current = result.reason;
              sleepOnsetAtMsRef.current = result.sleepOnsetAtMs;
            }
          }
          // 2026-08-02 사장님 지시("원인 구분 못 하는 곳 전수 확인") — 여기 폴백이 'manual_stop'이라
          // "사용자가 정말 직접 껐다"와 "끝내 사유를 알아내지 못했다"가 통계상 같은 값으로 섞였다.
          // 위 네이티브 재조회까지 실패한 경우는 진짜로 원인을 모르는 것이므로 'unknown'으로 남긴다 —
          // 진짜 수동 종료는 stopSession()에서 명시적으로 'manual_stop'을 세우므로 여기 안 온다.
          const endReason = endReasonRef.current ?? 'unknown';
          // 2026-07-26 사용자 지적("1시 3분에 잠들었으면 실제 마지막으로 움직인 시각을 써야지") —
          // sleep_detected면 네이티브가 무진동 임계값을 "넘긴" 시각(now) 대신 실제 마지막 움직임 시각
          // (sleepOnsetAtMsRef, PaceOverlayService.markExpired 참고)을 세션 종료 시각으로 쓴다 —
          // 그래야 duration도, 홈 화면 수면 인사이트 배너도 실제 잠든 시각에 가깝다.
          const effectiveEndedAtMs = endReason === 'sleep_detected' && sleepOnsetAtMsRef.current != null
            ? sleepOnsetAtMsRef.current
            : Date.now();
          // 2026-08-03 사장님 결정("알약 기준이 맞지 않아?") — 예전엔 여기서 벽시계(종료-시작)만 썼다.
          // 그런데 알약의 남은 시간은 실제 재생 중일 때만 깎이므로(performTick의 isLikelyPlaying 가드),
          // 세션만 켜두고 안 보면 알약은 그대로인데 통계엔 그 시간이 통째로 쌓이는 모순이 있었다.
          // 사용자가 이해하는 "사용 시간"은 실제로 본 시간이므로 네이티브가 누적한 실시청 시간을 쓴다.
          // iOS는 서드파티 앱 재생 상태를 관찰할 수단이 OS에 없어 null → 기존 벽시계로 폴백한다.
          // ⚠️ getWatchedSeconds()는 endSession()(네이티브 stop)보다 먼저 읽어야 한다 — 아래
          //    videosWatched와 같은 이유(세션이 닫히면 값이 리셋된다).
          const wallClockSeconds = startedAtMs ? Math.max(0, Math.round((effectiveEndedAtMs - startedAtMs) / 1000)) : 0;
          // 2026-08-06 — iOS 통계 일관성. 위 주석대로 예전엔 iOS가 항상 벽시계로 기록했는데, 이제
          // JS 틱이 "앱이 활성일 때만" 깎으므로 벽시계로 기록하면 **알약은 안 깎였는데 통계에는
          // 쌓이는** 모순이 iOS에서 그대로 재현된다(안드로이드가 2026-08-03에 없앤 바로 그 모순).
          // useTimerStore가 실제로 차감한 만큼만 누적해둔 값을 쓴다 — 알약과 정확히 같은 기준.
          // ⚠️ 이 줄은 반드시 첫 await 앞에서 동기로 읽어야 한다. 아래 timer.endSession()이 이
          //   IIFE의 await 사이에 끼어들어 스토어를 리셋하기 때문이다(같은 이유로 네이티브 값도
          //   endSession 전에 읽는다 — 아래 주석 참고).
          const jsWatchedSeconds = useTimerStore.getState().watchedSeconds;
          const watchedSeconds = await overlayService.getWatchedSeconds().catch(() => null);
          // 벽시계를 상한으로 둔다 — 네이티브 누적값이 어떤 이유로든(복구 경로 중복 가산 등) 실제
          // 경과 시간을 넘어서는 건 정의상 불가능하므로, 넘으면 신뢰하지 않고 벽시계로 자른다.
          const effectiveWatchedSeconds = watchedSeconds != null ? watchedSeconds : jsWatchedSeconds;
          const durationSeconds = Math.min(wallClockSeconds, Math.max(0, effectiveWatchedSeconds));
          // 2026-07-26 — PaceAccessibilityService가 실제 재생위치 신호(끝남/되감김 감지)로 센 진짜
          // 시청 편수를 읽는다(자동넘김이든 사용자가 직접 넘겼든 다 포함). iOS/접근성 꺼짐은 항상 0 —
          // 예전엔 개발용 시뮬레이터의 videoIndex를 가짜로 흘려보내다 고쳐서 정직하게 0을 기록했는데
          // (아래 원래 있던 주석 참고), 이제는 Android에서 진짜 값을 셀 수 있게 됐다. endSession()
          // (네이티브 stop → 카운터 리셋) 호출 전에 먼저 읽어야 한다.
          const videosWatched = await overlayService.getVideoWatchCount().catch(() => 0);
          await endSessionRow(sessionId, durationSeconds, videosWatched, endReason, new Date(effectiveEndedAtMs).toISOString());
          await pushUnsyncedSessions(userId);
          logOverlayEvent(userId, sessionId, 'SESSION_STOP', endReason).catch(() => {});
        })().catch(() => {});
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
      overlayService.consumeExpired().then((result) => {
        if (!result || hasAutoEndedRef.current) return;
        hasAutoEndedRef.current = true;
        endReasonRef.current = result.reason;
        sleepOnsetAtMsRef.current = result.sleepOnsetAtMs;
        useTimerStore.setState(
          result.reason === 'sleep_timer_expired' ? { sleepTimerRemainingMinutes: 0 } : { remainingMinutes: 0 }
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

  if (redirectingToHome) return null;

  // 2026-08-03 사장님 지시("목업 화면 안 나오게 되어 있는 거 맞아? / 필요없는 화면 아냐") —
  // 이 파일 33번째 줄 주석이 "아래 underlying content는 실제 프로덕션에 존재하면 안 되는 개발용
  // 시뮬레이터"라고 명시하는데, 정작 __DEV__ 가드가 어디에도 없어 릴리즈 빌드에도 그대로 들어갔다.
  // 지금까지는 "화면이 뜨면 곧바로 Home으로 리다이렉트"하는 타이밍 경쟁으로만 막고 있었고(위
  // useFocusEffect / AppState / bailToHome 세 경로), 리다이렉트가 한 프레임이라도 늦으면 검은
  // DEV SIMULATOR가 사용자에게 그대로 보였다 — 오늘만 그 조건을 세 번 고쳤지만 전부 타이밍을
  // 앞당기는 방식이라 경쟁 자체는 남아 있었다. Android는 네이티브 시스템 오버레이(알약)가 세션
  // 표시를 전담하므로 이 화면이 보일 이유가 애초에 없다 — 그리지 않는 것으로 경쟁을 원천 제거한다.
  // ⚠️ 훅은 모두 위에서 이미 호출됐고(이 return은 마지막 훅보다 아래) 세션 시작 이펙트도 그대로
  // 실행되므로, 렌더만 건너뛸 뿐 세션/오버레이/타이머 동작에는 영향이 없다.
  // iOS는 이 화면이 실제 콘텐츠 역할을 계속 하므로 건드리지 않는다.
  // 2026-08-03 — 같은 가드가 두 벌 들어가 있었다(다른 세션과 이 수정이 동시에 같은 결론에 도달).
  // 위 return이 먼저 걸리므로 아래쪽은 도달 불가능한 죽은 코드였다. 하나만 남긴다.
  if (Platform.OS === 'android' && overlayService.supportsSystemOverlay) return null;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.overlayLayer} edges={['top']}>
        {/* 2026-07-21 밤 사용자 지시(PACE_ARCHITECTURE.md "런치 플로우 단순화") — 콜드 스타트가
            이제 탭 대신 바로 이 화면으로 오므로, Home/Focus/Stats/Settings에 접근할 경로가 이
            화면 자체에 있어야 한다. 오른쪽 위 앱 아이콘 → 탭 네비게이션으로 이동(세션 자체는
            네이티브 오버레이/YouTube에서 계속 진행 중이므로 세션을 끊지 않음). */}
        <Pressable
          onPress={() => setShowPaceMenu((v) => !v)}
          hitSlop={10}
          style={[styles.appIconBtn, { top: insets.top + spacing.sm }]}
          accessibilityRole="button"
          accessibilityLabel={t('overlay.openApp')}
        >
          <Text style={styles.appIconBtnText}>P</Text>
        </Pressable>
        {showPaceMenu && (
          <PaceMenu
            top={insets.top + spacing.sm + 40}
            onClose={() => setShowPaceMenu(false)}
            onSelect={(action) => {
              setShowPaceMenu(false);
              if (action === 'app') router.push('/(tabs)/home');
              else if (action === 'capture') setActiveSavedList('capture');
              else if (action === 'favorite') setActiveSavedList('favorite');
              else if (action === 'hot') useToastStore.getState().show(t('overlay.hotComingSoon'));
            }}
          />
        )}
        {activeSavedList && user?.id && (
          <SavedVideoListOverlay
            userId={user.id}
            kind={activeSavedList}
            onClose={() => setActiveSavedList(null)}
          />
        )}
        <OverlayBar
          remainingMinutes={timer.remainingMinutes}
          autoNextEnabled={settings.autoNext}
          onToggleAutoNext={() => updateSettings({ autoNext: !settings.autoNext })}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
        {!expanded && (timer.remainingMinutes === 5 || timer.remainingMinutes === 1) && (
          <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOutUp.duration(160)} style={styles.lowTimeToast}>
            <Feather name="clock" size={14} color="#000000" />
            <Text style={styles.lowTimeToastText}>
              {timer.remainingMinutes === 1 ? t('overlay.lowTimeWarningSingular', { n: 1 }) : t('overlay.lowTimeWarningPlural', { n: timer.remainingMinutes })}
            </Text>
          </Animated.View>
        )}
        {expanded && (
          <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOutUp.duration(160)} style={styles.expandedWrap}>
            <OverlayExpandedCard
              todayUsedMinutes={effectiveDailyLimitMinutes - timer.remainingMinutes}
              dailyLimitMinutes={effectiveDailyLimitMinutes}
              remainingMinutes={timer.remainingMinutes}
              autoNextEnabled={settings.autoNext}
              onToggleAutoNext={() => updateSettings({ autoNext: !settings.autoNext })}
              sleepTimerMinutes={settings.sleepTimerMinutes}
              onCycleSleepTimer={() => {
                const idx = SLEEP_TIMER_OPTIONS.indexOf(settings.sleepTimerMinutes ?? 0);
                const nextTimer = SLEEP_TIMER_OPTIONS[(idx + 1) % SLEEP_TIMER_OPTIONS.length] || null;
                updateSettings({ sleepTimerMinutes: nextTimer });
                if (Platform.OS === 'android') {
                  bluetoothService.setSleepTimerMinutes(nextTimer ?? 0).catch(() => {});
                }
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
          </Animated.View>
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
});
