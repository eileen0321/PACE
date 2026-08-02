import { useCallback, useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, typography } from '../../constants/theme';

// 2026-08-02 사장님이 직접 만든 자산으로 "글로우 원 안에 로고" 복원. 예전엔 로고 이미지 배경이 불투명
// 어두운 카드([4,5,8])라 그보다 밝은 글로우 원 위에 얹으면 사각 경계가 드러나 원을 뺐었는데(0a50b24),
// 그때 투명 처리 시도는 글로우까지 잘려 "빛바램"이 났었다. 이번 Phone11_bgt.png는 **배경만 투명(45%)이고
// 글로우(빛 번짐)는 반투명으로 그대로 보존 + 풀밝기(99%ile 227, 기존 222보다 오히려 밝음)** — 픽셀 실측
// 확인. 그래서 뒤에 글로우 원을 깔아도 (1)사각 경계 없음(투명 배경) (2)빛바램 없음(글로우 보존) (3)투명
// 사이로 원이 비쳐 오히려 더 빛남. 네이티브 런치스크린은 같은 로고의 불투명 버전(Phone11.png)을 써서
// 로고 아트는 동일 크기로 이어지고, 원(글로우)만 JS에서 페이드인한다.
const ICON = require('../../../assets/Phone11_bgt.png');
const DURATION_MS = 600;
const ICON_SIZE = 160;      // 로고(매듭)
const GLOW_SIZE = 300;      // 빛나는 보라 원(로고보다 커서 "원 안의 아이콘")

// 2026-07-26 재작성(웹리서치 반영 — Apple HIG + Uber/Swiggy 방식): 앱 실행 "아이콘 번쩍" 해결.
// 상용앱 규칙: 네이티브 런치스크린과 애니메이션 스플래시의 "첫 프레임"이 시각적으로 동일해야 한다.
// 로고를 opacity 0→1/scale로 "등장"시키면 그 순간이 번쩍인다. → 로고는 런치스크린과 똑같이(화면 중앙,
// 120px, 박스 없음) 처음부터 떠 있고, 나머지 브랜딩 효과(글로우/시머/PACE 텍스트/로딩바)만 그 위에
// 얹어 페이드인한다. 이러면 [iOS 아이콘 확대]→[런치 로고]→[스플래시 로고]가 미동 없이 이어진다.
export function AnimatedSplash({ onComplete, onLayoutReady }: { onComplete: () => void; onLayoutReady?: () => void }) {
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);
  // 2026-08-02 사장님 지시("고급스럽게 멋있게") — 로고 뒤 글로우 원을 "블룸"처럼 부드럽게 등장시킨다.
  // 로고(불투명 아트)는 런치스크린과 미동 없이 이어지고, 글로우만 살짝 커지며(0.92→1) 페이드인 →
  // 은은하게 빛이 차오르는 프리미엄 인트로. 스플래시 총길이(600ms) 안에 다 보이도록 420~520ms.
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0.92);

  useEffect(() => {
    // 로고는 애니메이션 없음(런치스크린과 동일 고정). 효과만 등장.
    textOpacity.value = withDelay(150, withTiming(1, { duration: 220 }));
    textY.value = withDelay(150, withTiming(0, { duration: 220 }));
    // 글로우 원: 로고 뒤에서 부드럽게 차오름(블룸). ease-out으로 자연스럽게 안착.
    glowOpacity.value = withDelay(40, withTiming(1, { duration: 440, easing: Easing.out(Easing.ease) }));
    glowScale.value = withDelay(40, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) }));
    // 2026-08-02 사장님 지적("스플래시 맨 밑에 빛이 지나가는 효과 줄 너무 빨라") — 260ms는 한 번
    // 지나가는 게 눈에 안 잡힐 만큼 빨라서 깜빡이는 것처럼 보였다. 900ms로 늦춰 한 줄기 빛이
    // 천천히 훑고 지나가는 느낌으로.
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, glowOpacity, glowScale, onComplete, textOpacity, textY]);

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${barX.value * 100}%` }],
  }));

  // 위 onLayout 주석 참고 — 레이아웃/이미지로드 둘 다 끝났을 때만 네이티브 런치스크린을 내린다.
  // onLayoutReady(SplashScreen.hideAsync)는 정확히 1회만 불려야 하므로 ref로 중복 호출을 막는다.
  const layoutDoneRef = useRef(false);
  const iconDoneRef = useRef(false);
  const handoffDoneRef = useRef(false);
  const tryHandoff = useCallback(() => {
    if (handoffDoneRef.current) return;
    if (!layoutDoneRef.current || !iconDoneRef.current) return;
    handoffDoneRef.current = true;
    onLayoutReady?.();
  }, [onLayoutReady]);
  const markLayoutReady = useCallback(() => { layoutDoneRef.current = true; tryHandoff(); }, [tryHandoff]);
  const markIconReady = useCallback(() => { iconDoneRef.current = true; tryHandoff(); }, [tryHandoff]);
  // 안전장치 — 이미지 onLoad가 끝내 안 오는 경우(네트워크/디코딩 실패)에도 런치스크린이 영원히
  // 안 내려가 앱이 멈춘 것처럼 보이면 안 되므로, 1.5초 뒤엔 무조건 넘긴다.
  useEffect(() => {
    const t = setTimeout(() => { iconDoneRef.current = true; layoutDoneRef.current = true; tryHandoff(); }, 1500);
    return () => clearTimeout(t);
  }, [tryHandoff]);

  return (
    <Animated.View
      exiting={FadeOut.duration(400)}
      style={styles.container}
      // ⭐ 네이티브 런치스크린은 "이 JS 스플래시가 실제로 그려진 뒤에" 숨겨야 갭(번쩍/끊김)이 없다.
      // (reactnativeschool: onLayout 시점 = 첫 프레임 페인트 완료. 여기서 SplashScreen.hideAsync 호출.)
      // 2026-08-01 사용자 지적("스플래시 원 안에 아이콘이 없다") — 실기기 연속캡처(22프레임)로 확인:
      // onLayout은 "레이아웃 완료"일 뿐 <Image>의 디코딩 완료가 아니다. 그래서 네이티브 런치스크린이
      // 먼저 사라지고, 로고는 아직 안 그려진 상태로 글로우 원과 PACE 텍스트만 보이는 구간이 실제로
      // 존재했다(원만 덩그러니 뜨는 그 화면). 레이아웃과 이미지 로드가 "둘 다" 끝난 뒤에만 런치스크린을
      // 내려 이 갭 자체를 없앤다 — 이 파일의 원칙("첫 프레임이 런치스크린과 동일해야 한다")의 원래 의도.
      onLayout={markLayoutReady}
    >
      {/* 보라색 원형 + 빛효과 — SVG RadialGradient로 중심이 밝고 가장자리로 부드럽게 사라지는 진짜
          "빛나는 원"(밴딩/뭉개짐 없는 매끈한 그라데이션). Phone11_bgt는 배경 투명이라 이 빛이 로고
          사이로 비쳐 "보라색 원 안에서 빛나는 아이콘"이 된다. 원은 살짝 커지며(블룸) 페이드인. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.glowWrap, glowStyle]} pointerEvents="none">
        <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
          <Defs>
            <RadialGradient id="paceGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={colors.primary} stopOpacity={0.6} />
              <Stop offset="38%" stopColor={colors.primary} stopOpacity={0.32} />
              <Stop offset="70%" stopColor={colors.primary} stopOpacity={0.1} />
              <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={GLOW_SIZE / 2} cy={GLOW_SIZE / 2} r={GLOW_SIZE / 2} fill="url(#paceGlow)" />
        </Svg>
      </Animated.View>

      {/* 로고: 런치스크린과 동일 아트(불투명 Phone11) — 화면 중앙, 미동 없이 이어짐. 여기선 투명 버전. */}
      <View style={styles.iconArea}>
        <Image source={ICON} style={styles.icon} onLoad={markIconReady} />
      </View>

      {/* 브랜딩 텍스트: 로고 아래 절대배치로 페이드인(로고 위치는 안 건드림). */}
      <Animated.View style={[styles.textBlock, textStyle]}>
        <Text style={styles.title}>PACE</Text>
        <Text style={styles.subtitle}>Dopamine Loop Guard</Text>
      </Animated.View>

      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, barStyle]}>
          <LinearGradient
            colors={['transparent', colors.primary, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 110,
    backgroundColor: '#060709',
    alignItems: 'center',
    justifyContent: 'center', // 로고를 화면 정중앙에(런치스크린과 동일)
  },
  // 로고(Phone11_bgt): 투명 배경이라 매듭이 프레임을 꽉 채운다 → 뒤 글로우 원이 로고보다 확실히
  // 커야 "원 안의 매듭"으로 읽히므로 로고는 160으로. 네이티브 런치(app.json imageWidth)도 160으로 맞춰
  // [네이티브(원 없음)]→[JS(원 페이드인)] 전환에서 로고 아트 크기가 안 변하고 원만 차오른다.
  iconArea: { width: ICON_SIZE, height: ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
  icon: { width: ICON_SIZE, height: ICON_SIZE },
  // 빛나는 원(SVG radial)을 화면 중앙에 정렬.
  glowWrap: { alignItems: 'center', justifyContent: 'center' },
  // 로고 아래 텍스트 — 빛나는 원 바깥으로 충분히 내려 겹침 방지.
  textBlock: { position: 'absolute', top: '50%', marginTop: 128, alignItems: 'center' },
  title: {
    fontSize: 30,
    fontFamily: typography.bodyFontFamilyExtrabold,
    color: colors.textPrimary,
    letterSpacing: 10,
    textAlign: 'center',
    marginLeft: 10,
  },
  subtitle: {
    fontSize: 10,
    fontFamily: typography.bodyFontFamilyExtrabold,
    color: '#818CF8',
    letterSpacing: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginTop: 8,
    opacity: 0.6,
  },
  barTrack: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    width: 160,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  barFill: { width: '50%', height: '100%' },
});
