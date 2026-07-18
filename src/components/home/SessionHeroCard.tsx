import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, spacing, typography } from '../../constants/theme';
import { useBluetoothStore } from '../../store/useBluetoothStore';

// healthy-shorts-assistant(2) App.tsx "Today / Remaining / Auto Next Ready Hero Card"를 토씨 하나
// 안 틀리고 그대로 이식(사용자 명시적 지시) — 원본 JSX(App.tsx:280-329) 값 그대로: rounded-[28px],
// p-6, 우상단 퍼센트+COMPLETE 배지, 프로그레스 바, 하단 좌측 펄스 점+Auto Next 상태, 우측
// "{n}m Remaining". 이전 버전은 우상단에 "Auto Next Ready" 필을 잘못 넣고 퍼센트 배지와
// 하단 펄스 점 상태줄을 통째로 빠뜨렸었다 — PACE_ARCHITECTURE.md "비주얼 아이덴티티 전면 개편" 참고.
// 이 카드는 원본에서 translations 딕셔너리를 전혀 안 쓰는 구간(App.tsx Home 탭 전체가 그렇다) —
// "Today Session"/"Complete"/"Auto Next Ready"/"Remaining"을 t()로 번역하면 한국어에서 텍스트가
// 길어져 고정폭 카드를 넘치므로, 원본처럼 항상 영어 하드코딩으로 고정.
//
// 2026-07-19: healthy-shorts-assistant(3) 라벨 갱신("Today Session"→"SESSION STATUS",
// "Complete"→"CONSUMED") + 신규 "HANDS-FREE CONTROLLER" 행 추가(사용자 지시, 이번 라운드 Bluetooth
// Hands-Free 작업과 직결 — real useBluetoothStore 상태 사용, 가짜 배터리%/기기명 없음). ⚠️ (3)이
// 하단 상태줄 문구를 "Auto Mode ON"/"Shield Suspended"로 바꿨지만, 이건 그대로 안 옮겼다 — 이전
// 세션에서 사용자가 명시적으로 "AUTO" 브랜딩을 전면에서 빼기로 결정한 것과 다시 충돌하기 때문
// (PACE_ARCHITECTURE.md "제품 방향 결정 — AUTO 브랜딩 제거" 참고) — 기존 Session Ready/Standby 유지.
export function SessionHeroCard({ minutesWatched, limitMinutes, autoNextEnabled }: { minutesWatched: number; limitMinutes: number; autoNextEnabled: boolean }) {
  const isBluetoothConnected = useBluetoothStore((s) => s.isConnected);
  const bluetoothDeviceName = useBluetoothStore((s) => s.deviceName);
  const percentage = Math.min(100, (minutesWatched / Math.max(1, limitMinutes)) * 100);
  const percentageLabel = Math.round((minutesWatched / Math.max(1, limitMinutes)) * 100);
  const remainingMinutes = Math.max(0, limitMinutes - minutesWatched);

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
        <View style={styles.statusLeft}>
          <View style={styles.dotWrap}>
            <Animated.View style={[styles.dotPing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
            <View style={styles.dot} />
          </View>
          <Text style={styles.statusText}>{autoNextEnabled ? 'Session Ready' : 'Standby'}</Text>
        </View>
        <Text style={styles.remainingText}>{remainingMinutes}m Remaining</Text>
      </View>

      {/* Hands-Free Controller 행 — healthy-shorts-assistant(3) 신규 추가, 실제 Bluetooth 상태 사용. */}
      <View style={styles.handsFreeRow}>
        <Text style={styles.handsFreeLabel}>HANDS-FREE CONTROLLER</Text>
        {isBluetoothConnected ? (
          <View style={[styles.handsFreePill, styles.handsFreePillOn]}>
            <Text style={styles.handsFreePillIcon}>🎧</Text>
            <Text style={styles.handsFreePillTextOn}>{bluetoothDeviceName ?? 'Device'} Connected</Text>
          </View>
        ) : (
          <View style={[styles.handsFreePill, styles.handsFreePillOff]}>
            <Text style={styles.handsFreePillIcon}>⚪</Text>
            <Text style={styles.handsFreePillTextOff}>Hands-Free Available</Text>
          </View>
        )}
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
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dotPing: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.successLight },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  statusText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: '#D1D5DB', letterSpacing: 0.5, textTransform: 'uppercase' },
  remainingText: { fontSize: 10, fontFamily: typography.monoFontFamilyBold, color: colors.primary, letterSpacing: 0.5, textTransform: 'uppercase' },
  handsFreeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.03)' },
  handsFreeLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 1.4, textTransform: 'uppercase' },
  handsFreePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1 },
  handsFreePillOn: { backgroundColor: `${colors.primary}1A`, borderColor: `${colors.primary}33` },
  handsFreePillOff: { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.04)' },
  handsFreePillIcon: { fontSize: 10 },
  handsFreePillTextOn: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: colors.primary, letterSpacing: 0.3 },
  handsFreePillTextOff: { fontSize: 10, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, letterSpacing: 0.3 },
});
