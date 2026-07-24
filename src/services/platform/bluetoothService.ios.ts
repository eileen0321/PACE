import type { BluetoothService, BluetoothState } from './types';

// 2026-07-19: iOS 하드웨어 리모컨(AirPods 등) 이벤트 자체는 app/feed/index.tsx가
// hooks/useFeedRemoteControl.ios.ts(react-native-track-player)로 직접 수신·처리한다(Pace Feed
// 화면 안에서만 의미 있는 조작이라 화면 로컬 상태로 충분 — 전역 서비스로 뺄 이유가 없음).
// 이 파일은 Home/Focus/Settings 등 화면 밖 UI가 "지금 Bluetooth Hands-Free가 준비돼 있다"를
// 표시할 때 쓰는 자리표시자(placeholder) 스텁이다 — Xcode/실기기가 없어 이번 라운드에서 실제
// 연결기기 조회(AVAudioSession) 네이티브 코드는 작성/검증하지 못했다. supportsHardwareRemote=false로
// 정직하게 표시(상위 UI가 이 값으로 "실기기 미검증" 배지를 조건부로 보여줄 수 있게).
export const bluetoothService: BluetoothService = {
  supportsHardwareRemote: false,

  async getState(): Promise<BluetoothState> {
    return {
      isConnected: false,
      deviceName: null,
      autoModeEnabled: false,
      nextCount: 0,
      previousCount: 0,
      autoToggleCount: 0,
    };
  },

  async next() {},
  async previous() {},
  async toggleAutoMode() {},
  async setFocusSessionDurationMinutes() {},
  async getFocusSessionDurationMinutes() { return 10; },
  async hasRecordAudioPermission() { return true; },
  async requestRecordAudioPermission() { return true; },
  async hasCameraPermission() { return true; },
  async requestCameraPermission() { return true; },
};
