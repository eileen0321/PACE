import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { YouTubeShortsPlayer } from '../../components/feed/YouTubeShortsPlayer';
import { useShortsQueueStore } from '../../store/useShortsQueueStore';
import { hasYouTubeKey } from '../../services/api/youtube';
import { colors, radius, spacing, typography } from '../../constants/theme';

// iOS Pace Feed = YouTube Shorts "리스트 순차 재생"(2026-07-18 사용자 지시).
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의" 참고 — 큐에서 1 재생, 끝나면(onEnded) advance()로 다음.
// 재생은 공식 IFrame Player(합법). Pexels Pace Feed(usePlayerStore)는 코드베이스에 폴백 소스로 유지.
// NOTE(i18n): 스캐폴드 단계라 리터럴 문자열 — feed.* 키 배선은 후속 작업.
export default function PaceFeedScreen() {
  const router = useRouter();
  const queue = useShortsQueueStore((s) => s.queue);
  const isLoading = useShortsQueueStore((s) => s.isLoading);
  const isRefilling = useShortsQueueStore((s) => s.isRefilling);
  const error = useShortsQueueStore((s) => s.error);
  const loadInitial = useShortsQueueStore((s) => s.loadInitial);
  const advance = useShortsQueueStore((s) => s.advance);

  const [playing, setPlaying] = useState(true);
  const current = queue[0] ?? null;
  const usingScrape = !hasYouTubeKey();

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNext = () => {
    setPlaying(true);
    advance(); // 스킵도 시청 완료로 간주 → watched로 이동(리스트에서 삭제)
  };

  return (
    <View style={styles.container}>
      {current && (
        <YouTubeShortsPlayer
          videoId={current.videoId}
          playing={playing}
          onEnded={() => {
            setPlaying(true);
            advance();
          }}
          onError={() => advance()} // 재생 불가한 영상(지역제한 등)은 건너뜀
        />
      )}

      <SafeAreaView style={styles.uiLayer} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
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

        <View style={{ flex: 1 }} />

        {current && (
          <View style={styles.bottom} pointerEvents="box-none">
            <Text style={styles.title} numberOfLines={2}>{current.title}</Text>
            {!!current.channelTitle && <Text style={styles.creator}>{current.channelTitle}</Text>}
            <View style={styles.controls}>
              <Pressable onPress={() => setPlaying((v) => !v)} hitSlop={10} style={styles.ctrlBtnMain}>
                <Feather name={playing ? 'pause' : 'play'} size={22} color="#000000" />
              </Pressable>
              <Pressable onPress={onNext} hitSlop={10} style={styles.ctrlBtn}>
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
  uiLayer: { flex: 1, paddingHorizontal: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.45)' },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  categoryText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  countPill: { minWidth: 36, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  countText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.monoFontFamily },
  fallbackBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  fallbackText: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.bodyFontFamilyMedium },
  bottom: { paddingBottom: spacing.md, gap: spacing.xs },
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
