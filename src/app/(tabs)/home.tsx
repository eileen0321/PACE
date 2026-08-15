import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, InteractionManager, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUserStore } from '../../store/useUserStore';
import { teardownSession } from '../../services/sessionTeardown';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useShortsQueueStore } from '../../store/useShortsQueueStore';
import { useShortsHotStore } from '../../store/useShortsHotStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAttendanceStore } from '../../store/useAttendanceStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { getTodaysInsightMessage } from '../../services/usageInsight';
import { useToastStore } from '../../store/useToastStore';
import { backfillSleepFromHistory } from '../../services/sleepBackfill';
import { useFlipStore } from '../../store/useFlipStore';
import { AppHeader } from '../../components/ui/AppHeader';
import { SessionHeroCard } from '../../components/home/SessionHeroCard';
import { PlatformPickerCard } from '../../components/home/PlatformPickerCard';
import { QuickControlsGrid } from '../../components/home/QuickControlsGrid';
// 🔴 2026-08-15 — 날짜 문자열은 반드시 이걸로 만든다. toISOString()은 **UTC 날짜**라 한국(UTC+9)에서는
// 매일 KST 09:00에 하루가 넘어가 버린다. 같은 실수로 출석 보상이 하루 두 번 지급됐다(utils/date.ts 주석).
import { toLocalDateStr } from '../../utils/date';
import { BluetoothOnboardingSheet } from '../../components/home/BluetoothOnboardingSheet';
import { ConnectingOverlay } from '../../components/home/ConnectingOverlay';
import { FocusSessionExtendModal } from '../../components/home/FocusSessionExtendModal';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { bluetoothService, capabilities, overlayService } from '../../services/platform';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { useTranslation } from '../../services/i18n';
import { launchPlatformApp, resumePlatformApp } from '../../constants/supportedApps';
import { colors, radius, spacing, typography } from '../../constants/theme';
import type { AppShieldTarget } from '../../types/models';
import type { ShortFormApp } from '../../constants/apps';

const YOUTUBE_COVER = require('../../../assets/covers/youtube.jpg');
// 🔴 2026-08-11 사장님 지시("유튜브처럼 틱톡을 홈에 카드 추가") — 커버 이미지는 이미 저장소에
// 있었다(assets/covers/tiktok.jpg). 타입(ShortFormApp), 앱 패키지/스킴(supportedApps.ts),
// 안드 감시 목록(SupportedApps.PACKAGES에 글로벌 com.zhiliaoapp.musically + 한국 리전
// com.ss.android.ugc.trill 둘 다), 흉내 오버레이(PlatformMimicOverlay)까지 전부 이미 있다 —
// 즉 카드만 없었다.
import { LOOPS_COVER_DATA_URI } from '../../constants/loopsCover';
const TIKTOK_COVER = { uri: LOOPS_COVER_DATA_URI };
// 2026-08-03 — 홈 인사이트 배너를 다시 뽑기까지 필요한 최소 백그라운드 체류 시간. 이 값보다 짧게
// 다녀오면(보상광고 시청, P메뉴 "앱으로" 등) 문구를 그대로 두어 복귀 화면이 전혀 안 움직인다.
// 아래 AppState 효과의 주석 참고 — 왜 "안 바꾸는 것"이 유일한 해법인지 실측 근거가 적혀 있다.
const INSIGHT_REDRAW_MIN_AWAY_MS = 5 * 60 * 1000;

// healthy-shorts-assistant(2) App.tsx의 Home 탭(다크 리스킨)을 토씨 하나 안 틀리고 그대로 이식
// (App.tsx:280-399, 사용자 명시적 지시). 3개 플랫폼 카드는 세로 풀와이드 스택(App.tsx:342
// space-y-3), "CHOOSE PLATFORM" 헤더 옆 "TAP TO START" 배지 포함. 원본의
// UsageHero/StartShortsButton/StatsGrid는 이 화면에서 완전히 대체됐다. 플랫폼 카드 탭 →
// /overlay로 실제 세션 시작 + platform 파라미터 전달(오버레이 화면이 Android에서 실제 앱 실행까지
// 담당, overlay/index.tsx 참고).
// 2026-07-18: 이 화면 전체를 t()로 통째로 번역했다가 한국어 문자열이 영어보다 길어서 고정폭
// 카드/그리드를 넘치는 오버플로우가 실제로 발생한 적이 있다 — "Today Session"/"Complete"/큰 숫자/
// 인사말까지 한 번에 다 번역한 게 원인이었다(SessionHeroCard/PlatformPickerCard/QuickControlsGrid/
// AppHeader 내부). 2026-07-22 사용자 지적 — 그렇다고 전체를 영문 고정해버리는 건 앱의 기존 원칙
// (브랜드명/짧은 기능명은 영문 유지, 나머지는 자연스러운 한국어 — translations.ts 상단 참고)과
// 안 맞다. 이번엔 좁게: 이 파일 자체의 섹션 헤더 3개(Choose Platform/Tap to Start/Quick Controls)
// 만 t()로 번역 — 오버플로우를 실제로 냈던 하위 컴포넌트들(SessionHeroCard 등)과 상태문구
// (Active/Available — Settings 탭의 같은 성격 문구도 한국어에서 영문 유지하는 기존 관례를 따름)는
// 이번에도 그대로 둔다.
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const adBannerHeight = useAdBannerStore((s) => s.height);
  const tabBarHeight = useAdBannerStore((s) => s.tabBarHeight);
  const settings = useSettingsStore((s) => s.settings);
  // 2026-08-01 성능 감사 — whole-store 구독은 스토어의 어떤 필드가 바뀌어도 Home(및 하위 카드들)을
  // 리렌더한다(예: stats.refresh가 isLoading/weeklyStats를 매 포커스마다 갱신). 필요한 필드만 좁게 구독.
  const todayUsageMinutes = useStatsStore((s) => s.todayUsageMinutes);
  const refresh = useStatsStore((s) => s.refresh);
  const restSeconds = useFlipStore((s) => s.putDownSeconds); // 오늘 쉬는시간(내려놓은 시간) — 히어로 카드에 표시
  const activeSessionPlatform = useSessionStore((s) => (s.status === 'running' ? s.platformApp : null));
  // 2026-07-31 — 세션이 daily-limit로 끝나면 useSessionStore.finish()가 platformApp을 null로 지워서,
  // LimitReachedOverlay의 "+5분 더" 연장 시 "어느 플랫폼으로 다시 들어갈지" 알 방법이 없었다.
  // running인 동안 마지막 값을 계속 기억해뒀다가 연장 시 그 플랫폼으로 재진입시킨다.
  const lastPlatformRef = useRef<ShortFormApp | null>(null);
  useEffect(() => {
    if (activeSessionPlatform) lastPlatformRef.current = activeSessionPlatform;
  }, [activeSessionPlatform]);
  const isBluetoothConnected = useBluetoothStore((s) => s.isConnected);
  const refreshBluetooth = useBluetoothStore((s) => s.refresh);
  const toggleAutoMode = useBluetoothStore((s) => s.toggleAutoMode);
  const enableAutoModeForSession = useBluetoothStore((s) => s.enableAutoModeForSession);
  const bonusMinutes = useDailyBonusStore((s) => s.extraMinutes);
  const addBonusMinutes = useDailyBonusStore((s) => s.addMinutes);
  const celebrationVisible = useAttendanceStore((s) => s.celebrationVisible);
  // 2026-07-29 사장님 지시 — "몇시에 잠들었어요" 고정 배너를 "매일 하나의 랜덤 인사이트(사용 습관/
  // 신조어/힐링 문구/명언)" 선물상자로 확장. 뜨는 조건도 수면 감지와 무관하게 하루 1회로 바뀌었으므로
  // useSleepInsightStore(수면 감지 전용)는 더 이상 이 배너에 쓰지 않는다. 노티(maybeShowUsageInsight)와
  // 같은 "오늘의 뽑기"를 공유(usageInsight.ts의 날짜 캐시) — 세션당이 아니라 캘린더 날짜 기준이라
  // 앱을 여러 번 재시작해도 같은 날엔 같은 문구, 노티와 배너가 서로 다른 문구를 보여주지 않는다.
  const [todaysInsight, setTodaysInsight] = useState<string | null>(null);
  // 2026-08-07 — 선물상자(인사이트 배너) 보상이 터졌을 때 보여줄 값. 기존엔 토스트(몇 초 뒤 자동
  // 소멸)로만 알렸는데, 사용자가 놓치면 다시 확인할 방법이 없었다("바로 사라져서 클릭도 확인도 못
  // 함") — 출석 보상(DailyCheckInModal)과 동일하게 사용자가 직접 닫아야 사라지는 모달로 바꾼다.
  const [insightGiftEarned, setInsightGiftEarned] = useState<number | null>(null);
  // 🔴 2026-08-15 — 오늘 배너에 선물이 걸려 있는가. true면 배너에 🎁가 붙고 자동으로 안 사라진다.
  const [giftAvailable, setGiftAvailable] = useState(false);
  // 하루 단위 당첨 확률. 예전 "탭할 때마다 30%"를 날짜 단위로 옮긴 값 — 기대 빈도는 비슷하되
  // 상자가 보이는 날은 반드시 당첨이라 "열었는데 꽝"이 없다.
  const GIFT_DAY_CHANCE = 0.3;
  const [pendingPlatform, setPendingPlatform] = useState<AppShieldTarget | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<AppShieldTarget | null>(null);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);
  // 2026-08-01 실기기 사고 대응 — 접근성 서비스가 재빌드/재설치 등으로 꺼지면 세션 추적/오버레이가
  // 통째로 멈추는데, SharedPrefs의 session_active는 그대로 true라 앱 UI만 봐선 정상처럼 보이고
  // 에러도 없어 사용자가 스스로 알아챌 방법이 없었다(PACE_PROJECT_MANAGEMENT.md 참고). 배터리
  // 배너와 달리 "평생 1회만" 안내하면 안 된다 — 이건 기능이 통째로 죽는 하드 블로커라 꺼져 있는 한
  // 계속 다시 보여야 한다(AsyncStorage seen-flag 없이 매 확인마다 실제 상태를 그대로 반영).
  const [showAccessibilityPrompt, setShowAccessibilityPrompt] = useState(false);
  const [showFocusSessionExtend, setShowFocusSessionExtend] = useState(false);
  // 2026-08-02 사장님 지시("한도 차면 뜨는 팝업만 지워") — 하루 한도 도달 팝업(LimitReachedOverlay)
  // 과 그에 딸린 광고/크레딧 연장 모달은 제거됐다. 하루 한도는 이제 차단/팝업 없이 추적·표시만 하고,
  // 유일한 연장 게이트는 Focus Session 타임아웃(showFocusSessionExtend, 광고 5분)뿐이다.
  //
  // 2026-08-05 (B안 정리) — 그때 렌더만 지우고 남아 있던 잔해를 여기서 걷어냈다: 이 화면은
  // hitCount/dismissedHitCount를 구독하고 currentHitThreshold를 계산해 ensureLimitHitAtLeast()까지
  // 부르고 있었는데, 그 값을 **읽는 곳이 한 군데도 없었다**(유일한 소비처가 LimitReachedOverlay였다).
  // 한도 도달 횟수는 이제 안드로이드 네이티브(daily_limit_hit_count)가 세고, 화면에는 비차단 토스트로
  // 나간다(PaceOverlayService.showLimitNoticeToast / iOS는 feed/index.tsx). useLimitHitStore 자체는
  // 데이터 초기화(settings.tsx resetToday)가 참조하므로 남겨둔다.

  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;

  // ⚡ 쇼츠 큐를 홈 진입 시 미리 받아둔다(사용자가 홈 보는 동안 Vercel 콜드스타트+스크래핑이 끝남)
  // → 피드 열면 "쇼츠 불러오는 중" 5초 대기 없이 즉시 첫 영상. loadInitial은 큐가 이미 있으면 no-op이라
  // 피드의 중복 호출과 안전하게 공존. iOS 전용 기능이라 iOS에서만.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    // 2026-08-01 사장님 지적("가이드→홈 전환 버벅임") — 프리페치(네트워크+state 갱신)를 홈 마운트 즉시
    // 실행하면 온보딩→홈 fade 트랜지션과 겹쳐 버벅인다. InteractionManager로 트랜지션/애니메이션이 끝난
    // 뒤로 미룬다(프리페치는 "나중에 피드/Shorts HOT 열 때"용이라 몇백ms 지연돼도 무방). loadInitial은
    // 큐 있으면 no-op이라 피드 중복호출과 안전 공존. 'all'만 선프리페치, 나머지는 탭 선택 시 캐시.
    const task = InteractionManager.runAfterInteractions(() => {
      useShortsQueueStore.getState().loadInitial().catch(() => {});
      useShortsHotStore.getState().prefetch();
    });
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-07-26 사용자 지시(Focus Session/연속 시청 통합 결정) — 무료 Focus Session이 시간(10분) 만료로
  // 자동 종료됐을 때(사용자가 직접 끈 게 아니라) 광고/크레딧 연장 모달을 띄운다. YouTube가 전면에
  // 있는 동안 Home의 JS는 백그라운드 throttle로 죽어있을 수 있어, 네이티브가 이미 판단해둔 "시간
  // 만료" 신호를 Pace가 다시 포그라운드로 돌아올 때마다(AppState 'active') 1회성으로 소비 확인한다
  // (overlay/index.tsx의 consumeExpired/consumeAccessibilityRevoked와 동일 패턴). 프리미엄은 free
  // duration 고정 자체가 적용 안 되므로(enforceFreeFocusSessionDuration) 이 신호가 발생할 일이 없지만
  // 방어적으로 한 번 더 확인한다.
  // 2026-08-02 사장님 지시("앱으로 가는 시나리오 만들지 말고", "정리 좀 해") — Focus Session 연장은
  // 이제 쇼츠 위 네이티브 선택 팝업(광고/크레딧, PaceOverlayService.showExtendChoiceOverlay) 하나로
  // 일원화됐다. 여기 있던 "앱이 포그라운드로 오면 타임아웃 신호를 소비해 RN 모달을 띄우는" 경로를
  // 제거한다 — 남겨두면 사용자가 팝업에서 "나중에"를 고른 뒤 나중에 앱을 직접 열었을 때 난데없이
  // 앱 안에서 광고 모달이 뜬다(없애라고 한 바로 그 시나리오). 신호 자체는 네이티브가 들고 있다가
  // 배지를 다시 탭할 때 그 자리에서 팝업으로 쓴다.
  // ※ showFocusSessionExtend 상태와 아래 FocusSessionExtendModal 렌더는 iOS(피드 내 연장)에서
  //   계속 쓰이므로 남겨둔다 — 이 Android 전용 자동 트리거만 없앤 것.

  // 2026-08-02 사장님 지시("FOCUS OFF일 때 원인 구분을 못 한다 — 이런 게 또 있는지 전수 확인해") —
  // 감사 결과 오버레이 권한(SYSTEM_ALERT_WINDOW)에는 접근성과 달리 회수 감지가 아예 없었다. 세션
  // 도중 권한이 꺼지면 알약만 조용히 사라지고 세션/타이머/한도 집행은 계속 돌아서, 사용자는 "또
  // 오버레이가 사라졌다"만 볼 뿐 원인(권한 회수/서비스 사망/대상 앱이 전경 아님)을 구분할 수 없었다.
  // 네이티브(checkOverlayPermissionRevoked)가 매 틱마다 전이를 잡아 1회성 신호를 세워두면, 여기서
  // 앱이 다시 포그라운드로 올 때 소비해 사용자에게 알린다 — 바로 위 접근성 확인과 동일한 패턴.
  // ※ overlay/index.tsx가 아니라 여기인 이유: Android는 그 화면이 마운트되자마자 Home으로
  //   리다이렉트되므로(그 파일의 useFocusEffect) 거기 붙이면 실제로 실행될 기회가 없다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const checkOverlayRevoked = () => {
      overlayService.consumeOverlayRevoked().then((revoked) => {
        if (revoked) {
          useToastStore.getState().show(t('home.overlayPermissionRevoked'));
          return;
        }
        // 권한 회수가 아닌데도 알약이 안 보이는 나머지 원인 중 "서비스 사망"을 구분한다 —
        // 세션은 running인데 네이티브 서비스 프로세스가 죽어 있으면 타이머/한도 집행이 멈춘
        // 상태다(실기기에서 틱이 11분간 멈추고 남은 시간이 얼어붙은 것을 관측). 사용자가
        // "왜 시간이 안 줄지?"를 원인 모른 채 겪지 않도록 그 사실을 알린다.
        if (useSessionStore.getState().status !== 'running') return;
        overlayService.isOverlayServiceAlive().then((alive) => {
          if (!alive) useToastStore.getState().show(t('home.overlayServiceDead'));
        }).catch(() => {});
      }).catch(() => {});
    };
    checkOverlayRevoked();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkOverlayRevoked();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-08-01 실기기 사고 대응 — 접근성 꺼짐은 시스템 설정에서 언제든 조용히 일어날 수 있으므로
  // (재설치/재빌드뿐 아니라 OEM 배터리 관리·OS 업데이트로도 회수될 수 있음) Home 탭 포커스마다는
  // 물론(useFocusEffect, 아래) 앱이 다시 foreground로 돌아올 때도 재확인한다 — 설정 화면 다녀온
  // 뒤 뒤로가기로 복귀하는 경우 포함(focus.tsx의 동일 패턴 참고).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const checkAccessibility = () => {
      overlayService.hasAccessibilityPermission().then((granted) => {
        setShowAccessibilityPrompt(!granted);
      }).catch(() => {});
    };
    checkAccessibility();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAccessibility();
    });
    return () => sub.remove();
  }, []);

  // 2026-08-01 사용자 지적("앱 나갔다 다시 들어왔는데 무한 스크롤 같은 문구야") — useFocusEffect는
  // react-navigation의 화면 포커스(탭 전환)에만 반응한다. 홈 탭에 계속 머문 채로 홈 버튼 등으로
  // 앱만 백그라운드로 보냈다가 다시 열면 화면 포커스 자체는 안 바뀌므로 재추첨이 안 됐다. 앱이
  // 다시 active로 돌아올 때도 별도로 재추첨한다.
  // 2026-08-03 사장님 실기기 지적("P → 앱으로 누르면 앱 홈이 한 번 더 로딩된다") — 원인이 이 효과였다.
  // 12초 녹화를 10fps로 뜯어 확인: 홈이 '이전' 문구로 먼저 그려지고(약 0.2초) 곧바로 새 문구로
  // 교체되는데, 배너 줄 수가 바뀌면서(2줄↔3줄) 아래 SESSION STATUS/카드들이 통째로 밀린다. 화면
  // 진입 애니메이션과 겹쳐 "홈이 두 번 로딩된 것"처럼 보였다. 액티비티는 하나뿐이고(ActivityRecord
  // 1개로 확인) 재마운트도 아니다 — 순전히 이 재추첨 때문이다.
  //
  // '나갈 때 미리 뽑기'로도 안 없어진다(실측 확인). 안드로이드는 복귀 시 앱이 나갈 때 떠 있던 화면
  // 스냅샷을 먼저 띄우고 그 위에 새 렌더를 얹는데, 문구를 언제 바꾸든 스냅샷의 문구와 달라지는 순간
  // 그 교체가 그대로 눈에 보인다. 즉 "값이 바뀌면 반드시 보인다"가 전제라, 짧은 왕복에서는 아예
  // 안 바꾸는 것이 유일한 해법이다.
  //
  // 그래서 백그라운드에 머문 시간으로 가른다 — 광고 보고 오기/P메뉴 "앱으로"처럼 수 초짜리 왕복은
  // 문구를 그대로 두어 화면이 미동도 안 하고(사장님이 지적한 그 케이스), 한참 뒤에 다시 열면 그때는
  // 새로 뽑는다. 2026-08-01 지적("왜 계속 같은 것만 띄우냐, 랜덤으로 바뀌어야지")도 그대로 만족한다.
  // 2026-08-07 사용자 지적("닫아도 다른 메뉴 갔다 오면 계속 떠") — 오늘 이미 X(또는 선물상자 탭)로
  // 닫았으면, 같은 날 안에는 아래 두 트리거(포그라운드 복귀/탭 재포커스) 어느 쪽이 다시 불러도 배너를
  // 채우지 않는다. STORAGE_KEYS.insightDismissedDate 참고.
  /**
   * 오늘 선물이 있는가. 이미 받았으면 false, 오늘 뽑은 결과가 있으면 그걸 그대로 쓴다.
   * 확률은 예전 "탭할 때마다 30%"를 **날짜 단위 30%**로 옮긴 것이다 — 기대 빈도는 비슷하되,
   * 상자가 보이는 날은 반드시 당첨이라 "열었는데 비어 있음"이 없어진다.
   */
  const resolveTodaysGift = useCallback(async (todayStr: string): Promise<boolean> => {
    try {
      const claimed = await AsyncStorage.getItem(STORAGE_KEYS.insightGiftClaimedDate);
      if (claimed === todayStr) return false;
      const offered = await AsyncStorage.getItem(STORAGE_KEYS.insightGiftOfferedDate);
      const [offeredDate, verdict] = (offered ?? '').split(':');
      if (offeredDate === todayStr) return verdict === 'yes';
      const won = Math.random() < GIFT_DAY_CHANCE;
      await AsyncStorage.setItem(STORAGE_KEYS.insightGiftOfferedDate, `${todayStr}:${won ? 'yes' : 'no'}`);
      return won;
    } catch {
      return false; // 부가 기능 — 실패하면 조용히 없는 날로 둔다
    }
  }, []);

  const maybeSetTodaysInsight = useCallback(async (uid: string) => {
    const todayStr = toLocalDateStr(new Date());
    const dismissedDate = await AsyncStorage.getItem(STORAGE_KEYS.insightDismissedDate).catch(() => null);
    if (dismissedDate === todayStr) return;
    const message = await getTodaysInsightMessage(uid).catch(() => null);
    if (!message) return;
    // 🔴 2026-08-15 — 오늘이 "선물 있는 날"인지 하루에 딱 한 번 뽑아 고정한다. 화면을 다시 열
    // 때마다 다시 뽑으면 결국 무한 재시도가 되어 파밍 방지 취지가 사라진다.
    setGiftAvailable(await resolveTodaysGift(todayStr));
    setTodaysInsight(message);
  }, [resolveTodaysGift]);

  const backgroundedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (backgroundedAtRef.current == null) backgroundedAtRef.current = Date.now();
        return;
      }
      const leftAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (leftAt == null) return;
      if (Date.now() - leftAt < INSIGHT_REDRAW_MIN_AWAY_MS) return;
      if (user?.id) maybeSetTodaysInsight(user.id);
    });
    return () => sub.remove();
  }, [user?.id, maybeSetTodaysInsight]);

  // 2026-07-18 실기기 검증 중 발견: mount 시 1회만 refresh하는 useEffect라 세션이 끝나고
  // router.back()으로 Home에 돌아와도(탭 자체는 재마운트되지 않으므로) "오늘 사용" 숫자가 세션
  // 시작 전 값에 멈춰 있는 버그를 직접 확인(664초짜리 세션이 끝났는데도 Home이 이전 세션 값을
  // 그대로 표시). useFocusEffect로 교체해 이 탭이 다시 포커스될 때마다(세션 종료 복귀 포함) 갱신.
  useFocusEffect(
    useCallback(() => {
      if (user?.id) refresh(user.id);
      refreshBluetooth();
      // 2026-07-29 — 홈 배너를 매일 하나의 랜덤 인사이트 선물상자로. 수면 보정(방법 B)을 먼저
      // 돌려야 "어제 마지막 시청시각" 계산이 보정된 실제 값을 쓴다(기존 순서 보장 그대로 유지).
      if (user?.id) {
        const uid = user.id;
        (async () => {
          await backfillSleepFromHistory(uid);
          // 2026-08-01 사장님 지시 — "오늘의 신조어"가 앱 배너 + 푸시 노티로 중복 노출됐다. 앱 배너만
          // 남기고 푸시 노티는 제거(maybeShowUsageInsight 호출 삭제). 인사이트는 인앱에서만 본다.
          await maybeSetTodaysInsight(uid);
        })();
      }
      // 2026-07-28 밤 감사 — 배터리 최적화 제외 배너, 1회만. Settings 안에 이미 있는 행(guardRow)과
      // 별개 진입점 — 능동적으로 안 찾아보는 사용자가 대부분이라 발견성을 높인다.
      if (Platform.OS === 'android') {
        (async () => {
          const alreadyExempt = await overlayService.hasBatteryOptimizationExemption().catch(() => true);
          if (alreadyExempt) return;
          const seen = await AsyncStorage.getItem(STORAGE_KEYS.batteryOptimizationPromptSeen);
          if (!seen) setShowBatteryPrompt(true);
        })();
        overlayService.hasAccessibilityPermission().then((granted) => {
          setShowAccessibilityPrompt(!granted);
        }).catch(() => {});
      }
    }, [user?.id, refresh, refreshBluetooth, maybeSetTodaysInsight])
  );

  const dismissBatteryPrompt = useCallback(() => {
    setShowBatteryPrompt(false);
    AsyncStorage.setItem(STORAGE_KEYS.batteryOptimizationPromptSeen, 'true').catch(() => {});
  }, []);
  const acceptBatteryPrompt = useCallback(() => {
    overlayService.requestBatteryOptimizationExemption();
    dismissBatteryPrompt();
  }, [dismissBatteryPrompt]);

  // 2026-08-01 — 배터리 배너와 달리 "본 적 있음" 영속 기록을 안 남긴다: 접근성이 꺼진 채면 세션
  // 추적/오버레이 자체가 죽으므로, 지금 눈에 안 보이게 닫아도 다음 포커스/foreground 재확인에서
  // 여전히 꺼져 있으면 그대로 다시 뜬다(위 useEffect/useFocusEffect 참고).
  const dismissAccessibilityPrompt = useCallback(() => {
    setShowAccessibilityPrompt(false);
  }, []);
  const acceptAccessibilityPrompt = useCallback(() => {
    overlayService.requestAccessibilityPermission();
    setShowAccessibilityPrompt(false);
  }, []);

  // 2026-07-29 사장님 지시("가끔 연속으로 오면 크레딧도 선물박스 누르면 주고") — 인사이트 배너를
  // 탭하면 가끔(30% 확률) 보너스 크레딧이 터지는 선물상자로. 하루 한 번만 보상 판정(파밍 방지) —
  // 이미 오늘 시도했으면 그냥 닫기만 한다. 매번 확실히 주면 "선물"이 아니라 "기능"이 되어버려서
  // 확률로 둔다(예상 못한 즐거움 원칙).
  const onTapInsightGift = useCallback(async () => {
    const todayStr = toLocalDateStr(new Date());
    try {
      // 🔴 2026-08-15 — 당첨 판정은 여기서 하지 않는다. "오늘이 선물 있는 날인가"는 배너를 띄울 때
      // 이미 정해졌고(resolveTodaysGift), 🎁가 보였다면 **반드시 준다.** 보이는 상자를 열었는데
      // 비어 있는 경우를 없애는 것이 이번 수정의 핵심이다.
      if (giftAvailable) {
        const bonus = Math.random() < 0.5 ? 5 : 10;
        await addBonusMinutes(bonus);
        await AsyncStorage.setItem(STORAGE_KEYS.insightGiftClaimedDate, todayStr);
        setGiftAvailable(false);
        // 2026-08-07 사용자 지적("박스가 나왔다 바로 사라져서 클릭도 확인도 못 함") — 토스트는 몇 초면
        // 스스로 사라져서 놓치면 끝이었다. 출석 보상(DailyCheckInModal)과 동일하게, 사용자가 직접
        // 닫기 전까지 사라지지 않는 모달로 보여준다(아래 렌더 블록 참고).
        setInsightGiftEarned(bonus);
      }
    } catch {
      // 조용히 무시 — 부가 기능
    }
    // 2026-08-07 — 보상 당첨 여부와 무관하게 "오늘은 이미 닫았다"를 기록한다. 이게 없으면 다른 탭
    // 갔다가 홈으로 돌아올 때마다 useFocusEffect가 배너를 다시 채워, 사실상 무제한으로 재도전할 수
    // 있었다(파밍 방지 취지 자체가 무력화됨) — 위 STORAGE_KEYS.insightDismissedDate 주석 참고.
    await AsyncStorage.setItem(STORAGE_KEYS.insightDismissedDate, todayStr).catch(() => {});
    setTodaysInsight(null);
  }, [addBonusMinutes, giftAvailable]);

  // 🔴 2026-08-08 사장님 지시 — 홈 배너를 알림처럼 "떴다가 스스로 사라지게".
  //   예전엔 사용자가 ✕나 배너를 누를 때까지 **화면을 계속 차지**했다.
  //   AUTO_DISMISS_MS는 읽고 탭할 시간은 충분하되 자리를 오래 차지하지 않는 절충값이다
  //   (문구가 두 줄까지 나올 수 있어 3~4초는 짧다).
  //   ⚠️ 자동으로 사라질 때도 insightDismissedDate를 기록한다. 안 그러면 다른 탭 갔다 홈으로
  //     돌아올 때마다 배너가 다시 떠서 선물 확률을 무제한 재시도할 수 있다(2026-08-07에 그 파밍
  //     구멍을 막으려고 넣은 기록이다 — 자동 해제만 예외로 두면 그 구멍이 그대로 다시 열린다).
  //     대신 보상 판정(onTapInsightGift)은 타지 않는다 — 사용자가 안 눌렀으니 당첨도 없다.
  //   🔴 2026-08-15 — **선물이 걸린 날은 자동으로 안 사라진다.** 여기가 사장님이 선물상자를 한 번도
  //     못 본 진짜 원인이었다: 7초 뒤 자동 해제되면서 insightDismissedDate까지 기록해버려, 그날은
  //     다시 뜨지도 않고 당첨 판정도 못 탄 채 끝났다. 선물이 없는 날은 예전대로 7초 뒤 사라진다.
  const AUTO_DISMISS_MS = 7000;
  useEffect(() => {
    if (!todaysInsight || giftAvailable) return;
    const timer = setTimeout(() => {
      const todayStr = toLocalDateStr(new Date());
      AsyncStorage.setItem(STORAGE_KEYS.insightDismissedDate, todayStr).catch(() => {});
      setTodaysInsight(null); // Animated.View의 exiting(FadeOut 800ms)이 부드럽게 지운다
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [todaysInsight, giftAvailable]);

  // 2026-07-19: Bluetooth Hands-Free 최초 1회 안내 — 첫 플랫폼 카드 탭에서 세션 시작 전에 가로챈다.
  // 이미 본 적 있으면(STORAGE_KEYS.bluetoothOnboardingSeen) 그냥 바로 세션 시작.
  // 2026-07-25 B1 — 이 시트 자체는 Android에서도 그대로 띄운다: "Enable"이 실제로 켜는 건 Bluetooth
  // 헤드셋 하드웨어 버튼(죽음, capabilities.supportsHandsFreeControl 참고)이 아니라 핑거스냅/손
  // 밀어내기/자동재생 워처로 구성된 진짜 동작하는 Auto Mode(Focus Session)다 — 이게 지금 Android에서
  // Auto Mode를 켜는 유일한 진입점이라 지웠으면 안 됐다. 대신 BluetoothOnboardingSheet 자체의 문구를
  // 플랫폼별로 갈라 Android에서 더 이상 "Bluetooth 헤드셋 버튼" 거짓 약속을 하지 않도록 고쳤다.
  // healthy-shorts-assistant(3) 이식 — 실제 /overlay 이동 전에 ConnectingOverlay 체크리스트
  // 애니메이션을 먼저 보여준다(App.tsx triggerConnectingSequence). 애니메이션이 끝나면
  // handleConnectingComplete가 실제 라우팅을 수행.
  const startSession = useCallback((platform: AppShieldTarget) => {
    // 🔴 2026-08-12 — /overlay 라우트 파라미터가 유실되면 세션이 platform_app=NULL로 기록돼
    //   앱별 통계에서 빠진다(실측: 총 110분 중 51분이 NULL). 여기서 남겨 두면 overlay가 폴백한다.
    AsyncStorage.setItem(STORAGE_KEYS.lastPlatform, platform).catch(() => {});
    // 2026-07-20 실기기 검증 중 발견: 예전엔 /overlay 화면이 마운트된 뒤(DB 조회 2번 + Connecting
    // 애니메이션 이후)에야 launchPlatformApp을 불렀는데, 그러면 원래 탭 제스처로부터 너무 늦어져
    // 안드로이드 백그라운드 액티비티 시작 제한에 조용히 막혔다(예외 없음 — 그냥 실행이 안 됨).
    // 탭과 최대한 가까운 지금 시점에 바로 부른다.
    launchPlatformApp(platform).catch(() => {});
    // 2026-07-24 밤 실기기 검증 중 발견한 진짜 큰 버그 — launchPlatformApp이 실제 유튜브 앱을 거의
    // 즉시 포그라운드로 가져오면서 Pace 액티비티가 곧바로 백그라운드로 밀려나는데, PaceOverlayService
    // (카운트다운/일일한도/미디어세션 전부 담당)를 켜는 코드는 지금까지 /overlay 화면이 마운트된
    // 뒤(Connecting 애니메이션 300ms + 라우팅 이후)에야 실행되는 useEffect 안에 있었다. 실기기에서
    // adb로 직접 확인해보니, 그 useEffect는 액티비티가 진짜로 다시 포그라운드로 돌아올 때까지
    // 전혀 실행되지 않았다(RN이 백그라운드 상태에서 마운트 이펙트를 미룸) — 즉 사용자가 유튜브에
    // 머무는 동안 실제로는 세션 추적/한도 집행 서비스가 단 한 번도 켜지지 않고 있었다는 뜻이다.
    // 탭 이벤트를 처리 중인 지금(액티비티가 확실히 포그라운드인 시점)에 네이티브 서비스를 직접
    // 켜서 이 경쟁 상태를 없앤다 — PaceOverlayService.start()는 멱등(ensureInfraReady의 infraReady
    // 가드)이라 /overlay의 useEffect가 나중에 한 번 더 불러도 안전하다.
    // 2026-08-01 사용자 지적("5분 추가 눌렀는데 오버레이에 1분으로 나옴") — 이 콜백(onSelectPlatform)의
    // useCallback 의존성 배열이 [enableAutoModeForSession]뿐이라 settings/bonusMinutes/todayUsageMinutes를
    // 훅 클로저로 캡처해뒀다. LimitReachedOverlay의 "+5분 추가"는 addBonusMinutes(5)를 호출한 바로
    // 다음 줄에서 곧장 onSelectPlatform을 부르는데, addBonusMinutes는 비동기 상태 갱신이라 이 시점엔
    // 아직 리렌더 전 — 방금 추가한 보너스가 반영 안 된(그리고 최신 사용량도 아닌) 값으로 잔여시간을
    // 계산해 실제보다 훨씬 적은 시간이 오버레이에 표시됐다. 훅 클로저 대신 각 스토어의 getState()로
    // 지금 이 순간의 실제 값을 읽어 이 레이스를 없앤다.
    const freshSettings = useSettingsStore.getState().settings;
    const freshBonusMinutes = useDailyBonusStore.getState().extraMinutes;
    const freshTodayUsageMinutes = useStatsStore.getState().todayUsageMinutes;
    const remainingMinutes = Math.max(0, freshSettings.dailyLimitMinutes + freshBonusMinutes - freshTodayUsageMinutes);
    overlayService.startSession({
      dailyLimitMinutes: freshSettings.dailyLimitMinutes,
      remainingMinutes,
      autoNext: freshSettings.autoNext,
      sleepTimerMinutes: freshSettings.sleepTimerMinutes ?? 0,
      breakIntervalMinutes: freshSettings.breakIntervalMinutes,
      notifyRemaining: freshSettings.notifyRemaining,
      notifyLimit: freshSettings.notifyLimit,
      notifyBreak: freshSettings.notifyBreak,
      hardBlockMode: freshSettings.hardBlockMode,
      sleepStillnessMinutes: freshSettings.sleepStillnessMinutes,
      bluetoothVolumeKeySkipEnabled: freshSettings.bluetoothVolumeKeySkipEnabled,
    }).catch(() => {});
    // 2026-08-02 사장님 실기기 재현("open앱 하는데 중간 원형 팝업 나오고 앱 두 번") — 카드를 탭하면
    // ConnectingOverlay(원형 체크리스트 애니메이션)가 시작되는데, 바로 위 launchPlatformApp이 유튜브를
    // 전면으로 올리면서 그 애니메이션이 백그라운드에서 멈춘다. 그러다 나중에 P메뉴 "앱으로" 등으로
    // Pace가 다시 앞에 오면 그제서야 재개·완료되며 원형 팝업이 뜨고 /overlay 라우팅이 뒤늦게 실행됐다
    // — 사용자 입장에선 "앱으로를 눌렀는데 난데없이 진입 화면이 뜨고 앱이 두 번 뜬다".
    // 아침에 /overlay의 유튜브 재실행은 제거했지만 이 "뒤늦게 터지는 애니메이션" 자체는 남아 있었다.
    // 안드로이드는 곧바로 유튜브로 나가므로 이 연결 애니메이션을 보여줄 화면 시간이 애초에 없다 —
    // 애니메이션을 띄우지 않고 즉시 완료 처리해 나중에 터질 것을 남기지 않는다(iOS는 앱 안에 머무르며
    // 피드로 전환하므로 기존대로 애니메이션을 보여준다).
    if (Platform.OS === 'android') {
      if (user?.id) refresh(user.id);
      router.push({ pathname: '/overlay', params: { platform, autostart: String(Date.now()) } });
      return;
    }
    setConnectingPlatform(platform);
    // 2026-07-23 버그 수정 — 예전엔 BluetoothOnboardingSheet에서 Enable을 고른 "그 첫 세션"에만
    // Auto Mode(핑거스냅 포함)가 켜지고 10분 뒤 자동 종료된 뒤로는 다시 켤 방법이 없었다(Focus 탭
    // 토글 버튼이 7/22에 삭제됨). Enable을 고른 적 있는 사용자는 매 세션 시작마다 다시 켜준다 —
    // enableAutoModeForSession은 이미 켜져 있으면 아무것도 안 하는 멱등 호출이라 안전하다.
    // 2026-07-26 사장님 결정 번복 — D9에서 프리미엄 전용으로 게이팅했던 핸즈프리 컨트롤(Auto Mode)을
    // 다시 무료로 개방. 이유: Focus Session 자동넘김 자체가 이미 무료라, 그걸 "화면 안 만지고" 넘기는
    // 트리거만 유료로 막는 게 정책상 어색하다는 판단 — Focus Session 중에는 무료/유료 동일하게 동작.
    AsyncStorage.getItem(STORAGE_KEYS.autoModeOptIn).then(async (optIn) => {
      if (optIn === 'true') { enableAutoModeForSession(); return; }
      if (optIn === null) {
        // 2026-07-23 마이그레이션 — autoModeOptIn 키는 오늘 새로 추가됐다. 이 키가 생기기 전부터
        // 쓰던 기기는 온보딩(bluetoothOnboardingSeen)이 이미 true라 다시는 안 뜨므로, 새 키가
        // 없다는 이유만으로 예전에 Enable을 골랐던 사용자까지 도로 꺼진 채 방치되면 안 된다.
        // RECORD_AUDIO 권한이 이미 있다는 건 과거에 Enable 경로(dismissOnboarding/toggleAutoMode)를
        // 탄 적 있다는 확실한 증거이므로 그걸 opt-in 신호로 승계한다.
        const grantedBefore = await bluetoothService.hasRecordAudioPermission().catch(() => false);
        if (grantedBefore) {
          AsyncStorage.setItem(STORAGE_KEYS.autoModeOptIn, 'true').catch(() => {});
          enableAutoModeForSession();
        }
      }
    }).catch(() => {});
  }, [enableAutoModeForSession]);

  const handleConnectingComplete = useCallback(() => {
    const platform = connectingPlatform;
    setConnectingPlatform(null);
    if (!platform) return;
    // 2026-07-22 감사수정(App Review 블로커): iOS의 /overlay는 가짜 유튜브 "DEV SIMULATOR" 목업이라
    // 그대로 심사에 내면 반려(2.2 데모/4.3 사칭)된다. iOS에선 실제 인앱 재생 화면(Pace Feed)으로 보낸다.
    // Android는 오버레이-어시스턴트 모델 그대로 유지.
    // 🔴 2026-08-13 — platform 파라미터 없이 push하면 feed/index.tsx가 기본값(youtube)으로 렌더해
    // "Loops" 카드를 눌러도 유튜브가 떴다(feed 화면이 platform param을 새로 읽게 된 시점부터 필요).
    if (Platform.OS === 'ios') { router.push({ pathname: '/feed', params: { platform } }); return; }
    // 2026-08-02 실기기 로그로 확정("P메뉴 앱으로 눌렀는데 쇼츠로 되돌아감", 오늘 반복 재현) —
    // /overlay 화면의 세션 시작 이펙트가 마운트마다 돌면서 launchPlatformApp으로 유튜브를 다시
    // 열어버렸다. 기존 가드(useSessionStore.status === 'running')는 세션이 방금 끝났거나 스토어가
    // 아직 안 채워진 순간에 그냥 통과해버려 여러 번 샜다(로그: pace://home 진입 1.8초 뒤
    // PaceOverlayModule.start() → youtube UrlActivity START). 상태값이 아니라 "어떻게 들어왔는지"로
    // 막는다 — 홈 카드 탭으로 들어온 이 경로에서만 autostart를 넘기고, 딥링크/복귀 등 다른 경로로
    // 이 화면이 다시 마운트될 때는 세션 시작도 앱 재실행도 하지 않는다.
    // autostart는 고정값('1')이면 안 된다 — 같은 라우트가 다시 마운트될 때 파라미터가 그대로 남아
    // 있어 재사용돼버린다(실기기 로그로 확인: '1' 가드를 넣었는데도 그대로 재현). 매 탭마다 새
    // 토큰을 발급해 overlay 쪽에서 1회만 소비하게 한다.
    router.push({ pathname: '/overlay', params: { platform, autostart: String(Date.now()) } });
  }, [connectingPlatform, router]);


  const onSelectPlatform = useCallback((platform: AppShieldTarget) => {
    // 2026-08-02 사장님 지시("60분에 대한 팝업 없애라고, 그냥 focus 일때 광고 5분만 남겨") —
    // 하루 한도 도달 시 새 세션 시작을 막던 게이트를 제거했다. 팝업만 없애고 이 게이트를 남기면
    // 한도를 넘긴 뒤로는 카드를 눌러도 아무 반응 없이 조용히 막혀(설명도 없이) 훨씬 나쁜 UX가 된다.
    // 하루 한도는 이제 차단이 아니라 추적/표시 전용이고, 유일한 연장 게이트는 Focus Session 쪽
    // 광고 5분뿐이다.
    // 감사 HIGH2(2026-07-27, Mac→Windows 인계) — 세션이 이미 running인데 카드를 또 탭하면(keepAlive
    // 리다이렉트로 Home에 돌아온 뒤 재탭 등) startSession이 새 viewing_sessions 행을 또 만들어, 나중에
    // 둘 다 같은 종료시각으로 닫히며 겹치는 구간이 이중집계됐다. 이미 running이면 새 세션/네이티브
    // 서비스를 다시 시작하지 않고 해당 앱만 전면으로 다시 띄운다(세션·오버레이는 그대로 유지).
    // 2026-08-01 사용자 지적("작아진 화면 다시 키워야지 왜 새 쇼츠가 보여") — 여기서도
    // launchPlatformApp을 썼었는데, 그 함수는 매번 "새 Shorts 진입" URL을 열어서 PIP로 줄어있던
    // 기존 화면 대신 새 피드가 열렸다. 재소환 전용 resumePlatformApp(순수 스킴, 특정 화면 강제 없음)
    // 으로 교체 — supportedApps.ts 주석 참고.
    // 2026-08-05 사장님 실기기 재현("또 유튜브 앱이야", "첫 영상이 매번 같다") — 이 가드가 세션이
    // running인 동안 **무조건** 재개로 빠뜨려서, 쇼츠 진입 코드(openShortsFeed)가 한 번도 실행되지
    // 않았다. 재개는 런처 인텐트라 복원할 태스크가 없으면 유튜브 홈이 열린다. 두 증상의 공통 원인.
    if (useSessionStore.getState().status === 'running') {
      // 🔴 2026-08-13 발견 12 — **여기서 플랫폼을 비교하지 않던 게 버그였다.** 위 감사 HIGH2 가드는
      //   "같은 카드 재탭 시 이중 세션 방지"가 목적이었는데 **같은 앱 재탭과 다른 앱 전환을 구분하지
      //   않아서**, 유튜브 세션 중 틱톡 카드를 눌러도 세션이 그대로 유지됐다. viewing_sessions의
      //   platform_app은 INSERT 때 한 번 박히고 세션 도중 갱신되는 코드가 없으므로(전수 확인),
      //   **틱톡 시청시간이 통째로 유튜브로 기록**됐다.
      //   부수 피해: 홈 "Active" 배지가 엉뚱한 카드에 남고, 분석탭 Platform Breakdown이 앱을 하나로만
      //   보게 돼 `length > 1`을 못 채우고 섹션째 숨는다 — 2026-08-12에 "틱톡을 봤으면 같이 나와야
      //   하잖아"라고 지시받은 그 기능이 교차 사용에서 성립하지 않았다(M11의 실사용 재현 경로).
      //   → 플랫폼이 다르면 **이전 세션을 닫고 새 세션을 연다.** 시간·한도는 앱 구분 없이 공용이라
      //     (QA_MATRIX 1-4) 사용자 체감은 그대로고 기록만 정확해진다.
      //   ⚠️ teardown을 **await한 뒤에** startSession을 부른다. 안 기다리면 두 세션이 겹치고,
      //     /overlay의 마운트 가드(status === 'running')에 새 세션이 막혀 조용히 아무 일도 안 난다.
      const activePlatform = useSessionStore.getState().platformApp;
      const activeSessionId = useSessionStore.getState().currentSessionId;
      if (activePlatform && activePlatform !== platform) {
        const uid = useUserStore.getState().user?.id;
        const startedAt = useSessionStore.getState().startedAt;
        (async () => {
          if (activeSessionId && uid) {
            await teardownSession({
              sessionId: activeSessionId,
              userId: uid,
              startedAtMs: startedAt ? startedAt.getTime() : null,
              // 사용자가 직접 다른 앱으로 갈아탄 것이므로 수동 종료다 — 'unknown'으로 남기면
              // 종료사유 통계에서 "원인을 모르는 종료"와 섞인다(2026-08-02 규칙).
              endReason: 'manual_stop',
            });
          } else {
            useSessionStore.getState().finish();
          }
          startSession(platform);
        })().catch(() => {});
        return;
      }
      // iOS는 외부 앱을 안 열어 resumePlatformApp이 즉시 return이다 — 예전엔 카드를 눌러도 **아무 일도
      // 일어나지 않았다**(피드에서 나온 뒤 홈에서 재탭 시 먹통). 보던 피드로 되돌려 준다.
      if (Platform.OS === 'ios') { router.push({ pathname: '/feed', params: { platform } }); return; }
      resumePlatformApp(platform)
        .then((resumed) => {
          // PIP로 줄여둔 창이 없으면 복원할 게 없다 → 정상 진입으로 새 쇼츠를 연다.
          // ⚠️ startSession을 부르면 안 된다 — viewing_sessions 행이 하나 더 생겨 겹치는 구간이
          //    이중집계된다(감사 HIGH2). 세션·오버레이는 그대로 두고 앱만 정식 경로로 연다.
          if (!resumed) launchPlatformApp(platform).catch(() => {});
        })
        .catch(() => {});
      return;
    }
    AsyncStorage.getItem(STORAGE_KEYS.bluetoothOnboardingSeen).then((seen) => {
      if (seen) {
        startSession(platform);
      } else {
        setPendingPlatform(platform);
      }
    }).catch(() => startSession(platform));
  }, [startSession]);

  const dismissOnboarding = useCallback((enableAutoMode: boolean) => {
    AsyncStorage.setItem(STORAGE_KEYS.bluetoothOnboardingSeen, 'true').catch(() => {});
    // 2026-07-23 버그 수정 — 이 선택을 저장해둬야 startSession이 다음 세션부터도 계속 참조할 수 있다.
    AsyncStorage.setItem(STORAGE_KEYS.autoModeOptIn, String(enableAutoMode)).catch(() => {});
    if (enableAutoMode) toggleAutoMode();
    const platform = pendingPlatform;
    setPendingPlatform(null);
    if (platform) startSession(platform);
  }, [pendingPlatform, startSession, toggleAutoMode]);

  // 2026-07-18: 사용자 지시(외부 프로덕트 조언 반영) — "AUTO NEXT READY" 등 AUTO 브랜딩을 카드
  // 상태줄에서 전면에 노출하지 않는다(스토어 심사 리스크 + 타겟 연령대엔 "자동 조작 앱"보다 "프리미엄
  // 집중 관리 앱" 인상이 낫다는 판단). 플랫폼별 상태문구 대신 실제 세션 상태 기반 Active/Available
  // 2단만 사용 — 원본 App.tsx의 statusAutoNext/statusShield 문구는 더 이상 이식하지 않음.
  // 2026-07-22 사용자 지시 — Instagram/TikTok Auto Next가 구조적으로 정밀 감지 불가능(SeekBar
  // content-desc에 재생 위치 텍스트 자체가 없음, 실기기로 확인 — 45초 고정 타임아웃만 가능)하다고
  // 판단해 "YouTube Only"로 MVP 방향 확정. Instagram/TikTok 카드는 완전히 제거하고, 대신 YouTube를
  // "그냥 열기"(추적/차단 없음) vs "PACE와 함께"(기존 세션 추적+오버레이+한도 집행) 두 모드로 분리 —
  // Pace의 핵심 가치(한도 집행)가 필요 없는 사용자도 존재할 수 있다는 판단.
  // 🔴 2026-08-13 사장님 지시("틱톡 누르면 원형 중간 팝업 … 동일하게 만들고 TikTok으로 문구 바꾸고") —
  //   이 두 값이 **유튜브로 하드코딩**돼 있어서, 틱톡(Loops) 카드를 눌러도 연결 팝업이
  //   "YouTube / Shorts with PACE"라고 말했다. 홈 카드 제목과 같은 규칙으로 플랫폼에 따라 고른다.
  const connectingCard = connectingPlatform
    ? { title: connectingPlatform === 'tiktok' ? 'Loops with PACE' : 'Shorts with PACE' }
    : null;
  const connectingPlatformName = connectingPlatform === 'tiktok' ? 'TikTok'
    : connectingPlatform === 'instagram' ? 'Instagram'
    : connectingPlatform ? 'YouTube' : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />

        {/* 2026-08-01 실기기 사고 — 접근성이 꺼지면 세션 추적/오버레이가 통째로 멈추는 하드 블로커라
            다른 배너보다 항상 우선(아래 두 배너는 이게 떠 있는 동안 미룸). 배터리 배너와 달리
            "본 적 있음" 무기한 억제를 안 한다 — 꺼져 있는 한 계속 다시 뜬다. */}
        {showAccessibilityPrompt && (
          <Pressable style={[styles.sleepInsightBanner, styles.accessibilityBanner]} onPress={acceptAccessibilityPrompt}>
            <View style={[styles.sleepInsightBadge, styles.accessibilityBadge]}>
              <Feather name="alert-triangle" size={14} color="#FFFFFF" />
            </View>
            <Text style={styles.sleepInsightText}>{t('focus.accessibilityPromptBanner')}</Text>
            <Text style={styles.sleepInsightDismiss} onPress={dismissAccessibilityPrompt}>✕</Text>
          </Pressable>
        )}


        {/* 2026-08-01 사용자 지적("그걸 저렇게 촌스럽게 띄운다고", "노티를 저렇게 줄줄이 띄우는게
            트렌드야?") — 배터리 배너에 이모지(🔋)를 써서 위 인사이트 배너(P 배지)와 톤이 안 맞았고,
            둘 다 조건이 맞으면 동시에 쌓여 보였다. 이모지를 인사이트 배너와 동일한 원형 배지로
            통일하고, "노티가 다음에 나오게"라는 요청대로 인사이트 배너가 떠 있는 동안은 배터리
            배너를 미룬다 — 인사이트 배너를 닫아야(todaysInsight → null) 그다음에 나타난다. */}
        {showBatteryPrompt && !todaysInsight && !showAccessibilityPrompt && (
          <Pressable style={styles.sleepInsightBanner} onPress={acceptBatteryPrompt}>
            <View style={styles.sleepInsightBadge}>
              <Feather name="battery-charging" size={14} color="#FFFFFF" />
            </View>
            <Text style={styles.sleepInsightText}>{t('focus.batteryPromptBanner')}</Text>
            <Text style={styles.sleepInsightDismiss} onPress={dismissBatteryPrompt}>✕</Text>
          </Pressable>
        )}

        <SessionHeroCard minutesWatched={todayUsageMinutes} limitMinutes={effectiveDailyLimitMinutes} autoNextEnabled={settings.autoNext} restSeconds={restSeconds} />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('home.choosePlatform')}</Text>
          <View style={styles.tapBadge}>
            <Text style={styles.tapBadgeText}>{t('home.tapToStart')}</Text>
          </View>
        </View>
        <View style={styles.platformStack}>
          {/* 2026-07-26 사용자 지시 — "그냥 열기"(추적 없음) 카드는 삭제, 단일 카드로 통합해
              "Shorts with PACE"로 개명. 눌렀을 때 동작은 기존 "YouTube with PACE" 카드와 동일
              (onSelectPlatform → Android 오버레이 / iOS Pace Feed 웹뷰). 카드가 하나뿐인 유일한
              기본 액션이라 재생 버튼도 더 크게(styles.playButtonLarge, PlatformPickerCard 참고). */}
          <PlatformPickerCard
            key="shorts-with-pace"
            title="Shorts with PACE"
            badge="GUARDED"
            statusText={
              activeSessionPlatform === 'youtube'
                ? 'Active'
                // 2026-07-25 B1 — "Hands-Free Ready"는 Bluetooth 헤드셋 하드웨어 버튼이 실제로
                // YouTube를 조작할 수 있다는 뜻인데 Android는 OS 레벨에서 그게 불가능함이 확정됐다
                // (capabilities.supportsHandsFreeControl 주석 참고) — Android에서는 이 배지를 아예
                // 노출하지 않는다. iOS는 기존 그대로.
                : capabilities.supportsHandsFreeControl && isBluetoothConnected
                  ? '🎧 Hands-Free Ready'
                  : 'Track viewing time and build healthier habits.'
            }
            cover={YOUTUBE_COVER}
            gradientFrom="rgba(220,38,38,0.35)"
            onPress={() => onSelectPlatform('youtube')}
            isActive={activeSessionPlatform === 'youtube'}
            features={[...(capabilities.supportsHandsFreeControl ? ['🎧 Hands-Free'] : []), '⏱ Focus Session']}
            largeButton
          />

          {/* 🔴 2026-08-11 사장님 지시("유튜브처럼 틱톡을 홈에 카드 추가, 안드로이드 애플 각각 동일한
              방식으로") — 안드로이드는 **오버레이 코드가 앱 무관**이라 카드만 추가하면 기존 세션·
              한도·이어서재생이 그대로 동작한다(사장님 표현: "안드 오버레이 코드 공통이고 쇼츠
              사이트만 다르게"). onSelectPlatform('tiktok') → supportedApps.ts의 tiktok 항목
              (tiktok:// 스킴 / www.tiktok.com/foryou, 실기기에서 For You 풀스크린 진입 검증됨)로
              앱을 열고, ForegroundAppWatcher가 그 패키지를 감시 대상으로 이미 알고 있다.

              🟢 2026-08-13 — 아래 "iOS는 성립하지 않는다"는 이전 결론은 뒤집혔다(자세한 히스토리는
              QA_MATRIX.md 2026-08-12/13 섹션). 서버 스크래핑(이 코멘트가 실패라고 적었던 것)은 여전히
              막혀 있지만, 그건 다른 질문이었다 — 진짜 답은 **WKWebView로 tiktok.com/foryou 페이지
              자체를 데스크톱 UA로 그대로 띄우는 것**(TikTokShortsPlayer.ios.tsx, YouTube 플레이어와
              같은 패턴)이었다. iOS도 이제 카드를 노출한다. */}
          {/* ⚠️ 2026-08-12 — 아래 제목/배지/그라데이션은 **원본(383eae5)의 값 그대로** 쓴다.
              처음엔 내가 "TikTok with PACE"/"GUARDED"/rgba(37,244,238,0.30)으로 지어냈는데,
              사장님이 "이전 원본 찾아보라"고 하신 그 코드가 git에 있었다:
                { id: 'tiktok', title: 'TikTok Video Loop', badge: 'LOOPS',
                  gradientFrom: 'rgba(13,148,136,0.35)' }
              supportedApps.ts의 label도 'TikTok Video Loop'로 이미 그 값이었다(내가 안 봤다).
              내가 지어낸 그라데이션이 원본보다 진해 커버 이미지가 덮여 보이던 것도 같이 해결된다.
              ⚠️ 인스타그램 카드는 원본에 함께 있었고 자산·타입·supportedApps 항목이 그대로 살아
                있다(사장님: "인스타는 나중에 쓸 거야 버리지 마") — 지우지 말 것. */}
          <PlatformPickerCard
            key="tiktok-video-loop"
            // 🔴 2026-08-12 사장님 결정 — 상표 결합 위험 때문에 "TikTok with PACE"는 쓰지 않는다.
            //   YouTube/TikTok 브랜드 가이드라인은 자사 마크를 다른 이름과 합쳐 새 명칭을 만드는
            //   것을 금지하고, Apple 5.2.1 / Play 지식재산 정책도 제휴 오인을 반려 사유로 본다.
            //   → 제품명(Shorts/Loops)에만 PACE를 붙인다: "Shorts with PACE" / "Loops with PACE".
            title="Loops with PACE"
            badge="LOOPS"
            statusText={
              activeSessionPlatform === 'tiktok'
                ? 'Active'
                : capabilities.supportsHandsFreeControl && isBluetoothConnected
                  ? '🎧 Hands-Free Ready'
                  : 'Track viewing time and build healthier habits.'
            }
            cover={TIKTOK_COVER}
            gradientFrom="rgba(13,148,136,0.35)"
            onPress={() => onSelectPlatform('tiktok')}
            isActive={activeSessionPlatform === 'tiktok'}
            // 🔴 2026-08-16 사장님 지적("유튜브에만 왜 핸즈프리가 있고 틱톡엔 없어") — BT 리모컨은
            // useVolumeNext가 playerRef.current?.advance()를 부르는 방식이라 플랫폼 무관하게
            // 동작한다(TikTokShortsPlayer도 같은 advance() 인터페이스 구현, 오늘 밤 실제로 검증됨).
            // 틱톡 카드에만 이 배지가 빠져있던 건 카드 추가(2026-08-11~13) 당시 유튜브 카드의
            // capabilities.supportsHandsFreeControl 조건을 안 옮겨온 누락이었다.
            features={[...(capabilities.supportsHandsFreeControl ? ['🎧 Hands-Free'] : []), '⏱ Focus Session']}
            largeButton
          />
        </View>

        <Text style={[styles.sectionTitle, styles.quickControlsTitle]}>{t('home.quickControls')}</Text>
        <QuickControlsGrid />
      </ScrollView>

      {/* 🔴 2026-08-08 사장님 지시 2차 — "노티 떴다 사라지는 게 너무 부자연스럽고, 박스들이 움직이니까
          버벅거린다. 박스들 홈 화면 고정하고 알림처럼 떴다 사라지는 건?"
          원인: 이 배너가 **ScrollView 흐름 안에** 있어서 나타나고 사라질 때마다 아래 카드 전체가
          밀려 올라갔다 내려왔다 했다(레이아웃 리플로우). 페이드는 배너에만 걸리는데 카드 이동은
          애니메이션 없이 툭 튀니 더 어색했다.
          → ScrollView **밖으로 빼서 화면에 떠 있는 오버레이**로 만든다(position: absolute).
            이제 홈 카드들은 배너와 무관하게 **한 픽셀도 움직이지 않는다** — 진짜 알림처럼 위에
            떴다가 사라진다.
          ⚠️ pointerEvents="box-none"으로 배너 바깥 영역의 터치는 그대로 아래 화면에 전달된다
            (오버레이가 홈 상단을 가로막아 스크롤/탭이 막히면 안 된다). */}
      {todaysInsight && !showAccessibilityPrompt && (
        <View style={styles.insightOverlay} pointerEvents="box-none">
          <Animated.View entering={FadeInDown.duration(420)} exiting={FadeOut.duration(800)}>
            <Pressable style={[styles.sleepInsightBanner, styles.insightFloating]} onPress={onTapInsightGift}>
              {/* 2026-07-28 사장님 지시("아이콘 촌스럽잖아, 원에 PACE 아이콘 넣던가") — 작은 크기로
                  회전된 폰 사진은 지저분해 보여서, 브랜드 색 원형 배지 + P 모노그램으로 교체.
                  2026-07-29 — 이 박스 자체가 "선물상자"라 탭하면 가끔 보너스 크레딧이 나온다. */}
              {/* 🔴 2026-08-15 — 선물이 걸린 날은 P 모노그램 대신 🎁를 띄운다. 예전엔 "이 배너가
                  사실 선물상자"라는 걸 알려주는 표시가 화면에 **하나도 없었다** — 사장님이 한 번도
                  못 본 게 당연하다. 선물이 없는 날은 기존 배지 그대로라 평소 화면은 안 바뀐다. */}
              <View style={[styles.sleepInsightBadge, giftAvailable && styles.sleepInsightBadgeGift]}>
                <Text style={styles.sleepInsightBadgeText}>{giftAvailable ? '🎁' : 'P'}</Text>
              </View>
              <Text style={styles.sleepInsightText}>{todaysInsight}</Text>
              {/* 선물이 걸린 날엔 ✕를 숨긴다 — 닫기 버튼을 잘못 눌러 그날 선물을 날리는 일이 없게.
                  배너 아무 데나 누르면 선물을 받고 함께 닫힌다. */}
              {!giftAvailable && (
                <Text style={styles.sleepInsightDismiss} onPress={onTapInsightGift}>✕</Text>
              )}
            </Pressable>
          </Animated.View>
        </View>
      )}

      <BluetoothOnboardingSheet
        visible={pendingPlatform !== null}
        onEnable={() => dismissOnboarding(true)}
        onDismiss={() => dismissOnboarding(false)}
      />

      <ConnectingOverlay
        visible={connectingPlatform !== null}
        platformName={connectingPlatformName}
        platformFullTitle={connectingCard?.title ?? ''}
        onComplete={handleConnectingComplete}
      />

      {/* 2026-08-02 사장님 지시("60분에 대한 팝업 없애라고, 그냥 focus 일때 광고 5분만 남겨") —
          하루 한도(60분) 도달 팝업(LimitReachedOverlay)과 그에 딸린 광고/크레딧 연장 모달을 전부
          제거한다. 남는 연장 경로는 Focus Session 타임아웃 하나뿐(아래) — 하루 한도는 이제 팝업으로
          가로막지 않고 조용히 추적만 한다(사용시간 집계/통계는 그대로). 직전까지 겪던 "5분 더 눌렀는데
          또 한도 팝업이 뜬다", "팝업 두 개가 연달아 뜬다" 문제도 이 경로가 사라지면서 같이 없어진다. */}
      <FocusSessionExtendModal
        visible={showFocusSessionExtend && !celebrationVisible}
        onDismiss={() => setShowFocusSessionExtend(false)}
      />

      {/* 2026-08-07 사용자 지적("랜덤박스가 나왔다 바로 사라져서 클릭도 확인도 못 함") — 인사이트
          선물상자 당첨을 토스트 대신 출석 보상(DailyCheckInModal)과 같은 방식으로, 사용자가 직접
          닫기 전까지 사라지지 않게 보여준다. */}
      {insightGiftEarned != null && (
        <View style={styles.giftBackdrop} pointerEvents="auto">
          <View style={styles.giftCard}>
            <View style={styles.giftIconWrap}>
              <Feather name="gift" size={18} color={colors.successLight} />
            </View>
            <Text style={styles.giftTitle}>{t('home.insightGiftReward', { n: insightGiftEarned })}</Text>
            <Pressable style={styles.giftBtn} onPress={() => setInsightGiftEarned(null)}>
              <Text style={styles.giftBtnText}>{t('checkIn.dismiss')}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {},
  // 2026-08-07 — 인사이트 선물상자 당첨 모달(DailyCheckInModal과 동일한 배경/카드 톤).
  giftBackdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  giftCard: { width: '100%', maxWidth: 280, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, alignItems: 'center', gap: 2 },
  giftIconWrap: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  giftTitle: { color: colors.textPrimary, fontSize: 15, fontFamily: typography.bodyFontFamilySemibold, textAlign: 'center', marginTop: 2 },
  giftBtn: { alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  giftBtnText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 13 },
  // 🔴 2026-08-08 — 인사이트 배너를 ScrollView 밖으로 빼서 띄우는 컨테이너(위 렌더 주석 참고).
  // 홈 카드가 배너 때문에 밀리지 않게 하는 것이 목적이다. top은 AppHeader 아래에 겹치도록 잡았다.
  insightOverlay: {
    position: 'absolute',
    top: 96,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  // 떠 있는 상태라 배경 위에 얹히므로, 인라인일 때보다 불투명도를 올리고 그림자를 줘서
  // "화면 위에 뜬 알림"으로 읽히게 한다(반투명 그대로면 뒤 카드 글자와 겹쳐 지저분하다).
  insightFloating: {
    marginTop: 0,
    backgroundColor: 'rgba(28,30,42,0.96)',
    borderColor: 'rgba(129,140,248,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  sleepInsightBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // 2026-07-27 사용자 지적 — 타이틀/카드는 전부 24px 인셋인데 이 배너와 아래 두 섹션 라벨만
    // 28px이라 좌우 끝이 안 맞았다. 24로 통일.
    marginHorizontal: 24,
    marginTop: spacing.sm,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: 'rgba(129,140,248,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.25)',
  },
  sleepInsightBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  // 2026-08-01 — 접근성 꺼짐은 세션 추적 전체가 죽는 하드 블로커라 인사이트/배터리 배너의 보라색
  // 톤과 구분되게 경고색(amber)으로 눈에 띄게 한다.
  accessibilityBanner: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)' },
  accessibilityBadge: { backgroundColor: colors.warning },
  // 🔴 2026-08-15 — 선물이 걸린 날의 배지. 이모지는 그 자체로 색이 있어 보라색 원 위에 얹으면
  // 탁해 보이므로, 배경을 투명하게 비우고 이모지만 보이게 한다.
  sleepInsightBadgeGift: { backgroundColor: 'transparent' },
  sleepInsightBadgeText: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },
  sleepInsightText: { flex: 1, fontSize: 13, color: colors.textPrimary, fontFamily: typography.bodyFontFamilyBold },
  sleepInsightDismiss: { fontSize: 14, color: colors.textTertiary, paddingHorizontal: 6, paddingVertical: 2 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginTop: spacing.lg, marginBottom: 12 },
  // 2026-07-27 사용자 지적 — Settings의 섹션 라벨(sectionLabel)은 12px인데 이건 10px로 남아있어서
  // 화면마다 라벨 크기가 달랐다(공용 스타일이 아니라 화면별 로컬 StyleSheet라 이렇게 드리프트됨).
  sectionTitle: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase' },
  quickControlsTitle: { paddingHorizontal: 24, marginTop: spacing.lg, marginBottom: 10 },
  tapBadge: { backgroundColor: `${colors.primary}1A`, borderWidth: 1, borderColor: `${colors.primary}33`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tapBadgeText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, letterSpacing: 0.5, textTransform: 'uppercase' },
  platformStack: { paddingHorizontal: 24, gap: 12 },
});
