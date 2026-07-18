// Android는 이 화면(Pace Feed, app/feed/index.tsx) 자체에 진입하지 않는다 —
// capabilities.supportsPaceFeed는 iOS 전용(Android는 오버레이+실제 앱 실행이 그 역할을 대신함).
// no-op. react-native-track-player를 전혀 참조하지 않으므로 Android 네이티브 (재)링크 여부와
// 무관하게 항상 안전 — Metro가 파일 확장자로 이 변형을 선택하는 것 자체가 방어선.
export function useFeedRemoteControl(_callbacks: {
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoMode: () => void;
}) {
  // no-op
}
