import { StyleSheet } from 'react-native';

// YouTubeShortsPlayer.ios.tsx와 TikTokShortsPlayer.ios.tsx가 공유하는 WebView 공통부.
// 둘 다 "실제 사이트를 WKWebView로 그대로 띄우고 <video>에 붙어 ready/ended/progress를
// 브릿지"하는 같은 구조라, 플랫폼 고유 로직(주입 JS, UA, 쿠키/언어)만 각 파일에 남기고
// 여기엔 두 파일이 토씨 하나 안 다르게 쓰던 부분만 뽑았다.

export type ShortsPlayerHandle = { advance: () => void; previous: () => void; setMuted: (muted: boolean) => void };

// http(s)만 허용 → 앱 딥링크(youtube://, tiktok://)/앱스토어(itms-apps://) 등 "앱에서 열기"
// 시도를 차단해 WebView가 딴 데로 튕겨 까매지는 것을 막는다.
export function isAllowedNavigation(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
}

export const sharedShortsPlayerStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  loadingCover: {
    // RN 0.86 타입에서 StyleSheet.absoluteFillObject가 안 잡혀(tsc 에러) 명시적 절대위치로 대체 — 동일 효과.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
