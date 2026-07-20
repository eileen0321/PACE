import { create } from 'zustand';
import { autoNextService } from '../services/platform';

// 외부 리뷰 반영(2026-07-17): useSettingsStore.settings.autoNext는 "사용자가 켜뒀는지"(영속 설정)이고,
// 이 스토어는 "지금 이 순간 네이티브 AccessibilityService가 실제로 감시 중인지"(런타임 상태)다.
// 둘을 분리해야 설정 화면(영속)과 활성 세션(런타임)이 서로 다른 생명주기를 가질 수 있다 —
// 예: 설정은 ON이어도 세션이 없으면 isRunning=false, Foreground Service도 안 떠 있어야 배터리를 아낀다.
type AutoNextState = {
  isRunning: boolean;
  currentApp: string | null;
  start: (app: string | null) => void;
  stop: () => void;
};

export const useAutoNextStore = create<AutoNextState>((set) => ({
  isRunning: false,
  currentApp: null,

  // 2026-07-18: autoNextService.android.ts(PaceAccessibilityService 브릿지) 연결 완료. 미지원
  // 빌드(EXPO_PUBLIC_ENABLE_AUTO_NEXT=false)나 iOS에서는 supportsAutoNext=false라 start()가 던지므로
  // 실패를 조용히 흡수 — 이 스토어의 isRunning은 여전히 "런타임 의도"를 반영하고, 실제 네이티브
  // 워칭이 붙었는지는 capabilities.supportsAutoNext로 상위 UI가 별도 판단한다.
  start: (app) => {
    set({ isRunning: true, currentApp: app });
    if (autoNextService.supportsAutoNext) autoNextService.start().catch(() => {});
  },

  stop: () => {
    set({ isRunning: false, currentApp: null });
    if (autoNextService.supportsAutoNext) autoNextService.stop().catch(() => {});
  },
}));
