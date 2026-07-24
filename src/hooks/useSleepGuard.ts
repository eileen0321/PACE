// 취침 감지 가드는 iOS 전용(useSleepGuard.ios.ts — CMMotionManager 무진동).
// Android는 네이티브(PaceOverlayService의 registerStillnessSensor + performTick)가 담당 → 여기선 no-op.
// Metro가 플랫폼별 선택.
export function useSleepGuard(_: { enabled: boolean; onSleep: () => void }) {
  // no-op
}
