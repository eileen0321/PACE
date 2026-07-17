import { useCallback, useEffect } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { AppHeader } from '../../components/ui/AppHeader';
import { UsageHeroCard } from '../../components/cards/UsageHeroCard';
import { StartShortsButton } from '../../components/ui/StartShortsButton';
import { StatsGridCard } from '../../components/cards/StatsGridCard';
import { WeeklyGraphCard } from '../../components/cards/WeeklyGraphCard';
import { colors } from '../../constants/theme';

// healthy-shorts-assistant App.tsx의 Home 탭 레이아웃을 그대로 이식: Header → UsageHero → Start CTA
// → StatsGrid(+ Focus 이동 배너) → WeeklyGraph. Home은 세션 트리거 지점일 뿐, 실제 시청은
// /overlay(YouTube 등으로 전환 후 Pace가 상태바로만 관리)에서 이뤄진다 — PACE_ARCHITECTURE.md 참고.
export default function HomeScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const settings = useSettingsStore((s) => s.settings);
  const { todayUsageMinutes, todayVideosWatched, todayAverageDurationSeconds, weeklyStats, refresh } = useStatsStore();

  useEffect(() => {
    if (user?.id) refresh(user.id);
  }, [user?.id, refresh]);

  const isLimitReached = todayUsageMinutes >= settings.dailyLimitMinutes;

  const onStart = useCallback(() => {
    router.push('/overlay');
  }, [router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
        <UsageHeroCard minutesWatched={todayUsageMinutes} limitMinutes={settings.dailyLimitMinutes} />
        <StartShortsButton onPress={onStart} isLimitReached={isLimitReached} />
        <StatsGridCard
          videosWatched={todayVideosWatched}
          averageDurationSec={todayAverageDurationSeconds}
          settings={settings}
          onPressSettings={() => router.push('/(tabs)/focus')}
        />
        <WeeklyGraphCard weeklyStats={weeklyStats} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 32 },
});
