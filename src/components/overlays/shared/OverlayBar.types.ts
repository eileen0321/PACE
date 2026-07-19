// 오버레이는 "쇼츠를 대신 재생하는 앱"이 아니라 "쇼츠 위에서 시간만 관리하는 얇은 상태바"다.
// PACE_ARCHITECTURE.md "오버레이 UI 원칙 — 하지 말 것" 참고: 중앙 애니메이션/하단 플레이어 컨트롤 금지.
//
// Android=floating pill / iOS=frame 차분: OverlayBar.android.tsx는 화면 상단에 여백을 두고 뜨는
// 둥근 알약(pill) 모양, OverlayBar.ios.tsx는 화면 상단에 여백 없이 붙는 사각 "프레임" 배너 —
// 형태 자체로 두 플랫폼의 구현 방식(진짜 시스템 오버레이 vs 인앱 Live Activity 대체)이 다름을 드러낸다.
export type OverlayBarProps = {
  remainingMinutes: number;
  autoNextEnabled: boolean;
  onToggleAutoNext: () => void;
  /** 상시 상태바(44~56px) 탭 시 펼침 카드로 전환 */
  expanded: boolean;
  onToggleExpanded: () => void;
};

export type OverlayExpandedInfo = {
  todayUsedMinutes: number;
  dailyLimitMinutes: number;
  remainingMinutes: number;
  autoNextEnabled: boolean;
  onToggleAutoNext: () => void;
  sleepTimerMinutes: number | null;
  onCycleSleepTimer: () => void;
  isPlaying: boolean;
  onTogglePlaying: () => void;
  onStop: () => void;
  /** Extend Time(오늘 하루치 보너스 분 추가) — Focus 탭 Extend Time 칩과 같은 메커니즘
   * (useDailyBonusStore), 세션 중에도 Focus 탭으로 나가지 않고 바로 쓸 수 있게 오버레이 확장
   * 카드에도 추가(2026-07-19 — 세션 중엔 탭 네비게이터 밖의 /overlay 화면이라 Focus 탭 자체에
   * 물리적으로 접근 불가능했던 갭). */
  onExtend: (minutes: number) => void;
};

export const OVERLAY_BAR_HEIGHT = 48; // 44~56px 범위 내 기본값
