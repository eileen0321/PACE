import { create } from 'zustand';

// 외부 리뷰 반영(2026-07-17): useSettingsStore.settings.autoNext는 "사용자가 켜뒀는지"(영속 설정)이고,
// 이 스토어는 "지금 이 순간 네이티브 AccessibilityService가 실제로 감시 중인지"(런타임 상태)다.
// 둘을 분리해야 설정 화면(영속)과 활성 세션(런타임)이 서로 다른 생명주기를 가질 수 있다 —
// 예: 설정은 ON이어도 세션이 없으면 isRunning=false, Foreground Service도 안 떠 있어야 배터리를 아낀다.
type AutoNextState = {
  isRunning: boolean;
  currentApp: string | null;
  start: (app: string | null) => void;
  stop: () => void;
  setCurrentApp: (app: string | null) => void;
};

export const useAutoNextStore = create<AutoNextState>((set) => ({
  isRunning: false,
  currentApp: null,

  start: (app) => {
    set({ isRunning: true, currentApp: app });
    // NativeModules.PaceAutoNext.start() 연결 예정 — services/platform/autoNextService.android.ts 참고
  },

  stop: () => {
    set({ isRunning: false, currentApp: null });
    // NativeModules.PaceAutoNext.stop() 연결 예정
  },

  setCurrentApp: (app) => set({ currentApp: app }),
}));
