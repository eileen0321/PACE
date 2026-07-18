import type { ScreenTimeService } from './types';

// iOS Screen Time 제어 — modules/pace-screentime(Expo Modules API 로컬 모듈, Swift/FamilyControls)를
// 감싼다. 이 모듈은 npx expo prebuild + Dev Client 빌드 + Apple "Family Controls" entitlement 승인이
// 있어야 실제 동작한다(PACE_ARCHITECTURE.md "착수 전 현실 리스크" 참고). 미링크 시 방어적 폴백.
let PaceScreenTime: {
  requestAuthorization(): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  presentAppPicker(): Promise<void>;
  startMonitoring(dailyLimitMinutes: number): Promise<void>;
  stopMonitoring(): Promise<void>;
  isShielded(): Promise<boolean>;
} | null = null;

try {
  PaceScreenTime = require('../../../modules/pace-screentime').PaceScreenTime;
} catch (e) {
  console.warn('[screenTimeService.ios] pace-screentime 네이티브 모듈 미링크(Dev Client + Family Controls entitlement 필요) — Screen Time 비활성화:', e);
}

export const screenTimeService: ScreenTimeService = {
  supportsScreenTimeControl: PaceScreenTime !== null,

  async requestAuthorization() {
    if (!PaceScreenTime) return false;
    try {
      return await PaceScreenTime.requestAuthorization();
    } catch {
      return false;
    }
  },

  async isAuthorized() {
    return (await PaceScreenTime?.isAuthorized().catch(() => false)) ?? false;
  },

  async presentAppPicker() {
    await PaceScreenTime?.presentAppPicker().catch(() => {});
  },

  async startMonitoring({ dailyLimitMinutes }) {
    await PaceScreenTime?.startMonitoring(dailyLimitMinutes).catch(() => {});
  },

  async stopMonitoring() {
    await PaceScreenTime?.stopMonitoring().catch(() => {});
  },

  async isShielded() {
    return (await PaceScreenTime?.isShielded().catch(() => false)) ?? false;
  },
};
