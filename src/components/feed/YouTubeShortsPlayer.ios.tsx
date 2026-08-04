import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
  /** 스와이프 모드에서 실제 재생 중인 videoId 변화 통보(현재 영상 즐겨찾기 추가용). */
  onVideoChange?: (videoId: string) => void;
  /** iOS 유저 손가락 스와이프(1=위로/다음, -1=아래로/이전) — WebView JS가 감지해 통보(2026-08-01).
   *  moved=true면 **WebView가 이미 유튜브 피드를 넘긴 뒤**다(2026-08-05 버벅임 수정) — 부모는 기록/상태만
   *  맞추고 다시 넘기면 안 된다(이중 이동). moved=false는 리스트 모드라 부모가 이동을 수행해야 한다. */
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

  // 실제 스와이프 동작(여러 전략) — dir>0 다음(아래로), dir<0 이전(위로).
  function doSwipe(dir) {
    var dy = (dir > 0 ? 1 : -1) * (window.innerHeight || 800), tried = [];
    // ⭐ 첫 손짓 무시 수정 — ArrowDown 키 스와이프는 플레이어에 focus가 있어야 먹히는데 로드 직후 focus가
    //    없어 첫 키가 무시됐다. 매 스와이프 직전 플레이어를 focus해 첫 손짓부터 키가 먹히게 한다.
    var mp = document.getElementById('movie_player') || document.querySelector('.html5-video-player') || document.querySelector('ytd-reel-video-renderer') || document.body;
    try { mp && mp.focus && mp.focus({ preventScroll: true }); tried.push('focus'); } catch (e) {}
    var reel = document.querySelector('#shorts-inner-container, ytd-shorts, #shorts-container, ytd-reel-video-renderer, #player-container') || document.scrollingElement || document.documentElement;
    try { (reel && reel.scrollBy ? reel : window).scrollBy(0, dy); tried.push('scroll'); } catch (e) {}
    try { window.scrollBy(0, dy); } catch (e) {}
    try {
      var key = dir > 0 ? 'ArrowDown' : 'ArrowUp', kc = dir > 0 ? 40 : 38;
      var k = new KeyboardEvent('keydown', { key: key, code: key, keyCode: kc, which: kc, bubbles: true });
      (mp || document).dispatchEvent(k); document.dispatchEvent(k); (document.activeElement || document.body).dispatchEvent(k); tried.push('key');
    } catch (e) {}
    return tried;
  }
  // 자가치유 — 첫 스와이프가 YouTube를 "깨우는(priming)" 데만 쓰여 URL이 안 바뀌는 경우(사장님: "두 번째
  // 손짓에서 반응")를 잡는다: 스와이프 후 URL이 그대로면 한 번 더 스와이프해 첫 손짓부터 넘어가게 한다.
  // 실제로 넘어갔으면(href 변경) 재시도 안 함 → 이중 넘김 방지.
  function swipe(dir) {
    var before = '' + location.href;
    var tried = doSwipe(dir);
    send({ type: 'domlog', text: 'SWIPE dir=' + dir + ' tried=' + tried.join(',') + ' href=' + before.slice(-16) });
    setTimeout(function () {
      if (('' + location.href) === before) { doSwipe(dir); send({ type: 'domlog', text: 'SWIPE-retry dir=' + dir + ' (priming)' }); }
    }, 450);
  }
  window.paceAdvance = function () { swipe(1); };
  window.pacePrevious = function () { swipe(-1); };

  function installGlobalsOnce() {
    if (globalsOn) return; globalsOn = true;
    // ⚠️ 2026-08-05 되돌림 — 한때 "이미 소리내어 재생 중이면 즉시 return"을 넣었다(스와이프 touchend마다
    //   play()가 도는 게 전환 순간 낭비로 보였다). 근거 없는 최적화였다: 그 play()는 매 터치의 핸들러
    //   콜스택 안에서 도는 것이라 iOS 자동재생 정책상 "유저 제스처" 문맥을 갱신하는 역할을 겸한다.
    //   이미 재생 중인 요소의 play()는 사실상 no-op이라 아끼는 값도 없다 — 원래대로 매 터치마다 부른다.
    //   (참고: "다음 영상에서 멈췄다 플레이"는 이 함수와 무관한 별개 선재 버그다 — attach()의 unmute
    //    순서 문제로 추정. MD의 해당 항목 참고.)
    function unmuteOnce() { var v = curV; if (!v) return; v.__ok = true; v.muted = false; v.volume = 1.0; v.play().catch(function () {}); }
    document.addEventListener('touchend', unmuteOnce, true);
    document.addEventListener('click', unmuteOnce, true);
    // 2026-08-01 사장님 지시 — iOS 피드 유저 손가락 스와이프(위로=다음 Short, 아래로=이전). WebView는
    // scrollEnabled=false라 손가락 스와이프가 YouTube를 직접 안 움직인다. 여기서 수직 스와이프를 감지해
    // RN에 알리면(userswipe), RN이 goNext/goPrev→player.advance()(=doSwipe)로 실제 이동을 수행한다
    // (이중 이동 없음). 임계(dy≥60·수직 우세)로 탭은 무시돼 재생/음소거 탭이 그대로 보존된다.
    var swST = 0, swSY = 0, swSX = 0, swLast = 0;
    document.addEventListener('touchstart', function (e) {
      var tt = e.changedTouches && e.changedTouches[0]; if (!tt) return;
      swST = Date.now(); swSY = tt.clientY; swSX = tt.clientX;
    }, { capture: true, passive: true });
    document.addEventListener('touchend', function (e) {
      var tt = e.changedTouches && e.changedTouches[0]; if (!tt || !swST) return;
      var dy = tt.clientY - swSY, dx = tt.clientX - swSX, dt = Date.now() - swST; swST = 0;
      // 2026-08-05 사장님 "스와이프 개 버벅" — 800ms는 너무 빡빡해 조금만 천천히 끌어도 통째로 버려졌다
      // (사용자 체감: "먹통"). 1500ms로 완화. 위쪽 |dy|·수직우세 조건이 이미 탭/가로스크롤을 걸러낸다.
      if (dt > 1500) return;                           // 정말 느린 드래그(스크롤 의도)만 스와이프에서 제외
      if (Math.abs(dy) < 60) return;                   // 탭/미세 이동 무시(재생·음소거 탭 보존)
      if (Math.abs(dy) < Math.abs(dx) * 1.3) return;   // 수평 우세면 무시(수직만)
      var now = Date.now(); if (now - swLast < 500) return; swLast = now;  // 연속 오발화 방지
      var dir = dy < 0 ? 1 : -1;                                           // 위로(dy<0)=다음, 아래로=이전
      // ⚡ 2026-08-05 버벅임 수정의 핵심 — 예전엔 이동을 RN에 위임했다(userswipe → 브릿지 → goNext →
      //   injectJavaScript → 브릿지 → doSwipe). scrollEnabled=false라 드래그 중 화면이 손가락을 안
      //   따라오는데 그 왕복 지연까지 얹혀 "손 떼고 한 박자 뒤 툭" 하고 넘어갔다. 이동은 여기서 즉시
      //   실행하고, RN에는 기록(idle 리셋/상태)용으로만 알린다 — 이동 지연에서 브릿지가 빠진다.
      //   swipe()가 아니라 doSwipe()를 직접 부른다: swipe()의 450ms 재시도는 핸즈프리 첫 손짓 씹힘용
      //   자가치유라, 손가락 스와이프에 걸리면 릴 전환 도중 한 번 더 스크롤해 튀거나 두 칸 넘어간다.
      // ⚠️ 리스트 모드(HOT/즐겨찾기 순서 재생)에선 이동을 하면 안 된다 — 그건 유튜브 피드가 아니라
      //   우리 리스트의 다음 항목으로 리마운트해야 하므로 RN이 처리한다(moved=false로 위임).
      var moved = false;
      if (!window.__paceListMode) { doSwipe(dir); moved = true; }
      send({ type: 'userswipe', dir: dir, moved: moved });
    }, { capture: true, passive: true });
    // 2026-08-01 — "현재 영상 즐겨찾기 추가"용. 스와이프 모드에선 부모의 current.videoId가 첫 영상에
    // 고정돼 있어(리로드 안 함) 실제 재생 중인 영상 id를 부모가 모른다. URL(/shorts/ID)에서 현재 id를
    // 뽑아 부모로 보고한다(초기 1회 + URL 변할 때마다).
    function reportVideo() {
      var id = videoIdOf('' + location.href);
      if (id) send({ type: 'video', videoId: id });
    }
    reportVideo();
    setInterval(function () {
      // 스와이프로 새 쇼츠 로드(URL 변화, 리로드 없음) → 새 video에 재부착.
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
      if (v.__ok && v.muted) { v.muted = false; v.volume = 1.0; }
      if (!v.duration || isNaN(v.duration)) return;
      var t = v.currentTime;
      if (v.duration > 0) send({ type: 'progress', value: t / v.duration });
      if (reportedEnded) return;
      var nearEnd = t >= v.duration - 0.5, loopedBack = lastT > 1 && t < lastT - 1;
      if (nearEnd || loopedBack) { reportedEnded = true; send({ type: 'ended' }); return; }
      lastT = t;
    }, 500);
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
          set: function (val) { if (this.__ok && val === true) return; md.set.call(this, val); } });
      }
    } catch (e) {}
    try { var ust = document.createElement('style'); ust.textContent = '.ytp-unmute,.ytp-unmute-box,.ytp-unmute-icon{display:none!important}'; (document.head || document.documentElement).appendChild(ust); } catch (e) {}
    // ⚠️ 2026-08-05 "다음 영상에서 멈칫" 2차 수정 — **순서**가 원인이다. 예전엔 muted=false를 **먼저**
    //   하고 play()를 했다. 유튜브는 새 쇼츠를 무음 자동재생으로 시작하는데, 유저 제스처 밖에서 무음을
    //   풀면 iOS(WebKit) 자동재생 정책상 그 순간 재생이 멈출 수 있다 → play()가 거부되고 catch가 다시
    //   muted=true로 되돌려 재생 → 정확히 "멈췄다가 플레이". 게다가 이미 재생 중인 영상에 play()를 또
    //   거는 것도 불필요하다. 그래서: **이미 돌고 있으면 건드리지 않고 소리만 켜고**, 멈춰 있을 때만
    //   재생을 먼저 붙잡은 뒤 소리를 켠다.
    v.volume = 1.0;
    var goAudible = function () {
      if (v.muted) {
        v.muted = false;
        // 무음 해제 때문에 멈췄으면 되살린다(소리를 포기하진 않는다 — 다음 터치의 unmuteOnce가 또 시도).
        if (v.paused) v.play().catch(function () {});
      }
      v.__ok = true;
      send({ type: 'audio', tag: v.muted ? 'audible-blocked' : 'audible-ok', muted: v.muted });
    };
    if (v.paused) {
      v.play().then(goAudible)
        .catch(function (e) { send({ type: 'audio', tag: 'audible-blocked', err: String(e && e.name) }); v.muted = true; v.play().catch(function () {}); });
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
const CONSENT_COOKIE =
  'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCZW4gACgB; CONSENT=YES+1';

// http(s)만 허용 → youtube 앱 딥링크(youtube://)/앱스토어(itms-apps://) 등 "앱에서 열기" 시도를 차단해
// WebView가 딴 데로 튕겨 까매지는 것을 막는다. youtube/구글/영상CDN은 전부 http(s)라 그대로 허용됨.
function isAllowedNavigation(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
}

export type ShortsPlayerHandle = { advance: () => void; previous: () => void };

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
    () => ({ uri: `https://www.youtube.com/shorts/${navVideoId}`, headers: { Cookie: CONSENT_COOKIE } }),
    [navVideoId]
  );

  // 스와이프로 다음/이전 — 리로드 없이 YouTube 네이티브 피드를 넘긴다(부모 goNext/goToPrevious가 호출).
  useImperativeHandle(ref, () => ({
    advance: () => { webRef.current?.injectJavaScript('window.paceAdvance&&window.paceAdvance();true;'); },
    previous: () => { webRef.current?.injectJavaScript('window.pacePrevious&&window.pacePrevious();true;'); },
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
