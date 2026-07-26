import { useEffect } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useUserStore } from '../../store/useUserStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useAttendanceStore, getLast7Days, getCurrentStreak } from '../../store/useAttendanceStore';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { colors, radius, spacing, typography } from '../../constants/theme';

// getLast7Days()(useAttendanceStore, 순수 함수라 t() 접근 불가)가 넘겨주는 dayIndex(0=일~6=토,
// Date.getDay()와 동일)를 실제 번역 키로 매핑 — settings.tsx에서 그대로 가져옴(2026-07-27, Weekly
// Attendance를 Focus 탭으로 이동).
const DAY_INDEX_KEYS: TranslationKey[] = [
  'stats.daySun', 'stats.dayMon', 'stats.dayTue', 'stats.dayWed', 'stats.dayThu', 'stats.dayFri', 'stats.daySat',
];

// healthy-shorts-assistant(2) SettingsSection.tsx(Focus 탭)를 토씨 하나 안 틀리고 그대로 이식
// (사용자 명시적 지시)으로 시작했으나, 2026-07-22 사용자 지시로 여러 차례 단순화됨 — Session
// Status/Android Guard Services 카드는 Settings 화면으로 이전(settings.tsx 참고), Session Stats
// 3그리드는 분석(Stats) 탭과 중복이라 삭제, Hands-Free Control(Previous/Next/Auto Mode 버튼)과
// Session Controls(Auto Next 토글 + End Session 버튼, 딸린 Finish Session 확인 모달 포함)도 삭제
// — Focus 탭을 Session Control Hero → Extend Time → Interventions → (iOS)Pace Feed 진입만 남겨
// 단순화. 원본은 minutesWatched를 로컬 데모 state로 관리했는데, Pace는 실제 useStatsStore
// (todayUsageMinutes) 데이터로 대체했다 — "죽은 코드/가짜 데이터로 남기지 말라"는 별도 지시에 따름.
// Break Reminder/Healthy Pause 토글도 실제 useSettingsStore에 연결.
export default function FocusScreen() {
  const { t } = useTranslation();
  const user = useUserStore((s) => s.user);
  const adBannerHeight = useAdBannerStore((s) => s.height);
  const tabBarHeight = useAdBannerStore((s) => s.tabBarHeight);
  const { settings, update } = useSettingsStore();
  const { todayUsageMinutes, refresh } = useStatsStore();
  const { extraMinutes: bonusMinutes } = useDailyBonusStore();
  const attendanceHistory = useAttendanceStore((s) => s.history);
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  const currentStreak = getCurrentStreak(attendanceHistory);

  useEffect(() => {
    if (user?.id) refresh(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refresh]);

  // 2026-07-18 버그 수정: Extend Time(+10/20/30m)이 예전엔 settings.dailyLimitMinutes를 직접 올려버려서
  // "오늘만" 늘려주려던 의도와 달리 다음날 이후에도 영구히 늘어난 한도가 유지됐다. 이제 오늘 하루치
  // 보너스(useDailyBonusStore, 날짜 바뀌면 자동 리셋)를 더해서만 계산 — 영속 설정 자체는 안 건드린다.
  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const remainingMinutes = Math.max(0, effectiveDailyLimitMinutes - todayUsageMinutes);
  const progressPct = Math.min(100, (todayUsageMinutes / Math.max(1, effectiveDailyLimitMinutes)) * 100);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        {/* 1. Session Control Hero */}
        <LinearGradient colors={['#1A1D26', colors.cardDeep]} style={styles.heroCard}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTagText}>{t('focus.liveEngine')}</Text>
          </View>
          <Text style={styles.heroLabel}>{t('focus.focusSession')}</Text>
          <Text style={styles.heroTitle}>YouTube</Text>

          <View style={styles.splitRow}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>{t('focus.watched')}</Text>
              <Text style={styles.splitValue}>{todayUsageMinutes}m</Text>
            </View>
            <View style={[styles.splitCol, styles.splitColRight]}>
              <Text style={styles.splitLabel}>{t('focus.remaining')}</Text>
              <Text style={[styles.splitValue, styles.splitValuePrimary]}>{remainingMinutes}m</Text>
            </View>
          </View>

          <View style={styles.heroTrack}>
            <View style={[styles.heroFill, { width: `${progressPct}%` }]} />
          </View>
        </LinearGradient>

        {/* 2026-07-27 사용자 지시로 Settings에서 이동 — 설정값이 아니라 "매일 확인하는 상태/습관
            기록"이라 Focus의 실시간 상태 성격에 더 맞음(원래 2026-07-26에 Settings에 추가됐던 것,
            스트릭 숫자 강조 + 연속된 날끼리 이어지는 선의 Duolingo류 스트릭 UI 패턴). */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.weeklyAttendance')}</Text>
          <GlassSurface style={[styles.card, styles.attendanceCard]}>
            {currentStreak > 0 && (
              <View style={styles.attendanceStreakRow}>
                <Feather name="zap" size={14} color={colors.successLight} />
                <Text style={styles.attendanceStreakText}>{t('settings.attendanceStreak', { n: currentStreak })}</Text>
              </View>
            )}
            <View style={styles.attendanceRow}>
              {getLast7Days(attendanceHistory).map((day) => (
                <View key={day.date} style={styles.attendanceDay}>
                  <Text style={styles.attendanceDayLabel}>{t(DAY_INDEX_KEYS[day.dayIndex])}</Text>
                  <View style={styles.attendanceDotColumn}>
                    {/* 연속된 출석일끼리 칸 전체 폭의 바가 서로 맞닿아 하나의 선처럼 이어짐 —
                        빠진 날은 바 자체가 없어 그 지점에서 자연스럽게 끊김. */}
                    {day.attended && <View style={styles.attendanceConnector} />}
                    <View
                      style={[
                        styles.attendanceDot,
                        day.attended && styles.attendanceDotFilled,
                        day.isToday && styles.attendanceDotToday,
                      ]}
                    >
                      {day.attended && <Feather name="check" size={12} color="#0B0C0F" />}
                    </View>
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.attendanceFooter}>
              <Feather name="star" size={12} color={colors.successLight} />
              <Text style={styles.attendanceFooterText}>{t('settings.attendanceBonusCredits', { n: bonusCredits })}</Text>
            </View>
          </GlassSurface>
        </View>

        {/* 2026-07-27 사용자 지시 — "Extend Time"(+10/20/30m) 섹션 삭제. 코드 확인 결과 광고/프리미엄
            게이팅이 전혀 없는 useDailyBonusStore.addMinutes를 무제한으로 호출해, Daily Limit 자체를
            완전히 무력화하는 구멍이었다(LimitReachedOverlay의 광고 기반 +5분과 같은 저장소를 공짜로
            무한히 채울 수 있었음). Daily Limit을 늘리고 싶으면 Settings/Home에서 그 설정 자체를
            의식적으로 바꾸는 게 맞다는 판단 — bonusMinutes(광고로 받은 보너스)는 계산에 여전히
            반영되지만, 이 화면에서 직접 더하는 경로는 제거. */}

        {/* 3. Interventions & Shields */}
        {/* 2026-07-20 실기기 감사 중 발견(맥 세션 QA_ISSUES_2026-07-18.md #13) — "15분마다 작동"이
            하드코딩 라벨이라 실제 breakIntervalMinutes(기본 20분, Settings에서 10/20/30분 등으로
            변경 가능)와 어긋나 있었다. 게다가 여기서 토글을 켜면 실제 설정값과 무관하게 항상 15로
            덮어써서 값이 흐트러졌다 — 라벨을 실제값으로 표시하고, 토글 ON 시에도 기본값(20)으로
            통일해 최소한 다른 화면과 어긋나지 않게 정정. */}
        <GlassSurface style={styles.card}>
          <View style={styles.interventionRow}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.breakReminder')}</Text>
              <Text style={styles.interventionSub}>{t('focus.everyNMinutes', { n: settings.breakIntervalMinutes || DEFAULT_SETTINGS.breakIntervalMinutes })}</Text>
            </View>
            <Switch
              value={settings.breakIntervalMinutes > 0}
              onValueChange={(v) => update({ breakIntervalMinutes: v ? DEFAULT_SETTINGS.breakIntervalMinutes : 0 })}
              trackColor={{ true: colors.primary, false: '#262626' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#262626"
            />
          </View>
        </GlassSurface>

        {/* 2026-07-27 사용자 지시로 Pace Feed 진입 섹션 제거 — 홈의 YouTube 카드 탭이 이미 /feed로
            들어가므로(home.tsx, iOS) 집중화면의 진입 버튼은 중복이었다. dev Shorts POC 버튼도 함께 제거. */}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg },

  heroCard: { borderRadius: 30, padding: 24, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  liveTag: { position: 'absolute', top: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: '#A5B4FC', letterSpacing: 0.5, textTransform: 'uppercase' },
  heroLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase' },
  heroTitle: { fontSize: 24, fontFamily: typography.displayFontFamily, color: colors.textPrimary, marginTop: 4 },
  splitRow: { flexDirection: 'row', gap: spacing.md, paddingTop: 6 },
  splitCol: { flex: 1, borderLeftWidth: 2, borderLeftColor: `${colors.primary}66`, paddingLeft: spacing.sm },
  splitColRight: { borderLeftColor: `${colors.primary}CC` },
  splitLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  splitValue: { fontSize: 20, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary, marginTop: 2 },
  splitValuePrimary: { color: colors.primary },
  heroTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, overflow: 'hidden' },
  heroFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },

  sectionLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },

  // 2026-07-27 Settings에서 이동 — 요일 7칸, 출석한 날은 채운 원+체크, 오늘은 테두리로 강조.
  // 하단에 누적 보너스 크레딧(useAttendanceStore.bonusCredits) 표시.
  attendanceCard: { paddingVertical: 20 },
  attendanceStreakRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  attendanceStreakText: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  attendanceRow: { flexDirection: 'row', justifyContent: 'space-between' },
  attendanceDay: { alignItems: 'center', gap: 6, flex: 1 },
  attendanceDayLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilySemibold, color: colors.textTertiary },
  attendanceDotColumn: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  attendanceConnector: { position: 'absolute', left: 0, right: 0, top: '50%', height: 2, marginTop: -1, backgroundColor: colors.successLight },
  attendanceDot: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  attendanceDotFilled: { backgroundColor: colors.successLight, borderColor: colors.successLight },
  attendanceDotToday: { borderColor: colors.primary, borderWidth: 1.5 },
  attendanceFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  attendanceFooterText: { fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, color: colors.textSecondary },

  interventionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  interventionTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  interventionSub: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#818CF8', marginTop: 2 },
});
