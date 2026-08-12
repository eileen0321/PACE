import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useUserStore } from '../../store/useUserStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useFlipStore } from '../../store/useFlipStore';
import { useAttendanceStore } from '../../store/useAttendanceStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { capabilities, overlayService } from '../../services/platform';
import { pushUnsyncedSessions } from '../../services/sync/backendSync';
import { getTodayUsageMinutes } from '../../database/repositories/statsRepository';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { AppHeader } from '../../components/ui/AppHeader';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { WeeklyGraphCard } from '../../components/cards/WeeklyGraphCard';
import { colors, gradients, radius, sourceColors, spacing, typography } from '../../constants/theme';
import type { DailyStats } from '../../types/models';
import { toLocalDateStr } from '../../utils/date';

// healthy-shorts-assistant(2) StatsTab.tsx(components/StatsTab.tsx)를 토씨 하나 안 틀리고 그대로
// 이식 — 이전 버전은 완전히 다른 자체 구조("Insights" 대형 타이틀 + 연속기록/웰니스 요약/Platform
// 비중/WeeklyGraphCard(구프로토타입 컴포넌트)/Wholesome Feed Breakdown)였는데, 실제 소스엔 그런
// 섹션이 없다 — This Week Hero → Focus Score+Healthy Streak 2단 그리드 → Today's Behavior(3행) →
// Weekly Activity(요일별 바 리스트+목표선) → Best Day 카드 순.
// 2026-07-26에 "앱이 YouTube 하나뿐이라 항상 100%로만 나온다"며 Platform Breakdown을 통째로
// 지웠다가(c0cb9b6), 2026-08-12 틱톡이 들어오면서 **되살렸다**(아래 4-B 섹션 + store의
// todayUsageByApp + getTodayUsageByApp 쿼리). 앱이 하나뿐인 사용자에겐 여전히 숨기므로
// 2026-07-26의 판단도 그대로 유효하다.
// 원본은 4h 26m/82점/18%/31개 자동넘김/Mon-Sun 요일별 분/Best Day="Friday" 전부 하드코딩 데모
// 숫자다(videosWatched/averageDuration만 실제 prop이었고 그마저 0이면 `|| 42`/`|| 31`로 가짜값
// 대체). "가짜 데이터로 채우지 말라"는 지시에 따라:
//  - This Week 합계: 실제 weeklyStats 합산으로 대체. 지난주 대비 증감(%)은 2026-07-18에
//    getPreviousWeekStats() 추가로 gap 해소 — 지난주 기록이 없으면 "지난주 기록이 아직 없어요"로 표시.
//  - Focus Score: 2026-07-18에 정직한 로컬 정의를 붙였다(useStatsStore.computeFocusScore 참고) —
//    "이번 주 사용 기록이 있는 날 중 일일 한도 이내로 마친 날의 비율"(0~100). 서버가 산출하는 개념이
//    아니라 로컬 데이터만으로 계산해 매번 새로 구한다(별도 저장 없음). 사용 기록이 없으면 "아직 기록
//    없음"으로 표시. "이번 주 일평균"은 그대로 별도 카드로 유지(다른 지표라 병존).
//  - Healthy Streak: 실제 계산(computeStreak) 그대로 사용.
//  - Today's Behavior: videosWatched/averageDuration 실제값. Longest Session도
//    getWeeklyStats()가 이미 longestSessionSeconds를 리턴해서(과거엔 안 쓰던 필드) 오늘자 값을
//    실제로 뽑아 쓴다.
//  - Auto Next Impact 섹션: "자동 넘김된 영상 수" 카운터가 스키마에 없어 통째로 미포함(gap).
//  - Weekly Activity: 실제 weeklyStats + 실제 dailyLimitMinutes를 목표선으로 사용(요일별 60m
//    하드코딩 대신).
//  - Best Day: 실제 데이터에서 "목표 이내로 가장 알차게 쓴 날"(0보다 크고 한도 이하인 날 중 최댓값)
//    계산 — 없으면 빈 상태 문구.
export default function StatsScreen() {
  const { t } = useTranslation();
  const user = useUserStore((s) => s.user);
  const adBannerHeight = useAdBannerStore((s) => s.height);
  const tabBarHeight = useAdBannerStore((s) => s.tabBarHeight);
  const { weeklyStats, previousWeekStats, focusScore, refresh } = useStatsStore();
  const todayUsageByApp = useStatsStore((s) => s.todayUsageByApp);
  const dailyLimitMinutes = useSettingsStore((s) => s.settings.dailyLimitMinutes);
  const bluetooth = useBluetoothStore();
  // Flip Mode(스펙 §4-A) — 오늘 "내려놓은 시간(쉬는시간)", 양쪽 플랫폼 다 실제 계측.
  const putDownSeconds = useFlipStore((s) => s.putDownSeconds);
  const flipCredits = useFlipStore((s) => s.credits);
  const loadFlip = useFlipStore((s) => s.load);
  // 2026-08-09 사용자 지시("전체 크레딧은 어디서 확인이 되") — 적립 크레딧(오늘 휴식 기준, 매일 리셋)과
  // 출석 보너스(누적, 안 쓰면 이월)를 합쳐서 보여줄 곳이 없어서 "왜 숫자가 다르지"로 혼동이 있었다.
  // FocusSessionExtendModal이 내부적으로만 계산하던 totalCredits를 여기 화면에도 노출.
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  // 2026-08-03 사장님 지시("유튜브 앱으로 열면 시간 측정이 안 되는데 그걸 알려줘야 하지 않냐",
  // "팝업으로 띄우지 말고 분석에 표시") — Pace의 추적은 전부 세션에 묶여 있어서, 사용자가 런처에서
  // 유튜브를 직접 열면 아무것도 기록되지 않고 그 사실조차 알 수 없었다(사용자 눈엔 앱이 고장 난
  // 것과 구분이 안 됨). 이미 보유한 사용정보 접근 권한으로 "오늘 유튜브를 켜둔 시간"을 사후 조회해
  // Pace 기록과 나란히 보여준다 — 방해되는 팝업 대신, 어차피 사용량을 보러 오는 이 화면에 둔다.
  // Android 전용(iOS는 null → 섹션 자체를 렌더하지 않음, overlayService.ios.ts 주석 참고).
  const [appOpenSecondsToday, setAppOpenSecondsToday] = useState<number | null>(null);
  const [paceTrackedMinutesToday, setPaceTrackedMinutesToday] = useState(0);

  // 2026-07-18: home.tsx와 동일한 이유로 useFocusEffect로 교체(마운트 1회만 refresh하면 세션 종료 후
  // 이 탭으로 돌아와도 방금 끝난 세션이 반영 안 됨 — 실기기 검증 중 Home에서 먼저 발견한 버그를
  // Stats에도 동일하게 적용해 미리 예방).
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      refresh(user.id);
      // 이전 세션 종료 시점에 오프라인이었거나 실패해 못 보낸 백로그가 있으면 여기서 한 번 더 시도.
      pushUnsyncedSessions(user.id).catch(() => {});
      bluetooth.refresh();
      loadFlip(); // 오늘 내려놓은 시간(Flip Mode) 최신값 반영
      // 유튜브 앱을 켜둔 시간 vs Pace가 기록한 시간 (위 상태 선언부 주석 참고).
      // 둘 다 실패해도 화면 나머지는 그대로 보여야 하므로 개별적으로 삼킨다.
      overlayService.getSupportedAppForegroundSecondsToday()
        .then(setAppOpenSecondsToday)
        .catch(() => setAppOpenSecondsToday(null));
      getTodayUsageMinutes(user.id).then(setPaceTrackedMinutesToday).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, refresh])
  );

  const todayStr = toLocalDateStr(new Date());
  // 2026-07-28 감사 발견 — getWeeklyStats()는 "이번 주"가 아니라 오늘 포함 최근 7일 롤링 윈도우다
  // (요일 무관, 예: 오늘이 수요일이면 지난주 목~일 + 이번주 월~수). WeeklyGraphCard는 이미 이 배열에서
  // 진짜 월요일~오늘 구간만 골라 쓰는데(2026-07-27 "61분인데 왜 9분" 수정), 바로 위 히어로 카드
  // ("This Week")와 일평균 카드는 그 필터링 없이 롤링 7일 전체를 "이번 주"로 표시하고 있었다 — 같은
  // 화면에서 두 카드가 서로 다른 "주간" 숫자를 보여주는 모순. WeeklyGraphCard와 동일한
  // 월요일 기준 계산을 여기서도 적용해 두 카드가 일치하게 한다.
  const today = new Date(todayStr + 'T00:00:00');
  const isoDow = (today.getDay() + 6) % 7; // 0=Mon..6=Sun
  const elapsedDaysThisWeek = isoDow + 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - isoDow);
  const mondayStr = toLocalDateStr(monday);
  const thisWeekStats = weeklyStats.filter((d) => d.date >= mondayStr);
  const totalMinutesThisWeek = thisWeekStats.reduce((acc, d) => acc + d.totalMinutes, 0);
  const weeklyAvgMinutes = elapsedDaysThisWeek ? Math.round(totalMinutesThisWeek / elapsedDaysThisWeek) : 0;
  const streak = computeStreak(weeklyStats, todayStr);
  const todayEntry = weeklyStats.find((d) => d.date === todayStr);
  const longestSessionMinutes = todayEntry ? Math.round(todayEntry.longestSessionSeconds / 60) : 0;
  const bestDay = pickBestDay(weeklyStats, dailyLimitMinutes);
  const platformTotalSeconds = todayUsageByApp.reduce((acc, p) => acc + p.seconds, 0);
  // "지난주 대비" 트렌드도 같은 이유로 지난주 전체(7일)가 아니라 지난주의 같은 요일 구간(월~오늘과
  // 같은 위치)만 잘라 공정 비교한다 — 안 그러면 예를 들어 월요일 아침엔 "이번 주"(하루치)를 "지난주"
  // (7일치)와 비교해 항상 큰 폭으로 줄어든 것처럼 보인다.
  const lastWeekMonday = new Date(monday);
  lastWeekMonday.setDate(monday.getDate() - 7);
  const lastWeekMondayStr = toLocalDateStr(lastWeekMonday);
  const lastWeekSameWeekday = new Date(lastWeekMonday);
  lastWeekSameWeekday.setDate(lastWeekMonday.getDate() + isoDow);
  const lastWeekSameWeekdayStr = toLocalDateStr(lastWeekSameWeekday);
  const previousWeekPartialTotal = previousWeekStats
    .filter((d) => d.date >= lastWeekMondayStr && d.date <= lastWeekSameWeekdayStr)
    .reduce((acc, d) => acc + d.totalMinutes, 0);
  const weekTrendPct = previousWeekPartialTotal > 0
    ? Math.round(((totalMinutesThisWeek - previousWeekPartialTotal) / previousWeekPartialTotal) * 100)
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        {/* 1. THIS WEEK HERO */}
        <LinearGradient colors={gradients.heroCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
          <View style={styles.heroGlow} pointerEvents="none" />
          <Text style={styles.heroLabel}>{t('stats.thisWeek')}</Text>
          <Text style={styles.heroValue}>{formatHours(totalMinutesThisWeek)}</Text>
          {/* 2026-07-18: "지난주 대비" 트렌드 — 이전엔 지난주 쿼리가 없어 표시할 근거 자체가 없던 gap.
              getPreviousWeekStats() 추가로 실제 비교가 가능해졌다. */}
          <Text style={styles.heroTrend}>
            {weekTrendPct === null
              ? t('stats.noPreviousWeekData')
              : weekTrendPct <= 0
                ? `↓ ${Math.abs(weekTrendPct)}% ${t('stats.lessThanLastWeek')}`
                : `↑ ${weekTrendPct}% ${t('stats.moreThanLastWeek')}`}
          </Text>
        </LinearGradient>

        {/* 2. FOCUS SCORE / WEEKLY AVERAGE / HEALTHY STREAK GRID */}
        <View style={styles.grid2}>
          <GlassSurface style={styles.gridCard}>
            <Text style={styles.gridLabel}>{t('stats.focusScore')}</Text>
            {focusScore === null ? (
              <Text style={styles.gridValueEmpty}>{t('stats.focusScoreNoData')}</Text>
            ) : (
              <View style={styles.gridValueRow}>
                <Text style={styles.gridValueBig}>{focusScore}</Text>
                <Text style={styles.gridValueUnit}>/ 100</Text>
              </View>
            )}
          </GlassSurface>
          <GlassSurface style={styles.gridCard}>
            <Text style={styles.gridLabel}>{t('stats.dailyAverage')}</Text>
            <View style={styles.gridValueRow}>
              <Text style={styles.gridValueBig}>{weeklyAvgMinutes}</Text>
              <Text style={styles.gridValueUnit}>{t('home.minUnit')}</Text>
            </View>
          </GlassSurface>
          <GlassSurface style={styles.gridCard}>
            <Text style={styles.gridLabel}>{t('stats.healthyStreak')}</Text>
            <View style={styles.streakValueCol}>
              <Text style={styles.streakValue}>{t('stats.dayStreak', { n: streak })}</Text>
            </View>
          </GlassSurface>
        </View>

        {/* 4. TODAY'S BEHAVIOR */}
        <View>
          <Text style={styles.sectionTitle}>{t('stats.todaysBehavior')}</Text>
          <GlassSurface style={styles.divideCard}>
            {/* 2026-07-22 사용자 지시: "오늘 본 영상 수"/"평균 시청 시간"은 videos_watched가 항상
                0으로 기록되는(제3자 앱 내부를 관찰할 방법이 없어 정직하게 0으로 남겨둔) 값에 기대고
                있어 구조적으로 절대 측정 불가능 — 제거. Longest Session은 duration_seconds 기반이라
                실제로 측정됨(getTodayVideoStats 자체도 store/repository에서 삭제). */}
            <BehaviorRow title={t('stats.longestSession')} subtitle={t('stats.maxUninterrupted')} value={`${longestSessionMinutes}m`} valueColor={colors.primary} last />
          </GlassSurface>
        </View>

        {/* 4-B. PLATFORM BREAKDOWN — 오늘 앱별 사용시간.
            2026-07-26에 "앱이 YouTube 하나뿐이라 항상 100%로만 나오는 무의미한 섹션"이라며
            지웠던 것(c0cb9b6)을 2026-08-12 틱톡 추가로 되살린다 — 사장님 지시
            ("틱톡을 안 봤을 땐 0이니까 안 나와도 되는데 봤으면 같이 나와야 하잖아").
            ⚠️ 원본과 달라진 점: 원본은 **퍼센트만** 보여줬는데 지시가 "몇 분씩"이므로 분을 앞에 둔다.
            안 본 앱은 쿼리 결과에 행 자체가 없어 여기서 따로 거를 필요가 없다. 앱이 하나뿐이면
            100% 한 줄이 되므로 그때는 숨긴다 — 2026-07-26에 지웠던 판단 자체는 그 상황에선 옳았다. */}
        {todayUsageByApp.length > 1 && (
          <View>
            <Text style={styles.sectionTitle}>{t('stats.platformBreakdown')}</Text>
            <GlassSurface style={styles.card}>
              {todayUsageByApp.map((p) => {
                const pct = platformTotalSeconds > 0 ? Math.round((p.seconds / platformTotalSeconds) * 100) : 0;
                const accent = p.app in sourceColors ? sourceColors[p.app as keyof typeof sourceColors].accent : colors.textSecondary;
                return (
                  <View key={p.app} style={styles.barRow}>
                    <View style={styles.barHeaderRow}>
                      <Text style={styles.barLabel}>{PLATFORM_LABELS[p.app] ?? (p.app === 'other' ? t('stats.platformOther') : p.app)}</Text>
                      <Text style={styles.barPct}>{p.minutes}m · {pct}%</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: accent }]} />
                    </View>
                  </View>
                );
              })}
            </GlassSurface>
          </View>
        )}

        {/* 4-A. FLIP MODE — 오늘 내려놓은 시간(쉬는시간) + 적립 크레딧 (스펙 §4-A, 2026-07-23부터 양쪽 플랫폼 계측) */}
        {putDownSeconds > 0 && (
          <View>
            <Text style={styles.sectionTitle}>{t('stats.restTime')}</Text>
            <GlassSurface style={styles.divideCard}>
              <BehaviorRow title={t('stats.restTimeToday')} subtitle={t('stats.restTimeSub')} value={formatMinSec(putDownSeconds)} valueColor={colors.successLight} />
              <BehaviorRow title={t('stats.restCredits')} subtitle={t('stats.restCreditsSub')} value={`${flipCredits}`} valueColor={colors.primary} last />
            </GlassSurface>
          </View>
        )}

        {/* 4-A-2. 총 크레딧 — 적립(오늘, 매일 리셋) + 출석 보너스(누적, 안 쓰면 이월) 합계.
            위 적립 크레딧 카드와 달리 putDownSeconds 조건 없이 항상 보인다 — 출석 보너스는 오늘
            안 쉬어도 남아있는 값이라 숨기면 안 된다. FocusSessionExtendModal이 내부적으로만 쓰던
            totalCredits(휴식+출석 합산)를 화면에도 노출(2026-08-09 사용자 지시). */}
        {(flipCredits > 0 || bonusCredits > 0) && (
          <View>
            <GlassSurface style={styles.divideCard}>
              <BehaviorRow
                title={t('stats.totalCredits')}
                subtitle={t('stats.totalCreditsSub', { rest: flipCredits, bonus: bonusCredits })}
                value={`${flipCredits + bonusCredits}`}
                valueColor={colors.successLight}
                last
              />
            </GlassSurface>
          </View>
        )}

        {/* 4-B. 기록 범위 — "유튜브 앱 켠 시간" vs "Pace가 기록한 시간" (2026-08-03 사장님 지시)
            Pace의 추적은 전부 세션에 묶여 있어서, 런처에서 유튜브를 직접 열면 아무것도 기록되지 않고
            사용자는 그 사실조차 알 수 없었다("앱이 고장 났나?"와 구분 불가). 두 숫자를 나란히 보여줘
            차이가 왜 생기는지 스스로 알게 한다.
            ⚠️ 두 값은 자가 다르다: 위는 앱을 화면에 띄워둔 시간(UsageStats), 아래는 실제 재생 중이던
            시간(Pace). 그래서 문구도 "본 시간"이 아니라 "켠 시간"으로 쓴다 — 같은 자인 척하면 거짓말이
            된다. Android 전용이라 iOS에서는 null이 와서 이 블록 자체가 렌더되지 않는다(애플은 다른 앱의
            사용 시간을 읽는 공개 API가 없음). 0이면(권한 없음/조회 실패/오늘 사용 없음) 숨긴다. */}
        {appOpenSecondsToday !== null && appOpenSecondsToday > 0 && (
          <View>
            <Text style={styles.sectionTitle}>{t('stats.trackingGap')}</Text>
            <GlassSurface style={styles.divideCard}>
              <BehaviorRow
                title={t('stats.appOpenTime')}
                subtitle={t('stats.appOpenTimeSub')}
                value={`${Math.floor(appOpenSecondsToday / 60)}m`}
                valueColor={colors.textPrimary}
              />
              <BehaviorRow
                title={t('stats.paceTracked')}
                subtitle={t('stats.paceTrackedSub')}
                value={`${paceTrackedMinutesToday}m`}
                valueColor={colors.primary}
                last
              />
            </GlassSurface>
            {/* 차이가 의미 있을 때만 안내한다 — 1~2분 오차(세션 시작 직전/직후 몇 초)까지 지적하면
                잔소리로 느껴지고, 애초에 두 값은 측정 자가 달라 완전히 같아질 수 없다. */}
            {Math.floor(appOpenSecondsToday / 60) - paceTrackedMinutesToday >= 5 && (
              <Text style={styles.trackingGapHint}>{t('stats.trackingGapHint')}</Text>
            )}
          </View>
        )}

        {/* 5. WEEKLY ACTIVITY GRAPH WITH GOAL LINE */}
        <View>
          <Text style={styles.sectionTitle}>{t('stats.weeklyActivity')}</Text>
          <GlassSurface style={[styles.card, { gap: spacing.md }]}>
            <View style={styles.goalLegendRow}>
              <Text style={styles.goalLegendLeft}>{t('stats.dailyLimitsAnalyser')}</Text>
              <View style={styles.goalLegendRight}>
                <View style={styles.goalLegendSwatch} />
                <Text style={styles.goalLegendText}>{t('stats.goal')} ({dailyLimitMinutes}{t('home.minUnit')})</Text>
              </View>
            </View>
            {weeklyStats.length === 0 ? (
              <Text style={styles.empty}>{t('stats.noRecordsYet')}</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {weeklyStats.map((d) => {
                  // 목표선(goalMarker)이 트랙의 left:60%에 고정돼 있으므로, 그 지점이 실제
                  // dailyLimitMinutes를 가리키도록 트랙 전체 스케일을 한도/0.6으로 역산 — 원본은
                  // 바 스케일(/60)과 목표선(60%)이 우연히 같은 데모값이라 이 계산이 필요 없었다.
                  const trackMax = dailyLimitMinutes / 0.6;
                  const isOver = d.totalMinutes > dailyLimitMinutes;
                  const pct = Math.min(100, (d.totalMinutes / Math.max(1, trackMax)) * 100);
                  return (
                    <View key={d.date} style={styles.dayRow}>
                      <View style={styles.dayRowLeft}>
                        <Text style={styles.dayLabel}>{t(DAY_ABBR_KEYS[new Date(d.date + 'T00:00:00').getDay()])}</Text>
                        <View style={styles.dayTrack}>
                          <View style={[styles.dayFill, { width: `${pct}%` }, isOver && styles.dayFillOver]} />
                          <View style={styles.goalMarker} />
                        </View>
                      </View>
                      <View style={styles.dayRowRight}>
                        <Text style={styles.dayMinutes}>{d.totalMinutes}{t('home.minUnit')}</Text>
                        <Feather name={isOver ? 'alert-circle' : 'check'} size={13} color={isOver ? colors.warning : colors.successLight} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </GlassSurface>
        </View>

        {/* 6. BEST DAY CARD */}
        {bestDay && (
          <LinearGradient colors={['rgba(16,185,129,0.1)', 'rgba(88,86,214,0.05)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bestDayCard}>
            <View>
              <Text style={styles.bestDayLabel}>{t('stats.bestDay')}</Text>
              <Text style={styles.bestDayTitle}>{t(DAY_NAME_KEYS[bestDay.dayOfWeek])}</Text>
              <Text style={styles.bestDaySub}>{bestDay.minutes}{t('home.minUnit')}</Text>
            </View>
            <View style={styles.bestDayIconWrap}>
              <Feather name="heart" size={24} color={colors.successLight} />
            </View>
          </LinearGradient>
        )}

        {/* 7. WEEKLY USAGE GRAPH (App.tsx가 StatsTab 뒤에 별도로 덧붙이는 카드, WeeklyGraph.tsx) */}
        <WeeklyGraphCard weeklyStats={weeklyStats} dailyLimitMinutes={dailyLimitMinutes} />

        {/* 8. BLUETOOTH USAGE(2026-07-19, 사용자 지시) — 실제 집계된 카운터만 표시(누적, 세션 단위
            아님 — "몇 % 세션이 Hands-Free였는지"는 세션별 기록이 없어 정직하게 뺐다). */}
        {capabilities.supportsHandsFreeControl && (bluetooth.nextCount + bluetooth.previousCount + bluetooth.autoToggleCount) > 0 && (
          <View>
            <Text style={styles.sectionTitle}>{t('stats.bluetoothControls')}</Text>
            <GlassSurface style={styles.card}>
              <View style={styles.behaviorRow}>
                <Text style={styles.behaviorTitle}>{t('stats.next')}</Text>
                <Text style={styles.behaviorValue}>{bluetooth.nextCount}</Text>
              </View>
              <View style={[styles.behaviorRow, styles.behaviorRowBordered]}>
                <Text style={styles.behaviorTitle}>{t('stats.previous')}</Text>
                <Text style={styles.behaviorValue}>{bluetooth.previousCount}</Text>
              </View>
              <View style={[styles.behaviorRow, styles.behaviorRowBordered]}>
                <Text style={styles.behaviorTitle}>{t('stats.autoModeToggles')}</Text>
                <Text style={styles.behaviorValue}>{bluetooth.autoToggleCount}</Text>
              </View>
            </GlassSurface>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// YouTube/Instagram/TikTok은 고유명사라 로케일과 무관하게 그대로 둔다 — 'other'만 실제 번역 대상.
const PLATFORM_LABELS: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram Reels', tiktok: 'TikTok' };

const DAY_ABBR_KEYS: TranslationKey[] = ['stats.daySun', 'stats.dayMon', 'stats.dayTue', 'stats.dayWed', 'stats.dayThu', 'stats.dayFri', 'stats.daySat'];
const DAY_NAME_KEYS: TranslationKey[] = ['stats.dayNameSun', 'stats.dayNameMon', 'stats.dayNameTue', 'stats.dayNameWed', 'stats.dayNameThu', 'stats.dayNameFri', 'stats.dayNameSat'];

function formatHours(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Flip Mode 쉬는시간 표시용 — 초 단위를 "Xm Ys"(1분 미만이면 "Ys")로.
function formatMinSec(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function computeStreak(weeklyStats: DailyStats[], todayStr: string): number {
  const byDate = new Map(weeklyStats.map((d) => [d.date, d.totalMinutes]));
  let streak = 0;
  const cursor = new Date(todayStr + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const key = toLocalDateStr(cursor);
    if ((byDate.get(key) ?? 0) > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

function pickBestDay(weeklyStats: DailyStats[], limitMinutes: number): { dayOfWeek: number; minutes: number } | null {
  const candidates = weeklyStats.filter((d) => d.totalMinutes > 0 && d.totalMinutes <= limitMinutes);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.totalMinutes > a.totalMinutes ? b : a));
  return { dayOfWeek: new Date(best.date + 'T00:00:00').getDay(), minutes: best.totalMinutes };
}

function BehaviorRow({ title, subtitle, value, valueColor, last }: { title: string; subtitle: string; value: string; valueColor?: string; last?: boolean }) {
  return (
    <View style={[styles.behaviorRow, !last && styles.behaviorRowBordered]}>
      <View>
        <Text style={styles.behaviorTitle}>{title}</Text>
        <Text style={styles.behaviorSubtitle}>{subtitle}</Text>
      </View>
      <Text style={[styles.behaviorValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg },

  heroCard: { borderRadius: 24, padding: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderSubtle, gap: 8 },
  heroGlow: { position: 'absolute', top: -60, right: -30, width: 192, height: 192, borderRadius: 96, backgroundColor: `${colors.primary}0D` },
  heroLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: '#8E8E93', letterSpacing: 2, textTransform: 'uppercase' },
  heroValue: { fontSize: 36, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -0.5 },
  heroTrend: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, marginTop: 4 },

  grid2: { flexDirection: 'row', gap: spacing.sm },
  gridCard: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 24, padding: 16, justifyContent: 'space-between', gap: 16 },
  gridLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  gridValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  gridValueBig: { fontSize: 30, fontFamily: typography.displayFontFamily, color: colors.textPrimary, lineHeight: 30 },
  gridValueUnit: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.successLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  gridValueEmpty: { fontSize: 12, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary },
  streakValueCol: { alignItems: 'flex-start' },
  streakValue: { fontSize: 20, fontFamily: typography.displayFontFamily, color: colors.primary, lineHeight: 22 },

  sectionTitle: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, paddingHorizontal: 4 },
  trackingGapHint: { fontSize: 12, color: colors.textSecondary, paddingHorizontal: 4, marginTop: 8, lineHeight: 17 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 24, padding: 20 },

  barRow: { gap: 6, marginBottom: spacing.md },
  barHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: '#D1D5DB' },
  barPct: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  barTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.02)' },
  barFill: { height: '100%', borderRadius: radius.pill },

  divideCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 24, paddingHorizontal: 20 },
  behaviorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18 },
  behaviorRowBordered: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  behaviorTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  behaviorSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  behaviorValue: { fontSize: 14, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary },

  goalLegendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalLegendLeft: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  goalLegendRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  goalLegendSwatch: { width: 10, height: 2, backgroundColor: 'rgba(239,68,68,0.6)' },
  goalLegendText: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.chip },
  dayRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  dayLabel: { fontSize: 11, fontFamily: typography.monoFontFamilyBold, color: colors.textSecondary, width: 30 },
  dayTrack: { flex: 1, maxWidth: 96, backgroundColor: 'rgba(255,255,255,0.05)', height: 6, borderRadius: radius.pill, overflow: 'hidden', position: 'relative' },
  dayFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
  dayFillOver: { backgroundColor: colors.warning },
  goalMarker: { position: 'absolute', top: 0, bottom: 0, left: '60%', width: 1.5, backgroundColor: 'rgba(239,68,68,0.5)' },
  dayRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayMinutes: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary },
  empty: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingVertical: spacing.md },

  bestDayCard: { borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bestDayLabel: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 1.5, textTransform: 'uppercase' },
  bestDayTitle: { fontSize: 20, fontFamily: typography.displayFontFamily, color: colors.textPrimary, marginTop: 2 },
  bestDaySub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  bestDayIconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(16,185,129,0.2)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', alignItems: 'center', justifyContent: 'center' },
});
