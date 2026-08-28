// Android용 no-op — 워밍은 iOS 전용이다.
//
// Android는 앱 안에서 유튜브 페이지를 띄우는 게 아니라 **유튜브 앱 자체를 연다**(오버레이
// 어시스턴트 모델). 그래서 WebView를 미리 데울 대상이 없다. ShortsWarmup.ios.tsx 참고.
export function ShortsWarmup(_: { active: boolean }) {
  return null;
}
