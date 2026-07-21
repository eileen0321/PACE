import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// iOS 전용 Shorts 플레이어 (2026-07-21 사용자 지시: "IFrame 포기, 웹뷰로 다시 전환").
//
// 배경: react-native-youtube-iframe(공식 IFrame 임베드)은 재생은 되지만 임베드가 **항상 16:9**라
// 세로 쇼츠가 필러박스돼 화면 가운데 조각으로만 보였다(진짜 9:16 풀블리드 불가 — 임베드 정책 한계).
// 사용자가 "유튜브 앱처럼 전체화면"을 원해 → Android(.tsx)와 동일하게 **실제 youtube.com/shorts/ID
// 페이지를 WebView로 직접 로드**하는 방식으로 전환. 페이지 자체 레이아웃이라 9:16 풀블리드가 나온다.
//
// 트레이드오프(알고 가는 것):
//  - 비로그인 상태(특히 시뮬레이터)에서는 유튜브가 "앱에서 보기(Watch on YouTube)" 인터스티셜을 띄워
//    작게 보일 수 있다. 로그인된 실기기에서는 전체화면 재생(다른 세션이 Android에서 readyState=4 확인).
//  - JS 플레이어 제어 API가 없다 → "다음 영상"은 IFrame API가 아니라 외부 입력(볼륨/BT 리모컨)이 부모
//    피드의 advance()를 호출 → videoId가 바뀌면 이 WebView가 새 URL로 네비게이션(=다음 재생). (사용자
//    지시 (2)(3): 에어팟/버즈 볼륨, 다이소 BT 리모컨 → 다음. 입력 처리는 useFeedRemoteControl/볼륨
//    관찰 모듈, 이 컴포넌트는 videoId 변화에 반응만 한다.)
//  - 종료 감지: 실제 <video>의 currentTime을 폴링해 nearEnd/loopedBack(쇼츠 무한루프 되감김)을 판정.

type Props = {
  videoId: string;
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
  /** 재생 진행률(0~1) — 피드의 고개짓 카메라 배터리 게이팅용. */
  onProgress?: (fraction: number) => void;
};

// youtube.com/shorts 페이지의 실제 <video>에 붙어 ready/ended/progress를 RN으로 보내고 play/pause 전역함수 노출.
// 2026-07-22 실기기 대비 강화: (1) <video> 탐색 재시도 15→40회(≈12s, 실기기에서 페이지 로드가 느리거나
// 로그인/동의 벽으로 <video>가 늦게 뜨는 케이스), (2) 찾으면 즉시 v.play() 시도(실기기 자동재생), (3) 끝까지
// <video>가 없으면 'novideo' 신호 → 부모가 스킵(까만화면에 갇히지 않게), (4) 페이지가 shorts가 아니면
// (로그인/consent) 감지해 보고.
const INJECTED_JS = `
(function () {
  function send(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var reportedReady = false, reportedEnded = false, lastT = -1;
  function attach(n) {
    var v = document.querySelector('video');
    if (!v) {
      if (n > 0) { setTimeout(function () { attach(n - 1); }, 300); return; }
      // 12초 동안 <video>를 못 찾음 → 로그인/consent/차단 페이지일 가능성. 스킵 신호 + 진단.
      var href = '' + location.href;
      var signin = /consent|accounts\\.google|signin|login/i.test(href) || !!document.querySelector('form[action*="consent"]');
      send({ type: 'novideo', signin: signin, href: href.slice(0, 80) });
      return;
    }
    window.pacePlay = function () { v.play().catch(function () {}); };
    window.pacePause = function () { v.pause(); };
    v.muted = true; // 실기기 무음 자동재생 허용 조건
    v.play().catch(function () {}); // 찾는 즉시 재생 시도
    v.addEventListener('loadeddata', function () { if (!reportedReady) { reportedReady = true; send({ type: 'ready' }); } });
    v.addEventListener('ended', function () { if (!reportedEnded) { reportedEnded = true; send({ type: 'ended' }); } });
    v.addEventListener('error', function () { send({ type: 'error', code: v.error ? v.error.code : -1 }); });
    if (v.readyState >= 2 && !reportedReady) { reportedReady = true; send({ type: 'ready' }); }
    setInterval(function () {
      if (!v.duration || isNaN(v.duration)) return;
      var t = v.currentTime;
      if (v.duration > 0) send({ type: 'progress', value: t / v.duration });
      if (reportedEnded) return;
      var nearEnd = t >= v.duration - 0.5;
      var loopedBack = lastT > 1 && t < lastT - 1;
      if (nearEnd || loopedBack) { reportedEnded = true; send({ type: 'ended' }); return; }
      lastT = t;
    }, 500);
  }
  attach(40);
})();
true;
`;

// 동의(consent) 쿠키 — youtube.com이 실기기에서 "쿠키 동의" 페이지로 튕겨 <video>가 안 뜨는 것 방지.
const CONSENT_COOKIE =
  'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCZW4gACgB; CONSENT=YES+1';

// http(s)만 허용 → youtube 앱 딥링크(youtube://)/앱스토어(itms-apps://) 등 "앱에서 열기" 시도를 차단해
// WebView가 딴 데로 튕겨 까매지는 것을 막는다. youtube/구글/영상CDN은 전부 http(s)라 그대로 허용됨.
function isAllowedNavigation(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
}

export function YouTubeShortsPlayer({ videoId, playing, onEnded, onReady, onError, onProgress }: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const source = useMemo(
    () => ({ uri: `https://www.youtube.com/shorts/${videoId}`, headers: { Cookie: CONSENT_COOKIE } }),
    [videoId]
  );

  // videoId가 바뀌면(다음 영상) 새 페이지 로드 → ready 리셋.
  useEffect(() => { setReady(false); }, [videoId]);

  // 재생/일시정지 반영.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(
      `${playing ? 'window.pacePlay && window.pacePlay()' : 'window.pacePause && window.pacePause()'}; true;`
    );
  }, [ready, playing]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={source}
        injectedJavaScript={INJECTED_JS}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        sharedCookiesEnabled
        // 리다이렉트 차단: 앱 딥링크(youtube://)/앱스토어 등 non-http 스킴은 막아 WebView가 튕기지 않게.
        onShouldStartLoadWithRequest={(req) => {
          const ok = isAllowedNavigation(req.url);
          if (!ok) console.log('[WV] 🚫 blocked nav', req.url.slice(0, 40));
          return ok;
        }}
        // 깨끗한 iPhone Safari UA — 기본 WebView UA는 유튜브가 임베드/웹뷰로 감지해 "앱에서 보기"로 막는다.
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        onError={(e) => console.warn('[WV] onError', e.nativeEvent?.code, String(e.nativeEvent?.description).slice(0, 60))}
        onHttpError={(e) => console.warn('[WV] httpError', e.nativeEvent?.statusCode)}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        onMessage={(e) => {
          let msg: { type?: string; code?: number; value?: number } = {};
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'ready') {
            setReady(true);
            onReady?.();
          } else if (msg.type === 'ended') {
            onEnded();
          } else if (msg.type === 'progress') {
            if (typeof msg.value === 'number') onProgress?.(msg.value);
          } else if (msg.type === 'error') {
            onError?.(msg.code ?? -1);
          } else if (msg.type === 'novideo') {
            // 12초간 <video> 없음(로그인/consent/차단 페이지) → 까만화면에 갇히지 말고 다음 영상으로 스킵.
            console.log('[WV] novideo → skip', JSON.stringify(msg));
            onError?.(-2);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
});
