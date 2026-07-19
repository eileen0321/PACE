import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// ⚠️ 플랫폼 분리(2026-07-20): 이 .ios.tsx는 iOS 전용. 같은 폴더의 YouTubeShortsPlayer.tsx는
// Android 전용(youtube.com/shorts 원본 페이지 직접 로드 — 원안 ①). 원본 페이지 방식은 YouTube
// 약관 + Apple 심사(4.2/5.2.5) 위반 리스크가 있어 iOS 스토어 제출 경로에선 쓸 수 없다. 그래서
// iOS는 "공식 임베드"(youtube.com/embed/{id}, 합법)로 간다. Metro가 iOS에선 이 파일을, Android에선
// .tsx를 선택하므로 두 전략이 충돌 없이 공존한다.
//
// ── iOS 실검증 결과 요약 (2026-07-20, iOS 26.5 시뮬레이터) ────────────────────────────────────
//  · IFrame Player API(new YT.Player를 source={{html}}로 심는 d75c544 방식): onReady는 오지만
//    loadVideoById 직후 error 152(임베드 거부)가 모든 영상에서 발생. 원인은 WKWebView
//    loadHTMLString이 baseUrl을 줘도 origin을 opaque(null)로 잡는 것(널리 알려진 제약). → 폐기.
//  · 그래서 html-string이 아니라 진짜 URL(www.youtube.com/embed/ID)을 로드하도록 바꿈 → origin이
//    실제 youtube.com이라 error 152는 사라짐. <video> 엘리먼트도 정상 생성됨(paused:false, muted).
//  · 그러나 그 <video>가 readyState 0(HAVE_NOTHING)에서 못 벗어남 = YouTube 임베드 플레이어가
//    스트림 src를 끝내 안 붙임. 같은 WebView에 일반 mp4를 물리면 readyState 4로 정상 자동재생되므로
//    시뮬레이터/코덱 문제는 아니고, YouTube가 임베드 재생을 막는 것(Android .tsx 주석의 "readyState
//    0에서 못 벗어남"과 동일 계열 — WebView Media Integrity/봇 차단). ⇒ **iOS 시뮬레이터에서는 실제
//    재생 검증 불가.** 실기기(FairPlay/실사용자 세션)에서 재생되는지 별도 검증 필요. 안 되면 iOS
//    Pace Feed는 아키텍처 문서의 대안(Pexels/Pixabay 라이선스 콘텐츠)으로 가야 함.
//  · 아래 구현은 "합법 임베드 + 재생/종료 감지"의 올바른 형태로 남겨둔다(실기기 검증 대기).

type Props = {
  /** 지금 재생할 Short의 videoId. 부모(feed)가 큐가 비어있지 않을 때만 렌더한다. */
  videoId: string;
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
};

// /embed/ 페이지의 <video>에 리스너를 붙여 ready/ended/error를 RN으로 전달하고 play/pause 함수를
// 노출한다. 재생이 8초 넘게 시작 안 되면(YouTube가 스트림을 안 붙이는 경우) 'stalled'를 올려 부모가
// 해당 영상을 건너뛰게 한다.
const INJECTED_JS = `
(function () {
  function send(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var reportedReady = false, reportedEnded = false, lastTime = -1, waited = 0;
  function attach(retriesLeft) {
    var v = document.querySelector('video');
    if (!v) {
      if (retriesLeft > 0) setTimeout(function () { attach(retriesLeft - 1); }, 300);
      else send({ type: 'stalled', reason: 'novideo' });
      return;
    }
    window.pacePlay = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
    window.pacePause = function () { v.pause(); };
    v.addEventListener('loadeddata', function () { if (!reportedReady) { reportedReady = true; send({ type: 'ready' }); } });
    v.addEventListener('playing', function () { if (!reportedReady) { reportedReady = true; send({ type: 'ready' }); } });
    v.addEventListener('ended', function () { if (!reportedEnded) { reportedEnded = true; send({ type: 'ended' }); } });
    v.addEventListener('error', function () { send({ type: 'error', code: v.error ? v.error.code : -1 }); });
    if (v.readyState >= 2 && !reportedReady) { reportedReady = true; send({ type: 'ready' }); }
    v.muted = true;
    var pp = v.play();
    if (pp && pp.catch) pp.catch(function () {});
    setInterval(function () {
      if (reportedEnded) return;
      // 종료 감지: 끝에 근접 or 루프로 되감김.
      if (v.duration && !isNaN(v.duration)) {
        var t = v.currentTime;
        if (t >= v.duration - 0.4 || (lastTime > 1 && t < lastTime - 1)) { reportedEnded = true; send({ type: 'ended' }); return; }
        lastTime = t;
      }
      // 스톨 감지: ready 못 받고 readyState 0이 8초 이상 지속되면 재생 불가로 판단.
      if (!reportedReady) { waited += 500; if (waited >= 8000) { send({ type: 'stalled', reason: 'readystate0' }); waited = -1e9; } }
    }, 500);
  }
  attach(20);
})();
true;
`;

export function YouTubeShortsPlayer({ videoId, playing, onEnded, onReady, onError }: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // 공식 임베드 엔드포인트를 진짜 URL로 로드(→ 실제 origin=youtube.com → error 152 회피).
  // mute=1: iOS 자동재생 정책상 무음이어야 제스처 없이 시작 가능. videoId가 바뀌면 새 임베드로 재로드.
  const source = useMemo(
    () => ({ uri: `https://www.youtube.com/embed/${videoId}?playsinline=1&controls=0&rel=0&modestbranding=1&autoplay=1&mute=1&fs=0&iv_load_policy=3` }),
    [videoId],
  );

  useEffect(() => {
    setReady(false);
  }, [videoId]);

  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`${playing ? 'window.pacePlay && window.pacePlay()' : 'window.pacePause && window.pacePause()'}; true;`);
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
        onMessage={(e) => {
          let msg: { type?: string; code?: number } = {};
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
          } else if (msg.type === 'error') {
            onError?.(msg.code ?? -1);
          } else if (msg.type === 'stalled') {
            // 재생 불가(임베드 거부/스트림 미전달) — 부모가 다음 영상으로 건너뛰게 에러로 통지.
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
