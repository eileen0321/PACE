import { useEffect, useRef } from 'react';
import { Animated, ImageBackground, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) App.tsx "Choose Platform" 카드를 토씨 하나 안 틀리고 그대로 이식
// (App.tsx:342-397, 사용자 명시적 지시) — h-[100px] 풀와이드 세로 스택(가로 2분할 아님!), 커버
// 이미지 + 좌→우 그라데이션 오버레이, 제목+펄스점 상태줄, 우측 원형 재생 버튼, shadow-lg.
// 이전 버전은 가로 2열 그리드로 잘못 배치하고 상태줄/배지/그림자를 빠뜨렸었다.
export function PlatformPickerCard({ title, statusText, cover, gradientFrom, onPress, disabled }: {
  title: string;
  statusText: string;
  cover: ImageSourcePropType;
  gradientFrom: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.card, pressed && styles.pressed, disabled && styles.disabled]}>
      <ImageBackground source={cover} style={styles.cover} imageStyle={styles.coverImage}>
        <LinearGradient colors={[gradientFrom, 'rgba(0,0,0,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.overlay}>
          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <View style={styles.statusRow}>
              <Animated.View style={[styles.statusDot, { opacity: pulse }]} />
              <Text style={styles.statusText} numberOfLines={1}>{statusText}</Text>
            </View>
          </View>
          <View style={styles.playButton}>
            <Ionicons name="play" size={14} color="#FFFFFF" style={styles.playIcon} />
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 84,
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
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.4 },
  cover: { flex: 1 },
  coverImage: { resizeMode: 'cover' },
  overlay: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  textCol: { gap: 3, flexShrink: 1 },
  title: { fontSize: 15, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: -0.2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#818CF8' },
  statusText: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: '#D1D5DB' },
  playButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  playIcon: { marginLeft: 2 }, // 원본 ml-0.5(2px) — 삼각형 아이콘의 시각적 무게중심 보정
});
