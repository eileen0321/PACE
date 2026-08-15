import { StyleSheet } from 'react-native';

// YouTubeShortsPlayer.ios.tsx와 TikTokShortsPlayer.ios.tsx가 공유하는 WebView 공통부.
// 둘 다 "실제 사이트를 WKWebView로 그대로 띄우고 <video>에 붙어 ready/ended/progress를
// 브릿지"하는 같은 구조라, 플랫폼 고유 로직(주입 JS, UA, 쿠키/언어)만 각 파일에 남기고
// 여기엔 두 파일이 토씨 하나 안 다르게 쓰던 부분만 뽑았다.

export type ShortsPlayerHandle = {
  advance: () => void;
  previous: () => void;
  setMuted: (muted: boolean) => void;
  /** 2026-08-13 — 틱톡 전용(선택 프로퍼티, YouTube는 구현 안 함). 안드로이드가 이미 같은 원칙으로
   *  구현한 "검색은 우리 UI로 받고 결과는 틱톡 화면으로" 패턴의 iOS 버전 — WebView라 딥링크 대신
   *  같은 WebView를 틱톡 검색 URL로 이동시킨다(QA_MATRIX.md 1-4b 맥 세션 요청 참고). 빈 문자열이면
   *  검색에서 나가 다시 /foryou 피드로 돌아간다. */
  search?: (query: string) => void;
  /** 2026-08-15 — 틱톡 전용(선택 프로퍼티). YouTube는 useShortsQueueStore.current로 지금 영상을
   *  이미 알고 있어(videoId/title/channel) 이 메서드가 필요 없다 — 틱톡은 큐가 없어 "지금 보이는
   *  영상"을 WebView 안에서 직접 찾아 알려줘야 "현재 영상 즐겨찾기 추가"가 동작한다. 못 찾으면 null. */
  getCurrentVideoUrl?: () => Promise<string | null>;
  /** 2026-08-15 — __DEV__ 전용, 틱톡 전용. "검색 → 결과 탭" 버그 재현이 실기기 손가락 탭 없이는
   *  안 돼서(터치 주입 도구 없음), 검색결과 그리드에서 실제 영상 링크(href에 /video/ 포함)를 찾아
   *  프로그램적으로 .click()한다 — 실제 탭과 동일한 DOM 이벤트를 발생시켜 재현용으로 충분하다. */
  debugClickFirstSearchResult?: () => void;
  /** 2026-08-15 — __DEV__ 전용, 틱톡 전용. 사이드바 CSS 숨김 이후 다른 메뉴(검색/프로필 등)도
   *  제대로 나오는지 실기기 탭 없이 확인하기 위한 범용 진단 클릭 — data-e2e 값으로 요소를 찾아
   *  .click()한다(찾은 요소가 없으면 domlog로 실패를 보고, 그냥 조용히 넘어가지 않는다). */
  debugClickByDataE2E?: (name: string) => void;
};

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
