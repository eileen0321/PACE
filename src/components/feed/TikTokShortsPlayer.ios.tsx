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
  function send(o) { try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e) {} }
  // 2026-08-14(27차) 진단으로 실기기에서 확정(추측 아님): injectedJavaScript(페이지가 "완전히
  // 로드 끝남" 판정을 받은 뒤에만 주입되는 별도 prop)는 틱톡이 로딩 상태에 갇히면(반복 재현)
  // 그 판정이 영영 안 나서 **한 번도 실행되지 않았다** — 배너닫기/게이트통과/자동넘김 등 핵심
  // 로직 전부가 여기 있었는데 전부 죽어있던 것. 이 BeforeContentLoaded는 항상 실행되는 게
  // 로그로 확인됐으므로(아래 진단 라인), 핵심 로직을 전부 여기로 옮기고 "완전 로드"가 아니라
  // DOMContentLoaded(HTML 파싱 완료 시점 — 훨씬 이르고, 네트워크가 유휴 상태가 되길 기다리지
  // 않음) 시점에 실행한다. injectedJavaScript prop 자체는 이제 안 쓴다(중복 초기화 방지).
  send({ type: 'domlog', text: '🟡 BeforeContentLoaded 실행됨 t=' + Date.now() });
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
    var mo0 = new MutationObserver(function(){
      var list = document.querySelectorAll('video');
      for (var i = 0; i < list.length; i++) ensureInline(list[i]);
    });
    mo0.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch(e) {}

  function mainInit() {
  send({ type: 'domlog', text: '🟢 mainInit 시작(DOMContentLoaded 기준) t=' + Date.now() });
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
  // 있었다(3초마다 같은 로그 반복 = 진짜 모달은 그대로 안 닫힘).
  // ⚠️ 2026-08-13(20차) 코드 재검토로 발견(실기기 재현 전에 미리 잡음) — offsetParent===null 체크는
  // "화면에 안 보임"이 아니라 "레이아웃 흐름에서 빠짐"만 뜻한다. position:fixed 요소는 실제로
  // 화면 한가운데 떠 있는 모달이어도 offsetParent가 항상 null이다(스펙) — 로그인 모달이 흔한
  // position:fixed 오버레이라면, 이 체크가 **진짜 모달 버튼까지 전부 "안 보임"으로 오판해서
  // 걸러내고 있었을 수 있다.** getBoundingClientRect + computedStyle로 실제 크기·표시 여부를
  // 직접 확인하는 방식으로 교체 — position 방식과 무관하게 정확하다.
  function isVisible(el){
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false; // 접근성 전용 1px 텍스트 등은 계속 제외
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
      return true;
    } catch(e) { return true; }
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
        // 2026-08-13(24차) 웹서치로 확인(추측 아님) — 틱톡의 핑거프린팅 쿠키(msToken/ttwid 등)는
        // 페이지 자체 JS가 시간을 두고 생성한다("세션 생성 뒤 msToken 준비될 때까지 sleep 필요"가
        // 스크래핑 커뮤니티의 실측 관례). 우리가 로드 직후(1.5~3초)에 카테고리+계속을 눌러버리면
        // 그 토큰이 아직 안 만들어진 상태로 다음 영상 요청이 나가 "서버 오류"로 거부됐을 수 있다
        // (실기기 재현: 로그인벽은 통과했는데 그 다음 "영상을 불러올 수 없음"). 페이지 로드 후
        // 최소 6초는 그냥 기다렸다가 게이트를 넘는다 — 그 사이 하우스키핑의 다른 배너닫기는 계속
        // 동작(여긴 이 특정 관심사 게이트 통과 시도만 늦춘다).
        if (Date.now() - startedAt < 6000) {
          send({ type: 'domlog', text: '로그인모달 감지 — 토큰 생성 대기 중(' + Math.round((Date.now() - startedAt) / 1000) + 's)' });
          return false;
        }
        // 2026-08-13(21차) 실기기 콘솔 로그로 실제 버튼 목록을 확인(추측 아님): "계속 (0/3)",
        // "로그인", "대한민국", "서비스 약관", "개인정보 처리방침". "게스트로 보기"류 스킵 버튼은
        // 없다 — 이건 "카테고리를 최소 몇 개 고르면 계속 버튼이 활성화되는" 관심사 선택 게이트다.
        // "계속"만 클릭해선 (0/3)이라 진행이 안 될 수 있다. 모달 컨테이너 안에서 이 5개 알려진
        // 크롬 버튼이 아닌, 텍스트를 가진 "말단"(자식 엘리먼트 없는) 요소들을 카테고리 칩으로 보고
        // 몇 개 클릭한 뒤 "계속"을 누른다. ⚠️ "로그인"/OAuth류는 여전히 안 건드린다.
        try {
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          var textNode = null;
          while (walker.nextNode()) {
            if ((walker.currentNode.nodeValue || '').indexOf('무엇을 시청하고') !== -1) { textNode = walker.currentNode; break; }
          }
          var anchor = textNode ? textNode.parentElement : null;
          var modalRoot = null;
          // 2026-08-13(22차) — 이전엔 "버튼 1~14개"인 조상만 인정했는데, 실기기에서 세션마다
          // 모달 DOM 구조가 조금씩 달라(카테고리 칩이 button/a로 렌더될 때도 있는 듯) 그 범위를
          // 못 맞춰 "컨테이너 못 찾음"이 나기도 했다. 버튼 개수로 거르지 말고, "계속"/"로그인"
          // 텍스트를 실제로 포함한 첫 조상을 그대로 모달 루트로 쓴다 — 훨씬 관대하고 목적에 맞다
          // (우리가 찾는 건 "버튼이 적당히 있는 곳"이 아니라 "계속 버튼이 들어있는 곳").
          if (anchor) {
            var level = 0;
            var el2 = anchor;
            while (el2 && level < 8) {
              var txt3 = (el2.textContent || '');
              if (txt3.indexOf('계속') !== -1 || txt3.toLowerCase().indexOf('continue') !== -1) { modalRoot = el2; break; }
              el2 = el2.parentElement;
              level++;
            }
          }
          if (!modalRoot) {
            send({ type: 'domlog', text: '로그인모달 컨테이너 못 찾음(계속 텍스트 없음, anchor=' + (anchor ? anchor.tagName : 'null') + ')' });
          } else {
            var KNOWN_CHROME = ['계속', '로그인', '대한민국', '서비스 약관', '개인정보 처리방침', 'continue', 'log in', 'login'];
            var isKnownChrome = function(t){
              var lt = t.toLowerCase();
              for (var kc = 0; kc < KNOWN_CHROME.length; kc++) { if (lt.indexOf(KNOWN_CHROME[kc].toLowerCase()) !== -1) return true; }
              return false;
            };
            // 2026-08-13(23차) — children.length===0(순수 리프)만 인정했더니 0개였다(실기기 확인) —
            // 아이콘+텍스트를 함께 감싼 카테고리 칩이면 진짜 리프는 아이콘 뒤의 span 하나뿐이고,
            // 우리가 원하는 "칩 전체"는 그 부모일 수 있다. 대신 "자신과 완전히 같은 텍스트를 가진
            // 자손이 없는" 가장 안쪽 요소를 찾는다 — 래퍼 깊이가 몇 겹이든 실제 텍스트가 달린
            // 지점을 정확히 잡아낸다.
            var all = modalRoot.querySelectorAll('*');
            var chipCandidates = [];
            for (var a2 = 0; a2 < all.length; a2++) {
              var cand = all[a2];
              var ctxt = (cand.textContent || '').trim();
              if (!ctxt || ctxt.length > 12) continue; // 카테고리명은 짧다(동물/코미디 등)
              if (isKnownChrome(ctxt)) continue;
              if (!isVisible(cand)) continue;
              var kids2 = cand.querySelectorAll('*');
              var isWrapper = false;
              for (var w2 = 0; w2 < kids2.length; w2++) {
                if ((kids2[w2].textContent || '').trim() === ctxt) { isWrapper = true; break; }
              }
              if (isWrapper) continue;
              chipCandidates.push(cand);
            }
            send({ type: 'domlog', text: '카테고리칩 후보 ' + chipCandidates.length + '개: ' + chipCandidates.slice(0, 8).map(function(c){ return '"' + (c.textContent || '').trim() + '"'; }).join(', ') });
            if (chipCandidates.length === 0) {
              // 그래도 0개면 실제 마크업을 그대로 덤프해서 다음 라운드에 정확히 좁힌다.
              try { send({ type: 'domlog', text: '모달 HTML: ' + modalRoot.outerHTML.slice(0, 500) }); } catch(e) {}
            }
            var clickN = Math.min(3, chipCandidates.length);
            for (var c3 = 0; c3 < clickN; c3++) { try { chipCandidates[c3].click(); } catch(e) {} }
            if (clickN > 0) {
              send({ type: 'domlog', text: '카테고리 ' + clickN + '개 클릭함, 0.4초 뒤 계속 버튼 시도' });
              setTimeout(function(){
                try {
                  var btns2 = modalRoot.querySelectorAll('button, [role="button"], a');
                  for (var b2 = 0; b2 < btns2.length; b2++) {
                    var bt = (btns2[b2].textContent || '').trim();
                    if (isVisible(btns2[b2]) && bt.indexOf('계속') !== -1) { btns2[b2].click(); send({ type: 'domlog', text: '계속 버튼 클릭: ' + bt }); return; }
                  }
                } catch(e) {}
              }, 400);
            }
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
  // 2026-08-13(25차) 사장님 실기기 지적("포커스 오프인데도 영상이 계속 넘어감") — 유튜브는 FOCUS
  // OFF(isAutoMode=false)일 때 영상이 끝나면 멈추고 사용자를 기다리는데(feed/index.tsx의 onEnded:
  // isAutoMode면 goNext(), 아니면 setStatus('PAUSED')), 틱톡은 그 설정을 아예 모른 채 WebView
  // 안에서 자연종료를 감지하면 무조건 자기가 알아서 다음으로 넘겨버리고 있었다. RN에 "끝났다"고만
  // 알리고(send ended) 실제로 넘길지는 RN이 결정하게 한다 — 유튜브 플레이어와 똑같은 구조.
  // isAutoMode면 goNext()→advance()가 이 WebView의 tryAdvance를 다시 트리거하고(아래
  // window.paceForceAdvance 경로, 기존 그대로 재사용), 아니면 playing=false가 내려와 v.pause()로
  // 실제로 멈춘다. __paceAdvancing(tryAdvance 재시도 락)과는 별개 플래그를 쓴다 — 여기선 "끝남을
  // 이미 RN에 알렸는지"만 추적하고, 실제 이동 시도 여부/락은 paceForceAdvance 쪽이 따로 관리한다.
  function markEndedOnce(video){
    if (video.__paceEndedNotified) return false;
    video.__paceEndedNotified = true;
    return true;
  }
  function hookVideoEnded(video){
    if (!video || video.__paceEndedHooked) return;
    video.__paceEndedHooked = true;
    try { video.loop = false; } catch(e) {}
    video.addEventListener('ended', function(){
      if (!markEndedOnce(video)) return;
      send({ type: 'ended' });
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
    if ((nearEnd || loopedBack) && markEndedOnce(v)) { send({ type: 'ended' }); }
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

  // 2026-08-14(26차) — 사장님 실기기 재현: 로그인 모달은 안 뜨는데(우리 진단이 못 잡음) 틱톡이
  // "영상을 불러올 수 없음"/"서버 오류"를 보여줌. 이게 정확히 어떤 문구·버튼으로 나오는지 아직
  // 한 번도 캡처 못 했다 — 진단으로 한 번만 잡는다(클릭은 안 함, 순수 관측).
  var errorStateDumped = false;
  function dumpErrorStateOnce(){
    if (errorStateDumped) return;
    try {
      var bt = document.body.innerText || '';
      var markers = ['불러올 수 없', '서버 오류', '오류가 발생', '다시 시도', 'something went wrong', "couldn't load", 'error occurred'];
      for (var i = 0; i < markers.length; i++) {
        if (bt.toLowerCase().indexOf(markers[i].toLowerCase()) !== -1) {
          errorStateDumped = true;
          var idx = bt.toLowerCase().indexOf(markers[i].toLowerCase());
          send({ type: 'domlog', text: '🔴 에러상태 감지("' + markers[i] + '"): ' + bt.slice(Math.max(0, idx - 40), idx + 80).replace(/\n/g, ' ') });
          var btns = document.querySelectorAll('button, [role="button"], a');
          var found = [];
          for (var j = 0; j < btns.length && found.length < 8; j++) {
            if (!isVisible(btns[j])) continue;
            var t2 = (btns[j].textContent || '').trim();
            if (t2) found.push('"' + t2.slice(0, 20) + '"');
          }
          send({ type: 'domlog', text: '에러상태 버튼: ' + found.join(', ') });
          return;
        }
      }
    } catch(e) {}
  }

  function houseKeeping(){
    dismissAppBanner();
    dumpDomOnce();
    dumpErrorStateOnce();
    var href = '' + location.href;
    // ⚠️ 2026-08-13(20차) 코드 재검토로 발견 — search()가 /search?q=…로 이동시키면 그 결과 페이지는
    // 보통 썸네일 그리드라 자동재생 <video>가 없는 게 정상이다. 이 novideo 체크가 그걸 "재생 실패"로
    // 오판해 12초 뒤 onError(-2)를 보내고, feed/index.tsx의 handlePlayerError가 연속 6회로 세는
    // death-spiral 카운터를 매 사이클(3초 하우스키핑 반복 무관 — 1회만 보내지만)마다 결국 채워서
    // "Shorts를 불러오지 못했습니다" 화면을 띄울 수 있었다. 검색 결과 페이지에선 이 체크를 안 한다.
    var onSearchPage = href.indexOf('/search') !== -1;
    var noVideo = !document.querySelector('video');
    if (!onSearchPage && noVideo && (Date.now() - startedAt) > 12000 && !window.__paceNoVideoSent) {
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
  } // mainInit 끝

  // "완전 로드"가 아니라 DOMContentLoaded(또는 이미 그 시점을 지났으면 즉시) 기준으로 실행.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mainInit);
  } else {
    mainInit();
  }
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
        // 2026-08-14(28차) — injectedJavaScript(페이지 "완전 로드" 후 주입) prop을 더 이상 안 쓴다
        // — 핵심 로직 전부가 BeforeContentLoaded 안의 mainInit()(DOMContentLoaded 기준)로 옮겨감.
        injectedJavaScriptBeforeContentLoaded={INJECTED_JS_BEFORE_LOAD}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // 2026-08-14 되돌림 — sharedCookiesEnabled={false}로 바꾼 뒤 실기기에서 페이지 로딩
        // 자체가 영원히 안 끝나는 회귀가 났다(같은 폰 Safari로 tiktok.com은 정상 — 네트워크/틱톡
        // 서버는 멀쩡, WebView 설정 문제로 확정). "모바일 쿠키를 데스크톱 UA가 들고 있어 봇탐지에
        // 걸린다"는 가설 자체는 여전히 유효할 수 있지만, 끄는 구현이 다른 문제(아마 틱톡의 초기
        // 리다이렉트/동의 체인이 기존 쿠키 존재를 전제해 무한 대기)를 만든 것으로 보여 원복한다.
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
          } else if (msg.type === 'ended') {
            onEnded();
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
