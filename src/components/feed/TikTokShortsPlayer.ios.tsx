import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  isAllowedNavigation,
  sharedShortsPlayerStyles as styles,
  type ShortsPlayerHandle,
} from './sharedShortsPlayer';

// 2026-08-14(30차, 시뮬레이터 진단으로 발견) — requireOptionalNativeModule을 모듈 top-level에서
// 즉시 호출(예전 코드)하면 이 파일이 import되는 시점(앱 부트스트랩 초반, 네이티브 모듈 레지스트리가
// 아직 다 안 채워졌을 수 있는 시점)의 스냅샷이 최상위 const에 영구 캐시된다 — 그 시점에 아직
// "PaceGesture"가 없으면 null이 그대로 굳어 버려, 이후 모듈이 실제로 등록돼도 절대 안 바뀐다.
// (bluetoothService.ios.ts의 같은 호출은 화면 마운트 후 지연 호출이라 이 문제가 없었다 — 그래서
// 그쪽 로그는 찍히는데 여기 domlog만 처음부터 끝까지 단 한 줄도 안 찍히는 비대칭이 났다.)
// → 매번 다시 조회하는 함수로 바꿔 이 캐시 문제를 없앤다.
function getPaceGestureLog() {
  return requireOptionalNativeModule<{ nativeLog(msg: string): void }>('PaceGesture');
}

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
  /**
   * 2026-08-15 — 유튜브 쪽(YouTubeShortsPlayer.ios.tsx)에 넣은 것과 같은 목적: 이 WebView가
   * 콜드 스타트할 때 물리 무음 스위치 상태를 미리 알려줘서, RN의 첫 checkSilentSwitch() 응답
   * (200~300ms 비동기)이 오기 전에 새 video가 TikTok 기본 상태(대개 muted=false)로 잠깐 소리
   * 내며 재생되는 걸 막는다. window.__paceMuted를 이 값으로 미리 세팅한 뒤 나머지 스크립트를
   * 붙인다 — onLoadStart/onLoad 재주입(아래, 실기기에서 동작 확인됨)과
   * injectedJavaScriptBeforeContentLoaded prop(이 환경에서 실행 안 될 수 있다고 기록돼 있었으나
   * 2026-08-15 유튜브 쪽에서 domlog(__PACE_DIAG__ 게이트)가 실제로 찍히는 걸 확인해 그 기록이
   * RNW 16.0.0 업그레이드 이전 것일 가능성이 높음 — 안전하게 양쪽 다 세팅) 양쪽에 다 쓴다.
   */
  initialMuted?: boolean;
};

const INJECTED_JS_BEFORE_LOAD = `
(function() {
  // 2026-08-14(31차) — injectedJavaScriptBeforeContentLoaded prop이 이 환경(RNW 13.16.1 +
  // Fabric)에서 실행 안 되는 걸 시각적 테스트로 확정한 뒤, 컴포넌트 쪽에서 onLoadStart/onLoad마다
  // imperative injectJavaScript(ref)로 이 스크립트를 재주입하도록 바꿨다 — 그 결과 같은 문서에
  // 이 스크립트가 여러 번 들어올 수 있다(중복 setInterval 등록 방지 필요).
  if (window.__paceTikTokInit) return;
  window.__paceTikTokInit = true;
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
    // 2026-08-14(32차) — webkitEnterFullscreen(구식 API)과 별개로, 최신 WebKit은
    // webkitSetPresentationMode('fullscreen'/'picture-in-picture')라는 AVKit 연동 API를 따로
    // 갖고 있다. 사이트가 자체 "극장 모드"/커스텀 전체화면 버튼에 이걸 직접 쓰면 위 오버라이드로는
    // 안 잡힌다 — 같이 막는다.
    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.webkitSetPresentationMode) {
      HTMLVideoElement.prototype.webkitSetPresentationMode = function(){};
    }
  } catch(e) {}
  // 2026-08-14(29차, 시뮬레이터로 재현 확정) — 위 webkitEnterFullscreen 오버라이드 +
  // createElement/play() 가로채기(둘 다 이미 있었음)로도 여전히 네이티브 전체화면이 뚫렸다.
  // 이유: webkitEnterFullscreen 오버라이드는 "페이지가 그 JS 메서드를 직접 호출하는" 경로만
  // 막는다 — WKWebView 엔진이 재생 시작 시 playsinline 부재를 보고 **자체적으로** 승격을
  // 결정하는 건 JS 메서드 호출이 아니라 엔진 내부 로직이라 이 오버라이드로 안 잡힌다. 또한
  // 비디오가 innerHTML로 삽입되고 autoplay 속성만으로 재생되면 createElement도 play()도 안
  // 거친다. → 진입을 막는 대신, 진입한 "순간"을 이벤트로 잡아 **즉시 되돌린다**(어떤 경로로
  // 들어갔든 상관없이 동작 — 커뮤니티에 알려진 WKWebView 우회 패턴).
  try {
    document.addEventListener('webkitbeginfullscreen', function(ev) {
      try { send({ type: 'domlog', text: '🟠 네이티브 전체화면 진입 감지(이벤트) → 즉시 해제' }); } catch(e2) {}
      try { ev.target && ev.target.webkitExitFullscreen && ev.target.webkitExitFullscreen(); } catch(e2) {}
    }, true);
  } catch(e) {}
  // 2026-08-14(30차, 시뮬레이터로 확정) — 위 이벤트 리스너를 달아도 실제로 전체화면에 들어간 뒤
  // (WebKit 네이티브 로그로 didBecomeFullscreenElement 확인) 빠져나오는 시도 자체가 한 번도
  // 안 잡혔다 — 최신 WebKit의 AVPlayerViewController 기반 전체화면 구현에서는
  // 'webkitbeginfullscreen' 이벤트가 우리 기대와 다르게 동작하는 것으로 보인다(버블링/캡처
  // 여부가 예전 구현과 다를 수 있음). 이벤트에 기대는 대신 **상태를 직접, 짧은 주기로 감시**해서
  // 확실하게 잡는다 — video.webkitDisplayingFullscreen은 실제 네이티브 전체화면 표시 여부를
  // 그대로 반영하는 읽기전용 프로퍼티라 이벤트 발화 여부와 무관하게 항상 정확하다.
  try {
    setInterval(function() {
      try {
        var vids = document.querySelectorAll('video');
        for (var i = 0; i < vids.length; i++) {
          var v = vids[i];
          var inFullscreen = v.webkitDisplayingFullscreen || (v.webkitPresentationMode && v.webkitPresentationMode !== 'inline');
          if (inFullscreen) {
            send({ type: 'domlog', text: '🟠 전체화면 감시(폴링)로 감지(mode=' + v.webkitPresentationMode + ') → 해제 시도' });
            ensureInline(v);
            try { v.webkitExitFullscreen(); } catch(e2) {}
            try { if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('inline'); } catch(e2) {}
          }
        }
      } catch(e2) {}
    }, 250);
  } catch(e) {}
  function ensureInline(v){ try { v.setAttribute('playsinline','true'); v.setAttribute('webkit-playsinline','true'); v.playsInline = true; } catch(e) {} }
  // 2026-08-14(실기기 재현) — MutationObserver로 나중에 playsinline을 붙이는 방식은 **비동기라
  // 진다**: 틱톡이 같은 틱(synchronous)에서 <video>를 만들고 바로 .play()를 부르면, WKWebView
  // 엔진은 그 순간의 DOM 속성(playsinline 없음)만 보고 즉시 네이티브 전체화면으로 승격한다 —
  // MutationObserver 콜백은 그 뒤(다음 마이크로태스크)에나 도착해 이미 늦는다. 네이티브
  // 전체화면은 RN 뷰 트리 전체(P버튼 포함)를 덮는 모달이라, 이게 실기기에서 "같은 영상 반복 +
  // P메뉴 실종"의 실제 원인이었다(웹서치 확인: WKWebView는 playsinline 부재 시 자동 승격이 JS로
  // 가로챌 수 있는 메서드 호출이 아니라 엔진 내부 결정이라 webkitEnterFullscreen 오버라이드로도
  // 못 막음). → video 엘리먼트가 **생성되는 그 순간**(createElement)과 **play()가 불리는 그
  // 순간** 둘 다에서 동기적으로 playsinline을 강제한다 — 레이스 자체를 없앤다. MutationObserver는
  // innerHTML 등 createElement를 안 거치는 경로를 위한 3중 안전망으로 유지.
  try {
    var origCreateElement = document.createElement;
    document.createElement = function(tagName) {
      var el = origCreateElement.apply(document, arguments);
      try { if (String(tagName).toLowerCase() === 'video') ensureInline(el); } catch(e) {}
      return el;
    };
  } catch(e) {}
  try {
    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.play) {
      var origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        ensureInline(this);
        return origPlay.apply(this, arguments);
      };
    }
  } catch(e) {}
  try {
    var mo0 = new MutationObserver(function(){
      var list = document.querySelectorAll('video');
      for (var i = 0; i < list.length; i++) {
        ensureInline(list[i]);
        // 2026-08-15 사장님 실기기 재보고("전환될 때 소리 잠깐 남, 니가 고친 500ms 안전망도 아직
        // 들림") — 폴링(500ms든 tryAdvance든)은 새 video가 이미 재생을 시작한 "뒤"에야 따라잡아
        // 그 틈만큼 소리가 샌다. 이 MutationObserver는 새 <video> 요소가 DOM에 **삽입되는 그 순간**
        // (재생 시작 전, playsinline 강제와 같은 타이밍)에 발화하므로, 여기서 무음을 걸면 TikTok
        // 자신의 첫 play() 호출보다 항상 먼저 적용된다 — 폴링 지연 자체가 없어진다.
        if (typeof window.__paceMuted === 'boolean') { try { list[i].muted = window.__paceMuted; } catch(e2) {} }
      }
    });
    mo0.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch(e) {}
  // 2026-08-15 — 위 MutationObserver는 "새로" 삽입되는 video만 잡는다. TikTok이 기존 <video>
  // 요소를 재사용(같은 엘리먼트를 다음 슬라이드에 재활용)하면 삽입 이벤트가 없어 못 잡는다 — play
  // 이벤트를 캡처 단계(capture: true, 버블링을 안 기다려 가장 먼저 실행)로 문서 전체에 걸어 두 번째
  // 안전망을 둔다. 이것도 500ms 폴링보다 훨씬 빠르다(이벤트 자체가 발화 즉시 동기 실행).
  try {
    document.addEventListener('play', function(ev){
      var t = ev.target;
      if (t && t.tagName === 'VIDEO' && typeof window.__paceMuted === 'boolean' && t.muted !== window.__paceMuted) {
        t.muted = window.__paceMuted;
      }
    }, true);
  } catch(e) {}

  function mainInit() {
  send({ type: 'domlog', text: '🟢 mainInit 시작(DOMContentLoaded 기준) t=' + Date.now() });
  // 🔴 2026-08-15 사장님 지적("사람아이콘 눌르면 팔로우 화면이 왜 짤려", "세로줄로 메뉴 뜨는거
  // 맞아?") — 2026-08-12 QA_MATRIX에 이미 "알려진 부작용, 후속 작업"으로 기록돼 있던 항목이다:
  // 자동넘김을 살리려고 의도적으로 데스크톱 UA를 쓰는데(위 userAgent prop 주석 참고 — 모바일 UA는
  // 자동넘김이 1회 이동 후 영구 고착됐었다), 그 대가로 틱톡 데스크톱 UI(왼쪽 세로 사이드바 —
  // 추천/탐색/팔로잉/라이브 등)가 그대로 딸려나와 좁은 화면에서 팔로우 같은 하위 페이지가 눌려
  // 잘렸다. 실측(data-e2e 덤프)으로 확정한 컨테이너를 CSS로 숨긴다 — 유튜브 플레이어가 이미 하는
  // 것과 같은 패턴(불필요 UI를 injected CSS로 제거). class 앞부분(css-xxxxxx)은 빌드마다 바뀌는
  // 해시라 *= 부분일치로 뒤쪽 안정적인 컴포넌트명(DivHeaderContainer)만 잡는다.
  // 실측(data-e2e="nav-following" 조상 체인, 2회 시도 끝에 확정)으로 찾은 진짜 사이드바 컨테이너들.
  // DivSideNavContainer=보이는 아이콘 목록, DivSideNavPlaceholderContainer=레이아웃에서 그만큼
  // 폭을 미리 비워두는 자리표시자 — 아이콘만 숨기고 이걸 안 숨기면 빈 공간만 남아 영상이 여전히
  // 안 차므로 둘 다 숨긴다. 1차 시도(DivHeaderContainer, 로고 조상 기준)는 실기기 스크린샷으로
  // 실패 확정됨(로고와 세로 아이콘 목록이 다른 하위트리였다) — 지금 건 실제로 확인된 값.
  // ⚠️ /following 등 하위 화면(팔로우 추천 카드 그리드)이 좁은 화면 왼쪽 절반만 쓰고 나머지가
  // 까맣게 남는 별도 증상도 있다(실측 확인) — DivMainContainer/DivUserListWrapper에 width:100%를
  // 강제해봤지만 실기기/시뮬레이터 재검증 결과 효과 없었다(그리드 트랙이 고정 px로 박혀있을
  // 가능성이 맞았다 — 진짜 원인·수정은 아래 fixNarrowCardGrid() 참고).
  // 🔴 2026-08-15(2차) — 위 클래스명 셀렉터(DivSideNavContainer)는 /foryou·/explore(같은 SPA
  // 라우트)에서만 통했다. /live로 들어가면 완전히 다른 클래스 체계(실측: tiktok-1w5o2is,
  // tiktok-13e8rmi, eyxny660 등 — 뒤에 안정적인 컴포넌트명이 안 붙는 순수 해시라 *= 매칭 자체가
  // 불가능)를 써서 사이드바가 그대로 노출됐다(실기기 확인). "화면 위에 검은 View를 고정폭으로
  // 덮어씌우자"는 대안도 시도했지만 /explore처럼 이미 리플로우가 된 페이지에서 정상 콘텐츠(첫
  // 카테고리 탭)까지 잘라먹는 새 부작용을 냄 — 되돌림. 최종: 클래스명이 아니라 **기하학적
  // 특징**(왼쪽 끝에 붙어있고 화면 세로 대부분을 차지하는 좁은 컬럼)으로 찾아 숨긴다 — /live
  // 실측치(width 72~200px, height 652~812px)와 /foryou의 DivSideNavContainer가 공통으로 갖는
  // 패턴이라 클래스명이 또 바뀌어도 안 깨진다. <video>를 담고 있는 컨테이너는 절대 안 숨기게
  // 방어(실제 영상 컬럼이 우연히 이 기준에 걸리는 사고 방지). mainInit에서 1회 + houseKeeping에서
  // 매 틱(자가치유, SPA 라우트 전환 대응) 둘 다 호출.
  function hideLeftRailByGeometry(){
    try {
      var vh = window.innerHeight || 0;
      if (!vh) return;
      var all = document.querySelectorAll('div');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.style && el.style.display === 'none') continue;
        var r = el.getBoundingClientRect();
        if (r.left > 4 || r.width <= 0 || r.width > 220) continue;
        if (r.height < vh * 0.5) continue;
        if (el.querySelector('video')) continue;
        el.style.setProperty('display', 'none', 'important');
      }
    } catch(eGeo) {}
  }
  hideLeftRailByGeometry();
  // 🔴 2026-08-15(3차) — /following 카드 그리드가 왼쪽 절반만 쓰고 나머지가 까맣게 남는 문제,
  // 실측(팔로우 버튼 조상 체인의 getComputedStyle 덤프)으로 원인 확정: 카드 리스트 컨테이너
  // (MAIN 바로 아래 DIV.ey5qmgg0, 실측 w=420 — 뷰포트 402와 거의 같음, 즉 컨테이너 자체는 이미
  // 전체 폭)의 직계 자식 카드(DIV.ey5qmgg1)가 데스크톱 그리드용 고정 픽셀 폭(실측 w=226)을 그대로
  // 갖고 있다. 420px 컨테이너에 226px 카드는 1개만 들어가고 나머지 194px가 빈 채(까맣게) 남는다 —
  // "그리드"가 아니라 flex-wrap이 1개씩만 줄바꿈한 것. 이전 시도(DivMainContainer/
  // DivUserListWrapper에 width:100%)가 안 먹혔던 이유는 컨테이너가 아니라 **카드 자체의 고정폭**이
  // 원인이었기 때문 — 컨테이너를 아무리 늘려도 카드가 226px를 고집하면 그대로다.
  // 1차 시도: 클래스명 대신 기하학(형제 폭 동일 + 부모의 60%↑)으로 찾아 47% 강제 — 실기기/
  // 시뮬레이터 재검증 결과 안 먹힘(스크린샷 동일) — 카드가 직계 자식이 아니라 한 단계 더 감싸는
  // wrapper 뒤에 있어 조건에 안 걸린 것으로 추정, 되돌림. 2차(현재): 지금 실측으로 확인된 실제
  // 클래스명(ey5qmgg0=행 컨테이너, ey5qmgg1=카드)을 직접 지정 — /live처럼 접미사 없는 순수 해시라
  // 다음 틱톡 배포에서 바뀌면 깨질 수 있음(이미 DivSideNavContainer 등에서 감수 중인 것과 같은
  // 트레이드오프). 행 컨테이너를 grid로 바꾸고 카드 폭을 auto로 풀어 그리드 트랙이 폭을 정하게 한다.
  try {
    var gridFixStyle = document.createElement('style');
    gridFixStyle.textContent =
      '[class*="ey5qmgg0"]{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:8px!important}' +
      '[class*="ey5qmgg1"]{width:auto!important;max-width:none!important}';
    (document.head || document.documentElement).appendChild(gridFixStyle);
  } catch(eGridFix) {}
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
      // 🔴 2026-08-15 사장님 실기기 재현("검색하고 영상 고르면 잠깐 보였다 꺼짐") — 실기기 로그로
      // 확정: 검색결과에서 영상을 열면(URL은 /video/...로 바뀌지만 검색 패널 DOM은 안 없어짐) 그
      // 검색 패널 소속 "닫기" 버튼이 이 aria-label 셀렉터에 걸려서 하우스키핑이 **우리가 방금 연
      // 영상을 스스로 닫아버렸다**(클릭→그 직후 검색화면으로 돌아간 게 "잠깐 보였다 꺼짐").
      // 1차 시도(현재 URL에 /search 포함 여부로 판단)는 실패 확정 — URL이 이미 /video/...로 바뀐
      // 뒤였다. 대신 후보 자신의 조상 DOM 클래스명에 "search"가 있는지로 직접 걸러낸다(실측 로그로
      // 확정된 진짜 신호 — ancestors=...DivSearch...). 검색 패널 소속이 아닌 진짜 앱설치 배너의
      // 닫기 버튼은 이 필터에 안 걸린다.
      var closeCandidates = document.querySelectorAll('[aria-label="Close"], [aria-label="닫기"], [aria-label="close"], [aria-label*="skip" i], [aria-label*="건너뛰기"]');
      for (var ci = 0; ci < closeCandidates.length; ci++) {
        var cand = closeCandidates[ci];
        if (!isVisible(cand)) continue;
        var isSearchUiChrome = false;
        var ancFilter = cand;
        for (var af = 0; af < 8 && ancFilter; af++) {
          if (/search/i.test(String(ancFilter.className || ''))) { isSearchUiChrome = true; break; }
          ancFilter = ancFilter.parentElement;
        }
        if (isSearchUiChrome) {
          send({ type: 'domlog', text: '배너닫음(aria-label) 건너뜀(검색패널 소속): ' + (cand.getAttribute('aria-label') || '') });
          continue;
        }
        cand.click();
        send({ type: 'domlog', text: '배너닫음(aria-label): ' + (cand.getAttribute('aria-label') || '') });
        return true;
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
          // 2026-08-15 실기기 발견(추측 아님, 로그로 확정) — 이 TreeWalker가 SHOW_TEXT로 body 전체를
          // 훑는데, <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">의 텍스트 콘텐츠(SSR 하이드레이션용
          // JSON, 화면엔 안 보임)도 DOM상 엄연한 텍스트 노드라 같이 걸린다. 이 JSON이 모달 문구를
          // 데이터로도 들고 있어서(다국어 리소스 등) 실제 눈에 보이는 모달보다 먼저(문서상 앞쪽에
          // 있어서) 매칭돼버렸다 — 그 결과 anchor가 <script> 안이라 카테고리 칩이 매번 0개로 나오고
          // 게이트를 영원히 못 넘었다("사용약관"이 뭐냐는 질문도 이 로그인 게이트 자체를 보고 하신
          // 것 — 그 모달 하단 고정 링크 중 하나). script/style/보이지 않는 조상은 걸러내고, 매칭된
          // anchor가 실제로 안 보이면 계속 다음 후보를 찾는다.
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
              var p = node.parentElement;
              while (p) {
                var tag = p.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
                p = p.parentElement;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          var textNode = null;
          while (walker.nextNode()) {
            var cur = walker.currentNode;
            if ((cur.nodeValue || '').indexOf('무엇을 시청하고') !== -1 && cur.parentElement && isVisible(cur.parentElement)) {
              textNode = cur; break;
            }
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
      if (nowActive && nowActive !== video) {
        video.__paceAdvancing = false;
        // 2026-08-15 실기기 발견("FOCUS ON인데 다음 영상으로 안 넘어감", "소리가 나왔다 안
        // 나왔다") — 슬라이드 DOM은 실제로 옮겨갔는데(nowActive가 바뀜) 새 video가 그냥
        // 멈춰 있는 경우가 있었다. 여기까지는 goToNext()의 합성 스크롤/포인터/터치 이벤트가
        // 트리거지, 틱톡 자신의 재생 로직이 항상 같이 따라온다는 보장이 없다 — 그래서
        // 화면상으론 "안 넘어감"(그대로 멈춘 이전 프레임)으로 보이고, 어떤 영상은 재생되고
        // 어떤 건 멈춰만 있으니 "소리가 나왔다 안 나왔다"로 체감된 것도 같은 원인일 수 있다.
        // → 전환 성공을 확인한 시점에 새 video가 paused면 명시적으로 play()를 부른다. 이
        // 시점은 이미 이전의 진짜 사용자 탭으로 페이지 전체가 자동재생 허용을 받은 뒤라
        // (WebKit 자동재생 정책은 엘리먼트가 아니라 페이지/문서 단위) muted 여부와 무관하게
        // 통과할 것으로 기대한다.
        // 2026-08-15 실기기 재보고("소리가 잠깐 나고 안 나는 걸로 바뀜") — 새 video가 자기 자신의
        // 기본 muted 상태(대개 false, 즉 소리 있음)로 재생을 시작해서, RN의 무음스위치 폴링(최대
        // 2초 주기, setMuted 프로퍼티 참고)이 따라잡기 전까지 잠깐 소리가 샜다. window.__paceMuted
        // (RN이 setMuted를 부를 때마다 최신값 저장)를 play() 전에 즉시 적용해 그 틈을 없앤다.
        try {
          ensureInline(nowActive);
          if (typeof window.__paceMuted === 'boolean') nowActive.muted = window.__paceMuted;
          var wasPaused = nowActive.paused;
          if (wasPaused) nowActive.play().catch(function(){});
          send({ type: 'domlog', text: '자동넘김: 전환 성공, wasPaused=' + wasPaused + ' muted=' + nowActive.muted });
        } catch(e2) {}
        return;
      }
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
    // 2026-08-15 사장님 실기기 지적("틱톡 소리 안나다 한번씩 소리나던데 간헐적으로") — tryAdvance의
    // "전환 확인 후 window.__paceMuted 적용"(위 452줄)만으론 안 됐다. 그 확인은 goToNext() 뒤
    // 첫 폴링 틱(700ms)에야 도는데, 그 전에 새 video가 TikTok 자체 기본 상태(대개 muted=false)로
    // 이미 재생을 시작해버리면 그 700ms(최악 재시도 누적 시 최대 4.2초) 동안 소리가 샌다 — 유튜브
    // 스와이프 모드에 있던 "500ms 안전망"이 틱톡엔 없었다(이 폴링은 진행률/종료 감지만 했음). 이미
    // 500ms마다 도는 이 함수에 강제도 얹어 새는 창을 최대 500ms로 좁힌다.
    if (typeof window.__paceMuted === 'boolean' && v.muted !== window.__paceMuted) {
      send({ type: 'domlog', text: '무음안전망(500ms): muted ' + v.muted + '→' + window.__paceMuted + '로 보정' });
      v.muted = window.__paceMuted;
    }
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
          send({ type: 'domlog', text: '🔴 에러상태 감지("' + markers[i] + '"): ' + bt.slice(Math.max(0, idx - 40), idx + 80).replace(/\\n/g, ' ') });
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
    hideLeftRailByGeometry();
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
  // 2026-08-15 — "현재 영상 즐겨찾기 추가"(iOS는 useShortsQueueStore.current로 읽던 유튜브 전용
  // 경로라 틱톡에선 vid가 항상 null이라 조용히 아무 일도 안 났다. 안드는 extractTikTokVideo로
  // 자체 해결했지만(캡처 액티비티가 접근성 트리에서 URL을 긁음), iOS는 그 경로 자체가 없다 — 여기,
  // 우리가 이미 "지금 보이는 video"를 알고 있는 WebView 안에서 직접 permalink를 찾는 게 가장
  // 정확하다. 틱톡 영상 카드엔 정식 공유 링크(/@user/video/1234...)가 DOM 어딘가(공유 버튼 data,
  // 혹은 슬라이드 안 앵커)에 항상 박혀 있다 — 활성 video의 조상을 슬라이드 경계까지 올라가며 그
  // 패턴의 <a href>를 찾는다. RN이 injectJavaScript로 이걸 부르고 postMessage로 결과를 돌려받는
  // 요청/응답 구조(paceForceAdvance와 달리 값을 되돌려줘야 해서 별도 메시지 타입 필요).
  window.paceGetCurrentVideoUrl = function(){
    try {
      var v = getActiveVideo();
      if (!v) { send({ type: 'currentVideoUrl', url: null }); return; }
      // ⚠️ 이 파일 전체가 큰 템플릿 리터럴 문자열이라(INJECTED_JS_BEFORE_LOAD), 정규식 안의 백슬래시
      // escape는 반드시 두 배로 써야 살아남는다 — 한 배로 쓰면 템플릿 리터럴이 "인식 못하는 이스케이프
      // 시퀀스"로 보고 백슬래시를 조용히 삭제해 정규식이 깨진다. 이 주석 안에도 실제 백슬래시 시퀀스를
      // 예시로 적으면 안 된다(주석도 같은 문자열의 일부라 똑같이 잘려나간다 — 직접 겪은 버그).
      // 앞서 다른 곳(에러상태 문자열 개행 제거)에서 못 잡았던 나머지 인스턴스를 여기서 전수 수정.
      var VIDEO_LINK_RE = /\\/@[\\w.-]+\\/video\\/\\d+/;
      function findIn(root){
        if (!root || !root.querySelectorAll) return null;
        var links = root.querySelectorAll('a[href*="/video/"]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          if (VIDEO_LINK_RE.test(href)) return href.indexOf('http') === 0 ? href : ('https://www.tiktok.com' + href);
        }
        return null;
      }
      // 2026-08-15(3차) — 실기기+시뮬레이터 둘 다로 확정: 틱톡 "추천" 피드는 슬라이드 안에 <video>
      // 하나뿐이고 그 어디에도 /video/ 링크 자체가 없다(진단 덤프로 실물 확인). 대신 data-e2e 훅
      // 목록에 recommend-list-item-container(컨테이너)/video-author-avatar(작성자)가 실존한다 —
      // 이 컨테이너의 id가 곧 영상의 숫자 ID라는 게 TikTok 웹의 잘 알려진 DOM 패턴이라, 그걸로
      // 작성자 링크와 조합해 정식 permalink를 재구성한다. 못 맞으면(구조 변경 등) 아래에서 여전히
      // 진단 로그를 남긴다.
      // 2026-08-15(4차, 실기기+시뮬레이터 진단으로 확정) — container.id는 "one-column-item-0"
      // 같은 화면상 순번이지 영상 숫자ID가 아니었다(잘 알려진 패턴이라던 가정이 틀림, 실물 덤프로
      // 확인). 대신 작성자 링크(href="/@username")는 확실히 뽑힌다 — 그 username으로 SSR
      // 하이드레이션 JSON(__UNIVERSAL_DATA_FOR_REHYDRATION__, 로그인게이트 조사 때 이미 실존 확인한
      // 그 script 태그)을 훑어 author.uniqueId가 같은 아이템을 찾아 진짜 id를 가져온다 — 정확한
      // JSON 경로를 모르니 구조를 안 타고 값 자체로 재귀 탐색(구조가 바뀌어도 덜 깨지게).
      function findVideoIdByUsername(username){
        try {
          var script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (!script) return null;
          var data = JSON.parse(script.textContent || script.innerText || '{}');
          var found2 = null;
          var seen = [];
          function walk(node, depth){
            if (found2 || !node || typeof node !== 'object' || depth > 12 || seen.indexOf(node) !== -1) return;
            seen.push(node);
            if (node.author && (node.author.uniqueId === username) && node.id && /^\\d+$/.test(String(node.id))) {
              found2 = String(node.id);
              return;
            }
            for (var key in node) {
              if (found2) return;
              walk(node[key], depth + 1);
            }
          }
          walk(data, 0);
          return found2;
        } catch(eJ) { return null; }
      }
      function findByContainerId(){
        var container = v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
        if (!container) return null;
        var authorWrap = container.querySelector('[data-e2e="video-author-avatar"]');
        var username = null;
        if (authorWrap) {
          var a = authorWrap.tagName === 'A' ? authorWrap : authorWrap.querySelector('a');
          var href = a ? a.getAttribute('href') : null;
          var m = href ? href.match(/\\/@([\\w.-]+)/) : null;
          if (m) username = m[1];
          if (!username) {
            var img = authorWrap.querySelector('img');
            var alt = img ? (img.getAttribute('alt') || '') : '';
            var m2 = alt.match(/@([\\w.-]+)/);
            if (m2) username = m2[1];
          }
        }
        if (!username) return null;
        var vid = findVideoIdByUsername(username);
        if (!vid) return null;
        return 'https://www.tiktok.com/@' + username + '/video/' + vid;
      }
      var found = null;
      try { found = findByContainerId(); } catch(eC) {}
      // 슬라이드 경계(있으면)까지만 올라간다 — 그 밖(사이드바 등)의 다른 영상 링크를 잘못 줍지 않게.
      var slide = v.closest ? v.closest('.swiper-slide') : null;
      if (!found) { try { found = findIn(slide) || findIn(v.parentElement) || findIn(v.closest ? v.closest('article') : null) || findIn(document.body); } catch(e0) {} }
      // 2026-08-15 진단(실기기+시뮬레이터 재현: getCurrentVideoUrl이 항상 null) — <a href> 방식이
      // 실제 DOM에서 안 잡힌다. SPA가 흔히 갱신하는 og:url/canonical 메타도 같이 시도, 그래도
      // 없으면 실제 DOM이 어떻게 생겼는지 직접 덤프한다(추측 그만하고 실물을 본다).
      if (!found) {
        try {
          var og = document.querySelector('meta[property="og:url"]');
          var canon = document.querySelector('link[rel="canonical"]');
          var metaUrl = (og && og.getAttribute('content')) || (canon && canon.getAttribute('href')) || null;
          if (metaUrl && VIDEO_LINK_RE.test(metaUrl)) found = metaUrl;
        } catch(e1) {}
      }
      if (!found) {
        try {
          var anyVideoLinks = document.querySelectorAll('a[href*="/video/"]');
          send({ type: 'domlog', text: '즐겨찾기: URL못찾음. loc=' + location.href + ' /video/링크=' + anyVideoLinks.length });
        } catch(e2) {}
        try {
          var dbgContainer = v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
          var dbgAuthor = dbgContainer ? dbgContainer.querySelector('[data-e2e="video-author-avatar"]') : null;
          send({ type: 'domlog', text: '즐겨찾기: container.id=' + (dbgContainer ? dbgContainer.id : 'null') + ' authorHTML(300)=' + (dbgAuthor ? dbgAuthor.outerHTML.slice(0, 300) : 'null') });
        } catch(e6) {}
        // 2026-08-15(2차) — 슬라이드 안엔 <video> 하나뿐이라 링크 방식 자체가 안 통한다는 걸
        // 확인했다(700자 덤프로 실물 확인). 링크가 아니라 data-e2e 훅(틱톡이 자동화테스트/분석용으로
        // 붙이는 안정적 속성)을 뒤져서 실제로 뭐가 있는지 목록화 — 다음 라운드에 정확한 셀렉터를
        // 잡기 위한 정찰. 어떤 값이 실존하는지 전혀 모르니 값 자체를 그대로 로그로 남긴다.
        try {
          var e2eEls = document.querySelectorAll('[data-e2e]');
          var e2eVals = [];
          for (var q = 0; q < e2eEls.length && e2eVals.length < 40; q++) {
            var val = e2eEls[q].getAttribute('data-e2e');
            if (val && e2eVals.indexOf(val) === -1) e2eVals.push(val);
          }
          send({ type: 'domlog', text: '즐겨찾기: data-e2e 목록(' + e2eVals.length + '): ' + e2eVals.join(', ') });
        } catch(e5) {}
        try {
          var dumpRoot = slide || v.parentElement || document.body;
          // 부모로 3단계 더 올라가 액션바(좋아요/댓글/공유/유저명)가 포함될 만한 범위로 넓힌다.
          for (var up = 0; up < 3 && dumpRoot.parentElement; up++) dumpRoot = dumpRoot.parentElement;
          send({ type: 'domlog', text: '즐겨찾기: 슬라이드HTML(900자): ' + (dumpRoot.outerHTML || '').slice(0, 900) });
        } catch(e3) {}
      }
      send({ type: 'currentVideoUrl', url: found });
    } catch(e) {
      try { send({ type: 'domlog', text: '즐겨찾기: 예외 ' + (e && e.message) }); } catch(e4) {}
      send({ type: 'currentVideoUrl', url: null });
    }
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
  { playing, onEnded, onReady, onError, onProgress, initialMuted }: Props,
  ref
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  // 2026-08-15 — getCurrentVideoUrl()의 요청/응답 다리. injectJavaScript는 결과를 동기로 못
  // 돌려주므로(fire-and-forget), 요청 시점에 여기 resolver를 심어두고 onMessage의
  // 'currentVideoUrl'이 도착하면 그걸로 resolve한다. 동시에 하나만 진행 가능(현재 영상 하나에
  // 대한 요청이라 실제로 겹칠 일이 없음) — 새 요청이 오면 이전 걸 null로 흘려보낸다.
  const currentVideoUrlResolverRef = useRef<((url: string | null) => void) | null>(null);

  // 유튜브 플레이어와 같은 handle 시그니처를 맞추되, 틱톡은 큐레이션이 없어 advance/previous가
  // 스와이프 큐 이동이 아니라 "지금 재생 중인 video에 대해 다음 영상 시도"를 직접 트리거한다
  // (BT 리모컨/볼륨키 입력에서 재사용). previous는 대응하는 방법이 없어 no-op.
  useImperativeHandle(ref, () => ({
    advance: () => {
      webRef.current?.injectJavaScript('window.paceForceAdvance && window.paceForceAdvance(); true;');
    },
    previous: () => {},
    setMuted: (muted) => {
      // window.__paceMuted에도 저장 — 자동넘김(tryAdvance)이 새 video로 옮겨간 직후 이 값을
      // 즉시 적용해야, RN의 다음 무음스위치 폴링(최대 2초)까지 잠깐 소리가 새는 걸 막는다.
      webRef.current?.injectJavaScript(`(function(){window.__paceMuted=${muted};var v=document.querySelector('video'); if(v){v.muted=${muted};}})();true;`);
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
    // __DEV__ 전용 — sharedShortsPlayer.ts의 타입 주석 참고. 실제 손가락 탭과 똑같이 진짜 <a> 요소의
    // .click()을 호출한다(합성 이벤트가 아니라 그 엘리먼트의 실제 클릭 핸들러 체인을 그대로 태움).
    debugClickFirstSearchResult: () => {
      webRef.current?.injectJavaScript(`(function(){
        try {
          var links = document.querySelectorAll('a');
          var found = null;
          for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (href.indexOf('/video/') !== -1) { found = links[i]; break; }
          }
          if (found) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭: ' + found.getAttribute('href') }));
            found.click();
          } else {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭: /video/ 링크 못 찾음, a태그 ' + links.length + '개' }));
          }
        } catch(e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭 실패: ' + e.message }));
        }
      })(); true;`);
    },
    debugClickByDataE2E: (name) => {
      webRef.current?.injectJavaScript(`(function(){
        try {
          var el = document.querySelector('[data-e2e="${name}"]');
          if (el) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭(e2e=${name}): 찾음, href=' + (el.getAttribute('href')||'') }));
            el.click();
          } else {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭(e2e=${name}): 못 찾음' }));
          }
        } catch(e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭(e2e=${name}) 실패: ' + e.message }));
        }
      })(); true;`);
    },
    // "현재 영상 즐겨찾기 추가"의 틱톡 버전 — WebView 안에서 지금 활성 video의 공유 permalink를
    // 찾아 돌려준다(shared/ShortsPlayerHandle에 선택 프로퍼티로 추가, YouTube는 큐의 current로
    // 이미 알고 있어 구현 안 함). 1.5초 안에 응답이 없으면(페이지 전환 중 등) null로 포기.
    getCurrentVideoUrl: () => new Promise<string | null>((resolve) => {
      currentVideoUrlResolverRef.current = resolve;
      webRef.current?.injectJavaScript('window.paceGetCurrentVideoUrl && window.paceGetCurrentVideoUrl(); true;');
      setTimeout(() => {
        if (currentVideoUrlResolverRef.current === resolve) {
          currentVideoUrlResolverRef.current = null;
          resolve(null);
        }
      }, 1500);
    }),
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

  // 위 Props 주석 참고 — window.__paceMuted를 스크립트 본문보다 먼저 세팅해 콜드 스타트 무음샘 확보.
  const injectedScriptWithMuteSeed = `window.__paceMuted=${initialMuted ? 'true' : 'false'};` + INJECTED_JS_BEFORE_LOAD;

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ uri: 'https://www.tiktok.com/foryou' }}
        style={styles.web}
        // 2026-08-14(28차) — injectedJavaScript(페이지 "완전 로드" 후 주입) prop을 더 이상 안 쓴다
        // — 핵심 로직 전부가 BeforeContentLoaded 안의 mainInit()(DOMContentLoaded 기준)로 옮겨감.
        injectedJavaScriptBeforeContentLoaded={injectedScriptWithMuteSeed}
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
        // 🔴 2026-08-14(31~34차) — injectedJavaScriptBeforeContentLoaded/imperative injectJavaScript
        // 둘 다 시각적으로 확인이 안 돼(라임 outline/DOM 마커 테스트) react-native-webview+Fabric
        // 버그(GitHub #3727)로 잠정 결론 내렸었는데, **틀렸다.** react-native-webview를
        // 13.16.1→16.0.0으로 올렸더니(이 업그레이드로 injectJavaScript 실패 시 에러가 실제로
        // 콘솔에 찍히기 시작함 — 13.16.1은 이걸 완전히 삼켰다) 진짜 원인이 드러났다:
        // `SyntaxError: Unterminated regular expression literal '/'`. 원인은 INJECTED_JS_BEFORE_LOAD
        // 내부의 `.replace(/\n/g, ' ')` — 이 TS 템플릿 리터럴(백틱 문자열) 안에서 `\n`은 TS 자체가
        // "이스케이프 시퀀스"로 먼저 해석해 진짜 개행문자로 바꿔버린다. 그 결과 런타임에 WebView로
        // 전달되는 실제 문자열은 정규식 `/\n/g`가 아니라 `/` + 진짜 개행 + `/g`였고, 이건 문법적으로
        // "닫히지 않은 정규식"이라 스크립트 전체가 파싱 단계에서 죽어 있었다(`\\n`으로 고쳐 해결,
        // 커밋 참고). 즉 업스트림 버그가 아니라 **우리 스크립트의 SyntaxError가 처음부터 있었고,
        // 13.16.1이 그 실패를 완전히 침묵시켜서 며칠간 원인을 못 찾았던 것** — 라이브러리 업그레이드
        // 자체가 고친 게 아니라 에러 메시지를 드러내준 덕분에 진짜 원인을 찾은 것.
        // 이 재주입(onLoadStart/onLoad)은 이제 정말로 동작한다(시뮬레이터 스크린샷/로그로 확인:
        // PACEWV 로그 정상 출력, 네이티브 전체화면 승격 없이 P버튼/배지 유지). 다만 여전히 남겨두는
        // 이유는 — react-native-webview 13.x의 injectedJavaScriptBeforeContentLoaded prop이
        // (raw 시각 테스트로는) 안 먹혔던 것도 사실이라, prop보다 이 imperative 경로가 더 신뢰도가
        // 높다고 판단해서다.
        onLoadStart={() => { webRef.current?.injectJavaScript(injectedScriptWithMuteSeed); }}
        onLoad={() => { webRef.current?.injectJavaScript(injectedScriptWithMuteSeed); }}
        onError={(e) => { if (__DEV__) console.log('[TikTok WV] onError', e.nativeEvent?.code); }}
        onHttpError={(e) => { if (__DEV__) console.log('[TikTok WV] httpError', e.nativeEvent?.statusCode); }}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        onMessage={(e) => {
          let msg: { type?: string; value?: number; url?: string | null } = {};
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'domlog') {
            try { if (__DEV__) getPaceGestureLog()?.nativeLog?.(String((msg as any).text ?? '')); } catch {}
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
          } else if (msg.type === 'currentVideoUrl') {
            const resolve = currentVideoUrlResolverRef.current;
            currentVideoUrlResolverRef.current = null;
            resolve?.(msg.url ?? null);
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
