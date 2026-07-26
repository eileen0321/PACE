import { useEffect, useRef } from 'react';
import { Animated, ImageBackground, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) App.tsx "Choose Platform" 카드를 토씨 하나 안 틀리고 그대로 이식
// (App.tsx:342-397, 사용자 명시적 지시) — h-[100px] 풀와이드 세로 스택(가로 2분할 아님!), 커버
// 이미지 + 좌→우 그라데이션 오버레이, 제목+펄스점 상태줄, 우측 원형 재생 버튼, shadow-lg.
// 이전 버전은 가로 2열 그리드로 잘못 배치하고 상태줄/배지/그림자를 빠뜨렸었다.
// 2026-07-18: 사용자 지시로 상태 점 동작 변경 — 이전엔 3장 카드 전부 항상 같은 인디고색으로
// 깜빡였는데, 그러면 "지금 실제로 세션이 진행 중인 플랫폼이 어디인지"가 안 보인다. isActive(실제
// useSessionStore의 활성 세션 platformApp과 일치하는 카드만 true)일 때만 초록색으로 펄스,
// 나머지는 펄스 없는 정적 회색 점 — 시선이 실제 활성 세션에만 쏠리게.
// 2026-07-19: healthy-shorts-assistant(3)이 제목 옆에 작은 배지(SHORTS/REELS/LOOPS)를 추가 — 순수
// 장식용이라 실제 상태와 무관하게 항상 표시.
// 2026-07-22 사용자 지시 — "YouTube with PACE" 카드가 "그냥 열기" 카드와 시각적으로 너무
// 비슷해서(제목+배지+상태줄만 다름) 실제로 뭐가 다른지 한눈에 안 들어온다는 지적. GUARDED 카드에만
// 실제로 켜지는 부가기능(핸즈프리 컨트롤/포커스 세션)을 작은 칩으로 노출해 차별화.
export function PlatformPickerCard({ title, badge, statusText, cover, gradientFrom, onPress, isActive, features, largeButton }: {
  title: string;
  badge: string;
  statusText: string;
  cover: ImageSourcePropType;
  gradientFrom: string;
  onPress: () => void;
  isActive?: boolean;
  features?: string[];
  /** 2026-07-26 사용자 지시 — 카드가 하나뿐인 화면(Home)에서는 이 유일한 재생 버튼을 더 크게. */
  largeButton?: boolean;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (!isActive) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, isActive]);

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <Animated.View style={[styles.card, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          <ImageBackground source={cover} style={styles.cover} imageStyle={styles.coverImage}>
            <LinearGradient colors={[gradientFrom, 'rgba(0,0,0,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.overlay}>
              <View style={styles.textCol}>
                <View style={styles.titleRow}>
                  <Text style={styles.title} numberOfLines={1}>{title}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                </View>
                <View style={styles.statusRow}>
                  <Animated.View style={[styles.statusDot, isActive ? styles.statusDotActive : styles.statusDotIdle, { opacity: pulse }]} />
                  <Text style={styles.statusText} numberOfLines={1}>{statusText}</Text>
                </View>
                {features && features.length > 0 && (
                  <View style={styles.featureRow}>
                    {features.map((f) => (
                      <View key={f} style={styles.featureChip}>
                        <Text style={styles.featureChipText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View style={[styles.playButton, largeButton && styles.playButtonLarge]}>
                <Ionicons name="play" size={largeButton ? 18 : 14} color="#FFFFFF" style={styles.playIcon} />
              </View>
            </LinearGradient>
          </ImageBackground>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 84,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 6,
  },
  cover: { flex: 1 },
  coverImage: { resizeMode: 'cover' },
  overlay: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, minHeight: 84 },
  textCol: { gap: 3, flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: -0.2 },
  badge: { borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotActive: { backgroundColor: colors.successLight },
  statusDotIdle: { backgroundColor: 'rgba(255,255,255,0.3)' },
  statusText: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: '#D1D5DB' },
  featureRow: { flexDirection: 'row', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  featureChip: { borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2 },
  featureChipText: { fontSize: 8, fontFamily: typography.bodyFontFamilyBold, color: '#E5E7EB', letterSpacing: 0.3 },
  playButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  playButtonLarge: { width: 40, height: 40, borderRadius: 20 }, // 2026-07-26 사용자 지시로 52→40 축소(안드로이드와 맞춤 — co-session 미푸시분 반영)
  playIcon: { marginLeft: 2 }, // 원본 ml-0.5(2px) — 삼각형 아이콘의 시각적 무게중심 보정
});
