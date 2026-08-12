import { useEffect, useRef } from 'react';
import { Animated, ImageBackground, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
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
  /** 2026-07-26 — 카드가 하나뿐인 화면(Home)에서 기본(32px)보다 살짝만 크게(40px, iOS와 맞춤).
   * 52px는 사용자가 "촌스럽다"고 되돌림. */
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
            {/* 🔴 2026-08-12 사장님 지적("틱톡 홈 그래픽 이전 그래픽으로 바꾸랬더니 머했냐") —
                커버 이미지(assets/covers/tiktok.jpg)는 원본 프로토타입과 **바이트 단위로 동일**한데
                (git hash df0bbf2… 일치) 화면에선 안 보였다. 범인은 이 오버레이였다.
                원본(healthy-shorts-assistant/src/components/SourceGrid.tsx:
                `bg-gradient-to-t from-{accent}/40 to-black/80`)은 **아래→위 세로** 그라데이션에
                검정이 80%인데, 여기선 **왼→오른 가로**에 검정 90%였다. 유튜브 커버는 밝은
                빨강이라 그 밑에서도 살아남았지만 틱톡 커버는 어두운 야경이라 통째로 묻혔다 —
                같은 컴포넌트·같은 프롭인데 한쪽만 안 보이던 이유다. 원본 방향·농도로 되돌린다. */}
            {/* 🔴 2026-08-13 사장님 지시("홈 카드가 왜 이렇게 어두워? 첨부처럼 밝게") — 커버가
                거의 안 보일 만큼 덮고 있던 오버레이를 걷어낸다. 우리 레이아웃은 원본 프로토타입과
                달리 텍스트가 **왼쪽**, 재생 버튼이 오른쪽이므로 세로가 아니라 **가로**로 깐다:
                왼쪽만 글자 가독성만큼 살짝 어둡게, 오른쪽은 거의 그대로 둬서 그래픽이 살아난다. */}
            <LinearGradient
              colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.12)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.overlay}
            >
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
              {/* 2026-08-13 사장님 지시("첨부처럼 완전 최신의 글래스모피즘 스타일로, 좀 줄여서") —
                  맥 세션과 같은 시각에 각자 구현해 충돌났고, **맥의 GlassSurface 방식을 채택**한다:
                  유리 재질을 앱 공용 컴포넌트 한 곳(PaceMenu/ConnectingOverlay와 같은 패턴)에서
                  관리하는 게 맞고, 플랫폼 분기가 없어 iOS에도 그대로 적용된다.
                  거기에 두 가지만 얹었다:
                    · 크기 축소(40→32 / 32→26) — "좀 줄여서" 지시
                    · 상단 하이라이트 — 위쪽에만 밝은 띠. 첨부한 liquid glass 레퍼런스의 핵심으로,
                      이게 없으면 '반투명 원'이지 '유리'로 안 읽힌다. */}
              <GlassSurface
                style={[styles.playButton, largeButton && styles.playButtonLarge]}
                intensity={40}
                tint="dark"
                fallbackColor="rgba(88,86,214,0.35)"
              >
                <View style={styles.playHighlight} pointerEvents="none" />
                <Ionicons name="play" size={largeButton ? 15 : 12} color="#FFFFFF" style={styles.playIcon} />
              </GlassSurface>
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
  playButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // 하이라이트가 원형 밖으로 새지 않게
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  playButtonLarge: { width: 32, height: 32, borderRadius: 16 }, // 2026-08-13 40→32 축소(사장님 "좀 줄여서")
  // 상단 하이라이트 — 위쪽에만 밝은 띠(liquid glass 레퍼런스의 핵심). 없으면 유리로 안 읽힌다.
  playHighlight: {
    position: 'absolute', left: 0, right: 0, top: 0, height: '55%',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  playIcon: { marginLeft: 2 }, // 원본 ml-0.5(2px) — 삼각형 아이콘의 시각적 무게중심 보정
});
