import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) Header.tsx(App.tsx:41-89)를 토씨 하나 안 틀리고 그대로 이식.
// header 정렬은 items-end(우측 아바타 블록이 좌측 텍스트 블록 하단에 맞춰짐). 원본의 가짜 iOS
// 상태바(시간/신호/배터리, Header.tsx:44-56)는 RN 실기기의 진짜 OS 상태바와 중복이라 의도적으로
// 이식 제외(PACE_ARCHITECTURE.md 기록됨).
// 2026-07-22 사용자 지시 — 인사말(GOOD MORNING/AFTERNOON/EVENING)을 모든 화면에서 제거(AppHeader가
// 전체 탭 공유 컴포넌트라 이 한 곳만 고치면 됨) 후, 같은 자리에 "PACE • <모토>" 형태의 트렌디한
// 문구를 랜덤 로테이션으로 대신 노출해달라는 후속 지시 — 화면에 다시 포커스될 때마다(탭 전환 포함,
// SwiftUI onAppear와 동등한 시점) 새로 랜덤 선택. 직전과 같은 문구가 연달아 뽑히지 않게 배제.
const MOTTOS = [
  'TAKE YOUR PACE',
  'STAY IN CONTROL',
  'SLOW DOWN A LITTLE',
  'ENJOY THE MOMENT',
  'WATCH WITH BALANCE',
  'OWN YOUR TIME',
  'MIND YOUR FLOW',
  'DEFINE THE RHYTHM',
  'BREATHE AND BROWSE',
  'ESCAPE THE LOOP',
];

function pickMotto(exclude?: string): string {
  if (MOTTOS.length <= 1) return MOTTOS[0];
  let next = MOTTOS[Math.floor(Math.random() * MOTTOS.length)];
  while (next === exclude) next = MOTTOS[Math.floor(Math.random() * MOTTOS.length)];
  return next;
}

export function AppHeader({ userEmail }: { userEmail: string }) {
  const name = userEmail.split('@')[0] || 'guest';
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  const initial = name.slice(0, 2).toUpperCase();
  const [motto, setMotto] = useState(() => pickMotto());

  useFocusEffect(
    useCallback(() => {
      setMotto((prev) => pickMotto(prev));
    }, [])
  );

  return (
    <View style={styles.header}>
      <View>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>PACE</Text>
          <Text style={styles.mottoDot}>•</Text>
          <Text style={styles.motto}>{motto}</Text>
        </View>
        <Text style={styles.subtitle}>Active Session Guard</Text>
      </View>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.avatarName}>{capitalizedName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wordmark: { fontSize: 24, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -1.2, textTransform: 'uppercase' },
  mottoDot: { fontSize: 16, color: colors.primary, marginTop: -2 },
  motto: { fontSize: 11, fontFamily: typography.bodyFontFamilySemibold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
  subtitle: { color: colors.textTertiary, fontSize: 9, fontFamily: typography.bodyFontFamilyBold, letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 6 },
  avatarWrap: { alignItems: 'flex-end' },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: typography.bodyFontFamilyBold, color: colors.primary, letterSpacing: 0.7 },
  avatarName: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: '#8E8E93', letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 4 },
});
