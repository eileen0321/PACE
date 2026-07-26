import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../constants/theme';

const IMAGE = require('../../../assets/flip-phone.png');
const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

// 2026-07-26 사용자 지시 — 온보딩 가이드의 폰이미지가 "촌스럽고 단순하다"는 지적(다른 페이지의
// SnapPulse/GestureFlick/RemoteClick 일러스트는 전부 은은하게 움직이는데 이 사진만 정적이라
// 상대적으로 밋밋해 보였음). "애니메이션 효과 못넣어?"/"트렌드에 맞게" 재지적 이후 2026 모바일 UI
// 트렌드 조사(Muzli/Tubik 등, 2026-07-26) 반영 — 단순 정적 블롭 대신 (1) 천천히 회전하는 그라데이션
// 헤일로(halo, "glow ring" 트렌드), (2) 숨쉬듯 커졌다 작아지는 breathing pulse, (3) 등장 시
// 스프링 바운스(microinteraction), (4) 리니어 대신 sine 이징의 유기적인 float — 4겹을 조합한다.
// 2026-07-26 — "폰이 너무 시커멓기만 하다" 재지적. 원본 사진 자체가 짙은 회색 아이폰 뒷면이라 브랜드
// 컬러(보라 계열) 글로우만으로는 다크 배경 위에서 여전히 어두운 덩어리로 묻힌다 — 사진 바로 뒤에
// 밝은(흰색 계열) 스포트라이트를 한 겹 더 깔아 실루엣이 배경과 확실히 분리되도록 대비를 준다.
export function FlipPhoneHero() {
  const entrance = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, friction: 6, tension: 40 }).start();

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const spinLoop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true })
    );
    floatLoop.start();
    breatheLoop.start();
    spinLoop.start();
    return () => {
      floatLoop.stop();
      breatheLoop.stop();
      spinLoop.stop();
    };
  }, [entrance, float, breathe, spin]);

  const entranceScale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const rotate = float.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  const glowScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.95] });
  const spinRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={[styles.wrap, { opacity: entrance, transform: [{ scale: entranceScale }] }]}>
      <Animated.View style={[styles.haloWrap, { transform: [{ rotate: spinRotate }] }]}>
        <AnimatedGradient
          colors={[`${colors.primary}00`, `${colors.primary}55`, `${colors.primary}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.halo, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
        />
      </Animated.View>
      <Animated.View style={[styles.glowInner, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      <View style={styles.spotlightMid} />
      <View style={styles.spotlightCore} />
      <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>
        <Image source={IMAGE} style={styles.image} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 240, height: 220, alignItems: 'center', justifyContent: 'center' },
  haloWrap: { position: 'absolute', width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  halo: { width: 220, height: 220, borderRadius: 110 },
  glowInner: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: `${colors.primary}26` },
  spotlightMid: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(255,255,255,0.05)' },
  spotlightCore: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,255,255,0.10)' },
  image: { width: 210, height: 190, shadowColor: '#000000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.35, shadowRadius: 22 },
});
