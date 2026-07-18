// 2026-07-19: react-native-track-player는 iOS 전용(hooks/useFeedRemoteControl.ios.ts, Bluetooth
// Hands-Free의 AirPods 리모컨 수신 — PACE_ARCHITECTURE.md 참고, 사용자 지시로 "iOS일 때만" 적용) —
// Android는 같은 기능을 네이티브 MediaSession(modules/pace-overlay/PaceOverlayService.kt)으로
// 별도 구현했고 이 라이브러리를 전혀 참조하지 않는다. 이 패키지의 Android 네이티브 코드(Kotlin)가
// 이 프로젝트의 Kotlin 컴파일러 설정과 안 맞아(Bundle?/Bundle nullability 불일치) 오토링킹 시
// Android 빌드 자체가 깨지므로, Android 플랫폼에서는 오토링킹 대상에서 명시적으로 제외한다.
module.exports = {
  dependencies: {
    'react-native-track-player': {
      platforms: {
        android: null,
      },
    },
  },
};
