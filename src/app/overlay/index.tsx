import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { OverlayBar } from '../../components/overlays/OverlayBar'; // Metro가 .android.tsx/.ios.tsx를 자동 선택
import { OverlayExpandedCard } from '../../components/overlays/shared/OverlayExpandedCard';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useUserStore } from '../../store/useUserStore';
import { useAutoNextStore } from '../../store/useAutoNextStore';
import { overlayService } from '../../services/platform';
import { startSession, endSession as endSessionRow, logOverlayEvent } from '../../database/repositories/sessionsRepository';
import { getTodayUsageMinutes } from '../../database/repositories/statsRepository';
import { CURATED_VIDEOS } from '../../constants/curatedVideos';
import { colors, radius, spacing } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import type { SessionEndStatus } from '../../types/models';

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];

// 세션 시작 직후 화면. 실기기 프로덕션에서는 여기서 사용자가 홈 버튼/앱 스위처로 YouTube 등으로
// 전환하고, Android는 시스템 오버레이가, iOS는 Live Activity가 이어서 표시를 담당한다
// (PACE_ARCHITECTURE.md 참고). 아래 "underlying content" 영역은 실제 프로덕션에는 존재하지 않고,
// 네이티브 오버레이/Live Activity 모듈이 붙기 전까지 개발/테스트에서 오버레이-위-콘텐츠 상호작용을
// 눈으로 확인하기 위한 시뮬레이터일 뿐이다(healthy-shorts-assistant ShortsPlayer.tsx의 데모 콘텐츠 이식).
export default function OverlaySessionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const timer = useTimerStore();
  const autoNextRuntime = useAutoNextStore();
  const [expanded, setExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [videoIndex, setVideoIndex] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const endReasonRef = useRef<SessionEndStatus>('manual_stop');

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const id = await startSession(user.id, null);
      sessionIdRef.current = id;
      const todayUsedMinutes = await getTodayUsageMinutes(user.id);
      const remainingMinutes = Math.max(0, settings.dailyLimitMinutes - todayUsedMinutes);
      timer.startSession({
        sessionId: id,
        remainingMinutes,
        sleepTimerMinutes: settings.sleepTimerMinutes,
        breakIntervalMinutes: settings.breakIntervalMinutes,
      });
      if (settings.autoNext) autoNextRuntime.start(null);
      // Android 실기기에서 native 모듈이 링크돼 있으면 시스템 오버레이도 함께 띄운다(미링크 시 no-op).
      overlayService.startSession({
        dailyLimitMinutes: settings.dailyLimitMinutes,
        remainingMinutes,
        autoNext: settings.autoNext,
      }).catch(() => {});
    })();

    return () => {
      if (sessionIdRef.current && user.id) {
        endSessionRow(sessionIdRef.current, 0, videoIndex + 1, endReasonRef.current).catch(() => {});
        logOverlayEvent(user.id, sessionIdRef.current, 'SESSION_STOP', endReasonRef.current).catch(() => {});
      }
      timer.endSession();
      autoNextRuntime.stop();
      overlayService.endSession().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 남은 시간/수면 타이머가 0에 도달하면 세션 종료 사유를 기록(수동 Stop과 구분) + 네이티브 오버레이 갱신.
  useEffect(() => {
    if (timer.remainingMinutes <= 0) endReasonRef.current = 'daily_limit_reached';
    else if (timer.sleepTimerRemainingMinutes === 0) endReasonRef.current = 'sleep_timer_expired';
    overlayService.updateRemaining(timer.remainingMinutes).catch(() => {});
  }, [timer.remainingMinutes, timer.sleepTimerRemainingMinutes]);

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
    router.back();
  };

  const video = CURATED_VIDEOS[videoIndex];

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.overlayLayer} edges={['top']}>
        <OverlayBar
          remainingMinutes={timer.remainingMinutes}
          autoNextEnabled={settings.autoNext}
          onToggleAutoNext={() => updateSettings({ autoNext: !settings.autoNext })}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
        {expanded && (
          <View style={styles.expandedWrap}>
            <OverlayExpandedCard
              todayUsedMinutes={settings.dailyLimitMinutes - timer.remainingMinutes}
              dailyLimitMinutes={settings.dailyLimitMinutes}
              remainingMinutes={timer.remainingMinutes}
              autoNextEnabled={settings.autoNext}
              onToggleAutoNext={() => updateSettings({ autoNext: !settings.autoNext })}
              sleepTimerMinutes={settings.sleepTimerMinutes}
              onCycleSleepTimer={() => {
                const idx = SLEEP_TIMER_OPTIONS.indexOf(settings.sleepTimerMinutes ?? 0);
                updateSettings({ sleepTimerMinutes: SLEEP_TIMER_OPTIONS[(idx + 1) % SLEEP_TIMER_OPTIONS.length] || null });
              }}
              isPlaying={isPlaying}
              onTogglePlaying={() => { setIsPlaying((v) => !v); setExpanded(false); }}
              onStop={onStop}
            />
          </View>
        )}
      </SafeAreaView>

      {/* --- 개발용 시뮬레이터 콘텐츠(프로덕션에는 없음, 실제 숏폼 앱이 이 자리를 대체) --- */}
      <View style={styles.simContent}>
        <Text style={styles.simCategory}>{video.category}</Text>
        <Text style={styles.simTitle}>{video.title}</Text>
        <Text style={styles.simDesc}>{video.description}</Text>
        <Text style={styles.simCreator}>{video.creator}</Text>
        <View style={styles.simDots}>
          <Feather name="more-horizontal" size={20} color="rgba(255,255,255,0.4)" />
        </View>
      </View>

      <View style={styles.devBadge}>
        <Text style={styles.devBadgeText}>{t('overlay.devSimulator')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  overlayLayer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  expandedWrap: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  simContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  simCategory: { color: '#30D158', fontSize: 10, fontWeight: '800', letterSpacing: 1, backgroundColor: 'rgba(48,209,88,0.1)', borderWidth: 1, borderColor: 'rgba(48,209,88,0.2)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  simTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  simDesc: { color: '#9CA3AF', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  simCreator: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: spacing.sm },
  simDots: { marginTop: spacing.md },
  devBadge: { position: 'absolute', bottom: spacing.lg, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  devBadgeText: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});
