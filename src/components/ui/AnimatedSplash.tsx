import { useCallback, useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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

// 2026-08-01 사용자 지적("앱 시작할 때 아이콘은 빛나는데 그 뒤 스플래시 원 안 아이콘은 빛이 없다") —
// iOS만 vibrant 버전을 쓰고 Android는 splash-icon.png(최대밝기 217, 모서리 #090a0c)를 쓰고 있어서,
// Android에서 [네이티브 런치스크린(빛남)] → [이 JS 스플래시(빛바램)]로 넘어갈 때 로고가 눈에 띄게
// 바뀌었다. 이 파일 아래 주석의 "런치스크린과 첫 프레임이 시각적으로 동일해야 한다"는 원칙 자체를
// 어기고 있던 것. Android 네이티브 스플래시(drawable/splashscreen_logo)도 같은 날 ios-splash-icon
// 기반으로 통일했으므로 여기도 플랫폼 분기 없이 동일 소스를 쓴다(최대밝기 255, 모서리 #060709로
// 스플래시 배경과 정확히 일치 — 사각 경계도 안 보임).
const ICON = require('../../../assets/ios-splash-icon.png');
const DURATION_MS = 600;

// 2026-07-26 재작성(웹리서치 반영 — Apple HIG + Uber/Swiggy 방식): 앱 실행 "아이콘 번쩍" 해결.
// 상용앱 규칙: 네이티브 런치스크린과 애니메이션 스플래시의 "첫 프레임"이 시각적으로 동일해야 한다.
// 로고를 opacity 0→1/scale로 "등장"시키면 그 순간이 번쩍인다. → 로고는 런치스크린과 똑같이(화면 중앙,
// 120px, 박스 없음) 처음부터 떠 있고, 나머지 브랜딩 효과(글로우/시머/PACE 텍스트/로딩바)만 그 위에
// 얹어 페이드인한다. 이러면 [iOS 아이콘 확대]→[런치 로고]→[스플래시 로고]가 미동 없이 이어진다.
export function AnimatedSplash({ onComplete, onLayoutReady }: { onComplete: () => void; onLayoutReady?: () => void }) {
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);

  useEffect(() => {
    // 로고는 애니메이션 없음(런치스크린과 동일 고정). 효과만 등장.
    textOpacity.value = withDelay(150, withTiming(1, { duration: 220 }));
    textY.value = withDelay(150, withTiming(0, { duration: 220 }));
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, onComplete, textOpacity, textY]);

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
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
      {/* 로고: 런치스크린과 동일 — 화면 중앙, 박스/애니메이션 없음(미동 없이 이어짐). */}
      <View style={styles.iconArea}>
        {/* 2026-08-01 사용자 지시("빛이 있는 이미지를 그대로 써라") — 원래 로고 뒤에 보라색 글로우 원을
            깔았는데, 이 로고 이미지(ios-splash-icon.png)는 배경이 불투명한 어두운 카드([4,5,8])라
            그보다 밝은 글로우 원([16,14,36]) 위에 얹히면 카드의 사각 경계가 그대로 드러났다(실기기
            화면녹화 프레임 픽셀로 확인). 이미지를 가공하지 않고 원본 그대로 쓰려면 이 원을 빼는 것
            외엔 방법이 없다 — 로고 자체에 이미 빛(글로우/블룸)이 그려져 있어 별도 원이 없어도
            충분하고, 네이티브 런치스크린(원 없음)과도 이제 완전히 동일해진다. */}
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
  // 2026-08-01 사용자 지적("네이티브 스플래시에선 크게 보이다가 JS 스플래시 원 안에선 작아진다") —
  // 실기기 화면녹화 프레임을 픽셀로 실측해보니 매듭 폭이 네이티브 303px vs JS 194px(64%)로 실제로
  // 확 줄어들고 있었다. 원인: 이 로고는 120dp로 고정인데(=330px @2.75x), 그 이미지 안에서 매듭이
  // 차지하는 비율이 약 59%라 실제 매듭은 194px밖에 안 됐다. 네이티브와 같은 매듭 크기가 되도록
  // 120 → 188dp로 키운다(303/194 = 약 1.56배). 이러면 [네이티브 스플래시]→[JS 스플래시] 전환에서
  // 로고 크기가 안 변한다 — 이 파일의 "두 화면이 시각적으로 동일해야 한다"는 원칙 그대로.
  iconArea: { width: 188, height: 188, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 188, height: 188 },
  // 로고가 커진 만큼(120→188, 반지름 기준 +34) 텍스트도 같이 내려 겹치지 않게 한다.
  textBlock: { position: 'absolute', top: '50%', marginTop: 118, alignItems: 'center' },
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
