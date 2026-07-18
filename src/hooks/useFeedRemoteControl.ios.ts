import { useEffect, useRef } from 'react';
import TrackPlayer, { Capability, Event, useTrackPlayerEvents } from 'react-native-track-player';

let playerReady = false;

async function ensurePlayerSetup() {
  if (playerReady) return;
  try {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      capabilities: [Capability.SkipToNext, Capability.SkipToPrevious, Capability.Play, Capability.Pause],
    });
    playerReady = true;
  } catch (e) {
    console.warn('[useFeedRemoteControl] TrackPlayer 셋업 실패 — Bluetooth 리모컨 비활성화:', e);
  }
}

const REMOTE_EVENTS = [Event.RemoteNext, Event.RemotePrevious, Event.RemotePlay, Event.RemotePause];

type Callbacks = {
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoMode: () => void;
};

// iOS 전용(2026-07-19, 사용자 지시) — AirPods 등 Bluetooth 리모컨의 Next/Previous/Play-Pause를
// react-native-track-player의 MPRemoteCommandCenter 브릿지로 수신해 콜백에 매핑한다. 실제 오디오는
// 이 TrackPlayer가 재생하지 않는다(WebView 안 YouTube IFrame이 소리를 낸다) — 리모컨 이벤트를
// 가로채기 위한 "가상 세션"만 연다. Play/Pause는 영상 자체의 재생/정지가 아니라 Auto Mode 토글로
// 매핑(상태 머신 규칙 C) — 손대지 않고 다음 영상으로 넘어갈지 여부를 이어폰으로 제어.
// ⚠️ 이 파일은 Metro가 iOS 빌드에서만 선택(.ios.ts) — Android는 useFeedRemoteControl.android.ts
// (no-op)를 써서 react-native-track-player를 아예 참조하지 않는다(과거 react-native-webview 미링크
// 크래시 사례와 같은 위험을 원천 차단).
// ⚠️ 미검증: 이 리포에는 Mac/Xcode가 없어 실기기 iOS 빌드로 확인 못 했다 — react-native-track-player
// 자체는 Android 네이티브에도 재링크 전(2026-07-19 시점)이라, 다음에 Android를 네이티브 재빌드할 때
// (`expo prebuild`/`expo run:android`) 이 의존성이 자동링크되면서 문제가 없는지도 별도 확인 필요.
export function useFeedRemoteControl(callbacks: Callbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks; // 매 렌더 최신 콜백 유지 — stale closure 방지

  useEffect(() => {
    ensurePlayerSetup();
  }, []);

  useTrackPlayerEvents(REMOTE_EVENTS, (event) => {
    if (event.type === Event.RemoteNext) callbacksRef.current.onNext();
    else if (event.type === Event.RemotePrevious) callbacksRef.current.onPrevious();
    else if (event.type === Event.RemotePlay || event.type === Event.RemotePause) callbacksRef.current.onToggleAutoMode();
  });
}
