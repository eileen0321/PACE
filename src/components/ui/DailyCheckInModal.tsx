import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../services/i18n';
import { useAttendanceStore, getCurrentStreak } from '../../store/useAttendanceStore';
import { colors, radius, spacing, typography } from '../../constants/theme';

// 2026-07-26 사용자 지시("매일 출석하기 ... 크레딧 적립되었다는 알림 팝업") — _layout.tsx가 부팅
// 시 useAttendanceStore.checkInIfNeeded()를 1회 호출하고, 오늘 처음 출석한 것이면(=이전에 이미
// 출석했으면 다시 안 뜸) 이 팝업으로 축하 + 적립량을 보여준다.
//
// 2026-07-26 사용자 지적("하단 키가 흰색이야", "저게 트렌드야?") — 두 가지 문제를 같이 고침:
// (1) RN `<Modal>`은 Android에서 별도 네이티브 Window(Dialog)를 새로 띄우는데, 이 Window는 앱
//     Activity의 edge-to-edge 테마(투명 내비게이션 바)를 상속하지 않아 하단 시스템 바가 기본값
//     (흰색)으로 보였다 — `<Modal>` 대신 같은 Activity Window 안에 그냥 얹히는 절대위치 View로
//     교체(온보딩 화면 등 이미 앱 전역에서 쓰는 패턴과 동일한 해법).
// (2) 단순 텍스트 알림창이라 밋밋하다는 지적 — 적립 크레딧을 모노 폰트 큰 숫자로 강조하고, 출석
//     연속일수(스트릭)를 같이 보여줘서 습관 앱들의 흔한 "스트릭 축하" 패턴에 맞춤(Flat/No-Gradient
//     원칙은 유지 — constants/theme.ts 참고).
export function DailyCheckInModal({ visible, earned, onDismiss }: { visible: boolean; earned: number; onDismiss: () => void }) {
  const { t } = useTranslation();
  const history = useAttendanceStore((s) => s.history);
  const streak = getCurrentStreak(history);

  if (!visible) return null;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Feather name="calendar" size={18} color={colors.successLight} />
        </View>
        <Text style={styles.title}>{t('checkIn.title')}</Text>
        <View style={styles.statRow}>
          <Text style={styles.statValue}>+{earned}</Text>
          <Text style={styles.statLabel}>{t('stats.restCredits')}</Text>
        </View>
        {streak > 1 && (
          <View style={styles.streakChip}>
            <Feather name="zap" size={11} color={colors.warning} />
            <Text style={styles.streakChipText}>
              {t(streak === 1 ? 'checkIn.streakSingular' : 'checkIn.streakPlural', { n: streak })}
            </Text>
          </View>
        )}
        <Pressable style={styles.btn} onPress={onDismiss}>
          <Text style={styles.btnText}>{t('checkIn.dismiss')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 280, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, alignItems: 'center', gap: 2 },
  iconWrap: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  title: { color: colors.textPrimary, fontSize: 14, fontFamily: typography.bodyFontFamilySemibold, textAlign: 'center' },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: 2 },
  statValue: { color: colors.successLight, fontSize: 30, fontFamily: typography.monoFontFamilyBold, lineHeight: 34 },
  statLabel: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.bodyFontFamilyMedium },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: spacing.xs,
  },
  streakChipText: { color: colors.warning, fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  btn: { alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  btnText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 13 },
});
