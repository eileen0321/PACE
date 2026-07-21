// 볼륨키 → 다음 Short는 iOS 전용(useVolumeNext.ios.ts). Android/기타는 no-op —
// Android는 접근성 오버레이/제스처로 별도 처리(overlayService/pace-gesture). Metro가 플랫폼별 선택.
export function useVolumeNext(_: { enabled: boolean; onNext: () => void }) {
  // no-op
}
