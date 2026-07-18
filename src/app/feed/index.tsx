import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import { usePlayerStore } from '../../store/usePlayerStore';
import { PACE_FEED_CATEGORIES } from '../../constants/paceFeed';
import { colors, radius, spacing, typography } from '../../constants/theme';

// iOS Pace Feed 플레이어 — Screen Time으로 차단한 실제 숏폼의 "건강한 대체 출구"(2026-07-18 iOS 전략
// 확정, PACE_ARCHITECTURE.md 참고). Pexels 라이선스 콘텐츠를 자체 <Video>로 재생하고 Auto-Next로
// 자동 넘김한다 — 우리 콘텐츠라 YouTube WebView 래핑(원안 ①)의 약관/심사 리스크가 없다.
// NOTE(i18n): 스캐폴드 단계라 문자열은 리터럴 — services/i18n의 feed.* 키 배선은 후속 작업.
export default function PaceFeedScreen() {
  const router = useRouter();
  const playlist = usePlayerStore((s) => s.playlist);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const autoNext = usePlayerStore((s) => s.autoNext);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const error = usePlayerStore((s) => s.error);
  const usingFallback = usePlayerStore((s) => s.usingFallback);
  const category = usePlayerStore((s) => s.category);
  const loadFeed = usePlayerStore((s) => s.loadFeed);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const toggleAutoNext = usePlayerStore((s) => s.toggleAutoNext);
  const endSession = usePlayerStore((s) => s.endSession);

  const current = playlist[index] ?? null;
  const categoryLabel = PACE_FEED_CATEGORIES.find((c) => c.key === category)?.label ?? category;

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  // 최초 진입 시 피드 로드, 언마운트 시 세션 종료.
  useEffect(() => {
    loadFeed();
    return () => {
      endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 영상이 바뀌면 소스를 교체하고 재생.
  useEffect(() => {
    if (!current?.url) return;
    player.replace(current.url);
    player.play();
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.url]);

  // 재생/일시정지 상태를 실제 플레이어에 반영.
  useEffect(() => {
    if (isPlaying) player.play();
    else player.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // 영상 종료 → Auto-Next면 다음으로(watched++), 아니면 정지. stale closure 방지로 getState 사용.
  useEventListener(player, 'playToEnd', () => {
    const st = usePlayerStore.getState();
    if (st.autoNext) st.next(true);
    else st.setPlaying(false);
  });

  const onClose = () => {
    endSession();
    router.back();
  };

  return (
    <View style={styles.container}>
      {current && (
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="cover"
          nativeControls={false}
        />
      )}

      {/* 탭 영역: 화면 중앙 = 재생/일시정지 */}
      <Pressable style={styles.tapLayer} onPress={() => setPlaying(!isPlaying)} />

      <SafeAreaView style={styles.uiLayer} edges={['top', 'bottom']} pointerEvents="box-none">
        {/* 상단 바 */}
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.categoryPill}>
            <Feather name="wind" size={12} color={colors.successLight} />
            <Text style={styles.categoryText}>Pace Feed · {categoryLabel}</Text>
          </View>
          <Pressable onPress={toggleAutoNext} hitSlop={12} style={[styles.autoNextBtn, autoNext && styles.autoNextBtnOn]}>
            <Feather name={autoNext ? 'chevrons-down' : 'pause-circle'} size={13} color={autoNext ? '#000000' : '#FFFFFF'} />
            <Text style={[styles.autoNextText, autoNext && styles.autoNextTextOn]}>{autoNext ? 'Next On' : 'Next Off'}</Text>
          </Pressable>
        </View>

        {/* DEV 폴백 배너 */}
        {usingFallback && (
          <View style={styles.fallbackBanner}>
            <Feather name="alert-triangle" size={12} color={colors.warning} />
            <Text style={styles.fallbackText}>DEV 샘플 피드 · EXPO_PUBLIC_PEXELS_KEY 설정 시 실제 Pace Feed</Text>
          </View>
        )}

        <View style={{ flex: 1 }} />

        {/* 하단 정보 + 컨트롤 */}
        {current && (
          <View style={styles.bottom} pointerEvents="box-none">
            <Text style={styles.title}>{current.title}</Text>
            <Text style={styles.creator}>{current.creator}</Text>
            <View style={styles.controls}>
              <Pressable onPress={prev} hitSlop={10} style={styles.ctrlBtn}>
                <Feather name="skip-back" size={20} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={() => setPlaying(!isPlaying)} hitSlop={10} style={styles.ctrlBtnMain}>
                <Feather name={isPlaying ? 'pause' : 'play'} size={22} color="#000000" />
              </Pressable>
              <Pressable onPress={() => next(false)} hitSlop={10} style={styles.ctrlBtn}>
                <Feather name="skip-forward" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text style={styles.counter}>{index + 1} / {playlist.length}</Text>
          </View>
        )}
      </SafeAreaView>

      {/* 로딩/에러 상태 */}
      {isLoading && (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>Pace Feed 불러오는 중…</Text>
        </View>
      )}
      {!isLoading && error && (
        <View style={styles.centerState}>
          <Feather name="cloud-off" size={28} color={colors.textSecondary} />
          <Text style={styles.stateText}>
            {error === 'EMPTY_FEED' ? '표시할 영상이 없습니다.' : '피드를 불러오지 못했습니다.'}
          </Text>
          <Pressable onPress={() => loadFeed()} style={styles.retryBtn}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cardMuted },
  tapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  uiLayer: { flex: 1, paddingHorizontal: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.35)' },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  categoryText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  autoNextBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  autoNextBtnOn: { backgroundColor: colors.successLight },
  autoNextText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  autoNextTextOn: { color: '#000000' },
  fallbackBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  fallbackText: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.bodyFontFamilyMedium },
  bottom: { paddingBottom: spacing.md, gap: spacing.xs },
  title: { color: '#FFFFFF', fontSize: 18, fontFamily: typography.bodyFontFamilyExtrabold },
  creator: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.bodyFontFamilyBold },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.md },
  ctrlBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  ctrlBtnMain: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  counter: { color: colors.textTertiary, fontSize: 11, fontFamily: typography.monoFontFamily, textAlign: 'center', marginTop: spacing.sm },
  centerState: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.cardMuted },
  stateText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyMedium },
  retryBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.button, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
});
