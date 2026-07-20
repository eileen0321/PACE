// Metro가 파일 확장자(.android.ts/.ios.ts)로 플랫폼별 구현을 자동 선택한다 — 여기선 재수출만 한다.
// 상위 코드는 반드시 이 배럴을 통해서만 import하고 Platform.OS를 직접 검사하지 않는다.
export { autoNextService } from './autoNextService';
export { overlayService } from './overlayService';
export { screenTimeService } from './screenTimeService';
export { bluetoothService } from './bluetoothService';
export { capabilities, useCapabilities } from './capabilities';
export type { AppCapabilities } from './capabilities';
export * from './types';
