import { useEffect, useCallback } from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUserStore } from '../store/useUserStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSubscriptionStore } from '../store/useSubscriptionStore';

const queryClient = new QueryClient();

SplashScreen.preventAutoHideAsync().catch(() => {});

// healthy-shorts-assistant(1) 리서치 결과: 프로토타입은 본문 전체에 Inter를 기본 폰트로 깔고
// (Plus Jakarta Sans는 히어로 헤드라인 한두 곳에만, JetBrains Mono는 숫자에만) 있는데, Pace는
// 지금까지 헤드라인/숫자 외 나머지 텍스트가 전부 시스템 기본 폰트(Roboto/San Francisco)로 남아
// 있었다 — 이게 "촌스럽다"는 인상의 핵심 원인. Text.defaultProps로 Inter Regular를 전역
// 기본값으로 깔아 모든 컴포넌트를 일일이 수정하지 않고 한 번에 적용.
// @ts-expect-error defaultProps는 RN 타입에 없지만 공식적으로 지원되는 전역 기본 스타일 패턴
Text.defaultProps = Text.defaultProps || {};
// @ts-expect-error 위와 동일
Text.defaultProps.style = [{ fontFamily: 'Inter_400Regular' }];

export default function RootLayout() {
  const initUser = useUserStore((s) => s.init);
  const loadSettings = useSettingsStore((s) => s.load);
  const initSubscription = useSubscriptionStore((s) => s.init);

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    initUser();
    loadSettings();
    initSubscription();
  }, [initUser, loadSettings, initSubscription]);

  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* 2026-07-18: 앱이 항상-다크 테마로 고정되면서 상태바도 시스템 설정과 무관하게 항상 밝은
              아이콘("light") 고정 — style="auto"는 OS의 라이트/다크 모드를 따라가는데, 이 앱은 더
              이상 그걸 따르지 않는다. */}
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding/index" />
            <Stack.Screen name="auth/index" />
            <Stack.Screen name="paywall/index" options={{ presentation: 'modal' }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
