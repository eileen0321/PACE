import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// 2026-07-20 전면 재작성 — YouTube 공식 IFrame Embed API(new YT.Player(...))는 실기기(Android)에서
// 근본적으로 막혀 있음이 확정됨: onReady/onStateChange 등 JS 콜백은 정상 동작하는데, 그 밑의 실제
// <video> 엘리먼트는 readyState=0(데이터 없음)에서 세션 내내 한 번도 못 벗어났다(dumpsys audio에도
// Pace의 AudioTrack이 단 한 번도 안 잡힘). 원인으로 가장 유력한 건 YouTube의 "WebView Media
// Integrity API"(2023~, 임베드 앱의 Google Play 서명/무결성을 검증) — 임베드 전용 경로에만 걸리는
// 검증이라 일반 WebView 임베드에서는 통과 못 하고, 에러조차 안 띄운 채 조용히 스트림을 거부하는
// 것으로 보임(사용자 지시로 웹 검색 확인 — Referer 헤더 요구/Error 153도 같은 계열).
//
// 해결: IFrame Embed API를 아예 안 쓰고, 브레이브 같은 일반 브라우저처럼 진짜 유튜브 페이지
// (https://www.youtube.com/shorts/ID)로 직접 네비게이션한다 — "임베드"가 아니라 순수 브라우징이라
// 위 검증 자체를 안 만난다. 실기기 검증 완료: readyState=4(HAVE_ENOUGH_DATA), 실제 videoWidth/Height,
// blob: MediaSource src, dumpsys audio에 진짜 AudioTrack까지 전부 확인됨.
//
// 트레이드오프(알고 가는 것):
//  - JS 제어 API(loadVideoById 등)가 없어져서 videoId가 바뀔 때마다 WebView가 실제로 새 URL로
//    재네비게이션한다("이어붙여 재생"이 아니라 매번 페이지 로드) — 영상 전환마다 짧은 로딩이 보일 수 있음.
//  - YouTube 자체 UI(구독/좋아요/댓글/추천 등)가 그대로 노출된다 — controls=0 같은 임베드 전용 숨김
//    옵션을 못 씀. Pace 자체 오버레이(PlatformMimicOverlay 등)로 위에 덮는 방식과의 시각적 조화는
//    별도 UI 작업 필요(이번 라운드 범위 밖).
//  - 종료 감지는 실제 <video>의 'ended' DOM 이벤트에 의존 — YouTube 페이지 자체 JS가 루프시키는
//    경우 이 이벤트가 안 올 수 있어 실사용 중 재검증 필요.

type Props = {
  /** 지금 재생할 Short의 videoId. 부모(feed)가 큐가 비어있지 않을 때만 렌더한다. */
  videoId: string;
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
  /** 현재 영상 진행률(0~1) — 피드가 게이팅 등에 사용(co-session). */
  onProgress?: (p: number) => void;
  /** 진단: WebView 오디오 상태 문자열(muted/재생차단 등) — 무음 원인 파악용(임시). */
  onAudioDiag?: (text: string) => void;
};

// 실제 <video> 엘리먼트에 리스너를 붙여 ready/ended/error를 RN으로 전달하고, play/pause를 위한
// 전역 함수를 노출한다. querySelector('video')가 즉시 안 잡히면(페이지 초기 로딩 중) 짧게 재시도.
//
// ⚠️ 2026-07-20 실기기 검증 중 발견: 진짜 youtube.com Shorts 페이지는 영상이 끝나도 'ended' DOM
// 이벤트를 안 쏘고 그냥 처음으로 되감아 무한 루프한다(Shorts 자체의 정상 동작 — 사람이 스와이프
// 안 하면 계속 반복 재생하도록 설계됨, 실제 유튜브 앱과 동일). 그래서 'ended' 리스너만으로는
// Auto Mode의 자동 다음 넘김이 영원히 안 발동한다(사용자가 실기기로 직접 재현 확인). 해결:
// PaceAccessibilityService.kt(Auto Next, 실제 유튜브 앱 대상)에서 이미 검증된 것과 동일한 패턴 —
// currentTime을 폴링해 "끝에 거의 도달"(nearEnd) 또는 "재생 위치가 갑자기 확 줄어듦"(loopedBack,
// 루프로 처음으로 되감긴 것)을 감지해 우리가 직접 'ended'를 판정한다.
// ⭐ 무음 근본 해결(2026-07-26 리서치): mediaPlaybackRequiresUserAction=false로 소리 자동재생은 허용되나
// 유튜브 페이지 JS가 새 영상마다 <video>.muted=true를 강제해 "탭하여 음소거 해제"가 반복된다. 이걸
// 유튜브 JS보다 먼저 실행되는 injectedJavaScriptBeforeContentLoaded에서 HTMLMediaElement.prototype의
// muted 세터를 래핑해 "muted=true 시도를 항상 false로" 막는다 → 유튜브가 음소거를 못 한다. (풀페이지
// WebView 유지, iframe 전환 없이 소리 확보.)
const BEFORE_CONTENT_JS = `
(function () {
  try {
    var proto = HTMLMediaElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'muted');
    if (d && d.set && d.get) {
      var origSet = d.set, origGet = d.get;
      Object.defineProperty(proto, 'muted', {
        configurable: true, enumerable: d.enumerable,
        get: function () { return origGet.call(this); },
        set: function () { origSet.call(this, false); }
      });
    }
  } catch (e) {}
})();
true;
`;

const INJECTED_JS = `
(function () {
  function send(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var reportedReady = false;
  var reportedEnded = false;
  var lastKnownCurrentTime = -1;
  function attach(retriesLeft) {
    var v = document.querySelector('video');
    if (!v) {
      if (retriesLeft > 0) setTimeout(function () { attach(retriesLeft - 1); }, 300);
      return;
    }
    // 무음 자동재생 정책 + 유튜브가 새 페이지마다 스스로 음소거 → "탭하여 음소거 해제"가 계속 뜬다.
    // WebView는 mediaPlaybackRequiresUserAction=false라 소리 자동재생이 허용되므로, 유튜브가 다시
    // 음소거해도 즉시 되돌리도록 지속 강제한다(volumechange 이벤트 + 아래 폴링 인터벌 둘 다).
    function forceUnmute() { try { v.removeAttribute('muted'); v.muted = false; v.volume = 1.0; } catch (e) {} }
    forceUnmute();
    // 진단: 실제 오디오 상태를 RN으로 보고(무음 원인이 muted인지 autoplay 차단인지 가른다).
    function reportAudio(tag) { send({ type: 'audio', tag: tag, muted: v.muted, paused: v.paused, vol: v.volume, rs: v.readyState }); }
    reportAudio('attach');
    v.play().then(function () { reportAudio('play-ok'); }).catch(function (e) { send({ type: 'audio', tag: 'play-ERR', err: String(e && e.name), muted: v.muted }); });
    // 🔴 2026-08-30 제거 — 이 1.5초 틱은 세션 내내(시간당 2,400회) 브리지를 건넜는데,
    //   유일한 소비자가 feed/index.tsx 의 onAudioDiag={() => {}} 다(성능 때문에 상태 갱신을
    //   이미 걷어낸 자리). JSON.stringify → postMessage → RN 쪽 parse 를 거쳐 버려지고 있었다.
    //   attach/play-ok/play-ERR 단발 보고는 그대로 두므로 무음 원인 진단력은 유지된다.
    v.addEventListener('volumechange', function () { if (v.muted) forceUnmute(); });
    v.addEventListener('play', forceUnmute);
    window.pacePlay = function () { forceUnmute(); v.play().catch(function () {}); };
    window.pacePause = function () { v.pause(); };
    v.addEventListener('loadeddata', function () {
      if (!reportedReady) { reportedReady = true; send({ type: 'ready' }); }
    });
    v.addEventListener('ended', function () { if (!reportedEnded) { reportedEnded = true; send({ type: 'ended' }); } });
    v.addEventListener('error', function () { send({ type: 'error', code: v.error ? v.error.code : -1 }); });
    // loadeddata가 이미 지나간 뒤에 리스너가 붙었을 수 있으니(레이스) 현재 상태로 한 번 더 확인.
    if (v.readyState >= 2 && !reportedReady) { reportedReady = true; send({ type: 'ready' }); }

    setInterval(function () {
      if (v.muted) forceUnmute(); // 유튜브가 몰래 음소거하면 계속 되돌림
      if (reportedEnded || !v.duration || isNaN(v.duration)) return;
      var t = v.currentTime;
      send({ type: 'progress', p: v.duration ? t / v.duration : 0 });
      var nearEnd = t >= v.duration - 0.5;
      var loopedBack = lastKnownCurrentTime > 1 && t < lastKnownCurrentTime - 1;
      if (nearEnd || loopedBack) {
        reportedEnded = true;
        send({ type: 'ended' });
        return;
      }
      lastKnownCurrentTime = t;
    }, 500);
  }
  attach(15);
})();
true;
`;

// iOS(.ios.tsx)와 시그니처 대칭용 — Android는 이 웹뷰 피드를 /feed로 안 쓰지만(네이티브 오버레이 경로),
// 공유 feed/index.tsx가 ref를 넘기므로 forwardRef로 받아 no-op 핸들을 노출한다(스와이프는 iOS 전용).
export type ShortsPlayerHandle = { advance: () => void; previous: () => void };
export const SWIPE_NAV = false; // Android는 이 웹뷰 피드를 안 씀(iOS 전용 스와이프)

export const YouTubeShortsPlayer = forwardRef<ShortsPlayerHandle, Props>(function YouTubeShortsPlayer(
  { videoId, playing, onEnded, onReady, onError, onProgress, onAudioDiag }: Props,
  ref
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => ({ advance: () => {}, previous: () => {} }), []);
  const source = useMemo(() => ({ uri: `https://www.youtube.com/shorts/${videoId}` }), [videoId]);

  // videoId가 바뀌면(다음 영상) 새 페이지 로드이므로 ready를 다시 대기 상태로.
  useEffect(() => {
    setReady(false);
  }, [videoId]);

  // 재생/일시정지 반영.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`${playing ? 'window.pacePlay && window.pacePlay()' : 'window.pacePause && window.pacePause()'}; true;`);
  }, [ready, playing]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={source}
        injectedJavaScriptBeforeContentLoaded={BEFORE_CONTENT_JS}
        injectedJavaScript={INJECTED_JS}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        onMessage={(e) => {
          let msg: { type?: string; code?: number } = {};
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'progress') {
            onProgress?.((msg as any).p ?? 0);
            return;
          }
          if (msg.type === 'audio') {
            const m = msg as any;
            onAudioDiag?.(`${m.tag} muted=${m.muted} paused=${m.paused ?? '?'} vol=${m.vol ?? '?'}${m.err ? ' ' + m.err : ''}`);
            return;
          }
          if (msg.type === 'ready') {
            setReady(true);
            onReady?.();
          } else if (msg.type === 'ended') {
            onEnded();
          } else if (msg.type === 'error') {
            onError?.(msg.code ?? -1);
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
});
