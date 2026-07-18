import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../../store/useToastStore';
import { colors, radius, spacing, typography } from '../../constants/theme';

const VISIBLE_MS = 1500; // Copilot 스펙 "Toast 1.5초" 그대로.

// 2026-07-19: Bluetooth Hands-Free 액션 피드백용 — _layout.tsx 루트에 한 번만 마운트해서 앱 어디서든
// useToastStore.getState().show(message)로 띄울 수 있게 한다. GlassSurface를 안 쓰는 이유: 토스트는
// 짧게 스치듯 사라져야 해서 블러 렌더 비용을 들일 만큼 오래 보이지 않는다 — 불투명 다크 pill로 충분.
export function ToastHost() {
  const message = useToastStore((s) => s.message);
  const id = useToastStore((s) => s.id);
  const insets = useSafeAreaInsets();
  const [visibleMessage, setVisibleMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message || id === 0) return;
    setVisibleMessage(message);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setVisibleMessage(null));
    }, VISIBLE_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!visibleMessage) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm, opacity }]}>
      <Text style={styles.text}>{visibleMessage}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  text: {
    backgroundColor: 'rgba(20,20,24,0.92)',
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: typography.bodyFontFamilyBold,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
});
