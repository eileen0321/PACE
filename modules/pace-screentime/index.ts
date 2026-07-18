import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 JS 바인딩 — iOS(apple) 전용(expo-module.config.json 참고).
// Android/web/Expo Go에서 requireNativeModule은 throw하므로 반드시 iOS + Dev Client 빌드에서만
// 로드할 것(services/platform/screenTimeService.ios.ts가 try/catch 경계를 담당).
//
// ⚠️ 실동작 전제(PACE_ARCHITECTURE.md "착수 전 현실 리스크"):
//   1) Apple "Family Controls (Distribution)" entitlement 승인
//   2) npx expo prebuild + EAS Dev Client 빌드(FamilyControls/DeviceActivity/ManagedSettings는
//      시뮬레이터 지원이 제한적 — 실기기 권장)
//   3) DeviceActivityMonitor / ShieldConfiguration Extension 타깃(별도 App Extension) 추가
type PaceScreenTimeNativeModule = {
  requestAuthorization(): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  presentAppPicker(): Promise<void>;
  startMonitoring(dailyLimitMinutes: number): Promise<void>;
  stopMonitoring(): Promise<void>;
  isShielded(): Promise<boolean>;
};

export const PaceScreenTime = requireNativeModule<PaceScreenTimeNativeModule>('PaceScreenTime');
