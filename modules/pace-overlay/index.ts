import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 JS 바인딩. Android 전용(expo-module.config.json의 platforms 참고) —
// iOS/web에서 requireNativeModule은 예외를 던지므로 반드시 Platform.OS === 'android'에서만 import할 것
// (services/platform/overlayService.android.ts가 그 경계를 담당).
type PaceOverlayNativeModule = {
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  start(remainingMinutes: number, autoNextEnabled: boolean): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  stop(): Promise<void>;
};

export const PaceOverlay = requireNativeModule<PaceOverlayNativeModule>('PaceOverlay');
