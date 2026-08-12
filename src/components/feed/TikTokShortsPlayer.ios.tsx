import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  isAllowedNavigation,
  sharedShortsPlayerStyles as styles,
  type ShortsPlayerHandle,
} from './sharedShortsPlayer';

const PaceGestureLog = requireOptionalNativeModule<{ nativeLog(msg: string): void }>('PaceGesture');

// iOS 전용 TikTok 플레이어. `src/app/dev/tiktok-poc.tsx`(DEV PoC)에서 2026-08-12~13 밤 동안
// 검증한 기법을 그대로 프로덕션 컴포넌트 형태로 옮긴 것 — 실기기에서 데스크톱 UA로 자동 다음영상
// 넘김을 확인했고, 이어서 시뮬레이터에서 재현한 4개 버그(재생 중 끊김/무한 리플레이/영구 고착/
// RN UI 소실)를 전부 고친 뒤의 최종 형태다. 자세한 조사 히스토리는 `QA_MATRIX.md` 2026-08-12/13
// 섹션과 `tiktok-poc.tsx` 헤더 코멘트 참고.
//
// YouTubeShortsPlayer.ios.tsx와의 핵심 차이:
//  - **큐레이션 없음** — 유튜브는 PACE가 고른 videoId 순서를 스와이프 주입으로 이어가지만, 틱톡은
//    페이지 자체(`tiktok.com/foryou`)를 한 번만 로드하고 틱톡 자신의 추천 알고리즘에 맡긴다.
//    `videoId`/`listMode`/`onNotShorts` 같은 큐 관련 prop이 없다(그 개념 자체가 없음).
//  - **다음 영상 트리거가 완전히 다르다** — 유튜브는 스와이프 시뮬레이션(방향키+스크롤)로 자기
//    피드를 넘기지만, 틱톡 데스크톱 UA 페이지는 실기기에서 그 방식이 전혀 안 먹혔다(합성 이벤트
//    여러 종류 + 진짜 손가락 스와이프까지 전부 무반응). 대신 **자연 종료 감지(ended 이벤트 +
//    재생위치 폴링) → 확인될 때까지 여러 기법을 순서대로 재시도**하는 구조로 완전히 다르게 짰다.
//  - **데스크톱 UA 고정** — 모바일 Safari UA로는 8개 기법이 전부 1회 이동 후 영구 고착됐다(실기기
//    진짜 손가락 포함). 데스크톱 Chrome/Mac UA로 위장하면 계속 넘어간다(원인: 모바일 웹은 앱 설치
//    유도를 위해 의도적으로 제한, 데스크톱은 그 제한이 없음 — QA_MATRIX.md 2026-08-12 섹션).
//  - **playsinline 강제 필수** — 데스크톱 UA 페이지의 <video>는 playsinline 속성이 없어(진짜
//    데스크톱 브라우저는 필요 없음), iOS WKWebView가 네이티브 전체화면으로 승격해 RN UI 전체를
//    덮는 버그가 있었다(Apple Developer Forums에 보고된 iOS WKWebView 인라인 실패 패턴과 일치,
//    추측 아니라 웹서치로 확정). injectedJavaScriptBeforeContentLoaded로 페이지 스크립트보다
//    먼저 막는다.

type Props = {
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
  /** 재생 진행률(0~1) — 피드의 고개짓 카메라 배터리 게이팅용(유튜브 플레이어와 동일 용도). */
  onProgress?: (fraction: number) => void;
};

const INJECTED_JS_BEFORE_LOAD = `
(function() {
  try {
    if (typeof Element !== 'undefined' && Element.prototype.requestFullscreen) {
      Element.prototype.requestFullscreen = function(){ return Promise.reject(new Error('blocked')); };
    }
    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.webkitEnterFullscreen) {
      HTMLVideoElement.prototype.webkitEnterFullscreen = function(){};
    }
  } catch(e) {}
  function ensureInline(v){ try { v.setAttribute('playsinline','true'); v.setAttribute('webkit-playsinline','true'); v.playsInline = true; } catch(e) {} }
  try {
    var mo = new MutationObserver(function(){
      var list = document.querySelectorAll('video');
      for (var i = 0; i < list.length; i++) ensureInline(list[i]);
    });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch(e) {}
})();
true;
`;

const INJECTED_JS = `
(function() {
  // domlog는 RN 쪽(onMessage)에서 __DEV__일 때만 PaceGestureLog로 넘긴다 — 여기서 또 게이팅할
  // 필요 없다(예전엔 window.__PACE_DIAG__를 요구했는데 프로덕션 파일에선 그 값을 아무도 안 세팅해
  // 진단 로그가 전부 조용히 버려지고 있었다).
  function send(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }

  // 2026-08-13(17차) 실기기 보고 — 사장님이 실제로 확인: "무엇을 시청하고 싶으신가요, 동물/코미디
  // 등 카테고리가 있는 **로그인 유도** 팝업"이다. 관심사 선택이 아니라 비로그인 사용자에게 흔한
  // "Browse as Guest" 류 게이트로 보인다(웹서치로 확인 — TikTok 데스크톱 웹은 이 팝업을 "게스트로
  // 둘러보기" 버튼으로 닫게 해준다). 예전 문구 목록엔 그게 없었다 — 추가.
  // ⚠️ "continue"/"계속하기"는 일부러 안 넣는다 — 로그인 모달 안의 "Continue with Google/Apple"
  // 버튼과도 겹쳐서, 잘못 누르면 OAuth 플로우가 열리는 훨씬 나쁜 상태로 갈 수 있다. "게스트"류
  // 문구만 안전하게 특정해서 매칭한다.
  var SKIP_PHRASES = ['나중에', 'not now', 'maybe later', 'later', '건너뛰기', 'skip', '완료', 'done',
    '닫기', 'close', '괜찮아요', '괜찮습니다', '아니요', '아니오', '선택 안', 'no thanks', "i'll do this later",
    '게스트', 'guest', '둘러보기', '비회원', '로그인 없이', 'without logging'];
  function textMatches(txt){
    var lower = txt.toLowerCase();
    for (var i = 0; i < SKIP_PHRASES.length; i++) {
      if (lower.indexOf(SKIP_PHRASES[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }
  // 2026-08-13(18차) 실기기 로그로 확정(추측 아님) — "건너뛰기" 매칭이 실제 로그인 모달이 아니라
  // "콘텐츠 피드로 건너뛰기"라는 **접근성 스킵링크**(스크린리더용, 화면엔 안 보임)를 계속 클릭하고
  // 있었다(3초마다 같은 로그 반복 = 진짜 모달은 그대로 안 닫힘). offsetParent===null인 요소는
  // 화면에 실제로 안 보이는 요소라 후보에서 제외한다.
  function isVisible(el){
    try { return el.offsetParent !== null; } catch(e) { return true; }
  }
  function dismissAppBanner(){
    try {
      var candidates = Array.prototype.slice.call(document.querySelectorAll('button, div[role="button"], a, [role="button"]'));
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!isVisible(el)) continue;
        var txt = (el.textContent || '').trim();
        if (txt && txt.length < 20 && textMatches(txt)) { el.click(); send({ type: 'domlog', text: '배너닫음(텍스트): ' + txt }); return true; }
      }
      // 2026-08-13(19차) 실기기 로그로 확정 — 이 셀렉터도 isVisible 체크가 없어서 화면에 안 보이는
      // 뭔가를 3초마다 계속 클릭만 하고 있었다(진짜 로그인 모달은 안 닫힘). 전부에 가시성 체크.
      var closeCandidates = document.querySelectorAll('[aria-label="Close"], [aria-label="닫기"], [aria-label="close"], [aria-label*="skip" i], [aria-label*="건너뛰기"]');
      for (var ci = 0; ci < closeCandidates.length; ci++) {
        if (isVisible(closeCandidates[ci])) {
          closeCandidates[ci].click();
          send({ type: 'domlog', text: '배너닫음(aria-label): ' + (closeCandidates[ci].getAttribute('aria-label') || '') });
          return true;
        }
      }
      var bodyText = document.body.innerText || '';
      if (bodyText.indexOf('무엇을 시청하고') !== -1 || bodyText.indexOf('what you') !== -1 || bodyText.indexOf('관심사') !== -1) {
        // 로그인 유도 모달이 확실히 감지됐는데 "게스트"류 텍스트/aria-label 매칭도 실패 — 진단으로
        // 실제 버튼 목록만 로그(다음 라운드에 정확한 문구로 좁히기 위함). ⚠️ 여기서 아무 버튼이나
        // 골라 클릭하지 않는다 — 로그인 모달엔 "Continue with Google/Apple" 같은 버튼도 같이 있어,
        // 잘못 누르면 OAuth 플로우가 열리는 더 나쁜 상태가 된다. 안전한 배경 클릭/Esc만 시도.
        // 2026-08-13(18차) — [role="dialog"]/.modal 셀렉터로는 못 찾았다(실기기 로그로 확인, 진짜
        // 모달 마크업이 다른 패턴일 가능성). "무엇을 시청하고"를 직접 담은 텍스트 노드에서부터 위로
        // 올라가며 각 조상의 버튼/링크를 덤프한다 — 이러면 모달 컨테이너 이름이 뭐든 반드시 잡힌다.
        try {
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          var textNode = null;
          while (walker.nextNode()) {
            if ((walker.currentNode.nodeValue || '').indexOf('무엇을 시청하고') !== -1) { textNode = walker.currentNode; break; }
          }
          var anchor = textNode ? textNode.parentElement : null;
          if (anchor) {
            var level = 0;
            var el2 = anchor;
            while (el2 && level < 6) {
              var interactive = el2.querySelectorAll('button, [role="button"], a');
              if (interactive.length > 0 && interactive.length < 15) {
                var found2 = [];
                for (var k = 0; k < interactive.length; k++) {
                  if (!isVisible(interactive[k])) continue;
                  found2.push('"' + (interactive[k].textContent || '').trim().slice(0, 20) + '"');
                }
                if (found2.length > 0) {
                  send({ type: 'domlog', text: '로그인모달(lv' + level + ' ' + el2.tagName + '.' + (el2.className || '').toString().slice(0, 30) + ') 버튼: ' + found2.join(', ') });
                  break;
                }
              }
              el2 = el2.parentElement;
              level++;
            }
          } else {
            send({ type: 'domlog', text: '로그인모달 텍스트는 감지됐는데 텍스트노드를 못 찾음(이상 케이스)' });
          }
        } catch(e) { send({ type: 'domlog', text: '로그인모달 진단 실패: ' + e.message }); }
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch(e) {}
        try { document.body.click(); } catch(e) {}
      }
    } catch(e) {}
    return false;
  }

  function getActiveVideo(){
    var activeSlide = document.querySelector('.swiper-slide-active');
    var v = activeSlide ? activeSlide.querySelector('video') : null;
    return v || document.querySelector('video');
  }
  function markAdvancingOnce(video){
    if (video.__paceAdvancing) return false;
    video.__paceAdvancing = true;
    return true;
  }
  function scrollToNextFromVideo(video){
    try {
      var slide = video.closest ? video.closest('.swiper-slide') : null;
      if (slide && slide.nextElementSibling) {
        slide.nextElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        return;
      }
      if (slide) return;
      var e = video;
      while (e && e.tagName && e.tagName.toLowerCase() !== 'body') {
        var next = e.nextElementSibling;
        if (next && e.parentElement && e.parentElement.scrollHeight > e.parentElement.clientHeight) {
          next.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          return;
        }
        e = e.parentElement;
      }
    } catch(err) {}
  }
  function goToNext(video){
    try {
      var allSwipers = document.querySelectorAll('.swiper');
      for (var s = 0; s < allSwipers.length; s++) {
        var inst = allSwipers[s].swiper;
        if (inst && typeof inst.slideNext === 'function') inst.slideNext();
      }
    } catch(e) {}
    scrollToNextFromVideo(video);
    try {
      var py0 = window.innerHeight * 0.8, py1 = window.innerHeight * 0.15, px = window.innerWidth / 2;
      var pel = document.elementFromPoint(px, py0) || document.body;
      function pev(type, y, id){
        return new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: px, clientY: y, bubbles: true, cancelable: true });
      }
      pel.dispatchEvent(pev('pointerdown', py0, 1));
      pel.dispatchEvent(pev('pointermove', (py0 + py1) / 2, 1));
      pel.dispatchEvent(pev('pointermove', py1, 1));
      pel.dispatchEvent(pev('pointerup', py1, 1));
    } catch(e) {}
    try {
      var my0 = window.innerHeight * 0.8, my1 = window.innerHeight * 0.15, mx = window.innerWidth / 2;
      var mel = document.elementFromPoint(mx, my0) || document.body;
      function mev(type, y){ return new MouseEvent(type, { clientX: mx, clientY: y, bubbles: true, cancelable: true, button: 0 }); }
      mel.dispatchEvent(mev('mousedown', my0));
      mel.dispatchEvent(mev('mousemove', (my0 + my1) / 2));
      mel.dispatchEvent(mev('mousemove', my1));
      mel.dispatchEvent(mev('mouseup', my1));
    } catch(e) {}
    try {
      var y0 = window.innerHeight * 0.8, y1 = window.innerHeight * 0.15, x = window.innerWidth / 2;
      var el = document.elementFromPoint(x, y0) || document.body;
      function tev(type, y){ var t = new Touch({identifier: 1, target: el, clientX: x, clientY: y});
        return new TouchEvent(type, {cancelable: true, bubbles: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t]}); }
      el.dispatchEvent(tev('touchstart', y0));
      el.dispatchEvent(tev('touchmove', (y0 + y1) / 2));
      el.dispatchEvent(tev('touchmove', y1));
      el.dispatchEvent(tev('touchend', y1));
    } catch(e) {}
    try {
      var wheelEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
      wheelEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 800, bubbles: true, cancelable: true }));
    } catch(e) {}
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    } catch(e) {}
    try {
      var containers = document.querySelectorAll('div, main, section');
      var candidates = [];
      for (var k = 0; k < containers.length; k++) {
        var c = containers[k];
        var delta = c.scrollHeight - c.clientHeight;
        if (delta > 20) candidates.push({ el: c, top: c.scrollTop });
      }
      for (var m = 0; m < Math.min(3, candidates.length); m++) {
        candidates[m].el.scrollTop = candidates[m].top + window.innerHeight;
      }
      var se0 = document.scrollingElement || document.documentElement;
      se0.scrollTop = se0.scrollTop + window.innerHeight;
    } catch(e) {}
  }
  // 실제로 다음 영상으로 옮겨갔는지 확인하며 최대 6회(≈4.2초) 재시도한다. "영상이 이미 끝났다"고
  // 확정된 뒤에만 도는 재시도라 재생 중에는 절대 안 돈다(구버전의 8초 블라인드 강제루프와 다름).
  function tryAdvance(video, attemptsLeft){
    if (attemptsLeft === undefined) attemptsLeft = 6;
    goToNext(video);
    setTimeout(function(){
      var nowActive = getActiveVideo();
      if (nowActive && nowActive !== video) { video.__paceAdvancing = false; return; }
      if (attemptsLeft > 0) { tryAdvance(video, attemptsLeft - 1); }
      else { video.__paceAdvancing = false; }
    }, 700);
  }
  function hookVideoEnded(video){
    if (!video || video.__paceEndedHooked) return;
    video.__paceEndedHooked = true;
    try { video.loop = false; } catch(e) {}
    video.addEventListener('ended', function(){
      if (!markAdvancingOnce(video)) return;
      setTimeout(function(){ tryAdvance(video); }, 500);
    }, false);
  }
  var endedObserverStarted = false;
  function startEndedObserver(){
    if (endedObserverStarted) return; endedObserverStarted = true;
    var v0 = document.querySelector('video');
    if (v0) hookVideoEnded(v0);
    var mo = new MutationObserver(function(){
      var v = document.querySelector('video');
      if (v) hookVideoEnded(v);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  // 폴링 백업 — 'ended'가 안 뜨는 경우(틱톡이 video.loop을 되돌리는 등)를 대비해 재생 위치로
  // 직접 종료를 감지한다(YouTubeShortsPlayer.ios.tsx와 동일 패턴).
  var pollLastT = -1, pollLastVideo = null;
  function pollActiveVideo(){
    var v = getActiveVideo();
    if (!v) return;
    if (v !== pollLastVideo) { pollLastVideo = v; pollLastT = -1; }
    try { if (v.loop) v.loop = false; } catch(e) {}
    if (v.readyState >= 2 && !v.__paceReadySent) { v.__paceReadySent = true; send({ type: 'ready' }); }
    if (!v.duration || isNaN(v.duration)) return;
    var t = v.currentTime;
    if (v.duration > 0) send({ type: 'progress', value: t / v.duration });
    var nearEnd = t >= v.duration - 0.5;
    var loopedBack = pollLastT > 1 && t < pollLastT - 1;
    if ((nearEnd || loopedBack) && markAdvancingOnce(v)) { tryAdvance(v); }
    pollLastT = t;
  }

  var domDumped = false;
  function dumpDomOnce(){
    if (domDumped) return; domDumped = true;
    try {
      var all = document.querySelectorAll('button, [role="button"], [aria-label]');
      var found = [];
      for (var i = 0; i < all.length && found.length < 15; i++) {
        var el = all[i];
        var label = el.getAttribute('aria-label') || '';
        if (label) found.push(label);
      }
      send({ type: 'domlog', text: 'DOM(' + found.length + '): ' + found.join(' | ').slice(0, 300) });
    } catch(e) {}
  }

  function houseKeeping(){
    dismissAppBanner();
    dumpDomOnce();
    var href = '' + location.href;
    var noVideo = !document.querySelector('video');
    if (noVideo && (Date.now() - startedAt) > 12000 && !window.__paceNoVideoSent) {
      window.__paceNoVideoSent = true;
      send({ type: 'novideo', href: href.slice(0, 80) });
    }
  }

  // BT 리모컨/손짓(hands-free) 입력에서 RN이 강제로 "다음 영상" 시도를 걸 수 있게 노출.
  // 자연종료 감지(ended/폴링)와 똑같이 markAdvancingOnce 게이트를 거쳐 tryAdvance를 부른다 —
  // 이미 재생 중인 영상이면(자연종료 아님) 그냥 넘겨버리는 게 아니라 시도만 트리거하고, 이미
  // 진행 중인 이동이 있으면(markAdvancingOnce가 false) 중복 실행하지 않는다.
  window.paceForceAdvance = function(){
    var v = getActiveVideo();
    if (v && markAdvancingOnce(v)) tryAdvance(v);
  };

  var startedAt = Date.now();
  startEndedObserver();
  setInterval(houseKeeping, 3000);
  setInterval(pollActiveVideo, 500);
  setTimeout(dismissAppBanner, 1500);
  setTimeout(dismissAppBanner, 3000);
})();
true;
`;

export const TikTokShortsPlayer = forwardRef<ShortsPlayerHandle, Props>(function TikTokShortsPlayer(
  { playing, onEnded, onReady, onError, onProgress }: Props,
  ref
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);

  // 유튜브 플레이어와 같은 handle 시그니처를 맞추되, 틱톡은 큐레이션이 없어 advance/previous가
  // 스와이프 큐 이동이 아니라 "지금 재생 중인 video에 대해 다음 영상 시도"를 직접 트리거한다
  // (BT 리모컨/볼륨키 입력에서 재사용). previous는 대응하는 방법이 없어 no-op.
  useImperativeHandle(ref, () => ({
    advance: () => {
      webRef.current?.injectJavaScript('window.paceForceAdvance && window.paceForceAdvance(); true;');
    },
    previous: () => {},
    setMuted: (muted) => {
      webRef.current?.injectJavaScript(`(function(){var v=document.querySelector('video'); if(v){v.muted=${muted};}})();true;`);
    },
    // QA_MATRIX.md 1-4b(맥 세션 요청) — 안드로이드가 이미 구현한 "검색은 우리 UI, 결과는 틱톡
    // 화면" 패턴의 iOS 버전. 딥링크로 외부 앱/브라우저를 여는 대신, 이미 떠 있는 같은 WebView를
    // 틱톡 검색 URL로 이동시킨다(안드에서 https://www.tiktok.com/search가 크롬을 띄운 원인은
    // Linking.openURL로 "밖"으로 나가서지 URL 자체 문제가 아니었다 — 우리는 안 나간다).
    // 빈 문자열이면 검색 종료 → /foryou로 복귀.
    search: (query) => {
      const url = query.trim()
        ? `https://www.tiktok.com/search?q=${encodeURIComponent(query.trim())}`
        : 'https://www.tiktok.com/foryou';
      webRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
    },
  }), []);

  useEffect(() => {
    if (ready || showSpinner) return;
    const t = setTimeout(() => setShowSpinner(true), 450);
    return () => clearTimeout(t);
  }, [ready, showSpinner]);

  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(
      `(function(){var v=document.querySelector('video'); if(v){${playing ? 'v.play().catch(function(){});' : 'v.pause();'}}})();true;`
    );
  }, [ready, playing]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ uri: 'https://www.tiktok.com/foryou' }}
        style={styles.web}
        injectedJavaScriptBeforeContentLoaded={INJECTED_JS_BEFORE_LOAD}
        injectedJavaScript={INJECTED_JS}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        sharedCookiesEnabled
        onShouldStartLoadWithRequest={(req) => isAllowedNavigation(req.url)}
        // 깨끗한 데스크톱 Chrome(맥) UA — 모바일 UA는 실기기에서 자동 다음영상 넘김이 8개 기법+
        // 진짜 손가락 스와이프까지 전부 1회 이동 후 영구 고착됐다(QA_MATRIX.md 2026-08-12 참고).
        userAgent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        onError={(e) => { if (__DEV__) console.log('[TikTok WV] onError', e.nativeEvent?.code); }}
        onHttpError={(e) => { if (__DEV__) console.log('[TikTok WV] httpError', e.nativeEvent?.statusCode); }}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        onMessage={(e) => {
          let msg: { type?: string; value?: number } = {};
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'domlog') {
            try { if (__DEV__) PaceGestureLog?.nativeLog?.(String((msg as any).text ?? '')); } catch {}
            return;
          }
          if (msg.type === 'ready') {
            setReady(true);
            onReady?.();
          } else if (msg.type === 'progress') {
            if (typeof msg.value === 'number') {
              if (msg.value > 0 && !ready) { setReady(true); onReady?.(); }
              onProgress?.(msg.value);
            }
          } else if (msg.type === 'novideo') {
            if (__DEV__) console.log('[TikTok WV] novideo → skip', JSON.stringify(msg));
            onError?.(-2);
          }
        }}
      />
      {!ready && (
        <View style={styles.loadingCover} pointerEvents="none">
          {showSpinner && <ActivityIndicator size="large" color="#FFFFFF" />}
        </View>
      )}
    </View>
  );
});
