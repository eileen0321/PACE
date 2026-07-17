import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) Header.tsx(App.tsx:41-89)를 토씨 하나 안 틀리고 그대로 이식.
// "PACE" + 점(animate-pulse) + 인사말이 전부 한 줄(space-x-2)이고 그 아래 서브타이틀 — 이전 버전은
// 점을 PACE 앞에 잘못 붙이고 인사말을 별도 줄로 잘못 내려서 원본과 완전히 다른 레이아웃이었다.
// header 정렬도 items-end(우측 아바타 블록이 좌측 텍스트 블록 하단에 맞춰짐)인데 flex-start로
// 잘못 이식돼 있었다. 원본의 가짜 iOS 상태바(시간/신호/배터리, Header.tsx:44-56)는 RN 실기기의
// 진짜 OS 상태바와 중복이라 의도적으로 이식 제외(PACE_ARCHITECTURE.md 기록됨).
// 중요: Header.tsx는 translations 딕셔너리를 아예 import하지 않는다 — getGreeting()/서브타이틀
// 전부 하드코딩 영어이고 locale에 따라 달라지지 않는다(App.tsx 전체에서 Home 탭 + Header는
// t.xxx를 한 번도 안 쓴다 — Focus/Settings/Stats/Player만 실제로 번역됨). 그래서 이 컴포넌트는
// useTranslation()을 쓰지 않고 원본처럼 항상 영어로 고정 — 한국어에서 "오늘의 세션"처럼 억지
// 번역하면 박스 레이아웃이 원본보다 길어져 화면을 넘치는 오버플로우가 생긴다(실측 확인됨).
export function AppHeader({ userEmail }: { userEmail: string }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  const name = userEmail.split('@')[0] || 'guest';
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  const initial = name.slice(0, 2).toUpperCase();

  // 원본의 dot animate-pulse(opacity 1→0.5→1 루프) — PlatformPickerCard의 동일 패턴 재사용.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.header}>
      <View>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>PACE</Text>
          <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
          <Text style={styles.greeting}>{greeting}</Text>
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
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  wordmark: { fontSize: 24, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -1.2, textTransform: 'uppercase' },
  greeting: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  subtitle: { color: colors.textTertiary, fontSize: 9, fontFamily: typography.bodyFontFamilyBold, letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 6 },
  avatarWrap: { alignItems: 'flex-end' },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: typography.bodyFontFamilyBold, color: colors.primary, letterSpacing: 0.7 },
  avatarName: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: '#8E8E93', letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 4 },
});
