import { create } from 'zustand';

// 2026-07-25 — 배너를 (tabs)/_layout.tsx 하나에만 두고 화면들(Home/Focus/Stats/Settings)은
// 그 실제 렌더 높이만큼만 스크롤 하단 여백을 잡아야 한다(안 그러면 광고가 마지막 콘텐츠를 가림).
// ANCHORED_ADAPTIVE_BANNER는 기기 너비에 따라 높이가 달라 상수로 못 박을 수 없어서, AdBanner가
// 자기 실측 높이(onLayout)를 여기 기록해두면 각 화면이 그 값을 읽어 paddingBottom에 더한다.
//
// 2026-07-26 사용자 지적 — 화면들이 실제 탭바 높이 대신 constants/theme.ts의 고정 상수
// `layout.tabBarContentClearance`(Android=24)를 썼는데, 실제 탭바 높이((tabs)/_layout.tsx의
// `tabBarHeight` = TAB_BAR_BASE_HEIGHT(49) + 기기별 safe-area 여백, 보통 70~85px)와 크게 달라서
// 광고 배너가 탭바 위에 뜨자 마지막 콘텐츠가 탭바+배너 뒤에 가려졌다. 실제 탭바 높이도 여기서
// 같이 공유해 화면들이 더 이상 어긋난 고정 상수를 참조하지 않게 한다.
type AdBannerState = {
  height: number;
  setHeight: (height: number) => void;
  tabBarHeight: number;
  setTabBarHeight: (height: number) => void;
};

export const useAdBannerStore = create<AdBannerState>((set) => ({
  height: 0,
  setHeight: (height) => set({ height }),
  tabBarHeight: 0,
  setTabBarHeight: (height) => set({ tabBarHeight: height }),
}));
