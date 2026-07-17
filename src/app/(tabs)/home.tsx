import { useCallback, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { AppHeader } from '../../components/ui/AppHeader';
import { SessionHeroCard } from '../../components/home/SessionHeroCard';
import { PlatformPickerCard } from '../../components/home/PlatformPickerCard';
import { QuickControlsGrid } from '../../components/home/QuickControlsGrid';
import { colors, layout, radius, spacing, typography } from '../../constants/theme';
import type { AppShieldTarget } from '../../types/models';

const YOUTUBE_COVER = require('../../../assets/covers/youtube.jpg');
const INSTAGRAM_COVER = require('../../../assets/covers/instagram.jpg');
const TIKTOK_COVER = require('../../../assets/covers/tiktok.jpg');

// healthy-shorts-assistant(2) App.tsx의 Home 탭(다크 리스킨)을 토씨 하나 안 틀리고 그대로 이식
// (App.tsx:280-399, 사용자 명시적 지시). 3개 플랫폼 카드는 세로 풀와이드 스택(App.tsx:342
// space-y-3), "CHOOSE PLATFORM" 헤더 옆 "TAP TO START" 배지 포함. 원본의
// UsageHero/StartShortsButton/StatsGrid는 이 화면에서 완전히 대체됐다. 플랫폼 카드 탭 →
// /overlay로 실제 세션 시작 + platform 파라미터 전달(오버레이 화면이 Android에서 실제 앱 실행까지
// 담당, overlay/index.tsx 참고).
// 중요: App.tsx Home 탭 전체(App.tsx:278-457)는 translations 딕셔너리를 전혀 안 쓴다 — 섹션
// 타이틀/플랫폼명/상태문구 전부 하드코딩 영어이고 한국어 locale이어도 안 바뀐다(Focus/Settings/
// Stats 탭만 실제로 번역됨). 이전에 이 화면 전체를 t()로 잘못 번역했더니 한국어 문자열이 원본보다
// 길어서 고정폭 카드/그리드를 넘치는 오버플로우가 실제로 발생했다 — 그래서 원본처럼 항상 영어로 고정.
export default function HomeScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const settings = useSettingsStore((s) => s.settings);
  const { todayUsageMinutes, refresh } = useStatsStore();

  useEffect(() => {
    if (user?.id) refresh(user.id);
  }, [user?.id, refresh]);

  const isLimitReached = todayUsageMinutes >= settings.dailyLimitMinutes;

  const onSelectPlatform = useCallback((platform: AppShieldTarget) => {
    router.push({ pathname: '/overlay', params: { platform } });
  }, [router]);

  const PLATFORM_CARDS: { id: AppShieldTarget; title: string; cover: ImageSourcePropType; gradientFrom: string; statusAutoNext: string; statusShield: string }[] = [
    { id: 'youtube', title: 'YouTube Shorts', cover: YOUTUBE_COVER, gradientFrom: 'rgba(220,38,38,0.35)', statusAutoNext: 'Auto Next Ready', statusShield: 'Continuous Watch Shield Active' },
    { id: 'instagram', title: 'Instagram Reels', cover: INSTAGRAM_COVER, gradientFrom: 'rgba(219,39,119,0.35)', statusAutoNext: 'Auto Next Ready', statusShield: 'Breathe Friction Guard Active' },
    { id: 'tiktok', title: 'TikTok Video Loop', cover: TIKTOK_COVER, gradientFrom: 'rgba(13,148,136,0.35)', statusAutoNext: 'Auto Next Ready', statusShield: 'Anti-Scroll Intervention Ready' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
        <SessionHeroCard minutesWatched={todayUsageMinutes} limitMinutes={settings.dailyLimitMinutes} autoNextEnabled={settings.autoNext} />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Choose Platform</Text>
          <View style={styles.tapBadge}>
            <Text style={styles.tapBadgeText}>Tap to Start</Text>
          </View>
        </View>
        <View style={styles.platformStack}>
          {PLATFORM_CARDS.map((p) => (
            <PlatformPickerCard
              key={p.id}
              title={p.title}
              statusText={settings.autoNext ? p.statusAutoNext : p.statusShield}
              cover={p.cover}
              gradientFrom={p.gradientFrom}
              onPress={() => onSelectPlatform(p.id)}
              disabled={isLimitReached}
            />
          ))}
        </View>

        <Text style={[styles.sectionTitle, styles.quickControlsTitle]}>Quick Controls</Text>
        <QuickControlsGrid />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: layout.tabBarContentClearance },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 28, marginTop: spacing.lg, marginBottom: 12 },
  sectionTitle: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase' },
  quickControlsTitle: { paddingHorizontal: 28, marginTop: spacing.lg, marginBottom: 10 },
  tapBadge: { backgroundColor: `${colors.primary}1A`, borderWidth: 1, borderColor: `${colors.primary}33`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tapBadgeText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, letterSpacing: 0.5, textTransform: 'uppercase' },
  platformStack: { paddingHorizontal: 24, gap: 12 },
});
