import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

// 2026-07-28 사장님 지시 — 원본 flip-phone.png는 실제 애플 아이폰 사진(로고 그대로)이라 상표 리스크가
// 있었다. "PACE" 워드마크로 로고를 대체한 phone03.png로 교체.
const IMAGE = require('../../../assets/phone03.png');

// 2026-07-27 사용자 지적("블러와 모션이 개 촌스러운데") — 이전 버전(보라색 글로우 블롭 여러 겹 +
// 회전하는 그라데이션 링 + breathing pulse)이 정확히 "AI가 만든 것 같은 뻔한 디자인"의 전형(색색의
// 글로우 블롭, 빙글빙글 도는 그라데이션 링)이었다 — 효과를 겹겹이 쌓을수록 화려해 보일 거란 판단이
// 틀렸음. 실제 애플 제품 사진(이 사진 자체)이 이미 고급스러우니, 배경은 최대한 절제하고(뒤에 은은한
// 무채색 비네트 하나) 모션은 "제품 회전대(turntable)"처럼 3D로 살짝 좌우로 기울어지는 것 하나로
// 통일한다 — 화려함 대신 절제가 프리미엄이라는 원칙.
// 2026-07-27 — 바닥 그림자(groundShadow)를 "까만 막대기가 뭐냐"고 재지적받아 완전히 제거. 하드
// 엣지 캡슐 모양이라 부드러운 그림자로 안 읽히고 위치도 사진 아래에서 붕 떠 보이는 이물질처럼
// 보였다 — 폰이 "뒤집혀 떠 있다/회전한다"는 컨셉 자체가 바닥에 놓인 게 아니라 공중에 있는 느낌이라
// 그림자가 애초에 필요하지 않았다.
// 2026-07-28 사장님 지시("폰이 둥둥 뜨는거 말고 트렌디한 동작 모션") — 의미 없는 부유(floating)를 걷어내고,
// 이 기능의 실제 동작인 "폰을 엎어(face-down) 휴식에 들어간다"를 보여주는 flip 제스처로 바꾼다. 폰이
// 앞으로 살짝 기울며 엎어졌다(rotateX) → 잠깐 머물고(휴식 측정 중) → 다시 세워지는 루프. 엎어졌을 때
// 바닥에 부드러운 접지광(soft glow)이 은은히 번져 "놓였다"는 느낌만 준다(색색 블롭 금지, 무채색 절제).
export function FlipPhoneHero() {
  const entrance = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(0)).current; // 0 = 세워짐, 1 = 엎어짐(face-down)

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, friction: 7, tension: 45 }).start();

    const flipLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(flip, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }), // 엎기
        Animated.delay(1800), // 엎은 채 휴식 측정
        Animated.timing(flip, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }), // 다시 세우기
        Animated.delay(1200),
      ])
    );
    flipLoop.start();
    return () => flipLoop.stop();
  }, [entrance, flip]);

  const entranceScale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const rotateX = flip.interpolate({ inputRange: [0, 1], outputRange: ['6deg', '-74deg'] }); // 앞으로 엎어짐
  const settleY = flip.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }); // 엎으며 살짝 내려앉음
  const settleScale = flip.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });
  const glowOpacity = flip.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.04, 0.14] }); // 엎었을 때만 접지광
  const glowScale = flip.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <Animated.View style={[styles.wrap, { opacity: entrance, transform: [{ scale: entranceScale }] }]}>
      <View style={styles.vignette} />
      {/* 접지광 — 폰이 엎어질 때만 은은히 번지는 무채색 소프트 글로우(바닥에 놓인 느낌). */}
      <Animated.View style={[styles.contactGlow, { opacity: glowOpacity, transform: [{ scaleX: glowScale }] }]} />
      <Animated.View
        style={[
          styles.stage,
          { transform: [{ perspective: 900 }, { rotateX }, { translateY: settleY }, { scale: settleScale }] },
        ]}
      >
        <Image source={IMAGE} style={styles.image} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 240, height: 220, alignItems: 'center', justifyContent: 'center' },
  vignette: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.06)' },
  // 접지광 — 폰이 엎어질 때 바닥에 번지는 소프트 무채색 글로우(넓고 납작한 타원, 낮은 불투명도로 은은하게).
  contactGlow: { position: 'absolute', bottom: 34, width: 150, height: 30, borderRadius: 40, backgroundColor: '#FFFFFF' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  image: { width: 208, height: 188 },
});
