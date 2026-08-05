import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { YouTubeShortsPlayer, SWIPE_NAV, type ShortsPlayerHandle } from '../../components/feed/YouTubeShortsPlayer';
import { useShortsQueueStore } from '../../store/useShortsQueueStore';
import { useToastStore } from '../../store/useToastStore';
import { useFeedRemoteControl } from '../../hooks/useFeedRemoteControl';
import { useVolumeNext } from '../../hooks/useVolumeNext';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { useSleepGuard } from '../../hooks/useSleepGuard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { hasRealYouTubeSource } from '../../services/api/youtube';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useFlipStore } from '../../store/useFlipStore';
import { useUserStore } from '../../store/useUserStore';
import { startSession, endSession } from '../../database/repositories/sessionsRepository';
import { notifyLowTime, notifyLimitReached, notifyBreakReminder } from '../../services/notifications';
import type { SessionEndStatus } from '../../types/models';
import { overlayService } from '../../services/platform';
import { PaceMenu } from '../../components/overlays/PaceMenu';
import { SavedVideoListOverlay } from '../../components/overlays/SavedVideoListOverlay';
import { ShortsHotOverlay } from '../../components/overlays/ShortsHotOverlay';
import { FocusSessionExtendModal } from '../../components/home/FocusSessionExtendModal';
import { SleepPromptModal } from '../../components/feed/SleepPromptModal';
import { YouTubeLoginSheet } from '../../components/feed/YouTubeLoginSheet';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { addSavedVideo, type SavedVideoKind } from '../../database/repositories/savedVideosRepository';
import { colors, radius, spacing, typography } from '../../constants/theme';

// iOS Pace Feed = YouTube Shorts "리스트 순차 재생"(2026-07-18 사용자 지시).
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의" 참고 — 큐에서 1 재생, 끝나면(onEnded) advance()로 다음.
// 재생은 공식 IFrame Player(합법). Pexels Pace Feed(usePlayerStore)는 코드베이스에 폴백 소스로 유지.
//
// 2026-07-19: Bluetooth(AirPods) 리모컨 상태 머신 도입(사용자 지시, 상태 전이표 정리 반영).
// PlayerStatus: IDLE(로딩 전) → READY(재생 대기) → PLAYING(시청 중) ↔ PAUSED.
// isAutoMode: 리모컨 Play/Pause로 토글하는 "손 안 대고 정주행" 스위치 — true면 영상이 끝나자마자
// advance()로 다음, false면 끝난 자리에서 멈추고(PAUSED) 사용자가 Next를 눌러야 넘어간다. 리모컨
// Next/Previous는 이 스위치와 무관하게 항상 즉시 이동(상태 전이표 규칙 A/B).
type PlayerStatus = 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED';

// 하루 한도 도달 후 다음 안내까지의 간격(분). 안드로이드 네이티브의 EXTEND_MINUTES(=5)와 반드시
// 같은 값이어야 두 플랫폼의 안내 주기가 어긋나지 않는다(PaceOverlayService.EXTEND_MINUTES 참고).
const LIMIT_NOTICE_INTERVAL_MINUTES = 5;

// 2026-08-01 사장님 지적 — Focus Session ON일 때 남은시간이 피드에 안 보였다(예전에 시계 리렌더가
// 영상 "씹힘"을 유발해 통째로 제거됨). 부모(피드/WebView)를 리렌더하지 않도록 자체 타이머를 가진
// 격리 컴포넌트로 남은시간만 갱신한다 — 이 컴포넌트가 tick할 때 이 텍스트만 리렌더되고 WebView는 무관.
function SessionRemaining({ endsAt }: { endsAt: number }) {
  const calc = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 60000));
  const [min, setMin] = useState(calc);
  useEffect(() => {
    setMin(calc());
    const id = setInterval(() => setMin(calc()), 15000); // 15s — 분 단위 표시엔 충분, 배터리/리렌더 최소
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return <Text style={styles.sessionRemainingText}>{min}m</Text>;
}

// 2026-08-02 사장님 지적("한도 시간은 표시 안 하잖아") — Android 배지는 "40m left"로 하루 한도
// 남은 시간을 보여주는데 iOS 피드엔 Focus Session 남은시간만 있고 하루 한도 잔여가 없었다. 하루
// 한도(설정+보너스) − 오늘 사용 = 남은 분을 상단에 항상 표시한다. 스토어를 이 컴포넌트가 직접
// 구독해 격리(부모 피드 리렌더 없음 → WebView 씹힘 방지, SessionRemaining과 동일 패턴).
function DailyRemaining() {
  const used = useStatsStore((s) => s.todayUsageMinutes);
  const limit = useSettingsStore((s) => s.settings.dailyLimitMinutes);
  const bonus = useDailyBonusStore((s) => s.extraMinutes);
  const left = Math.max(0, limit + bonus - used);
  return <Text style={styles.dailyRemainingText}>{left}m left</Text>;
}

export default function PaceFeedScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  // fullScreenModal 프레젠테이션에선 SafeAreaView의 top edge가 0으로 잡혀 상단바가 시스템 상태바와
  // 겹친다(overlay/index.tsx와 동일 이슈) → useSafeAreaInsets로 명시 보정, 0이면 47로 폴백.
  const insets = useSafeAreaInsets();
  const queue = useShortsQueueStore((s) => s.queue);
  const isLoading = useShortsQueueStore((s) => s.isLoading);
  const isRefilling = useShortsQueueStore((s) => s.isRefilling);
  const error = useShortsQueueStore((s) => s.error);
  const loadInitial = useShortsQueueStore((s) => s.loadInitial);
  const advance = useShortsQueueStore((s) => s.advance);
  const goToPrevious = useShortsQueueStore((s) => s.goToPrevious);
  const focusSessionDurationMinutes = useSettingsStore((s) => s.settings.focusSessionDurationMinutes);
  const dailyLimitMinutes = useSettingsStore((s) => s.settings.dailyLimitMinutes);
  const sleepTimerMinutes = useSettingsStore((s) => s.settings.sleepTimerMinutes); // iOS 슬립 타이머(안드 parity)
  const sleepStillnessMinutes = useSettingsStore((s) => s.settings.sleepStillnessMinutes); // 수면감지 임계(안드 parity, D8)
  const breakIntervalMinutes = useSettingsStore((s) => s.settings.breakIntervalMinutes); // 브레이크 리마인더(안드 parity)
  const volumeKeyRemote = useSettingsStore((s) => s.settings.volumeKeyRemote); // BT 볼륨키 토글(opt-in, 기본 OFF)
  const handsFreeGesture = useSettingsStore((s) => s.settings.handsFreeGesture); // 손짓 토글(opt-in, 기본 OFF, 2026-08-01)
  const todayUsageMinutes = useStatsStore((s) => s.todayUsageMinutes); // 세션 시작 전 오늘 사용시간(일일한도 계산)
  const bonusMinutes = useDailyBonusStore((s) => s.extraMinutes); // 오늘 보너스(광고/크레딧 연장분)
  const [status, setStatus] = useState<PlayerStatus>('IDLE');
  const [isAutoMode, setIsAutoMode] = useState(false);
  // 2026-08-01 성능 감사 — diag 상태는 렌더에서 전혀 안 쓰였는데(오버레이 미표시) onDiag/onAudioDiag가
  // dev에서 초당 ~3회 setDiag로 피드(WebView 서브트리 포함)를 리렌더시켜 dev 손짓 테스트를 흐렸다.
  // 죽은 상태라 제거 — 온디바이스 진단은 PaceGestureLog.nativeLog(리렌더 무관)가 담당.
  // 시간 상태바(스펙 §1-E.3) — 몰입형 웹뷰에선 시간 감각을 잃기 쉬워 벽시계 + (Focus Session 중이면)
  // 남은 시간을 상단에 순수 JS로 노출. ⚠️ 감사 발견: iOS는 useTimerStore(오버레이 전용)가 절대 시작되지
  // 않아 남은시간이 죽은 값이었다 → 피드 자체 Focus Session(isAutoMode)의 종료시각에 바인딩한다.
  const [sessionEndsAt, setSessionEndsAt] = useState<number | null>(null);
  // 2026-08-01 자율세션(Android 8468a82 matching) — 무료 세션이 "타임아웃으로" 꺼졌는지(수동 off 아님)
  // 추적. 타임아웃 후 재활성화 시도 시 비프리미엄이면 무료 재개 대신 보상광고 연장 모달로 보낸다.
  const sessionTimedOutRef = useRef(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  // 광고가 화면을 덮는 동안 재생을 멈췄다가 되돌리기 위해 직전 상태를 기억한다
  // (FocusSessionExtendModal의 onAdVisibilityChange 주석 참고 — 광고는 앱을 백그라운드로
  //  보내지 않아서 AppState 기반 일시정지가 안 걸린다).
  const statusBeforeAdRef = useRef<PlayerStatus>('PLAYING');
  // 2026-08-01 사장님 지적("Shorts HOT/Favorite 누르면 우리 앱에서 열려야지 사파리로 열지 마") — 이 값이
  // 설정되면 플레이어를 그 videoId로 리마운트(key 변경)해 앱 내 피드에서 재생하고, 이후 YouTube 네이티브
  // 스와이프로 이어진다(Safari로 안 튕김). 스와이프 모드는 firstVideoIdRef에 첫 영상을 핀하므로 key 교체로
  // 리마운트해야 새 영상이 로드된다.
  const [forcedVideoId, setForcedVideoId] = useState<string | null>(null);
  // 2026-08-01 사장님 지시("쇼츠 리스트에서 유머 카테고리를 골랐다는 건 그 카테고리만 보고 싶다는 거 —
  // 우리 리스트를 이어서 보여주고, 보여줄 게 없으면 그때 유튜브 앱 순서로") — HOT/Favorite에서 항목을
  // 탭하면 그 리스트(카테고리) 순서대로 이어서 재생한다. forcedListRef가 있으면 goNext/goPrev가 유튜브
  // 네이티브 스와이프 대신 이 리스트의 다음/이전 videoId로 리마운트하고, 리스트를 다 소진하면 그때
  // forcedListRef를 비워 마지막 영상에서 유튜브 네이티브 피드로 이어간다. (리스트 재생은 항목마다
  // 리로드=리마운트라 전환에 로딩 커버가 잠깐 뜨지만, "카테고리만 보고 싶다"는 의도가 매끈함보다 우선.)
  const forcedListRef = useRef<string[] | null>(null);
  const forcedIndexRef = useRef(0);
  // 2026-08-05 — 위 ref를 그대로 플레이어에 내려줄 수 없어(ref 변경은 리렌더를 안 일으킴) 같은 값을 state로
  // 미러링한다. 이 값이 WebView의 window.__paceListMode가 되어, 손가락 스와이프를 WebView가 직접 처리할지
  // (유튜브 피드) 부모에 위임할지(리스트 다음 항목 리마운트) 가른다. ⚠️ forcedListRef를 바꾸는 곳은
  // 반드시 이 setter도 같이 호출해야 한다(현재 4곳: playInFeed 2분기, goNext 리스트소진, onNotShorts).
  const [listMode, setListMode] = useState(false);
  const playInFeed = (videoId: string, playlist?: string[]) => {
    markUserInput();
    if (playlist && playlist.length > 0) {
      forcedListRef.current = playlist;
      forcedIndexRef.current = Math.max(0, playlist.indexOf(videoId));
      setListMode(true);
    } else {
      forcedListRef.current = null;
      forcedIndexRef.current = 0;
      setListMode(false);
    }
    setForcedVideoId(videoId);
    setStatus('PLAYING');
  };
  const isFaceDown = useFlipStore((s) => s.isFaceDown); // Flip Mode — 엎어놓으면 영상 정지(슬립 유도)
  const [sleepBlackout, setSleepBlackout] = useState(false); // 취침 감지(§4-B) → 검은 풀스크린
  // Hard Block Mode(설정, 기본 OFF) — 하루 한도 도달 시 안내 대신 실제로 멈춘다(안드로이드 parity).
  const hardBlockMode = useSettingsStore((s) => s.settings.hardBlockMode);
  const [limitBlocked, setLimitBlocked] = useState(false);
  const userId = useUserStore((s) => s.user?.id);
  // 2026-08-01 사장님 지적 — 피드(웹뷰) P 버튼이 홈 이동만 하고 P 메뉴를 안 띄웠다. overlay/index.tsx와
  // 동일하게 공용 PaceMenu(앱으로/Shorts HOT/Saved/Favorite) + SavedVideoListOverlay를 그대로 재사용.
  const [showPaceMenu, setShowPaceMenu] = useState(false);
  const [activeSavedList, setActiveSavedList] = useState<SavedVideoKind | null>(null);
  const [showShortsHot, setShowShortsHot] = useState(false);
  // 유튜브 로그인 시트(iOS 전용) — 로그인에 성공하면 새 쿠키로 다시 붙어야 하므로 플레이어를 리마운트한다.
  // ytSessionNonce를 플레이어 key에 섞어, 로그인 전/후가 같은 영상이어도 WebView가 확실히 새로 뜬다.
  const [showYtLogin, setShowYtLogin] = useState(false);
  const [ytSessionNonce, setYtSessionNonce] = useState(0);
  // 스와이프 모드에서 플레이어가 보고하는 실제 재생 중 videoId(현재 영상 즐겨찾기 추가용). current.videoId는
  // 스와이프 모드에선 첫 영상에 고정이라 실제 영상과 다를 수 있어, 플레이어 onVideoChange 보고값을 우선한다.
  const currentVideoIdRef = useRef<string | null>(null);
  // 현재 "활성 시청 세그먼트" 시작 시각. null이면 카운트 안 함(백그라운드/flush 직후). 사용시간 측정용.
  const watchSegmentStartRef = useRef<number | null>(Date.now());
  // 감사 MED3 — 일일한도 tick의 누적 분/브레이크 카운트다운. 예전엔 effect 지역 let이라 playing/설정 변경으로
  // effect가 재생성될 때(정지·엎어놓기 등)마다 0으로 리셋돼 누적 시청분이 유실됐다(한도 도달이 무한 지연).
  // ref로 옮겨 effect 재생성에도 살아남게 한다(피드 이탈=언마운트 시에만 자연 리셋 — 피드 방문당 누적이 목적).
  const watchedMinRef = useRef(0);
  const nextBreakInRef = useRef(0);
  // 하루 한도 비차단 안내(2026-08-05 B안) — 안드로이드 네이티브와 같은 규칙으로 맞춘 값들.
  // limitGraceRef: 한도에 닿을 때마다 5분씩 얹어 다음 안내까지의 간격을 만든다(네이티브의
  //   `remainingMinutes += EXTEND_MINUTES`와 동일 역할). 이게 없으면 매 분 토스트가 뜬다.
  // limitHitCountRef: 몇 번째 도달인지 — 알림 1회 제한과 4종 문구 순환에 쓴다.
  const limitGraceRef = useRef(0);
  const limitHitCountRef = useRef(0);
  const current = queue[0] ?? null;
  const usingScrape = !hasRealYouTubeSource();
  // 2026-07-21: current가 생기는 순간부터 play=true로 마운트해야 라이브러리가 loadVideoById(autoplay)
  // 경로를 타 무음 자동재생이 걸릴 여지가 생긴다(status IDLE→READY 레이스로 첫 렌더가 play=false면
  // cueVideoById로 붙어 자동재생이 아예 안 걸림). PAUSED일 때만 멈춘다.
  const playing = current != null && status !== 'PAUSED';

  // 엎어놓으면(쉬는 시간 시작) 영상을 멈춘다 — WKWebView가 재생 중이면 화면 wake-lock을 잡아 안 그러면
  // 폰이 슬립에 못 든다. 정지 → 화면 꺼짐 허용 → 폰 자동잠금(스펙 §4-B "내려놓으면 쇼츠 멈춤" 방향).
  // 집어들 때 자동 재생하진 않는다(쉼 존중 — 사용자가 탭/리모컨으로 재개).
  useEffect(() => {
    if (isFaceDown) setStatus('PAUSED');
  }, [isFaceDown]);

  // iOS 사용시간 측정(2026-07-26) — 안드로이드는 /overlay 세션이 시청 시간을 viewing_sessions에
  // 기록하지만 iOS는 그동안 수면 감지 때만 기록해 정상 시청 시간이 todayUsageMinutes/일일한도에 전혀
  // 안 잡히는 갭이 있었다. 이제 "피드가 포그라운드로 열려 있던 시간"을 세그먼트로 재서 이탈(언마운트)·
  // 백그라운드 전환·수면 감지 때 flush한다(안드 오버레이 세션 지속시간 기록과 동일 개념). 백그라운드
  // 시간은 세그먼트를 끊어(null) 제외하고, flush마다 세그먼트를 닫아 이중 집계를 막는다.
  // endedAtMs: sleep_detected일 때 "실제 잠든 시각(=마지막 움직인 시각)"을 넘겨 DB ended_at을 그 시각으로
  // 정확히 기록(안드로이드 markExpired의 PREF_SLEEP_ONSET_AT_MS와 동일 개념). 없으면 지금(now)으로 기록.
  const flushWatchTime = (status: SessionEndStatus, endedAtMs?: number) => {
    const startedAt = watchSegmentStartRef.current;
    watchSegmentStartRef.current = null; // 세그먼트 종료 — 재개(active 복귀) 전까지 카운트 안 함
    if (startedAt == null) return;
    const uid = useUserStore.getState().user?.id;
    const endMs = endedAtMs ?? Date.now();
    const durationSeconds = Math.max(0, Math.round((endMs - startedAt) / 1000)); // 잠든 시각까지의 실제 시청시간
    if (!uid || durationSeconds < 3) return; // 3초 미만(즉시 이탈/오탐)은 무시
    // MEDIUM 4 수정 — 실제 세그먼트 시작·종료 시각을 그대로 기록해 started_at ≤ ended_at 보장 +
    // duration_seconds == (ended_at − started_at) 정합. sleep_detected 역전행/자정 오귀속 해소.
    startSession(uid, 'youtube', new Date(startedAt).toISOString())
      .then((id) => endSession(id, durationSeconds, 0, status, new Date(endMs).toISOString()))
      .catch(() => {});
  };

  // 취침 감지 강제 종료(스펙 §4-B) — 피드 시청 중 잠들면(무진동 지속, 이어폰 탈착 시 단축) 영상을 멈추고
  // 검은 풀스크린으로 덮어 밤새 재생을 막는다. iOS는 화면을 강제로 잠글 API가 없어(스펙 문서화) 영상
  // 정지 + WebView를 가리는 블랙아웃이 실질적 최선. DB엔 sleep_detected로 기록(홈 "…에 잠드셨습니다" 인사이트).
  // sleepOnsetAtMs = useSleepGuard가 계산한 "실제 잠든 시각(마지막 움직인 시각)". 그 시각으로 종료 기록.
  const onSleepDetected = (sleepOnsetAtMs?: number) => {
    setStatus('PAUSED');
    setSleepBlackout(true);
    flushWatchTime('sleep_detected', sleepOnsetAtMs); // 잠든 실제 시각까지의 시청시간+ended_at 기록
  };
  // 영상이 실제 재생 중이고 아직 블랙아웃 전일 때만 감지. stillnessMinutes=설정값(안드 parity, D8 프리미엄 조절).
  // markSleepActivity/isSleepPrompted = 2단계 상태기계(안드 evaluateSleepStages 패리티, 2026-08-04) —
  // 아래 markUserInput()이 실제 사용자 입력마다 같이 호출해 무입력 시계를 리셋한다.
  const { markActivity: markSleepActivity, isSleepPrompted } = useSleepGuard({ enabled: playing && !sleepBlackout, onSleep: onSleepDetected, stillnessMinutes: sleepStillnessMinutes });

  // 2026-07-27 iOS 수면감지 필수 전제 — 잠들면 화면을 안 만져서 iOS가 자동으로 화면을 끈다. 그러면
  // AppState가 'active'가 아니게 돼 useSleepGuard의 무진동 tick이 그 훅 L54 가드에서 멈춰, 취침을 영영
  // 못 잡았다(사용자 "몇시에 잤는지 안 뜸"의 실제 원인 — expo-keep-awake 미설치라 화면유지가 아예 없었음).
  // 안드로이드는 네이티브 포그라운드 서비스라 화면 꺼져도 감지되지만 iOS는 CMMotionManager가 백그라운드에서
  // 못 돌므로, 피드 재생 중엔 화면을 켜둬야 "켜둔 채 잠든 영상"을 감지→종료→잔 시각 기록할 수 있다(이
  // 기능의 원래 의도와 일치). 정지/블랙아웃(수면감지·슬립타이머 발동)되면 즉시 해제해 배터리 낭비를 막는다.
  useEffect(() => {
    if (!playing || sleepBlackout) return;
    activateKeepAwakeAsync('pace-feed').catch(() => {});
    return () => { deactivateKeepAwake('pace-feed').catch(() => {}); };
  }, [playing, sleepBlackout]);

  // iOS 슬립 타이머(2026-07-27, 안드로이드 parity) — 안드로이드는 오버레이 서비스가 "N분 재생 후 자동
  // 정지"하는데 iOS엔 그 타이머가 없었다(sleepTimerMinutes를 무시). 수면감지(무진동)와 별개로, 사용자가
  // 설정한 sleepTimerMinutes가 지나면 무조건 정지+블랙아웃해 밤새 재생을 막는다. 정지 메커니즘은 수면감지와
  // 동일(onSleepDetected 재사용). 재생 중일 때만 타이머를 돌리고, 정지/블랙아웃/설정 OFF면 끈다. 영상
  // 넘김(advance)엔 playing이 안 바뀌어 타이머가 리셋되지 않는다(=세션 누적 시간 기준).
  useEffect(() => {
    if (!playing || sleepBlackout || !sleepTimerMinutes || sleepTimerMinutes <= 0) return;
    const id = setTimeout(() => {
      // 슬립 타이머 만료 = 사용자가 설정한 카운트다운(수면감지와 다른 별개 사유) → 'sleep_timer_expired'로 기록.
      setStatus('PAUSED');
      setSleepBlackout(true);
      flushWatchTime('sleep_timer_expired');
    }, sleepTimerMinutes * 60 * 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sleepBlackout, sleepTimerMinutes]);

  // ── iOS 피드 세션 tick (안드로이드 overlay/index.tsx의 60초 tick과 동등, 2026-07-27 패리티 감사 반영) ──
  // Screen Time 삭제 후 iOS엔 "일일한도 강제 종료 / 브레이크 리마인더 / 저시간(5·1분) 알림"이 전부 빠져
  // 있었다(Home 게이트는 '시작'만 막을 뿐 진행 중 세션은 무한). 안드로이드가 네이티브 tick으로 하던 걸
  // 여기서 JS로 동일하게 한다. 재생 중일 때만 카운트, 정지/블랙아웃이면 끈다. 일일한도 도달 시 정지+홈 복귀
  // (홈의 LimitReachedOverlay가 연장 UX 담당 — 안드로이드가 세션 종료 후 한도화면 띄우는 것과 동등).
  useEffect(() => {
    if (!playing || sleepBlackout) return;
    if (nextBreakInRef.current <= 0) nextBreakInRef.current = breakIntervalMinutes; // 최초/브레이크 후 초기화
    const id = setInterval(() => {
      watchedMinRef.current += 1; // 누적 — pause/resume·설정변경으로 effect가 재생성돼도 유지(MED3)
      // 무입력 idle 하드상한 — 실제 사용자 입력이 IDLE_CAP_MINUTES분 없으면(자동넘김만 계속되면) 정지+블랙아웃.
      // ended_at은 "마지막 입력 시각"(=지금 - 상한)으로 기록 → sleep_detected와 동일한 과거-종료 처리를 재사용.
      idleMinRef.current += 1;
      if (idleMinRef.current >= IDLE_CAP_MINUTES) {
        setStatus('PAUSED');
        setSleepBlackout(true);
        flushWatchTime('sleep_detected', Date.now() - IDLE_CAP_MINUTES * 60 * 1000);
        clearInterval(id);
        return;
      }
      // 2026-08-05 사장님 결정(B안, 안드로이드와 통일) — 하루 한도는 차단하지 않는다.
      // limitGraceRef는 안드로이드 네이티브의 `remainingMinutes += EXTEND_MINUTES`와 같은 역할:
      // 한도에 닿을 때마다 5분씩 얹어서, 매 분 반복해서 안내가 뜨는 걸 막고 5분 간격으로만 알린다.
      const effectiveDailyLimit = dailyLimitMinutes + bonusMinutes + limitGraceRef.current;
      const remaining = effectiveDailyLimit - todayUsageMinutes - watchedMinRef.current;
      if (remaining === 5 || remaining === 1) notifyLowTime(remaining).catch(() => {}); // 저시간 알림
      if (breakIntervalMinutes > 0) { // 브레이크 리마인더
        nextBreakInRef.current -= 1;
        if (nextBreakInRef.current <= 0) { notifyBreakReminder().catch(() => {}); nextBreakInRef.current = breakIntervalMinutes; }
      }
      if (remaining <= 0) {
        // 예전엔 여기서 setStatus('PAUSED') + 홈으로 강제 이동이었다. 그건 안드로이드보다 오히려 더
        // 강한 개입이었고(보던 게 그냥 사라짐), 정작 연장 수단은 없었다 — 홈의 LimitReachedOverlay가
        // 2026-08-02에 제거되면서 iOS만 "튕겨나가고 끝"으로 남아 있었다.
        // 이제 안드로이드와 동일하게: 세션은 계속, 5분마다 비차단 안내만.
        limitHitCountRef.current += 1;
        limitGraceRef.current += LIMIT_NOTICE_INTERVAL_MINUTES;
        // Hard Block Mode(설정, 기본 OFF) — 안드로이드의 showBlockOverlay와 동일한 역할.
        // iOS는 다른 앱을 종료시킬 수 없으므로(안드로이드의 goHome 대응 불가), 시청이 실제로
        // 일어나는 이 피드를 전체화면으로 막고 재생을 세우는 것이 같은 기능이다.
        if (hardBlockMode) {
          notifyLimitReached().catch(() => {});
          setStatus('PAUSED');
          setLimitBlocked(true);
          flushWatchTime('daily_limit_reached');
          clearInterval(id);
          return;
        }
        // 알림은 첫 도달에만(안드로이드 performTick과 동일한 규칙) — 5분마다 반복하면 소음이다.
        if (limitHitCountRef.current === 1) notifyLimitReached().catch(() => {});
        const usageMinutes = dailyLimitMinutes + bonusMinutes + (limitHitCountRef.current - 1) * LIMIT_NOTICE_INTERVAL_MINUTES;
        // 안드로이드 showLimitNoticeToast와 같은 4종 문구를 같은 순서로 순환한다.
        const variant = ((limitHitCountRef.current - 1) % 4) + 1;
        useToastStore.getState().show(
          `${t(`limitReached.tier3Title${variant}` as TranslationKey)} ${t(`limitReached.tier3Body${variant}` as TranslationKey, {
            n: variant === 4 ? dailyLimitMinutes + bonusMinutes : usageMinutes,
          })}`
        );
      }
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sleepBlackout, dailyLimitMinutes, bonusMinutes, todayUsageMinutes, breakIntervalMinutes]);

  // 2026-07-26 사용자 지시 "안드로이드와 동일하게": 안드로이드는 Session ON일 때 감지기(스냅/손짓)를
  // 한꺼번에 켠다(PaceOverlayService.setAutoMode → start snap/handwave). iOS도 동일하게 Focus Session
  // (isAutoMode) 동안만 핸즈프리 감지를 켠다 — 이 플래그가 useFeedRemoteControl.ios의 감지 게이팅.
  // 현재 감지기는 핑거스냅(SoundAnalysis+AEC). 손짓(카메라 Vision)은 2단계로 pace-gesture에 추가 예정.
  // (고개짓 head-nod는 2026-07-23 "비현실적" 판단으로 계속 제외 — 'snap' 모드만 start.)
  //
  // 2026-07-26 사장님 결정 번복 — D9 프리미엄 게이팅을 다시 무료로 개방. Focus Session(isAutoMode)
  // 중에는 무료/유료 동일하게 손짓 감지가 켜진다(프리미엄 여부와 무관, 켜는 조건 자체는 아래로 대체됨).
  // ⚠️ 2026-07-27: 한때 핸즈프리 "마스터"(handsFreeEnabled)와 손짓 하위토글에 같이 묶었더니 마스터를
  // 끄면(사용자가 UI 테스트로 자주 끔) 손짓이 통째로 안 켜져 "한번도 안 됨"이 됐던 적이 있다 — 그래서
  // 한동안 설정 토글과 완전히 분리하고 Focus Session에만 묶여 있었다(무조건 ON).
  // 2026-08-01 사용자 지시 — 그 사이 배터리 검토에서, 손짓이 Focus Session 내내(프리미엄은 최대
  // ~120분/일까지 이어짐) 전면카메라를 계속 구동해 배터리 비용이 실재한다고 판단. volumeKeyRemote와
  // 같은 opt-in 패턴으로 전환: 이번엔 마스터(handsFreeEnabled)가 아니라 손짓 "하위" 토글
  // (handsFreeGesture, 기본값 false — useSettingsStore.ts)에만 물려서 위 회귀를 재현하지 않는다
  // (마스터는 여전히 UI 표시용일 뿐 이 게이팅과 무관). 세션 시작 시 꺼져 있으면 toggleAutoMode가
  // 토스트로 "Focus 탭에서 켤 수 있다" 안내(알림 대신 인앱 토스트 — 매 세션 알림은 과함).
  const handsFreeDetectActive = isAutoMode && handsFreeGesture;

  useEffect(() => {
    // §4-1 "Shorts with PACE 누를 때마다 새 영상"(2026-08-04 사장님) — loadInitial엔 "큐가 이미 있으면
    // skip"(즉시재생용) 가드가 있어, 재진입 시 zustand에 남은 이전 시드가 그대로 나왔다. 진입마다 큐를
    // 비워 가드를 통과시켜 새 시드를 뽑는다(서버가 9cbfef5로 serverPool을 1순위로 바꿔 매번 다른 영상이
    // 나오고, 그 뒤 스와이프는 유튜브 알고리즘). 시드는 로컬(캐시된 seedPool)이라 네트워크 대기 없음.
    useShortsQueueStore.setState({ queue: [], isLoading: false, error: null });
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // 감사 MED1(2026-07-27) — 시간 상태바가 제거됐는데 벽시계 clock state + 30초 setInterval이 남아,
  // 재생 중 30초마다 PaceFeedScreen(웹뷰 서브트리 포함) 전체를 무의미하게 리렌더하고 있었다(diag·setProgress와
  // 같은 "씹힘" 부류의 잔존 리렌더 소스). clock/인터벌/formatClock 모두 제거. (sessionRemainingMin은 렌더 안
  // 되는 죽은 계산이라 리렌더 비용 없음 — 그대로 둠.)

  // 2026-07-21 기기 디버깅: 까만화면이 "큐 0개"인지 vs "WebView 재생 실패"인지 로그로 가른다.
  useEffect(() => {
    if (__DEV__) console.log('[Feed] queue=', queue.length, 'current=', current?.videoId, 'usingScrape=', usingScrape, 'loading=', isLoading, 'error=', error);
  }, [queue.length, current?.videoId, usingScrape, isLoading, error]);

  // 큐가 처음 채워지면 IDLE→READY 전이(상태 전이표 규칙: FETCH_SUCCESS).
  useEffect(() => {
    if (status === 'IDLE' && queue.length > 0) setStatus('READY');
  }, [status, queue.length]);

  // 2026-07-19: Auto Mode를 앱이 백그라운드로 갈 때 자동으로 끈다 — 사용자 지시("카톡 확인하러
  // 잠깐 나갔다 5분 뒤 복귀하면 이미 여러 영상이 지나가 있는 걸 방지"). Bluetooth 연결 해제와는
  // 무관하게(그건 별개 입력장치일 뿐) 앱 자체의 포그라운드 상태만 본다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // ⚠️ 2026-07-26 크래시/버그 수정: 예전엔 state !== 'active'(즉 'inactive'도 포함)면 autoMode를
      // 꺼버렸는데, 카메라/마이크 권한 팝업이 뜨는 순간 앱이 'inactive'가 되어 "세션 켜자마자 다시
      // 꺼짐"이 발생했다. 실제로 앱을 벗어나는 건 'background'뿐이므로 거기서만 끄고 flush한다.
      if (state === 'background') {
        flushWatchTime('completed');     // 앱을 벗어나면 그때까지의 시청 시간을 기록(세그먼트 닫힘)
        setIsAutoMode((prev) => (prev ? false : prev));
        // 2026-08-01 배터리 감사 — 백그라운드에선 status를 PAUSED로 내려 playing=false로 만든다.
        // iOS는 백그라운드오디오 권한이 없어 WebView 영상을 자동 일시정지하지만 status는 그대로라
        // 복귀 시 keepAwake가 "정지된 영상" 위에서 계속 화면을 켜둬 최대 30분(idle 상한) 배터리를
        // 태웠다. PAUSED로 내리면 keepAwake/타이머/센서가 즉시 해제되고, 복귀 후 탭으로 재개한다.
        setStatus('PAUSED');
      } else if (state === 'active') {
        // background로 세그먼트가 닫혔을(null) 때만 새로 시작 — 'inactive'(권한 팝업 등)에서 돌아온
        // 경우엔 세그먼트가 살아 있으므로 건드리지 않아 그 사이 시청 시간을 잃지 않는다.
        if (watchSegmentStartRef.current == null) watchSegmentStartRef.current = Date.now();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 피드 이탈(언마운트) 시 잔여 시청 시간 기록 — 이걸로 "일반 시청"도 todayUsageMinutes에 잡힌다.
  useEffect(() => {
    return () => { flushWatchTime('completed'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus Session = 시간 제한 자동 진행(2026-07-20 사용자 지시, PACE_ARCHITECTURE.md "Focus Session =
  // 10분 제한 자동 진행"). Auto Mode(정주행)를 켠 시점부터 정확히 설정된 시간 뒤 자동으로 끈다 —
  // 무기한 지속을 막아 "사람이 세션을 켠다"는 결정적 트리거 안에서만 자동 진행되게 한다. 사용자가
  // 시간이 다 되기 전 직접 끄거나(토글) 백그라운드로 나가면(위 AppState effect) 더 일찍 종료된다.
  // 2026-07-21 밤 감사 발견 — 이 지속시간이 Android는 Settings에서 직접 고를 수 있었는데(5~60분)
  // iOS는 10분 하드코딩이었다. useSettingsStore.settings.focusSessionDurationMinutes로 공용화 —
  // Android는 같은 값을 네이티브 미러에도 반영(설정 화면 참고), iOS는 이 값을 그대로 JS 타이머에 쓴다.
  useEffect(() => {
    if (!isAutoMode) {
      setSessionEndsAt(null);
      overlayService.endSession().catch(() => {}); // iOS: Live Activity 종료(Android: no-op 아님, 별도 경로)
      return;
    }
    setSessionEndsAt(Date.now() + focusSessionDurationMinutes * 60 * 1000); // 상태바 남은시간 계산 기준
    // iOS Live Activity/다이나믹아일랜드에 Focus Session 카운트다운 표시(스펙 §1-E). remainingMinutes만
    // 실제로 쓰이고 나머지 필드는 iOS overlayService가 무시(인터페이스 호환용 기본값).
    overlayService.startSession({
      dailyLimitMinutes,
      remainingMinutes: focusSessionDurationMinutes,
      autoNext: true,
      sleepTimerMinutes: 0,
      breakIntervalMinutes: 0,
      notifyRemaining: false,
      notifyLimit: false,
      notifyBreak: false,
      hardBlockMode: false,
      sleepStillnessMinutes: 10, // iOS overlayService는 무시(no-op) — 인터페이스 호환용 기본값
      bluetoothVolumeKeySkipEnabled: false, // iOS overlayService는 무시(no-op) — 인터페이스 호환용 기본값
    }).catch(() => {});
    const timer = setTimeout(() => {
      sessionTimedOutRef.current = true; // "타임아웃으로 꺼짐" 표시(수동 off와 구분) — 재개 시 광고 유도
      setIsAutoMode(false);
      useToastStore.getState().show(t('feed.focusSessionAutoEndedToast', { n: focusSessionDurationMinutes }));
    }, focusSessionDurationMinutes * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isAutoMode, focusSessionDurationMinutes]);

  // Focus Session 남은 분(올림). clock이 30초마다 갱신되며 리렌더 → 이 값도 재계산된다. 세션 없으면 null.

  // 전환 동안 손짓 추론 정지(iOS) → 페이지 로드에 CPU 양보. 손짓/볼륨/자연종료/수동 등 모든 넘김이
  // goNext를 거치므로 여기 한 곳에서 부른다. ref는 아래 useFeedRemoteControl 반환으로 채워짐(안드는 no-op).
  const pauseWaveRef = useRef<(() => void) | null>(null);
  const playerRef = useRef<ShortsPlayerHandle>(null);

  // 2026-07-29 사장님 지시 — "무입력 idle 하드상한". 유튜브는 ~30분 무입력이면 "Continue watching?"으로
  // 스스로 멈추는데, PACE 자동모드의 프로그램 넘김(advance 주입)이 그 idle 타이머를 계속 리셋해 유튜브가
  // 영영 안 멈춘다(무한재생·배터리 방전 — 무진동 수면감지가 스피커/침대 미세진동에 리셋되면 유일한 방어선이
  // 뚫림). 그래서 PACE가 직접 소유하는 상한을 둔다: 실제 사용자 입력(탭/손짓/스냅/볼륨/토글)이
  // IDLE_CAP_MINUTES분 없으면 자동넘김이라도 정지+블랙아웃. 자동넘김(onEnded)·에러 스킵은 사용자 입력이
  // 아니므로 이 타이머를 리셋하지 않는다. 무진동 수면감지(15분)의 백스톱.
  // 값 근거(웹 리서치 2026-07-29): YouTube 숏폼 idle 가드 ~30분에 맞춤(가장 유사한 앵커). Netflix는
  // TV 3편+90분/기타 3편 연속(장편이라 더 김). 웰빙앱 성격상 짧게 잡아 더 보호적 — 깨어있으면 탭 1번으로 재개.
  const IDLE_CAP_MINUTES = 30;
  const idleMinRef = useRef(0);
  // 2026-08-04 — 같은 "실제 사용자 입력" 신호를 idle 상한(위 IDLE_CAP_MINUTES)과 수면감지 2단계
  // (useSleepGuard) 둘 다에 공급한다. 별도 마킹 지점을 새로 늘리지 않고 기존 idle 상한이 이미 걸어둔
  // 모든 실제 입력 호출부(탭/스와이프/손짓/볼륨키)를 그대로 재사용 — 안드 markUserActivity()와 동등.
  const markUserInput = () => { idleMinRef.current = 0; markSleepActivity(); };

  const goNext = () => {
    pauseWaveRef.current?.();
    setStatus('PLAYING');
    // 우리 리스트(HOT/Favorite) 순서 재생 중이면 유튜브 스와이프 대신 리스트의 다음 항목으로 리마운트한다.
    const list = forcedListRef.current;
    if (list) {
      const ni = forcedIndexRef.current + 1;
      if (ni < list.length) {
        forcedIndexRef.current = ni;
        setForcedVideoId(list[ni]);
        return;
      }
      // 리스트 소진 → 유튜브 자동으로 전환. forcedListRef만 비우고(다음부턴 스와이프 경로), 마지막 영상
      // 페이지에서 그대로 스와이프를 주입해 유튜브 네이티브 피드로 이어간다(forcedVideoId는 유지 = 리마운트 없음).
      forcedListRef.current = null;
      setListMode(false); // WebView가 이제부터 손가락 스와이프를 직접 처리(유튜브 피드)
      useToastStore.getState().show(t('feed.listEndYoutubeToast'));
      // 아래 스와이프 경로로 진행.
    }
    // 스와이프 모드(YouTube 네이티브): 리로드 없이 플레이어에 다음 스와이프 주입(큐 advance 안 함 → 플레이어가
    // 첫 영상에 마운트된 채 유지, YouTube가 다음 쇼츠를 이어줌). reload 모드: 기존대로 큐 advance(videoId 변경).
    if (SWIPE_NAV) { playerRef.current?.advance(); }
    else { advance(); } // 스킵도 시청 완료로 간주 → watched+history로 이동(리스트에서 삭제)
  };
  // 이전 — 리스트 재생 중이면 리스트 이전 항목, 아니면 스와이프 모드=위로 스와이프 주입/reload=큐 goToPrevious.
  // moved 반환(토스트 표시 판단용).
  const goPrev = (): boolean => {
    const list = forcedListRef.current;
    if (list) {
      const pi = forcedIndexRef.current - 1;
      if (pi < 0) return false; // 리스트 첫 항목 — 더 이전 없음
      forcedIndexRef.current = pi;
      setForcedVideoId(list[pi]);
      setStatus('PLAYING');
      return true;
    }
    if (SWIPE_NAV) { playerRef.current?.previous(); setStatus('PLAYING'); return true; }
    const moved = goToPrevious();
    if (moved) setStatus('PLAYING');
    return moved;
  };


  // 2026-07-22 death-spiral 방지: 실기기에서 다수 영상이 login/consent 벽으로 재생 실패(onError/novideo)하면
  // onError→goNext가 큐를 통째로 순삭하며 무한 스킵→까만화면이 될 수 있다. 연속 실패를 세서 임계(6)를
  // 넘으면 스킵을 멈추고 에러 상태로 전환(사용자에게 재시도 UI). 재생이 실제로 되면(onProgress>0) 리셋.
  const errorStreakRef = useRef(0);
  const [feedBlocked, setFeedBlocked] = useState(false);
  const handlePlayerError = () => {
    errorStreakRef.current += 1;
    if (errorStreakRef.current >= 6) {
      setFeedBlocked(true); // 연속 6회 실패 → 스킵 중단
      return;
    }
    goNext();
  };
  const handleProgress = (p: number) => {
    if (p > 0 && errorStreakRef.current !== 0) errorStreakRef.current = 0; // 실제 재생되면 스트릭 리셋
    // ⚠️ setProgress 제거 — progress state는 미사용(void progress, 카메라 게이팅은 isAutoMode로 이관)인데
    //    매 500ms setState로 피드를 재렌더시켜 일부 영상에 주기적 히치("어떤건 씹힘")를 유발했다.
    //    death-spiral 방지용 errorStreak 리셋만 남긴다.
  };
  const retryFeed = () => { errorStreakRef.current = 0; setFeedBlocked(false); loadInitial(); };

  const goPrevious = () => { goPrev(); };

  const toggleAutoMode = () => {
    // 토스트(다른 컴포넌트 setState)를 setIsAutoMode 업데이터 안에서 호출하면 React가
    // "Cannot update a component (ToastHost) while rendering..." 경고를 낸다(업데이터는 순수해야 함).
    // 이벤트 핸들러 본문(렌더 밖)에서 현재 값을 뒤집어 계산하고, 상태 변경과 토스트를 분리 호출한다.
    markUserInput();
    const next = !isAutoMode;
    // 2026-08-01 자율세션(Android 8468a82 matching) — 무료 사용자가 "타임아웃으로" 꺼진 세션을 다시
    // 켜려 하면 무료 재개 대신 보상광고/크레딧 연장 모달로 보낸다(무한 무료 재활성화 구멍 차단).
    // 프리미엄이거나 타임아웃 아닌(수동 off 후) 재개는 그대로 무료로 켠다.
    if (next && sessionTimedOutRef.current && !useSubscriptionStore.getState().isPremium) {
      setShowExtendModal(true);
      return; // 아직 재활성화 안 함 — 광고 보상/크레딧 확정 시 onExtended가 켠다
    }
    sessionTimedOutRef.current = false; // 수동 재개/종료 시 타임아웃 상태 해제
    setIsAutoMode(next);
    // 2026-08-01 — 손짓이 opt-in(기본 OFF)으로 바뀌면서, 세션을 켰는데 손짓이 꺼져있는 유저에게
    // Focus 탭에서 켤 수 있다고 짧게 안내(별도 푸시 알림 대신 기존 세션-시작 토스트에 얹는다).
    if (next) {
      useToastStore.getState().show(
        handsFreeGesture
          ? t('feed.focusSessionStartedToast', { n: focusSessionDurationMinutes })
          : t('feed.focusSessionStartedNoGestureToast', { n: focusSessionDurationMinutes })
      );
    } else {
      useToastStore.getState().show(t('feed.focusSessionEndedToast'));
    }
  };

  // Bluetooth 리모컨(iOS만 실제 동작 — .android.ts는 no-op, 상단 주석 참고).
  const feedRemote = useFeedRemoteControl({
    onNext: () => { markUserInput(); goNext(); useToastStore.getState().show(t('feed.nextShortToast')); },
    onPrevious: () => { markUserInput(); if (goPrev()) useToastStore.getState().show(t('feed.previousShortToast')); },
    onToggleAutoMode: toggleAutoMode,
    headDetectActive: handsFreeDetectActive, // iOS 핸즈프리 감지(핑거스냅) ON 조건 — Focus Session 동안만
    // 감사 발견 C1(2026-07-27) — onDiag는 WaveDetector가 초당 ~3회 emit한다. setDiag는 렌더도 안 되는
    // diag state를 매번 새 객체로 갱신 → PaceFeedScreen(웹뷰 서브트리 포함) 전체가 초당 수회 리렌더 →
    // 예전에 setProgress 제거로 고쳤던 영상 "씹힘/히치"·손짓 카메라 불안정이 그대로 재발하는 회귀 벡터.
    // 릴리즈에선 완전히 끄고(__DEV__ false), dev에서만 진단 유지. 손짓 발화는 onHandWave라 이와 무관.
    onDiag: () => {}, // diag 상태 제거(성능) — 진단은 네이티브 로그가 담당
  });
  // 전환 정지 함수를 goNext가 쓰는 ref에 연결(iOS=실제 정지, Android=no-op).
  pauseWaveRef.current = feedRemote?.pauseWaveForTransition ?? null;

  // 볼륨키 → Short 넘김. ⚠️ 2026-07-27 iOS 플랫폼 한계 확정(웹 리서치): iOS는 볼륨 변화의 출처(폰 버튼 vs
  // BT 리모컨)를 알 수 없고(안드 KeyEvent.getDevice() 대응 API 없음), 사람들이 쓰는 싸구려 카메라 리모컨은
  // 볼륨키 HID라 MPRemoteCommandCenter로도 못 잡고 GCKeyboard 연결감지도 안 된다. 그래서 예전의 "BT 오디오
  // 연결됨일 때만" 게이트는 (a)카메라 리모컨은 오디오기기가 아니라 영영 안 켜지고 (b)BT 스피커만 연결해도
  // 폰 볼륨을 뺏는, 정확히 반대로 동작하는 잘못된 신호였다. 유일하게 맞는 방식 = "핸즈프리(Focus Session) ON
  // + 피드 화면"일 때만 하이재킹을 국한한다. 평소 폰 볼륨은 항상 정상, 핸즈프리로 피드 볼 때만 볼륨키=스킵
  // (그 상황에선 리모컨을 쓰는 중이라 폰 볼륨 상실이 사실상 문제 안 됨). up=다음/down=이전.
  // 2026-08-01 사장님 지적("BT 리모컨이 저번엔 됐는데 갑자기 안돼") — 07-28에 추가한 btConnected(BT 오디오
  // 연결) 게이트가 위 07-27 결론(오디오 아닌 HID 카메라 리모컨은 iOS가 감지 못 해 영영 안 켜짐)대로 리모컨을
  // 죽였다. 되돌린다: 볼륨키 리모컨은 opt-in 토글(기본 OFF)이라 켰다는 건 "리모컨 쓴다"는 의도 → 세션+토글만
  // 으로 하이재킹(토글 OFF면 폰 볼륨 항상 정상). Android는 접근성 오버레이(Kotlin) 별도 — co-session 확인 필요.
  useVolumeNext({
    enabled: isAutoMode && volumeKeyRemote,
    onNext: () => { markUserInput(); goNext(); useToastStore.getState().show(t('feed.nextShortToast')); },
    onPrevious: () => { markUserInput(); if (goPrev()) useToastStore.getState().show(t('feed.previousShortToast')); },
  });

  // 영상 종료 시 Auto Mode 여부로 분기(상태 전이표 규칙 D) — 켜져 있으면 계속 정주행, 꺼져 있으면
  // 멈추고 리모컨/화면 탭 입력을 기다린다.
  const onEnded = () => {
    if (isAutoMode) {
      goNext();
    } else {
      setStatus('PAUSED');
    }
  };

  return (
    <View
      style={[styles.container, { paddingTop: insets.top }]}
      // 화면 탭도 "사용자 입력"으로 idle 상한 리셋. return false로 responder를 뺏지 않아 WebView 조작을 방해하지 않음.
      onStartShouldSetResponderCapture={() => { markUserInput(); return false; }}
    >
      {/* 웹뷰를 시스템 상태바 아래로 내려 유튜브 자체 헤더가 상태바와 겹치지 않게 한다(사용자 지시).
          상단 insets.top만큼은 검은 스트립(상태바 영역), 그 아래로 영상+유튜브 UI. */}
      {/* ⚠️ 프리로드(다음영상 미리로드)는 기기에서 YouTube WebView 2개가 디코더/대역폭 경합 → 재생 중
          버퍼링 멈춤(stalled) + 손짓 카메라 불안정을 유발했다(실기기 로그 확정). 전환 간극보다 mid-play
          멈춤이 더 나쁘므로 단일 플레이어로 유지한다. (next는 큐 프리페치/캐시로만 미리 확보.) */}
      {/* 2026-08-01 배터리 감사 — sleepBlackout(취침/슬립타이머/idle 상한 발동)이면 WebView를 통째로
          언마운트한다. 예전엔 검은 Pressable로 가리기만 해서 유튜브 페이지가 메모리에 남고 내부
          500ms 폴링이 계속 브릿지로 메시지를 쏘았다(재생은 정지됐어도 CPU/wakeup 낭비). */}
      {/* ⚠️ 2026-08-05 사장님 지적("아이폰은 주소가 있는데도 안 열렸어") — 예전 조건은 `current &&` 였다.
          즉 **큐에 현재 영상이 있어야만** 플레이어가 렌더됐고, `forcedVideoId`(즐겨찾기/HOT에서 연 특정
          영상)만으로는 아무것도 안 떴다. 그런데 이 화면은 진입할 때마다 큐를 비우고 다시 받아온다
          (§4-1 "누를 때마다 새 영상"). 그 사이거나 큐가 소진된 상태에서 즐겨찾기를 누르면
          forcedVideoId는 설정되는데 **화면엔 아무 일도 안 일어난다** — 저장은 멀쩡한데 안 열리는 정체.
          forcedVideoId만으로도 재생할 수 있어야 한다(그게 그 값의 존재 이유다). */}
      {(forcedVideoId || current) && !feedBlocked && !sleepBlackout && (
        <YouTubeShortsPlayer
          key={`${forcedVideoId ?? current!.videoId}:${ytSessionNonce}`}
          ref={playerRef}
          videoId={forcedVideoId ?? current!.videoId}
          playing={playing}
          onProgress={handleProgress}
          onVideoChange={(id) => { currentVideoIdRef.current = id; }}
          onUserSwipe={(dir, moved) => {
            // iOS 유저 손가락 스와이프(위=다음/아래=이전).
            markUserInput();
            // 2026-08-05 사장님 "스와이프 개 버벅" 수정 — moved=true면 WebView가 브릿지 왕복 없이 이미
            // 넘긴 뒤다. 여기서 goNext()를 또 부르면 이중 이동(두 칸)이 된다. 기록/상태만 맞춘다.
            // 토스트도 안 띄운다: 손짓·볼륨키는 화면 피드백이 없어 필요하지만, 손가락 스와이프는 본인이
            // 한 동작이라 매번 뜨면 방해만 되고 전환 순간에 불필요한 렌더/애니메이션을 얹는다.
            if (moved) {
              pauseWaveRef.current?.(); // 전환 중 손짓 오발화 방지(goNext가 하던 것과 동일)
              setStatus('PLAYING');
              return;
            }
            // moved=false = 리스트 모드(HOT/즐겨찾기) — 이동은 여기서 리스트의 다음/이전 항목으로 수행.
            if (dir === 1) { goNext(); useToastStore.getState().show(t('feed.nextShortToast')); }
            else if (goPrev()) { useToastStore.getState().show(t('feed.previousShortToast')); }
          }}
          listMode={listMode}
          onEnded={onEnded}
          onError={handlePlayerError} // 재생 불가 영상 스킵 — 연속 실패는 가드가 잡음(death-spiral 방지)
          onNotShorts={() => {
            // 2026-08-01 사장님 지적 — HOT/Favorite에서 연 항목이 비-쇼츠(라이브/롱폼)라 watch로 리다이렉트되면
            // 스와이프/자동넘김/손짓이 안 먹는다. 스와이프 스킵으론 복구 불가(릴 DOM 없음)라 key를 바꿔 리마운트한다.
            useToastStore.getState().show(t('feed.notShortsSkippedToast'));
            // 리스트 재생 중이면 리스트의 다음 항목으로 건너뛴다(카테고리 안에서 계속). 리스트 끝이면 큐로 복귀.
            const list = forcedListRef.current;
            if (list) {
              const ni = forcedIndexRef.current + 1;
              if (ni < list.length) { forcedIndexRef.current = ni; setForcedVideoId(list[ni]); return; }
              forcedListRef.current = null; setListMode(false); setForcedVideoId(null); return;
            }
            if (forcedVideoId) setForcedVideoId(null);
            else advance();
          }}
          onAudioDiag={() => {}} // diag 상태 제거(성능) — 리렌더 소스 제거
        />
      )}

      <SafeAreaView style={styles.uiLayer} edges={['bottom']} pointerEvents="box-none">
        {/* uiLayer는 position:absolute라 컨테이너 paddingTop을 무시하고 top:0에 붙는다 → topBar에 명시
            top 여백(insets.top, 모달에서 0이면 47 폴백)을 줘 시스템 상태바와 안 겹치게. */}
        <View style={[styles.topBar, { marginTop: Math.max(insets.top, 47) }]} pointerEvents="box-none">
          {/* 2026-07-25 사용자 지시: 상단은 영상을 최대한 안 가리게 "앱 복귀 버튼 하나"만 남긴다.
              X(닫기)와 "Pace Feed" 필은 영상 가리는 군더더기라 제거. 우상단 P만 유지 — 탭하면 Pace
              앱(Home)으로 복귀(세션은 백그라운드 유지). 딥링크로 스택이 비어도 replace라 안전. */}
          {/* 피드는 홈 위에 뜬 fullScreenModal — replace로 홈을 새로 그리면 밑의 홈과 겹쳐 "두 번 보임".
              back()으로 모달을 닫아 밑의 홈을 드러낸다. 딥링크로 스택이 비었을 때만 replace 폴백. */}
          {/* 세션 시작/표시 컨트롤(사용자 지시 2026-07-26) — 예전엔 하단 배지가 OFF일 때 흐려서 "어디 있냐"
              못 찾음. 항상 보이는 상단 토글 필로 올린다: OFF는 "▶ START SESSION"(눌러서 켬), ON은 안드로이드
              알약처럼 "● SESSION ON"(눌러서 끔). P 옆 고정 위치라 늘 찾기 쉽다. */}
          {/* 하루 한도 남은 시간 — 항상 표시(Focus Session 남은시간과 별개). Android "40m left" parity. */}
          <View style={styles.dailyPill} pointerEvents="none">
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
            <Feather name="clock" size={11} color="rgba(255,255,255,0.7)" />
            <DailyRemaining />
          </View>
          <Pressable onPress={toggleAutoMode} hitSlop={8} style={[styles.sessionPill, isAutoMode && styles.sessionPillOn]}>
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
            {isAutoMode ? <View style={styles.sessionOnDot} /> : <Feather name="play" size={12} color="rgba(255,255,255,0.92)" />}
            <Text style={styles.sessionOnText}>{isAutoMode ? t('feed.focusSessionOnBadge') : t('feed.focusSessionStartBadge')}</Text>
            {/* Focus Session ON일 때 남은시간(격리 컴포넌트 — 부모 리렌더 없음, WebView 씹힘 방지) */}
            {isAutoMode && sessionEndsAt != null && (
              <>
                <View style={styles.sessionDivider} />
                <SessionRemaining endsAt={sessionEndsAt} />
              </>
            )}
          </Pressable>
          <Pressable onPress={() => setShowPaceMenu((v) => !v)} hitSlop={12} style={styles.appIconBtn}>
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
            <Text style={styles.appIconText}>P</Text>
          </Pressable>
        </View>

        {/* 공용 P 메뉴(overlay/index.tsx와 동일 배선) — 앱으로/Shorts HOT/Saved/Favorite */}
        {showPaceMenu && (
          <PaceMenu
            top={Math.max(insets.top, 47) + 44}
            onClose={() => setShowPaceMenu(false)}
            // 유튜브 로그인은 iOS 피드에서만 의미가 있다 — 안드로이드는 실제 유튜브 앱(이미 로그인된
            // 계정)으로 넘기므로 이 항목이 필요 없다(YouTubeLoginSheet.tsx 상단 주석 참고).
            showYouTubeLogin={Platform.OS === 'ios'}
            onSelect={(action) => {
              setShowPaceMenu(false);
              if (action === 'app') { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/home'); }
              else if (action === 'capture') setActiveSavedList('capture');
              else if (action === 'favorite') setActiveSavedList('favorite');
              else if (action === 'hot') setShowShortsHot(true);
              else if (action === 'ytlogin') setShowYtLogin(true);
            }}
          />
        )}
        {activeSavedList && userId && (
          <SavedVideoListOverlay
            userId={userId}
            kind={activeSavedList}
            onClose={() => setActiveSavedList(null)}
            onOpenVideo={playInFeed}
            onAddCurrent={async () => {
              if (!userId) return;
              const vid = currentVideoIdRef.current ?? current?.videoId ?? null;
              if (!vid) return;
              // 스와이프 모드에선 title/channel을 정확히 못 읽어 videoId+url만 저장(썸네일은 videoId로 구성).
              const matchesQueue = current?.videoId === vid;
              await addSavedVideo({
                userId,
                kind: 'favorite',
                videoId: vid,
                title: matchesQueue ? (current?.title ?? null) : null,
                channel: matchesQueue ? (current?.channelTitle ?? null) : null,
                url: `https://www.youtube.com/shorts/${vid}`,
                platformApp: 'youtube',
              }).catch(() => {});
              useToastStore.getState().show(t('overlay.addCurrentSuccess'));
            }}
          />
        )}
        {showShortsHot && <ShortsHotOverlay onClose={() => setShowShortsHot(false)} onOpenVideo={playInFeed} />}

        {showYtLogin && (
          <YouTubeLoginSheet
            onClose={() => setShowYtLogin(false)}
            onSignedIn={() => {
              setShowYtLogin(false);
              // 새 로그인 쿠키로 다시 붙게 플레이어를 리마운트한다(key 교체).
              setYtSessionNonce((n) => n + 1);
              useToastStore.getState().show(t('feed.youtubeSignInDone'));
            }}
          />
        )}

        {/* 무료 세션 타임아웃 후 재개 시도 → 보상광고/크레딧 연장(Android 8468a82 matching). onExtended로
            feed가 직접 세션 재활성화(iOS는 세션이 JS 관리 — extendFocusSession은 no-op). 광고 실패/미보상
            시 재활성화 안 함(무료 손해 방지). */}
        <FocusSessionExtendModal
          visible={showExtendModal}
          onExtend={() => { sessionTimedOutRef.current = false; setIsAutoMode(true); }}
          onDismiss={() => setShowExtendModal(false)}
          onAdVisibilityChange={(adVisible) => {
            if (adVisible) {
              statusBeforeAdRef.current = status;
              setStatus('PAUSED'); // 광고 뒤에서 유튜브 소리가 계속 나는 것부터 막는다
            } else if (statusBeforeAdRef.current === 'PLAYING') {
              // 광고 전에 재생 중이었을 때만 되살린다 — playing이 false→true로 바뀌면서
              // 플레이어가 pacePlay를 다시 주입한다(YouTubeShortsPlayer의 [ready, playing] effect).
              setStatus('PLAYING');
            }
          }}
        />

        {/* 수면감지 2단계 확정 팝업(안드 showStillWatchingPrompt 패리티) — 반응(버튼/배경 탭) 자체가
            markUserInput()을 태워 idle 상한과 수면 무입력 시계를 함께 리셋한다. */}
        <SleepPromptModal visible={isSleepPrompted} onKeepWatching={markUserInput} />

        {/* 2026-07-25 사용자 지시: 인앱 "시간 상태바"(벽시계+남은시간)가 iOS 시스템 상태바와 겹쳐 제거.
            시간은 시스템 상태바(시계)와 다이나믹 아일랜드 Live Activity(세션 남은시간)가 이미 담당. */}
        {usingScrape && (
          <View style={styles.fallbackBanner}>
            <Feather name="alert-triangle" size={12} color={colors.warning} />
            <Text style={styles.fallbackText}>{t('feed.scrapeFallbackBanner')}</Text>
          </View>
        )}

        {/* 2026-07-21 실기기 발견: 이 가운데 spacer가 기본 pointerEvents=auto라 화면 중앙 탭을
            가로채 뒤의 YouTube WebView로 안 넘어갔다(→ "탭해도 재생 안 됨"). none으로 통과시켜
            iOS 첫탭 재생(자동재생 차단 우회)이 실제로 먹히게 한다. */}
        <View style={{ flex: 1 }} pointerEvents="none" />

        {/* 하단 "포커스 세션 시작" 배지는 OFF일 때 흐려서 유튜브 UI에 묻혀 못 찾는다는 지적(2026-07-26) →
            상단 토글 필로 이전해 제거. 세션 시작/표시는 이제 상단 [START SESSION/SESSION ON] 필이 전담. */}
      </SafeAreaView>

      {(isLoading || (isRefilling && !current)) && (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>{t('feed.loadingShorts')}</Text>
        </View>
      )}
      {/* 2026-07-22 감사수정: isRefilling 중엔 current가 잠깐 null이어도 에러화면 대신 위 스피너를 보인다
          (스킵이 refill보다 빨라 큐가 순간적으로 빌 때 "로드 실패"가 번쩍이던 문제). */}
      {!isLoading && !isRefilling && !current && (
        <View style={styles.centerState}>
          <Feather name="cloud-off" size={28} color={colors.textSecondary} />
          <Text style={styles.stateText}>
            {error === 'EMPTY_FEED' ? t('feed.emptyQueueMessage') : t('feed.loadFailedMessage')}
          </Text>
          <Pressable onPress={() => loadInitial()} style={styles.retryBtn}>
            <Text style={styles.retryText}>{t('paywall.retry')}</Text>
          </Pressable>
        </View>
      )}
      {/* 2026-07-22: 연속 재생실패 6회 → 무한 스킵(까만화면) 대신 여기서 멈추고 재시도 UI 노출. */}
      {feedBlocked && (
        <View style={styles.centerState}>
          <Feather name="alert-triangle" size={28} color={colors.warning} />
          <Text style={styles.stateText}>{t('feed.loadFailedMessage')}</Text>
          <Pressable onPress={retryFeed} style={styles.retryBtn}>
            <Text style={styles.retryText}>{t('paywall.retry')}</Text>
          </Pressable>
        </View>
      )}

      {/* 취침 감지 블랙아웃(스펙 §4-B) — 잠든 걸로 판단되면 영상을 멈추고 화면을 검게 덮는다. iOS는
          시스템 잠금 API가 없어 이 인앱 블랙아웃이 실질적 최선(밝기 0%는 OS가 되돌림). 아주 어둡게 두되,
          깨어 있었다면 탭 한 번으로 나갈 수 있게(오탐 대비) 최소 문구만. */}
      {sleepBlackout && (
        <Pressable
          style={styles.sleepBlackout}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
        >
          <Text style={styles.sleepBlackoutText}>{t('feed.sleepBlackout')}</Text>
        </Pressable>
      )}

      {/* 2026-08-05 사장님 지시("iOS도 동일기능 만들어") — Hard Block Mode(설정, 기본 OFF)를 켠
          사용자에게만 뜨는 하루 한도 전체화면 차단. 안드로이드 showBlockOverlay와 같은 문구·같은
          두 버튼(광고로 5분 더 / 여기까지)을 쓴다(translations.ts limitReached.*를 양쪽이 공유).
          iOS는 다른 앱을 종료시킬 수 없으므로 안드로이드의 goHome 대응은 없고, 대신 시청이 실제로
          일어나는 이 피드를 덮어 재생을 세우는 것이 동일한 효과다. */}
      {limitBlocked && (
        <View style={styles.limitBlock}>
          <Text style={styles.limitBlockIcon}>{limitHitCountRef.current >= 2 ? '☕' : '🛡'}</Text>
          <Text style={styles.limitBlockTitle}>
            {t(limitHitCountRef.current >= 2 ? 'limitReached.tier2Title' : 'limitReached.tier1Title')}
          </Text>
          <Text style={styles.limitBlockSubtitle}>
            {limitHitCountRef.current >= 2
              ? t('limitReached.tier2Subtitle', { n: (limitHitCountRef.current - 1) * LIMIT_NOTICE_INTERVAL_MINUTES })
              : t('limitReached.tier1Subtitle', { n: dailyLimitMinutes + bonusMinutes })}
          </Text>
          <Text style={styles.limitBlockBody}>{t('limitReached.tier1Body')}</Text>
          <View style={styles.limitBlockRow}>
            <Pressable
              style={[styles.limitBlockBtn, styles.limitBlockBtnPrimary]}
              onPress={() => { setLimitBlocked(false); setShowExtendModal(true); }}
            >
              <Text style={styles.limitBlockBtnPrimaryText}>
                {t(limitHitCountRef.current >= 2 ? 'limitReached.extendTier2' : 'limitReached.extendTier1')}
              </Text>
            </Pressable>
            <Pressable
              style={styles.limitBlockBtn}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
            >
              <Text style={styles.limitBlockBtnText}>
                {t(limitHitCountRef.current >= 2 ? 'limitReached.dismissTier2' : 'limitReached.dismissTier1')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  // 2026-07-19 버그 수정: position:'absolute'가 빠져 있어서 이 UI 레이어가 WebView 플레이어와 같은
  // flex:1 형제로 화면 공간을 나눠 갖고 있었다(둘 다 flex:1이라 세로로 반반 분할) — 플레이어가 화면
  // 절반도 채 못 쓰는데 그 위에 UI가 덮이는 게 아니라 옆(아래)에 쌓이는 구조였던 것. overlay/
  // index.tsx의 같은 패턴(overlayLayer)은 이미 position:'absolute'로 올바르게 돼 있었다 — 이
  // 화면만 그 컨벤션이 빠져 있었음.
  uiLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md },
  // 하루 한도 전체화면 차단(Hard Block Mode 전용) — 안드로이드 showBlockOverlay와 같은 톤.
  limitBlock: {
    ...StyleSheet.absoluteFill,
    zIndex: 1500,
    backgroundColor: 'rgba(11,12,15,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  limitBlockIcon: { fontSize: 40, marginBottom: 24 },
  limitBlockTitle: { color: '#FFFFFF', fontSize: 20, fontFamily: typography.bodyFontFamilyBold, textAlign: 'center', marginBottom: 10 },
  limitBlockSubtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 6 },
  limitBlockBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 24 },
  limitBlockRow: { flexDirection: 'row', gap: 10 },
  limitBlockBtn: { borderRadius: 100, paddingHorizontal: 22, paddingVertical: 13, backgroundColor: 'rgba(255,255,255,0.1)' },
  limitBlockBtnPrimary: { backgroundColor: '#5856D6' },
  limitBlockBtnPrimaryText: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
  limitBlockBtnText: { color: '#D1D5DB', fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.45)' },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  categoryText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  // 우상단 "P" 앱 아이콘(복귀용) — 온보딩/오버레이의 보라 P 배지와 동일 톤(2026-07-21).
  // 글래스모피즘 P(사용자 지시) — solid 보라 대신 프로스티드 글래스 원. 영상을 덜 가리게 반투명.
  appIconBtn: { width: 36, height: 36, borderRadius: radius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  // 상단 세션 토글 필(항상 표시) — OFF는 "▶ START SESSION"(중립 테두리), ON은 "● SESSION ON"(초록 테두리).
  sessionPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  sessionPillOn: { borderColor: colors.success },
  sessionOnDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  sessionOnText: { color: 'rgba(255,255,255,0.95)', fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 0.8 },
  sessionDivider: { width: StyleSheet.hairlineWidth, height: 12, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 2 },
  sessionRemainingText: { color: colors.success, fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  // 하루 한도 남은시간 필 — 세션 필과 같은 글래스 톤, 중립색(Focus 초록과 구분).
  dailyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 11, borderRadius: radius.pill, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  dailyRemainingText: { color: 'rgba(255,255,255,0.92)', fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  // 집중모드 인디케이터 — P와 같은 36 글래스 원, 은은한 보라 링(colors.primary)으로 "지금 집중 중" 표시.
  appIconText: { color: 'rgba(255,255,255,0.95)', fontSize: 17, fontFamily: typography.displayFontFamily },
  // 시간 상태바(§1-E.3) — 상단 중앙에 살짝, WebView 재생을 가리지 않게 반투명 필.
  statusBar: { alignItems: 'center', marginTop: spacing.sm },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  statusText: { color: '#FFFFFF', fontSize: 12, fontFamily: typography.monoFontFamilyBold },
  statusDivider: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 2 },
  fallbackBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  fallbackText: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.bodyFontFamilyMedium },
  // 2026-07-23: 유투브 웹뷰 자체 하단 UI(메타/다음영상 미리보기 바)와 안 겹치게 크게 띄우고 좌측 정렬.
  bottom: { paddingBottom: 110, alignItems: 'flex-start', gap: spacing.sm },
  autoModeBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs },
  autoModeBadgeOn: { backgroundColor: colors.successLight },
  autoModeBadgeOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  autoModeBadgeText: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  autoModeBadgeTextOn: { color: '#000000' },
  title: { color: '#FFFFFF', fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold },
  creator: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.bodyFontFamilyBold },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.md },
  ctrlBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  ctrlBtnMain: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  centerState: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: '#000000' },
  stateText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyMedium },
  retryBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.button, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
  // 취침 감지 블랙아웃(§4-B) — 거의 순수 검정, 최상단(zIndex). 아주 흐린 안내 문구만.
  sleepBlackout: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  sleepBlackoutText: { color: 'rgba(255,255,255,0.65)', fontSize: 22, lineHeight: 30, fontFamily: typography.bodyFontFamilySemibold, textAlign: 'center', paddingHorizontal: 32, letterSpacing: 0.3 },
});
