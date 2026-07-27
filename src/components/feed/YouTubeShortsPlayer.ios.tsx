import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { requireOptionalNativeModule } from 'expo-modules-core';

// 임시 진단: WebView 로그를 NSLog로 흘려 devicectl --console로 캡처.
const PaceGestureLog = requireOptionalNativeModule<{ nativeLog(msg: string): void }>('PaceGesture');

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
  /** 진단(임시): WebView 오디오 상태 — 무음 원인(소리 자동재생 차단 여부) 파악용. */
  onAudioDiag?: (text: string) => void;
  /** 프리로드 모드 — 다음 영상 페이지를 미리 로드만(재생·소리 없음). 활성화(false 전환) 시 처음부터 재생. */
  preload?: boolean;
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
    function ad(tag) { send({ type: 'audio', tag: tag, muted: v.muted, paused: v.paused, vol: v.volume }); }
    // ⭐ 2026-07-26: mediaPlaybackRequiresUserAction=false라 "소리 자동재생"이 허용될 수 있다(리서치 확인).
    // 예전엔 무조건 muted=true로 시작해 매 영상 무음이었다 → 먼저 소리로 재생 시도. 차단되면(iOS 정책)
    // 무음으로라도 재생하고 첫 탭에 소리를 켠다. audible-ok/blocked를 진단으로 보고해 실제 동작을 확인.
    // ⚠️ "탭하여 음소거 해제" 팝업을 클릭/숨김으로 없애려던 시도는 전부 실패·역효과였다:
    //   - .ytp-unmute 클릭 → 문서 클릭 리스너 무한 트리거 → 이벤트 루프/내비게이션 → "쇼츠 불러오기 실패"
    //   - 팝업 텍스트 요소 display:none → 그 요소가 영상 컨테이너를 포함 → 영상 멈추고 소리만 남음
    //   결론: 팝업은 유튜브 UI라 건드리면 재생이 깨진다. 소리는 이미 나므로 팝업(껍데기)은 그냥 둔다.
    var audibleOk = false;
    // ⭐ 실기기 로그로 확정(audible-ok muted=false, 영상당 1회): 소리는 v.muted=false로 "깨끗하게" 나온다.
    // 그런데 팝업 없애려고 부른 mp.unMute()/setVolume()가 오디오 파이프라인을 재초기화해 "매 영상 처음
    // 소리가 한 번 끊기는(씹힘)" 원인이었다. 또 음소거로 시작→해제하는 전환도 같은 컷을 만든다.
    // → 팝업(껍데기)은 그냥 두고, 오디오는 절대 두 번 건드리지 않는다: 처음부터 v.muted=false로 한 번만 재생.
    // ⭐ 컷의 진짜 원인(로그 확정): 재생 t≈1s에 유튜브가 muted=true로 자동음소거 → 내 코드가 muted=false로
    //   되돌리는 왕복이 "매 영상 처음 한 번 소리 끊김"이었다. volumechange로 반응하면 이미 끊긴 뒤라 늦다.
    //   → muted 프로퍼티 setter를 가로채 audibleOk 이후엔 muted=true를 무시(유튜브 음소거 호출이 no-op)
    //     → 애초에 음소거가 일어나지 않아 컷이 없다. (안드로이드 .tsx의 muted-setter override와 동일 전략.)
    var muteBlocks = 0; // 진단: 유튜브가 muted=true를 몇 번 시도(=우리가 막음)하는지 — thrash 여부 판별
    try {
      var mdesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
      if (mdesc && mdesc.get && mdesc.set) {
        Object.defineProperty(v, 'muted', {
          configurable: true,
          get: function () { return mdesc.get.call(this); },
          set: function (val) { if (audibleOk && val === true) { muteBlocks++; return; } mdesc.set.call(this, val); }
        });
      }
    } catch (e) {}
    // 팝업("탭하여 음소거 해제")만 숨김: muted setter가 실제 음소거를 이미 막고 있어 오디오 상태는 계속
    // false다. 그 상태에서 mp.unMute()는 유튜브 "플레이어 레벨" 음소거 플래그만 풀어(=팝업 제거) 실제
    // 오디오는 안 건드린다(=컷 없음). 재생이 안정된 뒤 딱 1회만 호출. (setVolume은 볼륨 글리치라 안 씀.)
    var popupCleared = false;
    function clearUnmutePopup() {
      if (popupCleared) return;
      try {
        var mp = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (mp && typeof mp.unMute === 'function') { mp.unMute(); popupCleared = true; send({ type: 'domlog', text: 'UNMUTE-once t=' + (v.currentTime || 0).toFixed(2) }); }
      } catch (e) {}
    }
    // "탭하여 음소거 해제"가 작은 아이콘(.ytp-unmute 버튼)으로 줄어 계속 남는 것도 CSS로 숨긴다.
    // ⚠️ .ytp-unmute는 "버튼 leaf"라 숨겨도 영상 재생엔 무해(영상 컨테이너 .html5-video-player가 아님).
    //    실제 오디오는 muted setter가 계속 false 유지 → 음소거 아이콘을 없애도 소리엔 영향 없음.
    try {
      var ust = document.createElement('style');
      ust.textContent = '.ytp-unmute,.ytp-unmute-box,.ytp-unmute-icon{display:none!important}';
      (document.head || document.documentElement).appendChild(ust);
    } catch (e) {}
    function tryAudible() {
      v.muted = false; v.volume = 1.0; // 처음부터 소리 켜고 1회 재생
      v.play().then(function () { audibleOk = true; ad('audible-ok'); /* clearUnmutePopup 제거: mp.unMute()가 오디오 재버퍼링(씹힘) 유발 — 소리는 setter로 이미 남 */ }).catch(function (e) {
        send({ type: 'audio', tag: 'audible-blocked', err: String(e && e.name), muted: v.muted });
        v.muted = true; v.play().catch(function () {}); // 소리 차단된 드문 기기에서만 무음 폴백(audibleOk 아직 false라 통과)
      });
    }
    // ⚡ 프리로드: 다음 영상 페이지를 미리 로드해 두면 넘길 때 전체 페이지 재로드 간극(="매 영상 처음 씹힘")이
    //   사라진다. 프리로드 인스턴스는 재생/소리 없이 페이지+<video>만 로드하고 정지 유지 → 활성화되면
    //   paceActivate로 처음부터 소리내어 재생. (활성화는 부모가 preload=false로 바뀌면 주입.)
    // 프리로드 제거됨 → 바로 소리내어 재생. ⚠️ 예전 paceActivate의 v.currentTime=0 시크가 "영상 초반
    // 한 번 씹힘"의 원인이었다(시작하자마자 seek). 프리로드가 없으니 영상은 이미 0부터 시작 — 시크 안 함.
    tryAudible();
    // 검증용 진단: 초반 씹힘(seeking/stalled) 사라졌는지 + 음소거 팝업 요소 확인. 검증 후 제거.
    ['pause', 'playing', 'waiting', 'stalled', 'seeking'].forEach(function (ev) {
      v.addEventListener(ev, function () {
        var buf = 0; try { buf = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0; } catch (e) {}
        // buf-t가 크면 버퍼 충분(무해), 0에 가까우면 진짜 언더런. rs<3이면 재생 멈춤.
        send({ type: 'domlog', text: 'VEV ' + ev + ' t=' + (v.currentTime || 0).toFixed(2) + ' buf=' + buf.toFixed(1) + ' rs=' + v.readyState });
      });
    });
    // 음소거 팝업/아이콘의 실제 요소를 기기에서 잡는다(.ytp-unmute가 안 먹으므로) — 로드 3.5초 뒤 보이는
    // "음소거" 관련 요소를 가장 안쪽까지 파고들어 태그+클래스 체인을 로그. 이 클래스로 다음 빌드에서 CSS 타겟.
    setTimeout(function () {
      send({ type: 'domlog', text: 'MUTEBLOCKS=' + muteBlocks + ' (유튜브 muted=true 시도 차단 횟수, 3.5s까지)' });
      try {
        var all = document.querySelectorAll('button,div,span,[role="button"],[aria-label]');
        for (var i = 0; i < all.length; i++) {
          var el = all[i]; if (el.offsetParent === null) continue;
          var t = (el.textContent || ''); var al = (el.getAttribute && el.getAttribute('aria-label')) || '';
          var hit = t.indexOf('음소거') >= 0 || al.indexOf('음소거') >= 0 || t.toLowerCase().indexOf('unmute') >= 0 || al.toLowerCase().indexOf('unmute') >= 0;
          if (!hit) continue;
          var target = el, moved = true;
          while (moved) { moved = false; var kids = target.children; for (var k = 0; k < kids.length; k++) { var kt = (kids[k].textContent || '') + ((kids[k].getAttribute && kids[k].getAttribute('aria-label')) || ''); if (kids[k].offsetParent !== null && (kt.indexOf('음소거') >= 0 || kt.toLowerCase().indexOf('unmute') >= 0)) { target = kids[k]; moved = true; break; } } }
          var p = target.parentElement, gp = p && p.parentElement;
          send({ type: 'domlog', text: 'MUTEICON ' + target.tagName + '[' + (target.className || '') + '] al=' + ((target.getAttribute && target.getAttribute('aria-label')) || '').slice(0, 16) + ' p=[' + (p ? p.className : '') + '] gp=[' + (gp ? gp.className : '') + ']' });
          break;
        }
      } catch (e) {}
    }, 3500);
    // 유튜브가 재생 후 다시 음소거하면 되돌린다 — 단 "소리 재생이 실제로 됐을 때(audibleOk)"만.
    // 초기 무음-autoplay 단계에서 섣불리 unmute하면 autoplay가 깨져 멈추므로 게이트를 둔다.
    v.addEventListener('volumechange', function () { if (audibleOk && v.muted) { v.muted = false; v.volume = 1.0; } });
    function unmuteOnce() { audibleOk = true; v.muted = false; v.volume = 1.0; v.play().catch(function () {}); ad('gesture-unmute'); }
    document.addEventListener('touchend', unmuteOnce, true);
    document.addEventListener('click', unmuteOnce, true);
    v.addEventListener('loadeddata', function () { if (!reportedReady) { reportedReady = true; send({ type: 'ready' }); } });
    v.addEventListener('ended', function () { if (!reportedEnded) { reportedEnded = true; send({ type: 'ended' }); } });
    v.addEventListener('error', function () { send({ type: 'error', code: v.error ? v.error.code : -1 }); });
    if (v.readyState >= 2 && !reportedReady) { reportedReady = true; send({ type: 'ready' }); }
    setInterval(function () {
      if (audibleOk && v.muted) { v.muted = false; v.volume = 1.0; } // 소리 재생 확인 후에만 재-unmute(폴백)

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

export function YouTubeShortsPlayer({ videoId, playing, onEnded, onReady, onError, onProgress, onAudioDiag, preload }: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // 스피너는 로드가 길어질 때(≥450ms)만 표시 — 빠른 전환엔 스피너를 안 띄워 "기다림"을 강조하지 않는다.
  const [showSpinner, setShowSpinner] = useState(false);
  const wasPreloadRef = useRef<boolean>(!!preload);
  const source = useMemo(
    () => ({ uri: `https://www.youtube.com/shorts/${videoId}`, headers: { Cookie: CONSENT_COOKIE } }),
    [videoId]
  );

  // videoId가 바뀌면(다음 영상) 새 페이지 로드 → ready 리셋.
  useEffect(() => { setReady(false); wasPreloadRef.current = !!preload; }, [videoId]);

  // 스피너 지연: 활성 로드가 450ms 넘게 걸릴 때만 스피너를 보인다(빠른 로드는 커버만·스피너 없음).
  useEffect(() => {
    if (ready || preload) { setShowSpinner(false); return; }
    const t = setTimeout(() => setShowSpinner(true), 450);
    return () => clearTimeout(t);
  }, [ready, preload, videoId]);

  // 프리로드였다가 활성화(preload=false)되면 → 미리 로드해둔 영상을 처음부터 소리내어 재생.
  // 이게 "다음 영상 즉시 재생"의 핵심 — 페이지가 이미 로드돼 있어 재로드 간극(씹힘)이 없다.
  useEffect(() => {
    if (!preload && wasPreloadRef.current) {
      wasPreloadRef.current = false;
      webRef.current?.injectJavaScript('window.paceActivate && window.paceActivate(); true;');
    }
  }, [preload]);

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
        // 페이지 로드 전에 프리로드 여부를 심어, attach()가 재생/소리를 켤지(활성) 로드만 할지(프리로드) 결정.
        injectedJavaScriptBeforeContentLoaded={`window.__pacePreload=${preload ? 'true' : 'false'};(function(){try{var s=document.createElement('style');s.textContent='.ytp-unmute,.ytp-unmute-box,.ytp-unmute-icon{display:none!important}';(document.head||document.documentElement).appendChild(s);}catch(e){}})();true;`}
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
          if (!ok && __DEV__) console.log('[WV] 🚫 blocked nav', req.url.slice(0, 40));
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
          if (msg.type === 'domlog') {
            try { PaceGestureLog?.nativeLog?.(String((msg as any).text ?? '')); } catch {}
            return;
          }
          if (msg.type === 'audio') {
            const m = msg as any;
            try { PaceGestureLog?.nativeLog?.(`AUDIO ${m.tag} muted=${m.muted}`); } catch {}
            onAudioDiag?.(`${m.tag} muted=${m.muted} vol=${m.vol ?? '?'}${m.err ? ' ' + m.err : ''}`);
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
            if (__DEV__) console.log('[WV] novideo → skip', JSON.stringify(msg));
            onError?.(-2);
          }
        }}
      />
      {/* 영상 전환 중(새 videoId 페이지 로드) WebView가 통째로 까맣게 보이던 "까만 화면 번쩍"을 가린다.
          preload(다음 영상 미리로드)일 땐 화면에 안 보이므로 커버 불필요 — 활성 영상 로딩 때만 표시. */}
      {!ready && !preload && (
        <View style={styles.loadingCover} pointerEvents="none">
          {showSpinner && <ActivityIndicator size="large" color="#FFFFFF" />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  loadingCover: {
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
