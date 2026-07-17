import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUserStore } from '../store/useUserStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSubscriptionStore } from '../store/useSubscriptionStore';

const queryClient = new QueryClient();

export default function RootLayout() {
  const initUser = useUserStore((s) => s.init);
  const loadSettings = useSettingsStore((s) => s.load);
  const initSubscription = useSubscriptionStore((s) => s.init);

  useEffect(() => {
    initUser();
    loadSettings();
    initSubscription();
  }, [initUser, loadSettings, initSubscription]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
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
