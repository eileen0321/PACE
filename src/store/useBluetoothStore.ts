import { create } from 'zustand';
import { bluetoothService } from '../services/platform';
import { useToastStore } from './useToastStore';

// 2026-07-19: Bluetooth Hands-Free Control 표시용 상태(Home 배지/Focus 카드/Settings 섹션 공용).
// Android: 실제 스와이프/토글/토스트/카운터는 네이티브(PaceOverlayService MediaSession)가 자기
// 완결적으로 처리하므로, 이 store의 역할은 (a) 화면 표시를 위해 refresh()로 네이티브 상태를 폴링,
// (b) 인앱 버튼 탭이 네이티브 함수를 직접 호출(= 하드웨어 리모컨과 동일 경로)하는 것 두 가지뿐 —
// Daily Limit의 consumeExpired와 같은 "네이티브가 진실원천, JS는 표시만" 설계 원칙을 그대로 따른다.
type BluetoothStoreState = {
  isConnected: boolean;
  deviceName: string | null;
  autoModeEnabled: boolean;
  nextCount: number;
  previousCount: number;
  autoToggleCount: number;
  refresh: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  toggleAutoMode: () => Promise<void>;
};

export const useBluetoothStore = create<BluetoothStoreState>((set, get) => ({
  isConnected: false,
  deviceName: null,
  autoModeEnabled: false,
  nextCount: 0,
  previousCount: 0,
  autoToggleCount: 0,

  refresh: async () => {
    const state = await bluetoothService.getState();
    set(state);
  },

  next: async () => {
    await bluetoothService.next();
    // Android는 네이티브가 이미 토스트를 쐈다(PaceOverlayService.triggerNext) — 여기 별도 토스트 없음.
    // 폴링 주기를 기다리지 않고 카운터를 낙관적으로 반영(다음 refresh에서 정확한 값으로 정정됨).
    set({ nextCount: get().nextCount + 1 });
  },

  previous: async () => {
    await bluetoothService.previous();
    set({ previousCount: get().previousCount + 1 });
  },

  toggleAutoMode: async () => {
    const next = !get().autoModeEnabled;
    await bluetoothService.toggleAutoMode(next);
    set({ autoModeEnabled: next, autoToggleCount: get().autoToggleCount + 1 });
    // iOS는 네이티브 토스트가 없으므로(하드웨어 리모컨 미구현) 인앱 버튼 탭에서는 여기서 직접 표시.
    useToastStore.getState().show(next ? '🎧 Auto Mode Enabled' : '🎧 Auto Mode Disabled');
  },
}));
