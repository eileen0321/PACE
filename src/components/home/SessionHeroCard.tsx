import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) App.tsx "Today / Remaining / Auto Next Ready Hero Card"를 토씨 하나
// 안 틀리고 그대로 이식(사용자 명시적 지시) — 원본 JSX(App.tsx:280-329) 값 그대로: rounded-[28px],
// p-6, 우상단 퍼센트+COMPLETE 배지, 프로그레스 바, 하단 좌측 펄스 점+Auto Next 상태, 우측
// "{n}m Remaining". 이전 버전은 우상단에 "Auto Next Ready" 필을 잘못 넣고 퍼센트 배지와
// 하단 펄스 점 상태줄을 통째로 빠뜨렸었다 — PACE_ARCHITECTURE.md "비주얼 아이덴티티 전면 개편" 참고.
// 이 카드는 원본에서 translations 딕셔너리를 전혀 안 쓰는 구간(App.tsx Home 탭 전체가 그렇다) —
// "Today Session"/"Complete"/"Auto Next Ready"/"Remaining"을 t()로 번역하면 한국어에서 텍스트가
// 길어져 고정폭 카드를 넘치므로, 원본처럼 항상 영어 하드코딩으로 고정.
//
// 2026-07-22 사용자 지시 — "HANDS-FREE CONTROLLER" 행과 "{n}m Remaining" 텍스트 제거
// (healthy-shorts-assistant(3)이 추가했던 행, useBluetoothStore 상태 표시). Home 화면 단순화
// 목적, Bluetooth Hands-Free 기능 자체는 Focus 탭/Settings에 그대로 남아있음 — 여기 카드에서만 뺀다.
export function SessionHeroCard({ minutesWatched, limitMinutes, autoNextEnabled, restSeconds = 0 }: { minutesWatched: number; limitMinutes: number; autoNextEnabled: boolean; restSeconds?: number }) {
  const percentage = Math.min(100, (minutesWatched / Math.max(1, limitMinutes)) * 100);
  const percentageLabel = Math.round((minutesWatched / Math.max(1, limitMinutes)) * 100);
  // 쉬는시간(Flip Mode "내려놓은 시간", putDownSeconds) — 사용시간과 함께 세션 상태 줄에 표시.
  // 60초 미만은 초로, 그 이상은 분으로(사용시간은 이미 위 큰 숫자로 분 단위 표시).
  const restLabel = restSeconds >= 60 ? `${Math.floor(restSeconds / 60)}m` : `${restSeconds}s`;

  // 원본의 animate-ping(팽창하며 사라지는 펄스 링) 근사 — RN Animated로 opacity+scale 루프.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.75, 0.2, 0] });

  return (
    <LinearGradient colors={gradients.heroCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.glow} pointerEvents="none" />

      <View style={styles.topRow}>
        <View>
          <Text style={styles.sessionLabel}>SESSION STATUS</Text>
          <View style={styles.valueRow}>
            <Text style={styles.value}>{minutesWatched} <Text style={styles.valueUnit}>/ {limitMinutes} min</Text></Text>
          </View>
        </View>
        <View style={styles.percentWrap}>
          <Text style={styles.percentValue}>{percentageLabel}%</Text>
          <Text style={styles.percentLabel}>CONSUMED</Text>
        </View>
      </View>

      <View style={styles.track}>
        <LinearGradient colors={gradients.progressFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${percentage}%` }]} />
      </View>

      <View style={styles.bottomRow}>
        <View style={styles.statCol}>
          <View style={styles.statLabelRow}>
            <View style={styles.dotWrap}>
              <Animated.View style={[styles.dotPing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
              <View style={styles.dot} />
            </View>
            <Text style={styles.statLabel}>Watched Today</Text>
          </View>
          <Text style={styles.statValue}>{minutesWatched}m</Text>
        </View>
        <View style={styles.statDivider} />
        {/* 쉬는시간(내려놓은 시간) — Flip Mode 누적. 사용시간(위 큰 숫자)과 짝을 이뤄 세션 상태에 표시.
            2026-07-27 사용자 지적 — 왼쪽(Watched Today)은 라벨+값 2줄 스택인데 이쪽만 한 줄이라
            bottomRow의 alignItems:'center' 기준으로 두 줄 블록 중간에 붕 떠 라벨/값 어느 쪽과도 안
            맞았다. 같은 라벨-값 2줄 구조로 맞추고 아래 bottomRow도 flex-start로 상단 정렬. */}
        <View style={styles.restRight}>
          <View style={styles.statLabelRow}>
            <Text style={styles.restIcon}>🌙</Text>
            <Text style={styles.restLabel}>REST</Text>
          </View>
          <Text style={styles.restValue}>{restLabel}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 24, marginTop: 16, borderRadius: 28, padding: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  glow: { position: 'absolute', top: -40, right: -40, width: 128, height: 128, borderRadius: 64, backgroundColor: `${colors.primary}0D` },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  sessionLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: '#818CF8', letterSpacing: 2, textTransform: 'uppercase' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  value: { fontSize: 36, lineHeight: 36, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -0.5 },
  valueUnit: { fontSize: 16, lineHeight: 18, color: colors.textTertiary, fontFamily: typography.bodyFontFamilySemibold },
  percentWrap: { alignItems: 'flex-end' },
  percentValue: { fontSize: 14, fontFamily: typography.displayFontFamily, color: colors.primary, lineHeight: 16 },
  percentLabel: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },
  track: { height: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.pill, overflow: 'hidden', marginBottom: spacing.md },
  fill: { height: '100%', borderRadius: radius.pill },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  statCol: { flex: 1, gap: 4 },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dotPing: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.successLight },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  restRight: { alignItems: 'flex-end', gap: 4 },
  restIcon: { fontSize: 11, marginRight: 4 },
  restLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  restValue: { fontSize: 15, fontFamily: typography.bodyFontFamilyExtrabold, color: '#818CF8' },
  statLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  statValue: { fontSize: 15, fontFamily: typography.bodyFontFamilyExtrabold, color: '#D1D5DB' },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: spacing.md },
});
