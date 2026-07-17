import type { OverlayService } from './types';

// iOS는 다른 앱 위에 항상-표시 윈도우를 띄울 수 없음(OS 정책). 대신 ActivityKit Live Activity +
// Dynamic Island로 "23m Left"를 잠금화면/다이나믹아일랜드에 표시하고, 5분/1분 전은 로컬 알림으로 대체.
// TODO(네이티브): ActivityKit 브릿지(Activity.request / activity.update / activity.end) 연결.
export const overlayService: OverlayService = {
  supportsSystemOverlay: false,
  async startSession() {
    // NativeModules.PaceLiveActivity.start(params) 연결 예정
  },
  async updateRemaining() {
    // NativeModules.PaceLiveActivity.update(remainingMinutes) 연결 예정
  },
  async endSession() {
    // NativeModules.PaceLiveActivity.end() 연결 예정
  },
  async hasForegroundDetectionPermission() {
    return true; // iOS는 포그라운드 앱 감지 개념 자체가 없음(오버레이 대신 Live Activity/Pace Player) — no-op
  },
  async requestForegroundDetectionPermission() {
    // no-op
  },
};
