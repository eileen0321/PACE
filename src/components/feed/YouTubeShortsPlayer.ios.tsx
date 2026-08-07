import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Localization from 'expo-localization';
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
  /** 스와이프 모드에서 실제 재생 중인 videoId 변화 통보(현재 영상 즐겨찾기 추가용). */
  onVideoChange?: (videoId: string) => void;
  /** iOS 유저 손가락 스와이프(1=위로/다음, -1=아래로/이전) — WebView JS가 감지해 통보(2026-08-01).
   *  moved=true면 **WebView가 이미 유튜브 피드를 넘긴 뒤**다(2026-08-05 버벅임 수정, doSwipe 직접 호출)
   *  — 부모는 기록/상태만 맞추고 다시 넘기면 안 된다(이중 이동). moved=false는 리스트 모드라 부모가
   *  이동을 수행해야 한다.
   *  ⚠️ scrollEnabled=true(네이티브 스크롤이 손가락을 직접 따라오게)로 바꾸는 시도는 실기기에서
   *  회귀였다(2026-08-05 2차, 되돌림) — 재생 중인 <video>를 실제로 라이브 스크롤하니 드래그 "도중"에도
   *  버벅여 증상이 더 나빠졌다. 다시 시도하지 말 것. */
  onUserSwipe?: (dir: number, moved: boolean) => void;
  /** HOT/즐겨찾기 순서 재생 중인지 — true면 손가락 스와이프의 이동을 WebView가 하지 않고 부모에 위임한다
   *  (리스트의 다음 항목으로 리마운트해야 하므로). WebView 안의 window.__paceListMode로 전달된다. */
  listMode?: boolean;
  /** /shorts/{id}가 watch로 리다이렉트된 "비-쇼츠"(라이브/롱폼) 감지 — 스와이프/자동넘김/손짓이 전부
   *  Shorts 릴 DOM에 의존해 동작 불가하므로, 부모가 정상 쇼츠로 리마운트하게 통보(2026-08-01 사장님 지적). */
  onNotShorts?: () => void;
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
  function send(o) { if (o && o.type === 'domlog' && !window.__PACE_DIAG__) return; if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
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

// ── 2026-07-28 사장님 결정: YouTube 방식(스와이프) 전환 ──────────────────────────────────────────
// 기존(reload) 방식은 특정 videoId마다 페이지를 통째로 새로 로드해 느리고 깜박였다. 이 스크립트는 쇼츠
// 페이지를 "한 번만" 로드하고, 다음/이전은 YouTube 네이티브 피드를 **스와이프 시뮬레이션**으로 넘긴다
// (리로드 0 → 즉시·매끈, 오디오도 재로드 안 하니 끊김 없음). 대가: 영상이 우리 큐가 아니라 YouTube 관련
// 피드로 흐름(큐레이션 포기). ⚠️ YouTube DOM은 자주 바뀌므로 스와이프 전략을 여러 개 시도하고 domlog로
// 기기에서 뭐가 먹히는지 관찰해 다듬는다. reload 모드(위 INJECTED_JS)는 플래그로 즉시 롤백 가능하게 유지.
const INJECTED_JS_SWIPE = `
(function () {
  function send(o) { if (o && o.type === 'domlog' && !window.__PACE_DIAG__) return; if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var reportedReady = false, reportedEnded = false, lastT = -1;
  var curHref = '' + location.href, curV = null, globalsOn = false;
  // 2026-08-05 — URL에서 영상 id만 뽑는다. 재부착 판단을 href 전체가 아니라 **id**로 해야 한다(아래 참고).
  function videoIdOf(h) {
    var i = h.indexOf('/shorts/'); if (i < 0) return '';
    var id = h.slice(i + 8).split('?')[0].split('/')[0].split('#')[0];
    return id.length >= 6 ? id : '';
  }
  var curVid = videoIdOf(curHref);
  // attach는 <video>가 아직 없으면 300ms 간격으로 재시도하는 체인이다. 새 부착이 시작되면 이전 체인은
  // 죽어야 한다 — 안 그러면 낡은 체인이 뒤늦게 살아나 play()를 한 번 더 걸어 재생을 끊는다.
  var attachSeq = 0;
  // 2026-08-08 — 무음스위치 강제 상태를 **요소(v)가 아니라 전역**에 둔다. 예전엔 v.__paceForceMuted처럼
  // <video> 요소에 표식을 남겼는데, 스와이프로 다음 Short가 오면 유튜브가 완전히 새 <video> 요소를 만들어
  // 그 표식이 사라진다 — 그러면 attach()가 새 요소에 v.volume=1.0을 무조건 걸어 무음스위치를 켠 채로도
  // 소리가 났다(실기기 로그로 확정: paceSetMuted로 vol=0까지 찍고도 직후 audible-ok가 다시 1.0으로 되돌림).
  // 전역 플래그면 영상이 바뀌어도 살아남아 attach()가 새 요소에도 즉시 반영할 수 있다.
  window.__paceForceSilent = window.__paceForceSilent || false;

  // ⭐ 2026-08-06 "다음 영상 시작 시 멈칫" 3차 수정 — 원인의 마지막 조각.
  //   지금까지의 muted 가로채기는 **요소 단위**(v.__mo)였다. 유튜브가 다음 쇼츠에서 <video> 요소를
  //   새로 만들면 그 새 요소에는 가로채기가 없으므로, 유튜브가 muted=true로 무음 자동재생을 시작하고
  //   우리가 attach에서 뒤늦게 muted=false로 되돌린다. 그 무음 해제가 재생을 한 번 끊었다가 되살리는
  //   것이 바로 "시작할 때 멈칫"이다(아래 goAudible의 "if (v.paused) v.play()" 경로).
  //   ⚠️ 이 주석 블록은 템플릿 리터럴(INJECTED_JS_SWIPE) 안이다 — 백틱을 쓰면 문자열이 그 자리에서
  //     끊겨 파일 전체가 깨진다(2026-08-06에 실제로 한 번 냈다). 인용은 큰따옴표로만 쓸 것.
  //   → 가로채기를 **프로토타입 레벨**로 올린다. 그러면 **앞으로 만들어질 모든 <video>가 태어날 때부터**
  //     보호되어, 유튜브의 muted=true 자체가 무시된다 → 애초에 음소거가 안 되니 되돌릴 일도 없고
  //     멈칫도 없다.
  //   안전 근거: 이 WebView는 mediaPlaybackRequiresUserAction={false}로 떠 있어(=WKWebView의
  //     mediaTypesRequiringUserActionForPlayback이 비어 있음) **소리 있는 자동재생이 앱 설정상
  //     허용**된다. 즉 무음을 막아도 자동재생이 차단되지 않는다.
  //   __paceAudioOk가 켜지기 전(=아직 한 번도 소리 재생에 성공하지 못한 상태)에는 가로채지 않는다 —
  //     첫 재생만큼은 유튜브의 무음 자동재생을 그대로 두어 확실히 시작되게 하고, 소리가 한 번 붙은
  //     뒤부터 보호를 건다. 실패 시 최악이라도 예전과 동일한 동작으로 폴백된다.
  // 2026-08-08 — 웹서치로 확정: **iOS WebKit(Safari/WKWebView 공통)은 HTMLMediaElement.volume을
  // 아예 무시한다**(값은 그대로 읽히지만 실제 출력엔 반영 안 됨 — Apple의 의도적 정책, 볼륨은 항상
  // 하드웨어 버튼으로만 조절되게). 그래서 어제 만든 "volume=0으로 무음스위치 강제" 우회는 JS 상태는
  // 정상(vol=0으로 찍힘)인데 실제로는 계속 소리가 났다 — 근본적으로 안 먹히는 프로퍼티를 썼던 것.
  // 실제로 유효한 건 **muted**뿐이라 다시 muted로 돌아간다. 문제는 muted를 이미 이중으로 가로채고
  // 있다는 것(아래 프로토타입 훅 + attach()의 요소별 훅) — 둘 다 "val===true를 막는" 용도라 우리
  // 자신의 강제음소거 호출도 막아버린다(2026-08-07 "md.set.call 우회 실패"가 바로 이거였다 — 그
  // 시점에 md가 이미 이 프로토타입 훅으로 감싸인 뒤였다). → 진짜 네이티브 setter(pmd.set, 이 훅이
  // 설치되기 **이전**에 캡처됨)를 window에 노출해 paceSetMuted가 두 겹 다 건너뛰고 직접 부르게 한다.
  try {
    if (!window.__paceMutedHook) {
      var pmd = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
      if (pmd && pmd.get && pmd.set) {
        window.__paceMutedHook = true;
        window.__paceNativeMutedSet = pmd.set; // 진짜 네이티브 setter — paceSetMuted 전용, 훅 우회.
        Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
          configurable: true,
          get: function () { return pmd.get.call(this); },
          set: function (val) {
            if (window.__paceForceSilent) { if (val === false) return; }
            else if (window.__paceAudioOk && val === true) { return; }
            pmd.set.call(this, val);
          }
        });
      }
    }
  } catch (e) {}

  // 실제 스와이프 동작(여러 전략) — dir>0 다음(아래로), dir<0 이전(위로).
  function doSwipe(dir, scrollFallback) {
    var dy = (dir > 0 ? 1 : -1) * (window.innerHeight || 800), tried = [];
    // ⭐ 첫 손짓 무시 수정 — ArrowDown 키 스와이프는 플레이어에 focus가 있어야 먹히는데 로드 직후 focus가
    //    없어 첫 키가 무시됐다. 매 스와이프 직전 플레이어를 focus해 첫 손짓부터 키가 먹히게 한다.
    var mp = document.getElementById('movie_player') || document.querySelector('.html5-video-player') || document.querySelector('ytd-reel-video-renderer') || document.body;
    try { mp && mp.focus && mp.focus({ preventScroll: true }); tried.push('focus'); } catch (e) {}
    // ⭐ 2026-08-05 "다음 영상에서 멈췄다가 플레이" 원인 확정(웹서치) — **WKWebView는 사용자가 스크롤하는
    //   동안 미디어 재생을 정지하고 스크롤이 끝나면 재개한다.** WebKit의 알려진 동작이다
    //   (apache/cordova-ios#530 등 다수 보고). 유튜브 탓도, 우리 재생 코드 탓도 아니었다.
    //   그런데 여기서 우리가 **직접 scrollBy를 호출**하고 있었다 → 스크롤 시작에 재생 정지, 끝나면 재개
    //   = 사장님이 보신 그 멈칫. 앞서 시도한 두 수정(중복 attach 제거, unmute 순서)이 안 먹힌 이유도
    //   이것이다 — 엉뚱한 층을 고치고 있었다.
    //   → **평상시엔 스크롤을 아예 하지 않는다.** ArrowDown 키만으로 릴이 넘어간다(유튜브 자체 단축키).
    //     키가 안 먹어 URL이 안 바뀐 경우에만 swipe()의 재시도에서 scrollBy 폴백을 쓴다(scrollFallback).
    if (scrollFallback) {
      // ⭐ 2026-08-06 — 폴백에서도 **메인 프레임 스크롤은 마지막 수단**으로 미룬다.
      //   위 근거대로 재생을 정지시키는 것은 UIScrollView(=메인 프레임) 스크롤이다. 안쪽 오버플로
      //   컨테이너를 스크롤하는 것은 그 대상이 아니다. 그런데 예전 코드는 컨테이너를 스크롤한 **직후
      //   조건 없이 window.scrollBy도 같이** 불러서, 컨테이너만으로 넘어갈 수 있는 경우까지 매번
      //   메인 프레임을 흔들어 멈칫을 만들었다.
      //   → 컨테이너 스크롤을 먼저 하고, 그것으로 URL이 바뀌지 않았을 때만 250ms 뒤 메인 프레임을 쓴다.
      var reel = document.querySelector('#shorts-inner-container, ytd-shorts, #shorts-container, ytd-reel-video-renderer, #player-container');
      var beforeScroll = '' + location.href;
      var scrolledInner = false;
      try { if (reel && reel.scrollBy) { reel.scrollBy(0, dy); scrolledInner = true; tried.push('scroll-inner'); } } catch (e) {}
      if (!scrolledInner) {
        try { window.scrollBy(0, dy); tried.push('scroll-window'); } catch (e) {}
      } else {
        setTimeout(function () {
          if (('' + location.href) === beforeScroll) {
            try { window.scrollBy(0, dy); send({ type: 'domlog', text: 'SWIPE-fallback window.scrollBy (inner failed)' }); } catch (e) {}
          }
        }, 250);
      }
    }
    try {
      var key = dir > 0 ? 'ArrowDown' : 'ArrowUp', kc = dir > 0 ? 40 : 38;
      var k = new KeyboardEvent('keydown', { key: key, code: key, keyCode: kc, which: kc, bubbles: true });
      (mp || document).dispatchEvent(k); document.dispatchEvent(k); (document.activeElement || document.body).dispatchEvent(k); tried.push('key');
    } catch (e) {}
    return tried;
  }
  // 2026-08-01 — "현재 영상 즐겨찾기 추가"용. URL(/shorts/ID)에서 현재 id를 뽑아 부모로 보고한다
  // (초기 1회 + URL 변할 때마다). pollTick(재부착)에서도 다시 부르므로 top-level로 뺀다(2026-08-05 2차).
  function reportVideo() {
    var id = videoIdOf('' + location.href);
    if (id) send({ type: 'video', videoId: id });
  }

  // 자가치유 — 첫 스와이프가 YouTube를 "깨우는(priming)" 데만 쓰여 URL이 안 바뀌는 경우(사장님: "두 번째
  // 손짓에서 반응")를 잡는다: 스와이프 후 URL이 그대로면 한 번 더 스와이프해 첫 손짓부터 넘어가게 한다.
  // 실제로 넘어갔으면(href 변경) 재시도 안 함 → 이중 넘김 방지. 손짓/BT리모컨 전용 — 손가락 스와이프는
  // 아래 onTouchFinish가 별도 경로(네이티브 스크롤 우선)로 처리한다(2026-08-05 2차).
  function swipe(dir) {
    var before = '' + location.href;
    var tried = doSwipe(dir, false);
    send({ type: 'domlog', text: 'SWIPE dir=' + dir + ' tried=' + tried.join(',') + ' href=' + before.slice(-16) });
    scheduleFastPoll();
    setTimeout(function () {
      if (('' + location.href) === before) { doSwipe(dir, true); send({ type: 'domlog', text: 'SWIPE-retry dir=' + dir + ' (scroll fallback)' }); scheduleFastPoll(); }
    }, 450);
  }
  window.paceAdvance = function () { swipe(1); };
  window.pacePrevious = function () { swipe(-1); };

  // 2026-08-05(2차) — 전환(스와이프/doSwipe) 직후 새 영상 재부착(음소거 해제·ended 리셋)이 500ms 고정
  // 폴링을 기다려야 했던 것도 "전환 후 한 박자 있다 소리/재생이 맞아떨어지는" 잔여 버벅임의 한 축이었다.
  // 전환 트리거 시점에 짧은 간격(60/150/300ms)으로 몇 번 더 확인해 정상 폴링보다 훨씬 빨리 따라잡는다.
  function scheduleFastPoll() {
    setTimeout(pollTick, 60);
    setTimeout(pollTick, 150);
    setTimeout(pollTick, 300);
  }

  // 폴링 1틱 — href/영상id 변화 감지 재부착 + 진행률/종료 감지. setInterval(500ms, 상시)과
  // scheduleFastPoll(전환 직후 버스트) 양쪽이 공유한다(top-level로 빼 양쪽에서 호출 가능).
  function pollTick() {
    // ⚠️ 2026-08-05 사장님/맥 진단 — "같은 비디오가 짧은 시간에 두 번 걸려 첫 재생이 두 번째에 끊긴다."
    //   원인: 재부착 판단을 **href 전체**로 하고 있었다. 유튜브는 같은 쇼츠를 보면서도 URL 뒤쪽을
    //   손댄다(파라미터 추가/정규화 등). 그때마다 href가 달라져 attach()가 다시 돌고, attach는 끝에서
    //   v.play()를 걸고 muted를 되돌린다 → 이미 재생 중이던 **같은 영상**이 멈칫하고 다시 시작한다.
    //   영상 id가 실제로 바뀔 때만 재부착한다. id가 같으면 curHref만 갱신하고 넘어간다.
    var h = '' + location.href;
    if (h !== curHref) {
      var vid = videoIdOf(h);
      curHref = h;
      if (vid && vid !== curVid) {
        curVid = vid;
        reportedReady = false; reportedEnded = false; lastT = -1;
        send({ type: 'domlog', text: 'URLCHG reattach ' + vid });
        reportVideo();
        attach(40); return;
      }
      send({ type: 'domlog', text: 'URLCHG same-video skip ' + h.slice(-24) });
    }
    var v = curV; if (!v) return;
    if (v.__ok && v.muted && !window.__paceForceSilent) { v.muted = false; }
    // 안전망: 무음스위치가 켜진 채로 어떤 경로로든 muted가 풀려 있으면 매 500ms마다 네이티브 setter로 되돌린다.
    if (window.__paceForceSilent && !v.muted) {
      try { (window.__paceNativeMutedSet || function (val) { v.muted = val; }).call(v, true); } catch (e) {}
    }
    if (!v.duration || isNaN(v.duration)) return;
    var t = v.currentTime;
    if (v.duration > 0) send({ type: 'progress', value: t / v.duration });
    if (reportedEnded) return;
    var nearEnd = t >= v.duration - 0.5, loopedBack = lastT > 1 && t < lastT - 1;
    if (nearEnd || loopedBack) { reportedEnded = true; send({ type: 'ended' }); return; }
    lastT = t;
  }

  function installGlobalsOnce() {
    if (globalsOn) return; globalsOn = true;
    // ⚠️ 2026-08-05 — 이 play()는 iOS 자동재생 정책상 "유저 제스처" 문맥을 갱신하는 역할을 겸해서
    //   완전히 없앨 순 없지만(탭으로 소리 해제하는 원래 목적), **스와이프로 판정된 터치에서는 건너뛴다**
    //   — 스와이프는 곧 다른 영상으로 넘어간다는 뜻이라 지금 영상(curV, 곧 교체될 대상)에 다시 거는
    //   play()가 유튜브 자신의 비디오 교체 처리와 겹쳐 "멈칫하고 재생"을 만들 수 있다(실측: AbortError).
    //   탭(스와이프가 아닌 모든 touchend/click)에서는 그대로 부른다 — 필요성 자체는 그대로 유효하다.
    // __paceForceSilent면 무음스위치가 켜져 있다는 뜻 — 탭해도 안 풀어준다(유튜브 실제 앱과 동일하게
    // OS 무음스위치가 인앱 조작보다 우선하도록, 2026-08-07).
    function unmuteOnce() { var v = curV; if (!v || window.__paceForceSilent) return; v.__ok = true; v.muted = false; v.play().catch(function () {}); }
    document.addEventListener('click', unmuteOnce, true);
    // 2026-08-01 사장님 지시 — iOS 피드 유저 손가락 스와이프(위로=다음 Short, 아래로=이전).
    // 2026-08-05(2차, 되돌림) — scrollEnabled=true(네이티브 스크롤이 직접 따라오게)를 실기기에 올렸다가
    // **회귀 확정**: 실제 재생 중인 <video>가 있는 무거운 페이지를 진짜로 라이브 스크롤하니 드래그
    // "도중"에도 컴포지팅이 버벅여, 증상이 "손 뗀 뒤 한 박자"에서 "손 대는 순간부터" 버벅임으로
    // 더 나빠졌다(사장님 실기기 확인). 즉시 되돌린다 — scrollEnabled는 다시 항상 false(아래 RN
    // 컴포넌트), doSwipe()도 다시 touchend 즉시 호출로 복귀(1차 수정과 동일). scheduleFastPoll()
    // (전환 직후 재부착을 앞당기는 개선)만 남긴다 — 이건 이 회귀와 무관하게 유효하다.
    var swST = 0, swSY = 0, swSX = 0, swLast = 0;
    document.addEventListener('touchstart', function (e) {
      var tt = e.changedTouches && e.changedTouches[0]; if (!tt) return;
      swST = Date.now(); swSY = tt.clientY; swSX = tt.clientX;
    }, { capture: true, passive: true });
    function onTouchFinish(e) {
      var tt = e.changedTouches && e.changedTouches[0];
      if (!tt || !swST) { unmuteOnce(); return; } // touchstart를 못 잡은 케이스는 안전하게 탭으로 취급.
      var dy = tt.clientY - swSY, dx = tt.clientX - swSX, dt = Date.now() - swST; swST = 0;
      // 2026-08-05 사장님 "스와이프 개 버벅" — 800ms는 너무 빡빡해 조금만 천천히 끌어도 통째로 버려졌다
      // (사용자 체감: "먹통"). 1500ms로 완화. 위쪽 |dy|·수직우세 조건이 이미 탭/가로스크롤을 걸러낸다.
      if (dt > 1500) { unmuteOnce(); return; }         // 정말 느린 드래그(스크롤 의도) — 탭으로 취급
      if (Math.abs(dy) < 60) { unmuteOnce(); return; }                    // 탭/미세 이동 — 재생·음소거 탭 보존
      if (Math.abs(dy) < Math.abs(dx) * 1.3) { unmuteOnce(); return; }   // 수평 우세 — 탭으로 취급
      var now = Date.now(); if (now - swLast < 500) return; swLast = now;  // 연속 오발화 방지(스와이프 자체를 버림 — unmuteOnce도 안 부름)
      var dir = dy < 0 ? 1 : -1;                                           // 위로(dy<0)=다음, 아래로=이전
      // ⚠️ 리스트 모드(HOT/즐겨찾기 순서 재생)에선 이동을 하면 안 된다 — 그건 유튜브 피드가 아니라
      //   우리 리스트의 다음 항목으로 리마운트해야 하므로 RN이 처리한다(moved=false로 위임).
      if (window.__paceListMode) { send({ type: 'userswipe', dir: dir, moved: false }); return; }
      // ⚡ 이동은 여기서 즉시 실행하고(브릿지 왕복 없음), RN에는 기록용으로만 알린다. scrollFallback=false —
      //   키 이벤트만으로 넘긴다(scrollBy는 WKWebView 재생을 멈춘다, 2026-08-05 웹서치로 확정된 진짜 원인).
      doSwipe(dir, false);
      scheduleFastPoll();
      send({ type: 'userswipe', dir: dir, moved: true });
    }
    document.addEventListener('touchend', onTouchFinish, { capture: true, passive: true });
    document.addEventListener('touchcancel', onTouchFinish, { capture: true, passive: true });
    reportVideo();
    setInterval(pollTick, 500);
  }

  // seq — 이 부착 시도의 세대 번호. 새 attach가 시작되면 attachSeq가 올라가고, 진행 중이던 낡은 재시도
  // 체인은 다음 틱에서 스스로 멈춘다(안 그러면 뒤늦게 살아나 play()를 한 번 더 걸어 재생을 끊는다).
  function attach(n, seq) {
    if (seq === undefined) seq = ++attachSeq;
    else if (seq !== attachSeq) return; // 낡은 체인 — 폐기
    var v = document.querySelector('video');
    if (!v) {
      if (n > 0) { setTimeout(function () { attach(n - 1, seq); }, 300); return; }
      var href = '' + location.href;
      var signin = /consent|accounts\\.google|signin|login/i.test(href) || !!document.querySelector('form[action*="consent"]');
      send({ type: 'novideo', signin: signin, href: href.slice(0, 80) }); return;
    }
    // 2026-08-01 사장님 지적 — <video>는 있지만 URL이 /shorts/가 아니면(라이브/롱폼이 watch로 리다이렉트됨)
    // 이 화면에선 스와이프/자동넘김/손짓이 전부 Shorts 릴 DOM에 의존해 동작 불가. 리다이렉트는 내비게이션
    // 시점(서버 303)에 끝나 이 시점 href는 이미 최종값이라 오탐 없음(정상 쇼츠는 항상 /shorts/ 유지). 부모가
    // 정상 쇼츠로 리마운트하도록 통보하고, watch 페이지 <video>엔 핸들러를 안 붙인다(재생 안 함).
    if (('' + location.href).indexOf('/shorts/') < 0) {
      send({ type: 'notshorts', href: ('' + location.href).slice(0, 80) }); return;
    }
    // 2026-08-05 — 같은 영상에 이미 붙어 있으면 아무것도 다시 하지 않는다. 아래는 play()와 muted 되돌림,
    // 리스너 재등록을 하는데, 재생 중인 같은 영상에 그걸 또 하면 멈칫하고 다시 시작한다(사장님 보고 증상).
    // 위 폴링의 id 비교로 대부분 걸러지지만, 초기 attach와 폴링이 겹치는 창이 있어 여기서 한 번 더 막는다.
    if (curV === v && v.__paceAttached === curVid) { installGlobalsOnce(); return; }
    curV = v;
    v.__paceAttached = curVid;
    window.pacePlay = function () { v.play().catch(function () {}); };
    window.pacePause = function () { v.pause(); };
    // 오디오: 처음부터 소리로 재생 + muted setter 가로채 유튜브 자동음소거 무시(재로드 없어 영상당 1회 깔끔).
    try {
      var md = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
      if (md && md.get && md.set && !v.__mo) {
        v.__mo = true;
        Object.defineProperty(v, 'muted', { configurable: true, get: function () { return md.get.call(this); },
          set: function (val) {
            if (window.__paceForceSilent) { if (val === false) return; }
            else if (this.__ok && val === true) { return; }
            md.set.call(this, val);
          } });
      }
    } catch (e) {}
    // 2026-08-08 — 무음스위치 강제 반영, muted 기반으로 재작성. 웹서치로 확정: iOS WebKit은
    // HTMLMediaElement.volume을 아예 무시한다(JS 상태만 바뀌고 실제 출력엔 반영 안 됨 — Apple 의도적
    // 정책). 어제의 volume=0 우회는 그래서 로그상 성공(vol=0)인데 실기기에선 계속 소리가 났다. 진짜
    // 유효한 건 muted뿐 — 위 프로토타입/요소별 두 훅 모두 "무음스위치 켜져있는 동안 val===false를
    // 거부"하도록 고쳐 어디서도 강제로 안 풀리게 막고, 여기서는 훅을 안 거치는 진짜 네이티브 setter
    // (window.__paceNativeMutedSet, 훅 설치 전에 캡처)로 직접 muted를 세팅한다.
    window.paceSetMuted = function (m) {
      window.__paceForceSilent = !!m;
      if (!curV) return;
      try {
        if (window.__paceNativeMutedSet) { window.__paceNativeMutedSet.call(curV, !!m); }
        else { curV.muted = !!m; }
      } catch (e) {}
    };
    try { var ust = document.createElement('style'); ust.textContent = '.ytp-unmute,.ytp-unmute-box,.ytp-unmute-icon{display:none!important}'; (document.head || document.documentElement).appendChild(ust); } catch (e) {}
    // ⚠️ 2026-08-05 "다음 영상에서 멈칫" 2차 수정 — **순서**가 원인이다. 예전엔 muted=false를 **먼저**
    //   하고 play()를 했다. 유튜브는 새 쇼츠를 무음 자동재생으로 시작하는데, 유저 제스처 밖에서 무음을
    //   풀면 iOS(WebKit) 자동재생 정책상 그 순간 재생이 멈출 수 있다 → play()가 거부되고 catch가 다시
    //   muted=true로 되돌려 재생 → 정확히 "멈췄다가 플레이". 게다가 이미 재생 중인 영상에 play()를 또
    //   거는 것도 불필요하다. 그래서: **이미 돌고 있으면 건드리지 않고 소리만 켜고**, 멈춰 있을 때만
    //   재생을 먼저 붙잡은 뒤 소리를 켠다.
    v.volume = 1.0; // iOS WebKit은 volume을 무시한다(웹서치로 확정) — 무해하게 그대로 두되 무음은 muted로만 제어.
    var goAudible = function () {
      // 2026-08-08 — 무음스위치가 켜져 있으면 여기서 무조건 muted=true로 확정한다(진입 시 상태 무관 —
      // 이미 재생 중이던 요소가 재사용된 경우까지 커버). 네이티브 setter를 직접 불러 위 두 훅(프로토타입
      // /요소별)을 다 거치지 않고 확실히 세팅한다.
      if (window.__paceForceSilent) {
        try { (window.__paceNativeMutedSet || function (val) { v.muted = val; }).call(v, true); } catch (e) {}
      } else if (v.muted) {
        v.muted = false;
        // 무음 해제 때문에 멈췄으면 되살린다(소리를 포기하진 않는다 — 다음 터치의 unmuteOnce가 또 시도).
        if (v.paused) v.play().catch(function () {});
      }
      v.__ok = true;
      // 2026-08-06 — 소리가 실제로 붙은 시점에만 프로토타입 가로채기를 활성화한다(위 __paceMutedHook
      // 주석 참고). 이 시점 이후 만들어지는 <video>는 유튜브가 muted=true를 걸어도 무시되므로,
      // 다음 영상부터는 "무음으로 시작 → 우리가 되돌림 → 멈칫"의 고리 자체가 사라진다.
      if (!v.muted) window.__paceAudioOk = true;
      send({ type: 'audio', tag: v.muted ? 'audible-blocked' : 'audible-ok', muted: v.muted });
    };
    // ⚡ 2026-08-05(3차, 되돌림) — "처음부터 muted=true로 재생 시작"을 시도했다가 실기기 회귀 확정:
    //   소리가 완전히 안 났다. 원인 추정 — 유튜브의 오디오 트랙 포함 여부는 **최초 play() 시도 시점의
    //   muted 상태**로 결정되는 듯하다(적응형 스트림이 그때 오디오 트랙을 붙일지 정함). muted=true로
    //   시작하면 오디오 트랙 자체가 안 붙어서, 나중에 muted=false로 되돌려도 낼 소리가 없었다. 그래서
    //   최초 시도는 **원래대로 무음-아님(기본값)**으로 되돌린다 — 이건 실기기 로그상 100% 거부되지만
    //   (아래 audible-blocked), 거부되더라도 오디오 트랙 자체는 이미 정상적으로 붙는다(그 다음 재생이
    //   들리는 이유). 실제로 고칠 버그는 그 거부 이후: 예전 코드는 catch에서 무음 재생만 붙잡고
    //   goAudible()을 안 불러 v.__ok가 영영 true가 안 됐다 — pollTick의 "무음이면 풀어준다" 안전망도
    //   muted-setter 차단도 전혀 작동을 안 해서 **탭하기 전까진 계속 무음으로 남는** 별개의 진짜
    //   버그였다. 무음 재생이 실제로 붙잡힌(.then) 뒤에만 goAudible()을 불러 소리를 켠다.
    if (v.paused) {
      v.play().then(goAudible)
        .catch(function (e) {
          send({ type: 'audio', tag: 'audible-blocked', err: String(e && e.name) });
          v.muted = true;
          v.play().then(goAudible).catch(function () { v.__ok = true; }); // 그래도 실패하면 __ok만 세워 안전망 가동
        });
    } else {
      goAudible(); // 이미 재생 중 — play()를 다시 걸지 않는다(그게 멈칫을 만든다)
    }
    // 유튜브가 릴 사이에서 같은 <video> 요소를 재사용하면 attach마다 리스너가 겹겹이 쌓인다.
    // 요소에 표식을 남겨 1회만 등록한다(핸들러는 클로저 밖 변수만 읽으므로 재등록이 필요 없다).
    if (!v.__paceListeners) {
      v.__paceListeners = true;
      v.addEventListener('loadeddata', function () { if (!reportedReady) { reportedReady = true; send({ type: 'ready' }); } });
      v.addEventListener('ended', function () { if (!reportedEnded) { reportedEnded = true; send({ type: 'ended' }); } });
      v.addEventListener('error', function () { send({ type: 'error', code: v.error ? v.error.code : -1 }); });
      // 진단(dev 전용) — 전환 순간 무엇이 멈추는지 기기에서 직접 본다. 스와이프 모드엔 이 로그가
      // 아예 없어서 "멈칫"의 원인을 추정으로만 좁혀야 했다. __PACE_DIAG__ 밖에선 문자열도 안 만든다.
      ['pause', 'playing', 'waiting', 'stalled'].forEach(function (ev) {
        v.addEventListener(ev, function () {
          if (!window.__PACE_DIAG__) return;
          send({ type: 'domlog', text: 'VEV ' + ev + ' t=' + (v.currentTime || 0).toFixed(2) + ' muted=' + v.muted + ' rs=' + v.readyState });
        });
      });
    }
    if (v.readyState >= 2 && !reportedReady) { reportedReady = true; send({ type: 'ready' }); }
    installGlobalsOnce();
  }
  attach(40);
})();
true;
`;

// 전환 방식 플래그 — 'swipe'(YouTube 네이티브, 빠름/큐레이션 없음) | 'reload'(특정 videoId, 느림/큐레이션).
// 2026-07-28 사장님 결정으로 'swipe'. 문제 시 'reload'로 되돌리면 어젯밤까지의 검증된 동작으로 즉시 복귀.
type NavMode = 'swipe' | 'reload';
const NAV_MODE = 'swipe' as NavMode;
// 피드가 goNext/goToPrevious를 "스와이프 주입"으로 바꿀지 판단(스와이프 모드면 큐 advance 대신 player.advance()).
export const SWIPE_NAV = NAV_MODE === 'swipe';

// 동의(consent) 쿠키 — youtube.com이 실기기에서 "쿠키 동의" 페이지로 튕겨 <video>가 안 뜨는 것 방지.
//
// 2026-08-05 사장님 지적("첫 영상은 유튜브에서 받고 다음도 유튜브가 잇기로 했는데 아직 영어가 나온다")
// — 이어가는 구조 자체는 정상이었다(NAV_MODE='swipe' → window.paceAdvance로 유튜브 페이지가 스스로
// 다음을 고름). 문제는 **그 유튜브 세션의 언어가 영어로 고정돼 있던 것**이다. 이 SOCS 값을 디코딩하면
// 프로토버프 필드 3에 언어가 들어 있는데 그게 'en'이었다:
//     CAISNQgD...GgJlbiAAKAE → ... 1A 02 'e' 'n' ...
// 즉 우리가 매 요청마다 "이 세션 언어는 영어"라고 알려주고 있었다. 안드로이드는 실제 유튜브 앱으로
// 넘겨서 계정/기기 로케일을 그대로 타므로 이 문제가 없다 — iOS만 WebView라 우리가 정하게 된다.
// 언어 코드는 2바이트라 그 자리만 바꾸면 길이 프리픽스가 그대로 유효하다(ko/en 둘 다 2글자).
const SOCS_BY_LANG: Record<string, string> = {
  en: 'CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCZW4gACgB',
  ko: 'CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCa28gACgB',
};

/** 기기 로케일 → 유튜브가 쓰는 (언어, 지역) 쌍. 지원 언어 밖이면 영어로 폴백. */
function youtubeLocale(): { hl: string; gl: string } {
  try {
    const loc = Localization.getLocales()[0];
    const hl = (loc?.languageCode || 'en').toLowerCase();
    const gl = (loc?.regionCode || (hl === 'ko' ? 'KR' : 'US')).toUpperCase();
    return { hl: SOCS_BY_LANG[hl] ? hl : 'en', gl: /^[A-Z]{2}$/.test(gl) ? gl : 'US' };
  } catch {
    return { hl: 'en', gl: 'US' };
  }
}

// 익명(비로그인) 세션에서 유튜브가 언어·지역을 판단하는 표준 경로 세 가지를 모두 맞춘다:
//   ① SOCS 동의 쿠키의 언어 필드   ② PREF 쿠키(hl/gl)   ③ URL 쿼리(hl/gl) + Accept-Language 헤더
// 하나만 맞추면 나머지가 영어로 남아 흐름이 도로 영어권으로 끌려간다(실제로 ①만 영어였는데도 그랬다).
function consentCookie(hl: string, gl: string): string {
  return `SOCS=${SOCS_BY_LANG[hl] ?? SOCS_BY_LANG.en}; CONSENT=YES+1; PREF=hl=${hl}&gl=${gl}`;
}

// http(s)만 허용 → youtube 앱 딥링크(youtube://)/앱스토어(itms-apps://) 등 "앱에서 열기" 시도를 차단해
// WebView가 딴 데로 튕겨 까매지는 것을 막는다. youtube/구글/영상CDN은 전부 http(s)라 그대로 허용됨.
function isAllowedNavigation(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
}

// 기기 언어를 유튜브에 알려주는 헤더 — "ko-KR,ko;q=0.9,en;q=0.8" 형태.
// 유튜브는 익명 세션의 추천 언어권을 이걸로도 판단한다.
function acceptLanguageHeader(): string {
  try {
    const loc = Localization.getLocales()[0];
    const lang = (loc?.languageCode || 'en').toLowerCase();
    const tag = loc?.languageTag || lang;
    return lang === 'en' ? `${tag},en;q=0.9` : `${tag},${lang};q=0.9,en;q=0.8`;
  } catch {
    return 'en-US,en;q=0.9';
  }
}

export type ShortsPlayerHandle = { advance: () => void; previous: () => void; setMuted: (muted: boolean) => void };

export const YouTubeShortsPlayer = forwardRef<ShortsPlayerHandle, Props>(function YouTubeShortsPlayer(
  { videoId, playing, onEnded, onReady, onError, onProgress, onAudioDiag, onVideoChange, onUserSwipe, onNotShorts, preload, listMode }: Props,
  ref
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // 스피너는 로드가 길어질 때(≥450ms)만 표시 — 빠른 전환엔 스피너를 안 띄워 "기다림"을 강조하지 않는다.
  const [showSpinner, setShowSpinner] = useState(false);
  const wasPreloadRef = useRef<boolean>(!!preload);
  // 스와이프 모드: 첫 영상만 로드하고 이후 videoId 변화는 무시(리로드 안 함) → source를 첫 영상으로 고정.
  const firstVideoIdRef = useRef(videoId);
  const navVideoId = NAV_MODE === 'swipe' ? firstVideoIdRef.current : videoId;
  const source = useMemo(
    // 2026-08-05 — Accept-Language를 명시한다. 예전엔 Cookie만 보내서 유튜브에 **언어를 한 번도
    // 알려주지 않았다**(UA도 일반 iPhone Safari 고정). WebView 세션이 로그인 상태면 계정 설정이
    // 우선이라 영향이 없지만, 로그인 쿠키가 공유 안 된 익명 세션에선 유튜브가 언어 힌트 없이
    // 전 세계 인기(=영어 위주)로 흐른다.
    //
    // ⚠️ 앞선 주석은 "URL 형태는 절대 안 건드린다 — /shorts/<ID>가 Shorts 탭으로 가는 유일하게
    // 검증된 형태"라고 못박고 헤더만 더했는데, **그 근거는 iOS에 해당하지 않는다.** 그 표
    // (services/shortsEntry.ts 상단)는 **안드로이드에서 유튜브 앱으로 딥링크를 던질 때** 앱이 어느
    // 탭으로 라우팅하느냐에 대한 것이다. iOS는 앱으로 던지는 게 아니라 WebView 안에서 웹페이지를
    // 여는 것이라 그 라우팅 규칙 자체가 적용되지 않는다 — 여기서 hl/gl은 그냥 유튜브 표준 쿼리다.
    // (안드로이드 쪽 딥링크 URL은 그 주석대로 그대로 둔다.)
    // persist_hl/persist_gl은 그 값을 PREF 쿠키에 눌러 담아 이후 내부 이동에도 유지시킨다.
    () => {
      const { hl, gl } = youtubeLocale();
      return {
        uri: `https://www.youtube.com/shorts/${navVideoId}?hl=${hl}&gl=${gl}&persist_hl=1&persist_gl=1`,
        headers: { Cookie: consentCookie(hl, gl), 'Accept-Language': acceptLanguageHeader() },
      };
    },
    [navVideoId]
  );

  // 스와이프로 다음/이전 — 리로드 없이 YouTube 네이티브 피드를 넘긴다(부모 goNext/goToPrevious가 호출).
  useImperativeHandle(ref, () => ({
    advance: () => { webRef.current?.injectJavaScript('window.paceAdvance&&window.paceAdvance();true;'); },
    previous: () => { webRef.current?.injectJavaScript('window.pacePrevious&&window.pacePrevious();true;'); },
    // 2026-08-07 — 무음스위치 강제 반영(위 attach()의 window.paceSetMuted 주석 참고).
    // 2026-08-08 — window.__paceForceSilent를 직접 먼저 세팅한다. paceSetMuted 함수는 attach()가
    // <video>를 찾아야 정의되는데, 첫 영상 로드 중(아직 attach 전) 이 호출이 오면 함수가 없어 조용히
    // 무시됐다 — 실기기 로그로 확정(첫 영상만 소리나고 그다음부터 계속 무음이던 증상의 원인). 전역
    // 변수는 attach() 전에도 항상 존재하므로(스크립트 최상단에서 초기화) 여기서 먼저 세팅해두면
    // goAudible()이 첫 영상부터 바로 이 값을 본다.
    setMuted: (muted) => { webRef.current?.injectJavaScript(`window.__paceForceSilent=${muted};window.paceSetMuted&&window.paceSetMuted(${muted});true;`); },
  }), []);

  // reload 모드에서만: videoId가 바뀌면 새 페이지 로드 → ready 리셋. (스와이프 모드는 리로드가 없어 불필요.)
  useEffect(() => { if (NAV_MODE === 'reload') { setReady(false); wasPreloadRef.current = !!preload; } }, [videoId]);

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

  // 리스트 모드 전달 — WebView의 손가락 스와이프 핸들러가 "직접 넘길지(유튜브 피드) 부모에 위임할지
  // (리스트 다음 항목)" 판단하는 데 쓴다. 페이지 로드 시점 값은 injectedJavaScriptBeforeContentLoaded가
  // 심으므로(리마운트 대응), 이 effect는 리마운트 없이 값만 바뀌는 경우(리스트 소진 등)를 담당한다.
  useEffect(() => {
    webRef.current?.injectJavaScript(`window.__paceListMode=${listMode ? 'true' : 'false'};true;`);
  }, [listMode]);

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
        injectedJavaScript={NAV_MODE === 'swipe' ? INJECTED_JS_SWIPE : INJECTED_JS}
        // 페이지 로드 전에 프리로드 여부를 심어, attach()가 재생/소리를 켤지(활성) 로드만 할지(프리로드) 결정.
        injectedJavaScriptBeforeContentLoaded={`window.__PACE_DIAG__=${__DEV__ ? 'true' : 'false'};window.__pacePreload=${preload ? 'true' : 'false'};window.__paceListMode=${listMode ? 'true' : 'false'};(function(){try{var s=document.createElement('style');s.textContent='.ytp-unmute,.ytp-unmute-box,.ytp-unmute-icon{display:none!important}';(document.head||document.documentElement).appendChild(s);}catch(e){}})();true;`}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // 2026-08-05(2차) — scrollEnabled=true(네이티브 스크롤이 손가락을 직접 따라오게) 실험을 실기기에
        // 올렸다가 회귀 확정: 재생 중인 무거운 <video> 페이지를 실제로 라이브 스크롤하니 드래그 "도중"에도
        // 컴포지팅이 버벅여, 증상이 "손 뗀 뒤 한 박자"에서 "손 대는 순간부터"로 더 나빠졌다(실기기 확인).
        // 되돌린다 — 항상 false 유지, 이동은 doSwipe()(합성 스크롤/키 이벤트)로 계속 처리.
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
            try { if (__DEV__) PaceGestureLog?.nativeLog?.(String((msg as any).text ?? '')); } catch {}
            return;
          }
          if (msg.type === 'audio') {
            const m = msg as any;
            try { if (__DEV__) PaceGestureLog?.nativeLog?.(`AUDIO ${m.tag} muted=${m.muted}`); } catch {}
            onAudioDiag?.(`${m.tag} muted=${m.muted} vol=${m.vol ?? '?'}${m.err ? ' ' + m.err : ''}`);
            return;
          }
          if (msg.type === 'video') {
            const vid = (msg as any).videoId;
            if (typeof vid === 'string' && vid) onVideoChange?.(vid);
            return;
          }
          if (msg.type === 'userswipe') {
            const d = (msg as any).dir;
            // moved=true = WebView가 이미 넘김(부모는 기록만). 구버전 메시지 호환을 위해 !!로 좁힌다.
            if (d === 1 || d === -1) onUserSwipe?.(d, !!(msg as any).moved);
            return;
          }
          if (msg.type === 'ready') {
            setReady(true);
            onReady?.();
          } else if (msg.type === 'ended') {
            onEnded();
          } else if (msg.type === 'progress') {
            if (typeof msg.value === 'number') {
              // 실패망: progress>0 = 실제 재생 중 = 로드 완료. 'ready' 메시지가 브릿지에서 드롭돼도
              // 로딩 커버가 재생 중 영상 위에 남아 까만화면이 되지 않게, 첫 진행에서 ready로 승격.
              // (onMessage 클로저는 매 렌더 최신 ready를 캡처 → 정상 ready 후엔 이 분기 안 탐.)
              if (msg.value > 0 && !ready) { setReady(true); onReady?.(); }
              onProgress?.(msg.value);
            }
          } else if (msg.type === 'error') {
            onError?.(msg.code ?? -1);
          } else if (msg.type === 'novideo') {
            // 12초간 <video> 없음(로그인/consent/차단 페이지) → 까만화면에 갇히지 말고 다음 영상으로 스킵.
            if (__DEV__) console.log('[WV] novideo → skip', JSON.stringify(msg));
            onError?.(-2);
          } else if (msg.type === 'notshorts') {
            // /shorts/{id}가 watch로 리다이렉트된 비-쇼츠 → 스와이프로는 복구 불가(릴 DOM 없음), 부모가
            // key 교체(forcedVideoId 해제)로 정상 쇼츠에 리마운트해야 한다. onError(스와이프 스킵)와 구분.
            if (__DEV__) console.log('[WV] notshorts → remount', JSON.stringify(msg));
            onNotShorts?.();
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
});

const styles = StyleSheet.create({
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
