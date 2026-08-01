import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUserStore } from '../../store/useUserStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useShortsQueueStore } from '../../store/useShortsQueueStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useAttendanceStore } from '../../store/useAttendanceStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useLimitHitStore } from '../../store/useLimitHitStore';
import { getTodaysInsightMessage } from '../../services/usageInsight';
import { useToastStore } from '../../store/useToastStore';
import { backfillSleepFromHistory } from '../../services/sleepBackfill';
import { useFlipStore } from '../../store/useFlipStore';
import { AppHeader } from '../../components/ui/AppHeader';
import { SessionHeroCard } from '../../components/home/SessionHeroCard';
import { PlatformPickerCard } from '../../components/home/PlatformPickerCard';
import { QuickControlsGrid } from '../../components/home/QuickControlsGrid';
import { BluetoothOnboardingSheet } from '../../components/home/BluetoothOnboardingSheet';
import { ConnectingOverlay } from '../../components/home/ConnectingOverlay';
import { LimitReachedOverlay } from '../../components/home/LimitReachedOverlay';
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
  const hitCount = useLimitHitStore((s) => s.hitCount);
  const dismissedHitCount = useLimitHitStore((s) => s.dismissedHitCount);
  const loadLimitHits = useLimitHitStore((s) => s.load);
  const ensureLimitHitAtLeast = useLimitHitStore((s) => s.ensureAtLeast);
  const dismissLimitHit = useLimitHitStore((s) => s.dismiss);
  const celebrationVisible = useAttendanceStore((s) => s.celebrationVisible);
  // 2026-07-29 사장님 지시 — "몇시에 잠들었어요" 고정 배너를 "매일 하나의 랜덤 인사이트(사용 습관/
  // 신조어/힐링 문구/명언)" 선물상자로 확장. 뜨는 조건도 수면 감지와 무관하게 하루 1회로 바뀌었으므로
  // useSleepInsightStore(수면 감지 전용)는 더 이상 이 배너에 쓰지 않는다. 노티(maybeShowUsageInsight)와
  // 같은 "오늘의 뽑기"를 공유(usageInsight.ts의 날짜 캐시) — 세션당이 아니라 캘린더 날짜 기준이라
  // 앱을 여러 번 재시작해도 같은 날엔 같은 문구, 노티와 배너가 서로 다른 문구를 보여주지 않는다.
  const [todaysInsight, setTodaysInsight] = useState<string | null>(null);
  const [pendingPlatform, setPendingPlatform] = useState<AppShieldTarget | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<AppShieldTarget | null>(null);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);
  // 2026-07-22 — 예전엔 "한 번 닫으면 오늘 하루 끝"인 단일 boolean이었는데, 3단계 시스템에선 3차
  // 토스트가 5분마다 계속 다시 떠야 한다(그래야 "완화된 반복 알림"이 됨). dismissedHitCount로
  // "이 hitCount는 이미 보여준 적 있다"만 기록 — hitCount가 다음 5분 임계값으로 올라가면 그 값보다
  // 커지므로 자동으로 다시 보인다. Extend Time으로 한도가 올라가 isLimitReached가 false가 되면
  // hitCount 자체가 다음 로직에서 0으로 안 내려가지만(오늘 누적 기록이라 정직하게 유지), 어차피
  // isLimitReached가 false면 visible 조건 자체가 꺼진다.
  // 2026-07-31 — dismissedHitCount는 이제 useLimitHitStore에서 날짜 스코프로 영속화된 값을 그대로
  // 구독한다(위 destructure) — 로컬 useState였을 땐 앱을 완전히 재시작할 때마다 0으로 리셋돼서,
  // 오늘 이미 닫은 한도도달 팝업이 세션을 시작하지도 않았는데 재실행마다 다시 떴다.
  const [showFocusSessionExtend, setShowFocusSessionExtend] = useState(false);

  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const isLimitReached = todayUsageMinutes >= effectiveDailyLimitMinutes;
  useEffect(() => {
    loadLimitHits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⚡ 쇼츠 큐를 홈 진입 시 미리 받아둔다(사용자가 홈 보는 동안 Vercel 콜드스타트+스크래핑이 끝남)
  // → 피드 열면 "쇼츠 불러오는 중" 5초 대기 없이 즉시 첫 영상. loadInitial은 큐가 이미 있으면 no-op이라
  // 피드의 중복 호출과 안전하게 공존. iOS 전용 기능이라 iOS에서만.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    useShortsQueueStore.getState().loadInitial().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-07-26 사용자 지시(Focus Session/연속 시청 통합 결정) — 무료 Focus Session이 시간(10분) 만료로
  // 자동 종료됐을 때(사용자가 직접 끈 게 아니라) 광고/크레딧 연장 모달을 띄운다. YouTube가 전면에
  // 있는 동안 Home의 JS는 백그라운드 throttle로 죽어있을 수 있어, 네이티브가 이미 판단해둔 "시간
  // 만료" 신호를 Pace가 다시 포그라운드로 돌아올 때마다(AppState 'active') 1회성으로 소비 확인한다
  // (overlay/index.tsx의 consumeExpired/consumeAccessibilityRevoked와 동일 패턴). 프리미엄은 free
  // duration 고정 자체가 적용 안 되므로(enforceFreeFocusSessionDuration) 이 신호가 발생할 일이 없지만
  // 방어적으로 한 번 더 확인한다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const checkTimedOut = () => {
      if (useSubscriptionStore.getState().isPremium) return;
      bluetoothService.consumeFocusSessionTimedOut().then((timedOut) => {
        if (timedOut) setShowFocusSessionExtend(true);
      }).catch(() => {});
    };
    checkTimedOut();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkTimedOut();
    });
    return () => sub.remove();
  }, []);

  // 2026-07-22 사용자 지시 — 한도 도달 알림 3단계화. 한도를 넘긴 뒤 5분 단위로 "몇 번째 도달인지"
  // 계산(정확히 한도=1차, +5분=2차, +10분 이상=3차 이상)해서 useLimitHitStore를 그 값까지 따라잡게
  // 하고, 그 값(tier로 clamp)에 맞는 다이얼로그/토스트를 렌더한다.
  const minutesOverLimit = Math.max(0, todayUsageMinutes - effectiveDailyLimitMinutes);
  const currentHitThreshold = isLimitReached ? Math.floor(minutesOverLimit / 5) + 1 : 0;
  useEffect(() => {
    if (currentHitThreshold > 0) ensureLimitHitAtLeast(currentHitThreshold);
  }, [currentHitThreshold, ensureLimitHitAtLeast]);
  const limitTier: 1 | 2 | 3 = hitCount <= 1 ? 1 : hitCount === 2 ? 2 : 3;
  // 2026-07-31 — celebrationVisible(출석 축하 팝업) 떠 있는 동안은 렌더 미룸(동시에 두 팝업이
  // 겹쳐 보이던 문제, §6 로그 참고).
  const showLimitReached = isLimitReached && hitCount > dismissedHitCount && activeSessionPlatform === null && pendingPlatform === null && connectingPlatform === null && !celebrationVisible;

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
          getTodaysInsightMessage(uid).then(setTodaysInsight).catch(() => {});
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
      }
    }, [user?.id, refresh, refreshBluetooth])
  );

  const dismissBatteryPrompt = useCallback(() => {
    setShowBatteryPrompt(false);
    AsyncStorage.setItem(STORAGE_KEYS.batteryOptimizationPromptSeen, 'true').catch(() => {});
  }, []);
  const acceptBatteryPrompt = useCallback(() => {
    overlayService.requestBatteryOptimizationExemption();
    dismissBatteryPrompt();
  }, [dismissBatteryPrompt]);

  // 2026-07-29 사장님 지시("가끔 연속으로 오면 크레딧도 선물박스 누르면 주고") — 인사이트 배너를
  // 탭하면 가끔(30% 확률) 보너스 크레딧이 터지는 선물상자로. 하루 한 번만 보상 판정(파밍 방지) —
  // 이미 오늘 시도했으면 그냥 닫기만 한다. 매번 확실히 주면 "선물"이 아니라 "기능"이 되어버려서
  // 확률로 둔다(예상 못한 즐거움 원칙).
  const onTapInsightGift = useCallback(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      const claimed = await AsyncStorage.getItem(STORAGE_KEYS.insightGiftClaimedDate);
      if (claimed !== todayStr && Math.random() < 0.3) {
        const bonus = Math.random() < 0.5 ? 5 : 10;
        await addBonusMinutes(bonus);
        await AsyncStorage.setItem(STORAGE_KEYS.insightGiftClaimedDate, todayStr);
        useToastStore.getState().show(t('home.insightGiftReward', { n: bonus }));
      }
    } catch {
      // 조용히 무시 — 부가 기능
    }
    setTodaysInsight(null);
  }, [addBonusMinutes, t]);

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
    const remainingMinutes = Math.max(0, settings.dailyLimitMinutes + bonusMinutes - todayUsageMinutes);
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
    if (Platform.OS === 'ios') { router.push('/feed'); return; }
    router.push({ pathname: '/overlay', params: { platform } });
  }, [connectingPlatform, router]);


  const onSelectPlatform = useCallback((platform: AppShieldTarget) => {
    // 2026-07-27 사용자 지적("이게 쇼츠를 막으란거였어?") — LimitReachedOverlay 설계 의도(tier 3+는
    // "차단 아님, 그냥 알려주기만")와 이 게이트가 모순돼 있었다: tier와 무관하게 isLimitReached이기만
    // 하면 무조건 새 세션 시작 자체를 막아버려서, 3차 이상 도달한 뒤엔 안내 토스트만 뜨고 실제로는
    // 계속 볼 방법이 없었다. 사용자 확인 — tier 1/2(정확히 도달~+5분)는 그대로 마찰(다이얼로그로
    // "여기까지"를 명시적으로 고르게)을 유지하고, tier 3+(그 이상)부터는 안내만 하고 새 세션 시작을
    // 허용한다.
    if (isLimitReached && limitTier < 3) {
      dismissLimitHit(0);
      return;
    }
    // 감사 HIGH2(2026-07-27, Mac→Windows 인계) — 세션이 이미 running인데 카드를 또 탭하면(keepAlive
    // 리다이렉트로 Home에 돌아온 뒤 재탭 등) startSession이 새 viewing_sessions 행을 또 만들어, 나중에
    // 둘 다 같은 종료시각으로 닫히며 겹치는 구간이 이중집계됐다. 이미 running이면 새 세션/네이티브
    // 서비스를 다시 시작하지 않고 해당 앱만 전면으로 다시 띄운다(세션·오버레이는 그대로 유지).
    // 2026-08-01 사용자 지적("작아진 화면 다시 키워야지 왜 새 쇼츠가 보여") — 여기서도
    // launchPlatformApp을 썼었는데, 그 함수는 매번 "새 Shorts 진입" URL을 열어서 PIP로 줄어있던
    // 기존 화면 대신 새 피드가 열렸다. 재소환 전용 resumePlatformApp(순수 스킴, 특정 화면 강제 없음)
    // 으로 교체 — supportedApps.ts 주석 참고.
    if (useSessionStore.getState().status === 'running') {
      resumePlatformApp(platform).catch(() => {});
      return;
    }
    AsyncStorage.getItem(STORAGE_KEYS.bluetoothOnboardingSeen).then((seen) => {
      if (seen) {
        startSession(platform);
      } else {
        setPendingPlatform(platform);
      }
    }).catch(() => startSession(platform));
  }, [startSession, isLimitReached, limitTier, dismissLimitHit]);

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
  const connectingCard = connectingPlatform ? { title: 'Shorts with PACE' } : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />

        {todaysInsight && (
          <Pressable style={styles.sleepInsightBanner} onPress={onTapInsightGift}>
            {/* 2026-07-28 사장님 지시("아이콘 촌스럽잖아, 원에 PACE 아이콘 넣던가") — 작은 크기로
                회전된 폰 사진은 지저분해 보여서, 브랜드 색 원형 배지 + P 모노그램으로 교체.
                2026-07-29 — 이 박스 자체가 이제 "선물상자"라 탭하면 가끔 보너스 크레딧이 나온다. */}
            <View style={styles.sleepInsightBadge}>
              <Text style={styles.sleepInsightBadgeText}>P</Text>
            </View>
            <Text style={styles.sleepInsightText}>{todaysInsight}</Text>
            <Text style={styles.sleepInsightDismiss} onPress={onTapInsightGift}>✕</Text>
          </Pressable>
        )}

        {showBatteryPrompt && (
          <Pressable style={styles.sleepInsightBanner} onPress={acceptBatteryPrompt}>
            <Text style={styles.sleepInsightIcon}>🔋</Text>
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
        </View>

        <Text style={[styles.sectionTitle, styles.quickControlsTitle]}>{t('home.quickControls')}</Text>
        <QuickControlsGrid />
      </ScrollView>

      <BluetoothOnboardingSheet
        visible={pendingPlatform !== null}
        onEnable={() => dismissOnboarding(true)}
        onDismiss={() => dismissOnboarding(false)}
      />

      <ConnectingOverlay
        visible={connectingPlatform !== null}
        platformName={connectingPlatform ? 'YouTube' : ''}
        platformFullTitle={connectingCard?.title ?? ''}
        onComplete={handleConnectingComplete}
      />

      <LimitReachedOverlay
        visible={showLimitReached}
        tier={limitTier}
        hitCount={hitCount}
        limitMinutes={effectiveDailyLimitMinutes}
        todayUsageMinutes={todayUsageMinutes}
        // 2026-07-31 사용자 지적("5분더는 쇼츠를 보겠다는건데 종료해버리는지 확인해") — 예전엔 보너스
        // 분만 더해주고 팝업만 닫아서, "+5분 더 보기"를 눌러도 실제로는 Home에 그대로 남아 사용자가
        // 플랫폼 카드를 다시 탭해야 했다(연장의 의도와 정반대 경험). 마지막으로 보던 플랫폼을
        // lastPlatformRef로 기억해뒀다가, 연장 시 그 플랫폼으로 즉시 재진입시킨다.
        onExtend={() => {
          addBonusMinutes(5);
          dismissLimitHit(hitCount);
          const p = lastPlatformRef.current;
          if (p === 'youtube' || p === 'instagram' || p === 'tiktok') onSelectPlatform(p);
        }}
        onDismiss={() => dismissLimitHit(hitCount)}
      />

      <FocusSessionExtendModal
        visible={showFocusSessionExtend && !celebrationVisible}
        onDismiss={() => setShowFocusSessionExtend(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {},
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
  sleepInsightIcon: { fontSize: 18 },
  sleepInsightBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
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
