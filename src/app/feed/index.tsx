import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { YouTubeShortsPlayer } from '../../components/feed/YouTubeShortsPlayer';
import { useShortsQueueStore } from '../../store/useShortsQueueStore';
import { useToastStore } from '../../store/useToastStore';
import { useFeedRemoteControl } from '../../hooks/useFeedRemoteControl';
import { useVolumeNext } from '../../hooks/useVolumeNext';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { useSleepGuard } from '../../hooks/useSleepGuard';
import { hasRealYouTubeSource } from '../../services/api/youtube';
import { useTranslation } from '../../services/i18n';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFlipStore } from '../../store/useFlipStore';
import { useUserStore } from '../../store/useUserStore';
import { startSession, endSession } from '../../database/repositories/sessionsRepository';
import type { SessionEndStatus } from '../../types/models';
import { overlayService } from '../../services/platform';
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
  const [status, setStatus] = useState<PlayerStatus>('IDLE');
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [diag, setDiag] = useState<{ wave: string; snap: string; audio: string }>({ wave: '—', snap: '—', audio: '—' }); // 디버그 오버레이
  // 시간 상태바(스펙 §1-E.3) — 몰입형 웹뷰에선 시간 감각을 잃기 쉬워 벽시계 + (Focus Session 중이면)
  // 남은 시간을 상단에 순수 JS로 노출. ⚠️ 감사 발견: iOS는 useTimerStore(오버레이 전용)가 절대 시작되지
  // 않아 남은시간이 죽은 값이었다 → 피드 자체 Focus Session(isAutoMode)의 종료시각에 바인딩한다.
  const [sessionEndsAt, setSessionEndsAt] = useState<number | null>(null);
  const [progress, setProgress] = useState(0); // 현재 영상 재생 진행률(0~1) — 고개짓 카메라 게이팅용
  const isFaceDown = useFlipStore((s) => s.isFaceDown); // Flip Mode — 엎어놓으면 영상 정지(슬립 유도)
  const [sleepBlackout, setSleepBlackout] = useState(false); // 취침 감지(§4-B) → 검은 풀스크린
  const userId = useUserStore((s) => s.user?.id);
  // 현재 "활성 시청 세그먼트" 시작 시각. null이면 카운트 안 함(백그라운드/flush 직후). 사용시간 측정용.
  const watchSegmentStartRef = useRef<number | null>(Date.now());
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
  const flushWatchTime = (status: SessionEndStatus) => {
    const startedAt = watchSegmentStartRef.current;
    watchSegmentStartRef.current = null; // 세그먼트 종료 — 재개(active 복귀) 전까지 카운트 안 함
    if (startedAt == null) return;
    const uid = useUserStore.getState().user?.id;
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    if (!uid || durationSeconds < 3) return; // 3초 미만(즉시 이탈/오탐)은 무시
    startSession(uid, 'youtube')
      .then((id) => endSession(id, durationSeconds, 0, status))
      .catch(() => {});
  };

  // 취침 감지 강제 종료(스펙 §4-B) — 피드 시청 중 잠들면(무진동 지속, 이어폰 탈착 시 단축) 영상을 멈추고
  // 검은 풀스크린으로 덮어 밤새 재생을 막는다. iOS는 화면을 강제로 잠글 API가 없어(스펙 문서화) 영상
  // 정지 + WebView를 가리는 블랙아웃이 실질적 최선. DB엔 sleep_detected로 기록(홈 "…에 잠드셨습니다" 인사이트).
  const onSleepDetected = () => {
    setStatus('PAUSED');
    setSleepBlackout(true);
    flushWatchTime('sleep_detected'); // 잠들기까지의 시청 시간을 sleep_detected로 기록(세그먼트도 닫힘)
  };
  // 영상이 실제 재생 중이고 아직 블랙아웃 전일 때만 감지(정지/블랙아웃 중엔 불필요).
  useSleepGuard({ enabled: playing && !sleepBlackout, onSleep: onSleepDetected });

  // 2026-07-26 사용자 지시 "안드로이드와 동일하게": 안드로이드는 Session ON일 때 감지기(스냅/손짓)를
  // 한꺼번에 켠다(PaceOverlayService.setAutoMode → start snap/handwave). iOS도 동일하게 Focus Session
  // (isAutoMode) 동안만 핸즈프리 감지를 켠다 — 이 플래그가 useFeedRemoteControl.ios의 감지 게이팅.
  // 현재 감지기는 핑거스냅(SoundAnalysis+AEC). 손짓(카메라 Vision)은 2단계로 pace-gesture에 추가 예정.
  // (고개짓 head-nod는 2026-07-23 "비현실적" 판단으로 계속 제외 — 'snap' 모드만 start.)
  const handsFreeDetectActive = isAutoMode;
  void progress;

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // 시간 상태바용 벽시계 — 30초마다 갱신(분 단위 표시라 그 이상 촘촘할 필요 없음).
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // 2026-07-21 기기 디버깅: 까만화면이 "큐 0개"인지 vs "WebView 재생 실패"인지 로그로 가른다.
  useEffect(() => {
    console.log('[Feed] queue=', queue.length, 'current=', current?.videoId, 'usingScrape=', usingScrape, 'loading=', isLoading, 'error=', error);
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
    }).catch(() => {});
    const timer = setTimeout(() => {
      setIsAutoMode(false);
      useToastStore.getState().show(t('feed.focusSessionAutoEndedToast', { n: focusSessionDurationMinutes }));
    }, focusSessionDurationMinutes * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isAutoMode, focusSessionDurationMinutes]);

  // Focus Session 남은 분(올림). clock이 30초마다 갱신되며 리렌더 → 이 값도 재계산된다. 세션 없으면 null.
  const sessionRemainingMin = sessionEndsAt != null ? Math.max(0, Math.ceil((sessionEndsAt - Date.now()) / 60000)) : null;

  const goNext = () => {
    setStatus('PLAYING');
    setProgress(0); // 다음 영상 → 진행률 리셋(고개짓 카메라 게이팅을 다시 1/2지점 대기로)
    advance(); // 스킵도 시청 완료로 간주 → watched+history로 이동(리스트에서 삭제)
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
    setProgress(p);
  };
  const retryFeed = () => { errorStreakRef.current = 0; setFeedBlocked(false); loadInitial(); };

  const goPrevious = () => {
    if (goToPrevious()) setStatus('PLAYING');
  };

  const toggleAutoMode = () => {
    // 토스트(다른 컴포넌트 setState)를 setIsAutoMode 업데이터 안에서 호출하면 React가
    // "Cannot update a component (ToastHost) while rendering..." 경고를 낸다(업데이터는 순수해야 함).
    // 이벤트 핸들러 본문(렌더 밖)에서 현재 값을 뒤집어 계산하고, 상태 변경과 토스트를 분리 호출한다.
    const next = !isAutoMode;
    setIsAutoMode(next);
    useToastStore.getState().show(next ? t('feed.focusSessionStartedToast', { n: focusSessionDurationMinutes }) : t('feed.focusSessionEndedToast'));
  };

  // Bluetooth 리모컨(iOS만 실제 동작 — .android.ts는 no-op, 상단 주석 참고).
  useFeedRemoteControl({
    onNext: () => { goNext(); useToastStore.getState().show(t('feed.nextShortToast')); },
    onPrevious: () => { const moved = goToPrevious(); if (moved) { setStatus('PLAYING'); useToastStore.getState().show(t('feed.previousShortToast')); } },
    onToggleAutoMode: toggleAutoMode,
    headDetectActive: handsFreeDetectActive, // iOS 핸즈프리 감지(핑거스냅) ON 조건 — Focus Session 동안만
    onDiag: (kind, text) => setDiag((d) => (kind === 'wave' ? { ...d, wave: text } : { ...d, snap: text })),
  });

  // 볼륨키 → 다음 Short. ⚠️ 2026-07-26 사용자 지적: 볼륨키 하이재킹은 "블루투스 리모컨(에어팟/버즈/
  // 다이소 리모컨)이 실제로 연결됐을 때만" 해야 한다 — 폰만 있을 땐 볼륨키가 음량 조절이어야 하는데
  // 세션 ON만으로 무조건 가로채 음량 조절을 막고 있었다. Focus Session ON && BT 오디오 연결됨일 때만 활성.
  const isBluetoothConnected = useBluetoothStore((s) => s.isConnected);
  useVolumeNext({
    enabled: isAutoMode && isBluetoothConnected,
    onNext: () => { goNext(); useToastStore.getState().show(t('feed.nextShortToast')); },
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 웹뷰를 시스템 상태바 아래로 내려 유튜브 자체 헤더가 상태바와 겹치지 않게 한다(사용자 지시).
          상단 insets.top만큼은 검은 스트립(상태바 영역), 그 아래로 영상+유튜브 UI. */}
      {current && !feedBlocked && (
        <YouTubeShortsPlayer
          videoId={current.videoId}
          playing={playing}
          onProgress={handleProgress}
          onEnded={onEnded}
          onError={handlePlayerError} // 재생 불가 영상 스킵 — 단 연속 실패는 가드가 잡음(death-spiral 방지)
          onAudioDiag={(text) => setDiag((d) => ({ ...d, audio: text }))}
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
          <Pressable onPress={toggleAutoMode} hitSlop={8} style={[styles.sessionPill, isAutoMode && styles.sessionPillOn]}>
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
            {isAutoMode ? <View style={styles.sessionOnDot} /> : <Feather name="play" size={12} color="rgba(255,255,255,0.92)" />}
            <Text style={styles.sessionOnText}>{isAutoMode ? 'SESSION ON' : 'START SESSION'}</Text>
          </Pressable>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))} hitSlop={12} style={styles.appIconBtn}>
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
            <Text style={styles.appIconText}>P</Text>
          </Pressable>
        </View>

        {/* 🐞 임시: 음소거 오버레이 요소 진단 — 정확한 선택자 맞춘 뒤 제거 */}
        <View style={styles.diagBox} pointerEvents="none">
          <Text style={styles.diagText}>🔊 {diag.audio}</Text>
        </View>

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
    </View>
  );
}

// 벽시계 HH:MM(24시간) — 상태바용. 로케일 무관하게 항상 24h로 통일(숫자 시계 톤).
function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  // 2026-07-19 버그 수정: position:'absolute'가 빠져 있어서 이 UI 레이어가 WebView 플레이어와 같은
  // flex:1 형제로 화면 공간을 나눠 갖고 있었다(둘 다 flex:1이라 세로로 반반 분할) — 플레이어가 화면
  // 절반도 채 못 쓰는데 그 위에 UI가 덮이는 게 아니라 옆(아래)에 쌓이는 구조였던 것. overlay/
  // index.tsx의 같은 패턴(overlayLayer)은 이미 position:'absolute'로 올바르게 돼 있었다 — 이
  // 화면만 그 컨벤션이 빠져 있었음.
  uiLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md },
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
  diagBox: { alignSelf: 'center', marginTop: 8, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  diagText: { color: '#00E5A0', fontSize: 15, fontFamily: typography.monoFontFamilyBold, textAlign: 'center' },
  sessionOnDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  sessionOnText: { color: 'rgba(255,255,255,0.95)', fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 0.8 },
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
