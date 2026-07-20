import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { YouTubeShortsPlayer } from '../../components/feed/YouTubeShortsPlayer';
import { useShortsQueueStore } from '../../store/useShortsQueueStore';
import { useToastStore } from '../../store/useToastStore';
import { useFeedRemoteControl } from '../../hooks/useFeedRemoteControl';
import { hasRealYouTubeSource } from '../../services/api/youtube';
import { colors, radius, spacing, typography } from '../../constants/theme';

// iOS Pace Feed = YouTube Shorts "리스트 순차 재생"(2026-07-18 사용자 지시).
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의" 참고 — 큐에서 1 재생, 끝나면(onEnded) advance()로 다음.
// 재생은 공식 IFrame Player(합법). Pexels Pace Feed(usePlayerStore)는 코드베이스에 폴백 소스로 유지.
// NOTE(i18n): 스캐폴드 단계라 리터럴 문자열 — feed.* 키 배선은 후속 작업.
//
// 2026-07-19: Bluetooth(AirPods) 리모컨 상태 머신 도입(사용자 지시, 상태 전이표 정리 반영).
// PlayerStatus: IDLE(로딩 전) → READY(재생 대기) → PLAYING(시청 중) ↔ PAUSED.
// isAutoMode: 리모컨 Play/Pause로 토글하는 "손 안 대고 정주행" 스위치 — true면 영상이 끝나자마자
// advance()로 다음, false면 끝난 자리에서 멈추고(PAUSED) 사용자가 Next를 눌러야 넘어간다. 리모컨
// Next/Previous는 이 스위치와 무관하게 항상 즉시 이동(상태 전이표 규칙 A/B).
type PlayerStatus = 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED';

export default function PaceFeedScreen() {
  const router = useRouter();
  const queue = useShortsQueueStore((s) => s.queue);
  const isLoading = useShortsQueueStore((s) => s.isLoading);
  const isRefilling = useShortsQueueStore((s) => s.isRefilling);
  const error = useShortsQueueStore((s) => s.error);
  const loadInitial = useShortsQueueStore((s) => s.loadInitial);
  const advance = useShortsQueueStore((s) => s.advance);
  const goToPrevious = useShortsQueueStore((s) => s.goToPrevious);

  const [status, setStatus] = useState<PlayerStatus>('IDLE');
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [progress, setProgress] = useState(0); // 현재 영상 재생 진행률(0~1) — 고개짓 카메라 게이팅용
  const current = queue[0] ?? null;
  const usingScrape = !hasRealYouTubeSource();
  const playing = status === 'PLAYING' || status === 'READY';

  // iOS 고개짓(ARKit) 감지는 배터리를 위해 "Focus Session 켜짐 + 현재 영상 1/2 지점 이후"에만 켠다
  // (2026-07-20 사용자 지시 — Android가 손짓 카메라를 1/2지점부터 켜는 것과 동일 취지). 스냅은 쇼츠
  // 소리에 묻혀 신뢰도가 낮아 고개짓으로 전환. iOS는 TrueDepth라 소리 무관하게 강건.
  const headDetectActive = isAutoMode && progress >= 0.5;

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 큐가 처음 채워지면 IDLE→READY 전이(상태 전이표 규칙: FETCH_SUCCESS).
  useEffect(() => {
    if (status === 'IDLE' && queue.length > 0) setStatus('READY');
  }, [status, queue.length]);

  // 2026-07-19: Auto Mode를 앱이 백그라운드로 갈 때 자동으로 끈다 — 사용자 지시("카톡 확인하러
  // 잠깐 나갔다 5분 뒤 복귀하면 이미 여러 영상이 지나가 있는 걸 방지"). Bluetooth 연결 해제와는
  // 무관하게(그건 별개 입력장치일 뿐) 앱 자체의 포그라운드 상태만 본다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setIsAutoMode((prev) => (prev ? false : prev));
      }
    });
    return () => sub.remove();
  }, []);

  // Focus Session = 10분 제한 자동 진행(2026-07-20 사용자 지시, PACE_ARCHITECTURE.md "Focus Session =
  // 10분 제한 자동 진행"). Auto Mode(정주행)를 켠 시점부터 정확히 10분 뒤 자동으로 끈다 — 무기한
  // 지속을 막아 "사람이 세션을 켠다"는 결정적 트리거 안에서만 자동 진행되게 한다. 사용자가 10분 전에
  // 직접 끄거나(토글) 백그라운드로 나가면(위 AppState effect) 더 일찍 종료된다.
  useEffect(() => {
    if (!isAutoMode) return;
    const t = setTimeout(() => {
      setIsAutoMode(false);
      useToastStore.getState().show('⏱ Focus Session 종료 (10분 경과)');
    }, 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, [isAutoMode]);

  const goNext = () => {
    setStatus('PLAYING');
    setProgress(0); // 다음 영상 → 진행률 리셋(고개짓 카메라 게이팅을 다시 1/2지점 대기로)
    advance(); // 스킵도 시청 완료로 간주 → watched+history로 이동(리스트에서 삭제)
  };

  const goPrevious = () => {
    if (goToPrevious()) setStatus('PLAYING');
  };

  const toggleAutoMode = () => {
    setIsAutoMode((prev) => {
      const next = !prev;
      useToastStore.getState().show(next ? '▶️ Focus Session 시작 · 10분간 자동 진행' : '⏹ Focus Session 종료');
      return next;
    });
  };

  // Bluetooth 리모컨(iOS만 실제 동작 — .android.ts는 no-op, 상단 주석 참고).
  useFeedRemoteControl({
    onNext: () => { goNext(); useToastStore.getState().show('⏭ Next Short'); },
    onPrevious: () => { const moved = goToPrevious(); if (moved) { setStatus('PLAYING'); useToastStore.getState().show('⏮ Previous Short'); } },
    onToggleAutoMode: toggleAutoMode,
    headDetectActive, // iOS 고개짓 감지 ON 조건(Focus Session + 1/2지점 이후) — 배터리 게이팅
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
    <View style={styles.container}>
      {current && (
        <YouTubeShortsPlayer
          videoId={current.videoId}
          playing={playing}
          onProgress={setProgress}
          onEnded={onEnded}
          onError={() => goNext()} // 재생 불가한 영상(지역제한 등)은 건너뜀
        />
      )}

      <SafeAreaView style={styles.uiLayer} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          {/* 2026-07-20 실기기 감사 중 발견: 딥링크(pace://feed)로 바로 진입했을 때는 이 화면이
              네비게이션 스택의 첫 화면이라 router.back()이 되돌아갈 곳이 없어 "GO_BACK not handled"
              에러가 실제로 떴다(스크린샷으로 확인) — canGoBack()으로 방어. */}
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
            hitSlop={12}
            style={styles.iconBtn}
          >
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.categoryPill}>
            <Feather name="youtube" size={13} color="#FF4444" />
            <Text style={styles.categoryText}>Pace Feed · Shorts</Text>
          </View>
          <View style={styles.countPill}>
            <Text style={styles.countText}>{queue.length}{isRefilling ? '+' : ''}</Text>
          </View>
        </View>

        {usingScrape && (
          <View style={styles.fallbackBanner}>
            <Feather name="alert-triangle" size={12} color={colors.warning} />
            <Text style={styles.fallbackText}>스크래핑 모드 · EXPO_PUBLIC_YOUTUBE_API_KEY 설정 시 Data API</Text>
          </View>
        )}

        {/* 2026-07-21 실기기 발견: 이 가운데 spacer가 기본 pointerEvents=auto라 화면 중앙 탭을
            가로채 뒤의 YouTube WebView로 안 넘어갔다(→ "탭해도 재생 안 됨"). none으로 통과시켜
            iOS 첫탭 재생(자동재생 차단 우회)이 실제로 먹히게 한다. */}
        <View style={{ flex: 1 }} pointerEvents="none" />

        {current && (
          <View style={styles.bottom} pointerEvents="box-none">
            {/* 탭하여 Focus Session on/off. 켜면 10분 자동넘김 + (영상 1/2지점부터) 고개짓 감지 ON. */}
            <Pressable
              onPress={toggleAutoMode}
              hitSlop={8}
              style={[styles.autoModeBadge, isAutoMode ? styles.autoModeBadgeOn : styles.autoModeBadgeOff]}
            >
              <Feather name={isAutoMode ? 'zap' : 'play'} size={11} color={isAutoMode ? '#000000' : colors.textSecondary} />
              <Text style={[styles.autoModeBadgeText, isAutoMode && styles.autoModeBadgeTextOn]}>
                {isAutoMode ? 'Focus Session ON' : 'Focus Session 시작'}
              </Text>
            </Pressable>
            <Text style={styles.title} numberOfLines={2}>{current.title}</Text>
            {!!current.channelTitle && <Text style={styles.creator}>{current.channelTitle}</Text>}
            <View style={styles.controls}>
              <Pressable onPress={goPrevious} hitSlop={10} style={styles.ctrlBtn}>
                <Feather name="skip-back" size={20} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={() => setStatus((s) => (s === 'PAUSED' ? 'PLAYING' : 'PAUSED'))} hitSlop={10} style={styles.ctrlBtnMain}>
                <Feather name={playing ? 'pause' : 'play'} size={22} color="#000000" />
              </Pressable>
              <Pressable onPress={goNext} hitSlop={10} style={styles.ctrlBtn}>
                <Feather name="skip-forward" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>

      {isLoading && (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>Shorts 불러오는 중…</Text>
        </View>
      )}
      {!isLoading && !current && (
        <View style={styles.centerState}>
          <Feather name="cloud-off" size={28} color={colors.textSecondary} />
          <Text style={styles.stateText}>
            {error === 'EMPTY_FEED' ? '표시할 Shorts가 없습니다.' : 'Shorts를 불러오지 못했습니다.'}
          </Text>
          <Pressable onPress={() => loadInitial()} style={styles.retryBtn}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.45)' },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  categoryText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  countPill: { minWidth: 36, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  countText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.monoFontFamily },
  fallbackBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  fallbackText: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.bodyFontFamilyMedium },
  bottom: { paddingBottom: spacing.md, gap: spacing.xs },
  autoModeBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs },
  autoModeBadgeOn: { backgroundColor: colors.successLight },
  autoModeBadgeOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  autoModeBadgeText: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  autoModeBadgeTextOn: { color: '#000000' },
  title: { color: '#FFFFFF', fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold },
  creator: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.bodyFontFamilyBold },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.md },
  ctrlBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  ctrlBtnMain: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  centerState: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: '#000000' },
  stateText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyMedium },
  retryBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.button, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
});
