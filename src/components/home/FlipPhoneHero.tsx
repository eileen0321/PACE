import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

const IMAGE = require('../../../assets/flip-phone.png');

// 2026-07-27 사용자 지적("블러와 모션이 개 촌스러운데") — 이전 버전(보라색 글로우 블롭 여러 겹 +
// 회전하는 그라데이션 링 + breathing pulse)이 정확히 "AI가 만든 것 같은 뻔한 디자인"의 전형(색색의
// 글로우 블롭, 빙글빙글 도는 그라데이션 링)이었다 — 효과를 겹겹이 쌓을수록 화려해 보일 거란 판단이
// 틀렸음. 실제 애플 제품 사진(이 사진 자체)이 이미 고급스러우니, 배경은 최대한 절제하고(뒤에 은은한
// 무채색 비네트 하나 + 바닥 그림자) 모션은 "제품 회전대(turntable)"처럼 3D로 살짝 좌우로 기울어지는
// 것 하나로 통일한다 — 화려함 대신 절제가 프리미엄이라는 원칙.
export function FlipPhoneHero() {
  const entrance = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, friction: 7, tension: 45 }).start();

    const tiltLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(tilt, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(tilt, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    tiltLoop.start();
    return () => tiltLoop.stop();
  }, [entrance, tilt]);

  const entranceScale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const rotateY = tilt.interpolate({ inputRange: [0, 1], outputRange: ['-9deg', '9deg'] });
  const translateY = tilt.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] });
  const shadowScaleX = tilt.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  return (
    <Animated.View style={[styles.wrap, { opacity: entrance, transform: [{ scale: entranceScale }] }]}>
      <View style={styles.vignette} />
      {/* ⚠️ 그림자는 반드시 사진보다 먼저(뒤에) 그려야 한다 — 순서가 바뀌면 사진 하단을 그림자
          바가 가로질러 덮어버려 "사진이 잘려 보인다"는 버그가 생긴다(실기기에서 발견). */}
      <Animated.View style={[styles.groundShadow, { transform: [{ scaleX: shadowScaleX }] }]} />
      <Animated.View
        style={[
          styles.stage,
          { transform: [{ perspective: 800 }, { rotateY }, { translateY }] },
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
  stage: { alignItems: 'center', justifyContent: 'center' },
  image: { width: 208, height: 188 },
  groundShadow: { position: 'absolute', bottom: 0, width: 120, height: 16, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.4)' },
});
