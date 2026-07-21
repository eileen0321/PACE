import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUserStore } from '../../store/useUserStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { AppHeader } from '../../components/ui/AppHeader';
import { SessionHeroCard } from '../../components/home/SessionHeroCard';
import { PlatformPickerCard } from '../../components/home/PlatformPickerCard';
import { QuickControlsGrid } from '../../components/home/QuickControlsGrid';
import { BluetoothOnboardingSheet } from '../../components/home/BluetoothOnboardingSheet';
import { ConnectingOverlay } from '../../components/home/ConnectingOverlay';
import { LimitReachedOverlay } from '../../components/home/LimitReachedOverlay';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { useTranslation } from '../../services/i18n';
import { launchPlatformApp } from '../../constants/supportedApps';
import { colors, layout, radius, spacing, typography } from '../../constants/theme';
import type { AppShieldTarget } from '../../types/models';

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
  const settings = useSettingsStore((s) => s.settings);
  const { todayUsageMinutes, refresh } = useStatsStore();
  const activeSessionPlatform = useSessionStore((s) => (s.status === 'running' ? s.platformApp : null));
  const isBluetoothConnected = useBluetoothStore((s) => s.isConnected);
  const refreshBluetooth = useBluetoothStore((s) => s.refresh);
  const toggleAutoMode = useBluetoothStore((s) => s.toggleAutoMode);
  const { extraMinutes: bonusMinutes, addMinutes: addBonusMinutes } = useDailyBonusStore();
  const [pendingPlatform, setPendingPlatform] = useState<AppShieldTarget | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<AppShieldTarget | null>(null);
  const [dismissedLimitReached, setDismissedLimitReached] = useState(false);

  // healthy-shorts-assistant(3) App.tsx의 "APPLE SCREEN TIME LOCKOUT OVERLAY" 이식 — 일일 한도 도달 시
  // Home에 전체화면 안내를 띄운다(LimitReachedOverlay.tsx). focus.tsx와 동일한 계산식(dailyLimitMinutes
  // + 오늘 보너스). isLimitReached가 false로 돌아오면(Extend Time으로 한도를 늘렸거나 자정이 지나
  // 새 날짜가 됐을 때) dismissedLimitReached도 리셋 — 다음에 다시 한도에 도달하면 새로 뜨게.
  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const isLimitReached = todayUsageMinutes >= effectiveDailyLimitMinutes;
  useEffect(() => {
    if (!isLimitReached) setDismissedLimitReached(false);
  }, [isLimitReached]);

  // 2026-07-18 실기기 검증 중 발견: mount 시 1회만 refresh하는 useEffect라 세션이 끝나고
  // router.back()으로 Home에 돌아와도(탭 자체는 재마운트되지 않으므로) "오늘 사용" 숫자가 세션
  // 시작 전 값에 멈춰 있는 버그를 직접 확인(664초짜리 세션이 끝났는데도 Home이 이전 세션 값을
  // 그대로 표시). useFocusEffect로 교체해 이 탭이 다시 포커스될 때마다(세션 종료 복귀 포함) 갱신.
  useFocusEffect(
    useCallback(() => {
      if (user?.id) refresh(user.id);
      refreshBluetooth();
    }, [user?.id, refresh, refreshBluetooth])
  );

  // 2026-07-19: Bluetooth Hands-Free 최초 1회 안내 — 첫 플랫폼 카드 탭에서 세션 시작 전에 가로챈다.
  // 이미 본 적 있으면(STORAGE_KEYS.bluetoothOnboardingSeen) 그냥 바로 세션 시작.
  // healthy-shorts-assistant(3) 이식 — 실제 /overlay 이동 전에 ConnectingOverlay 체크리스트
  // 애니메이션을 먼저 보여준다(App.tsx triggerConnectingSequence). 애니메이션이 끝나면
  // handleConnectingComplete가 실제 라우팅을 수행.
  const startSession = useCallback((platform: AppShieldTarget) => {
    // 2026-07-20 실기기 검증 중 발견: 예전엔 /overlay 화면이 마운트된 뒤(DB 조회 2번 + Connecting
    // 애니메이션 이후)에야 launchPlatformApp을 불렀는데, 그러면 원래 탭 제스처로부터 너무 늦어져
    // 안드로이드 백그라운드 액티비티 시작 제한에 조용히 막혔다(예외 없음 — 그냥 실행이 안 됨).
    // 탭과 최대한 가까운 지금 시점에 바로 부른다.
    launchPlatformApp(platform).catch(() => {});
    setConnectingPlatform(platform);
  }, []);

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

  // "YouTube"(그냥 열기) 카드 — Android는 Pace 추적 없이 유튜브 앱만 연다. iOS엔 "타 앱 위 오버레이"가
  // 없으므로(그리고 launchPlatformApp이 non-Android no-op이라 버튼이 죽어 있었음 — 감사발견) 인앱
  // Pace Feed로 보낸다.
  const openPlainYoutube = useCallback(() => {
    if (Platform.OS === 'ios') { router.push('/feed'); return; }
    launchPlatformApp('youtube').catch(() => {});
  }, [router]);

  const onSelectPlatform = useCallback((platform: AppShieldTarget) => {
    if (isLimitReached) {
      setDismissedLimitReached(false);
      return;
    }
    AsyncStorage.getItem(STORAGE_KEYS.bluetoothOnboardingSeen).then((seen) => {
      if (seen) {
        startSession(platform);
      } else {
        setPendingPlatform(platform);
      }
    }).catch(() => startSession(platform));
  }, [startSession, isLimitReached]);

  const dismissOnboarding = useCallback((enableAutoMode: boolean) => {
    AsyncStorage.setItem(STORAGE_KEYS.bluetoothOnboardingSeen, 'true').catch(() => {});
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
  const connectingCard = connectingPlatform ? { title: 'YouTube with PACE' } : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
        <SessionHeroCard minutesWatched={todayUsageMinutes} limitMinutes={effectiveDailyLimitMinutes} autoNextEnabled={settings.autoNext} />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('home.choosePlatform')}</Text>
          <View style={styles.tapBadge}>
            <Text style={styles.tapBadgeText}>{t('home.tapToStart')}</Text>
          </View>
        </View>
        <View style={styles.platformStack}>
          <PlatformPickerCard
            key="youtube-plain"
            title="YouTube"
            badge="OPEN"
            statusText="▶ No tracking, just watch"
            cover={YOUTUBE_COVER}
            gradientFrom="rgba(220,38,38,0.35)"
            onPress={openPlainYoutube}
          />
          <PlatformPickerCard
            key="youtube-pace"
            title="YouTube with PACE"
            badge="GUARDED"
            statusText={
              activeSessionPlatform === 'youtube'
                ? 'Active'
                : isBluetoothConnected
                  ? '🎧 Hands-Free Ready'
                  : '▶ Tracks time & enforces limits'
            }
            cover={YOUTUBE_COVER}
            gradientFrom="rgba(88,86,214,0.35)"
            onPress={() => onSelectPlatform('youtube')}
            isActive={activeSessionPlatform === 'youtube'}
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
        visible={isLimitReached && !dismissedLimitReached && activeSessionPlatform === null && pendingPlatform === null && connectingPlatform === null}
        limitMinutes={effectiveDailyLimitMinutes}
        onExtend={() => { addBonusMinutes(15); setDismissedLimitReached(false); }}
        onDismiss={() => setDismissedLimitReached(true)}
      />
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
