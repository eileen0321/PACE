// Flip Mode(내려놓은 시간 측정)는 iOS 전용(useFlipMode.ios.ts, CMMotionManager).
// Android는 co-session의 네이티브 Flip 감지로 별도 처리 → 여기선 no-op. Metro가 플랫폼별 선택.
export function useFlipMode(_: { enabled: boolean }) {
  // no-op
}
