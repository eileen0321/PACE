import { useEffect, useCallback } from 'react';
import { Platform, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { autoNextService } from '../services/platform';
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
import { useDailyBonusStore } from '../store/useDailyBonusStore';
import { ToastHost } from '../components/ui/ToastHost';

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
  const syncSettingsFromServer = useSettingsStore((s) => s.syncFromServer);
  const initSubscription = useSubscriptionStore((s) => s.init);
  const loadDailyBonus = useDailyBonusStore((s) => s.load);

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
    // initUser()가 끝나야 토큰 유무(로그인 성공 vs 로컬 전용 게스트 폴백)가 확정되므로, 그 이후에
    // syncFromServer를 불러야 불필요한 401(→자동로그아웃)을 피할 수 있다(services/sync/backendSync
    // 참고 — 토큰 없으면 그 안에서 스스로 스킵하지만, 순서를 지켜 의도를 명확히 한다).
    (async () => {
      await initUser();
      await loadSettings();
      syncSettingsFromServer().catch(() => {});
    })();
    initSubscription();
    loadDailyBonus();
  }, [initUser, loadSettings, syncSettingsFromServer, initSubscription, loadDailyBonus]);

  // 실기기(Galaxy Note20, 시스템 라이트 모드)에서 하단 내비게이션 바 영역이 흰색으로 보였던 진짜
  // 원인은 android/styles.xml의 Theme.AppCompat.DayNight가 시스템 라이트/다크를 따라가던 것 —
  // NoActionBar(항상 다크)로 교체하고 windowBackground/navigationBarColor(transparent)를
  // 네이티브 테마에서 직접 고정했다(android/app/src/main/res/values/styles.xml 참고). SDK 57부터
  // Android가 edge-to-edge를 강제해서 expo-navigation-bar의 setBackgroundColorAsync/
  // setButtonStyleAsync가 아예 제거됐다(AGENTS.md 경고대로 API가 바뀜) — 남은 건 아이콘 색만
  // 제어하는 setStyle뿐이라 그것만 사용.
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setStyle('light');
    }
  }, []);

  // 2026-07-19: notifyAccessibilityNeeded() 알림 탭 처리 — data.action을 보고 바로 접근성 설정으로
  // 보낸다(services/notifications/index.ts 참고). 앱이 백그라운드/종료 상태에서 탭해도 콜드 스타트 후
  // 이 리스너가 붙으면 마지막으로 탭한 알림의 response를 즉시 재전달해주는 expo-notifications 동작을
  // 그대로 활용 — 별도의 "초기 알림" 처리 코드 불필요.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.action === 'open-accessibility-settings') {
        autoNextService.requestPermission();
      }
    });
    return () => sub.remove();
  }, []);

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
            {/* iOS Pace Feed(자체 대체 피드 플레이어) — 2026-07-18 iOS 전략 확정. 풀스크린 재생. */}
            <Stack.Screen name="feed/index" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            {/* ⚠️ DEV 전용 WKWebView Shorts POC(원안 ①) — 프로덕션 제출 금지. dev/shorts-poc.tsx의 __DEV__ 가드 참고. */}
            <Stack.Screen name="dev/shorts-poc" options={{ presentation: 'fullScreenModal' }} />
          </Stack>
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
