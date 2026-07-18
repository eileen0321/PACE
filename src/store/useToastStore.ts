import { create } from 'zustand';

// 2026-07-19: Bluetooth Hands-Free 액션(Next/Previous/Auto Mode 토글) 피드백용 경량 토스트.
// react-native-paper 등 외부 UI 라이브러리 없이 이 store + components/ui/ToastHost.tsx로 자체 구현
// (프로젝트에 토스트 컴포넌트가 전혀 없었음). Android 자체 네이티브 Toast(Kotlin Toast.makeText)와는
// 별개 — 이건 JS/iOS 쪽에서 쓰는 인앱 토스트다. Android는 네이티브 스와이프/Auto Mode 토글 자체가
// 100% Kotlin에서 자기 완결적으로 일어나므로(PaceAccessibilityService/PaceOverlayService 참고) 거기선
// 네이티브 Toast를 우선 쓰고, 이 JS 토스트는 iOS 및 Focus/Settings 화면 등 일반 UI 피드백에 쓴다.
let nextId = 1;

type ToastState = {
  message: string | null;
  id: number;
  show: (message: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  id: 0,
  show: (message: string) => set({ message, id: nextId++ }),
}));
