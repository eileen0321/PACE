import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 JS 바인딩. Android 전용(expo-module.config.json의 platforms 참고) —
// iOS/web에서 requireNativeModule은 예외를 던지므로 반드시 Platform.OS === 'android'에서만 import할 것
// (services/platform/overlayService.android.ts가 그 경계를 담당).
type PaceOverlayNativeModule = {
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  hasUsageAccessPermission(): boolean;
  requestUsageAccessPermission(): void;
  start(remainingMinutes: number, autoNextEnabled: boolean): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  stop(): Promise<void>;
  // 네이티브가 백그라운드에서 스스로 카운트다운해 0에 도달하면 오버레이/서비스를 직접 정리하고
  // 이 플래그만 남긴다(PaceOverlayService.kt 상단 주석 참고) — JS는 포그라운드 복귀 시 1회 소비.
  consumeExpired(): boolean;
  // Auto Next 실제 스와이프(PaceAccessibilityService, 2026-07-18) — Play 스토어 정책 리스크가 있어
  // EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드에서만 상위 UI/서비스가 이 함수들을 호출한다.
  hasAccessibilityPermission(): boolean;
  requestAccessibilityPermission(): void;
  startAutoNextWatching(intervalMs: number): Promise<void>;
  stopAutoNextWatching(): Promise<void>;
};

export const PaceOverlay = requireNativeModule<PaceOverlayNativeModule>('PaceOverlay');
