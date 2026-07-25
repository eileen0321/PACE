import { create } from 'zustand';

// 2026-07-25 — 배너를 (tabs)/_layout.tsx 하나에만 두고 화면들(Home/Focus/Stats/Settings)은
// 그 실제 렌더 높이만큼만 스크롤 하단 여백을 잡아야 한다(안 그러면 광고가 마지막 콘텐츠를 가림).
// ANCHORED_ADAPTIVE_BANNER는 기기 너비에 따라 높이가 달라 상수로 못 박을 수 없어서, AdBanner가
// 자기 실측 높이(onLayout)를 여기 기록해두면 각 화면이 그 값을 읽어 paddingBottom에 더한다.
type AdBannerState = {
  height: number;
  setHeight: (height: number) => void;
};

export const useAdBannerStore = create<AdBannerState>((set) => ({
  height: 0,
  setHeight: (height) => set({ height }),
}));
