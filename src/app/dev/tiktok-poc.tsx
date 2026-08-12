import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors, radius, spacing, typography } from '../../constants/theme';

// ⚠️⚠️ DEV 전용 · 프로덕션/스토어 제출 금지 ⚠️⚠️
// 2026-08-11 사장님 지시("웹뷰로 틱톡 못띄워?") — dev/shorts-poc.tsx와 똑같은 목적, 대상만 틱톡.
//
// 🟢 결론 재반전(2026-08-12, 실기기 확정) — **모바일 UA로는 8개 기법이 전부 1회만 이동하고
// 영구히 멈췄지만(합성 터치/wheel/키보드/scrollTop/Swiper.slideNext/scrollIntoView/PointerEvent/
// 진짜 신뢰된 'ended' 미디어 이벤트까지 전부 실패), 사장님 제안대로 **데스크톱(맥/윈도우 크롬)
// User-Agent로 위장하니 실기기에서 영상이 계속 자동으로 넘어갔다.** 모바일 웹은 앱 설치 유도를
// 위해 의도적으로 2개쯤에서 막아두고, 데스크톱은 모바일 앱을 설치할 수 없으니 그 제한이 없는
// 것으로 보인다 — 지금까지의 모든 반증(isTrusted 아님/로그인 무관/WKWebView 임베딩 무관)과도
// 모순 없이 들어맞는다. 이 UA는 아래 WebView의 userAgent prop에 이미 적용돼 있다(데스크톱
// Chrome/Mac 고정).
//
// 🐛 후속 버그(발견 즉시 수정, 이 커밋) — 위 8개 기법을 "8초마다 전부 강제 재시도"하던 루프가
// 데스크톱 UA에서는 일부 기법(Swiper slideNext/scrollIntoView 등)이 실제로 먹히기 시작하면서,
// **영상이 자연 종료되기 전에도 8초마다 강제로 다음 영상으로 밀어버리는** 부작용을 냈다(사장님
// 보고: "플레이 중간에 다른영상으로 넘어가", 오디오가 비디오보다 먼저 나옴). 원인은 명백히 이
// 파일의 테스트 하네스 설계(어떤 기법이 먹히는지 몰라 전부 주기적으로 쏴본 것)였지 프로덕션에서
// 필요한 동작이 아니다 — 실제로 필요한 건 "영상이 끝났을 때만" 넘기는 것. 그래서 강제 재시도
// 루프(구 advance())를 없애고, 다음 영상 이동은 오직 아래 hookVideoEnded()의 진짜 'ended' 미디어
// 이벤트(신뢰된 브라우저 이벤트)로만 트리거하도록 바꿨다. 배너 닫기/로그인벽 감지/로그용 DOM 덤프
// 같은 하우스키핑만 가벼운 주기로 계속 돈다(강제 이동 기법은 전혀 호출 안 함).
//
// 다음 단계: 이 ended-only 방식을 실기기에서 재확인(자연 종료 시에만 매끈하게 넘어가는지) →
// 데스크톱 레이아웃의 사이드바/헤더 등 불필요한 UI를 가리는 CSS 주입(YouTubeShortsPlayer.ios.tsx의
// 언멋 팝업 숨김과 같은 패턴) → 정식 TikTokShortsPlayer.ios.tsx 구현.

const INJECTED_JS = `
(function() {
  function log(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify({t:Date.now(), m:m})); } catch(e){} }

  // 2026-08-13(15차) 시뮬레이터 자체 검증 — RN 상단바(X/로그패널)가 사라지고 영상만 화면을 꽉 채우는
  // 패턴을 반복 재현했다: WebView 렌더러 크래시가 아니라 **네이티브 전체화면 비디오 프레젠테이션**이
  // RN 뷰 계층을 통째로 덮는 것으로 의심된다(allowsInlineMediaPlayback은 <video>의 playsinline만
  // 보장하지, 데스크톱 UA 페이지의 Fullscreen API(requestFullscreen)나 webkitEnterFullscreen 호출은
  // 안 막는다). 페이지 로드 즉시(다른 코드보다 먼저) 두 경로를 모두 no-op으로 가로막는다 — 전체화면
  // 요청이 있어도 인라인 상태를 유지하게 강제.
  try {
    if (typeof Element !== 'undefined' && Element.prototype.requestFullscreen) {
      Element.prototype.requestFullscreen = function(){ log('🚫 requestFullscreen 차단'); return Promise.reject(new Error('blocked by PACE PoC')); };
    }
    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.webkitEnterFullscreen) {
      HTMLVideoElement.prototype.webkitEnterFullscreen = function(){ log('🚫 webkitEnterFullscreen 차단'); };
    }
    document.addEventListener('fullscreenchange', function(){
      if (document.fullscreenElement) { log('🚫 fullscreenchange 감지 — exitFullscreen 시도'); try { document.exitFullscreen(); } catch(e) {} }
    }, true);
  } catch(e) { log('전체화면 차단 설치 실패: ' + e.message); }

  // "이 앱을 다운로드하세요" 유도 모달 — 매 페이지 로드 초반에 뜬다. 텍스트 매칭으로 닫기/나중에
  // 버튼을 찾아 자동 클릭한다(좌표 기반 탭이 없어도 DOM 쿼리로는 가능).
  // 2026-08-13(13차) 사장님 보고("틱톡에서 무엇을 시청하고 싶으신가요 팝업 나옴") — 관심사(카테고리)
  // 선택 온보딩 모달도 같은 방식으로 처리. 이게 화면을 덮고 있으면 스와이프/합성 이벤트가 전부
  // 이 모달에 막혀 실제 피드에 안 닿을 수 있다(스와이프 무반응 증상과 관련 있을 가능성).
  function dismissAppBanner(){
    try {
      var candidates = Array.prototype.slice.call(document.querySelectorAll('button, div[role="button"], a'));
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var txt = (el.textContent || '').trim();
        if (txt === '나중에' || txt === 'Not now' || txt === 'Maybe later' || txt === 'Later'
          || txt === '건너뛰기' || txt === 'Skip' || txt === '완료' || txt === 'Done'
          || txt === '닫기' || txt === 'Close' || txt === '나중에 하기') {
          el.click(); log('배너/모달 닫음: "' + txt + '"'); return true;
        }
      }
      // X 아이콘류 — aria-label 기반
      var closeBtn = document.querySelector('[aria-label="Close"], [aria-label="닫기"], [aria-label="close"]');
      if (closeBtn) { closeBtn.click(); log('배너 닫음(X 아이콘)'); return true; }
      // 관심사 선택 모달은 닫기 버튼이 없이 Esc나 배경 클릭으로만 닫히는 경우가 있다. 좌표 기반
      // elementFromPoint 클릭은 하지 않는다 — 임의 UI(로고/메뉴 등)를 잘못 눌러 딴 페이지로 튈 위험이
      // 있다(2026-08-13 시뮬레이터 자체 검증 중 검은 화면 고착 재현, 원인 후보 중 하나로 배제).
      // document.body.click()은 좌표 없이 백드롭-클릭-닫기 델리게이트 패턴에만 걸리므로 더 안전하다.
      var bodyText = document.body.innerText || '';
      if (bodyText.indexOf('무엇을 시청하고') !== -1 || bodyText.indexOf('what you') !== -1) {
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch(e) {}
        try { document.body.click(); log('관심사 모달: Esc + body 클릭 시도'); } catch(e) {}
      }
    } catch(e) { log('dismissAppBanner 실패: ' + e.message); }
    return false;
  }

  // 로그인벽 감지 — 스크롤을 계속했을 때 이게 뜨는지가 이번 실험의 핵심 질문.
  function checkLoginWall(){
    try {
      var bodyText = document.body.innerText || '';
      var markers = ['로그인하여', 'Log in to', '로그인 후 계속', 'continue watching', '더 보려면 로그인'];
      for (var i = 0; i < markers.length; i++) {
        if (bodyText.indexOf(markers[i]) !== -1) { log('🔴 로그인벽 감지: "' + markers[i] + '"'); return true; }
      }
    } catch(e) {}
    return false;
  }

  var seenIds = {};
  function trackCurrentVideo(){
    try {
      var v = document.querySelector('video');
      var src = v ? (v.currentSrc || v.src || '') : '';
      var key = src.slice(0, 60) || location.pathname;
      if (!seenIds[key]) {
        seenIds[key] = true;
        var count = Object.keys(seenIds).length;
        log('새 영상 #' + count + ' (path=' + location.pathname + ', playing=' + (v ? !v.paused : 'no-video') + ')');
      }
    } catch(e) {}
  }

  // 2026-08-13(10차) 사장님 보고("같은 영상만 계속 리플레이") — 'ended' 이벤트 단독 의존이
  // 실기기에서 실패했다. 두 가지 의심 지점: (1) 틱톡 자체 코드가 우리가 끈 video.loop을 다시
  // true로 되돌릴 수 있다(그러면 브라우저가 내부적으로 되감아 재생해 'ended'가 아예 안 뜬다 —
  // 스펙상 loop=true인 동안은 ended가 발생하지 않는다), (2) 'ended'는 떴어도 다음 슬라이드가
  // 아직 DOM에 없어(.swiper-slide.nextElementSibling 없음) scrollIntoView가 조용히 실패했을 수
  // 있다 — 예전엔 8초 강제루프의 Swiper.slideNext() 반복 호출이 다음 콘텐츠를 미리 당겨오는
  // 부수효과를 냈는데, 그걸 통째로 없애며 그 효과까지 같이 사라졌을 가능성. 그래서 이번엔
  // YouTubeShortsPlayer.ios.tsx가 이미 검증한 전략을 그대로 가져온다: **'ended' 이벤트에만
  // 의존하지 않고, currentTime/duration을 500ms마다 직접 폴링해 종료임박(duration-0.5초 이내)
  // 또는 되감김(loopedBack, 짧게 끝났다가 되돌아감)을 감지**한다 — video.loop이 되돌려져도,
  // 'ended'가 안 떠도 이 폴링은 영향받지 않는다. 그리고 실제 "다음으로" 이동은 scrollIntoView
  // 전에 **Swiper 공식 slideNext()를 먼저 호출**해 다음 슬라이드를 확실히 DOM에 올린 뒤
  // scrollIntoView로 마무리한다(둘 다 해도 서로 방해 안 됨 — slideNext가 렌더만 보장, 실제
  // 스크롤 위치/IntersectionObserver 트리거는 scrollIntoView가 담당).
  function getActiveVideo(){
    var activeSlide = document.querySelector('.swiper-slide-active');
    var v = activeSlide ? activeSlide.querySelector('video') : null;
    return v || document.querySelector('video');
  }
  // "한 번 시도했다 실패하면 영영 그 영상에 갇힌다"를 막기 위한 게이트. 시도 "중"에만 true —
  // 이동이 실제로 확인되거나 재시도가 소진되면 풀려서, 다음 자연종료 감지(재생 재시작 등) 때
  // 다시 시도할 수 있다(아래 tryAdvance).
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
        log('scrollIntoView: .swiper-slide.nextElementSibling 실행');
        return;
      }
      if (slide) {
        log('scrollIntoView: nextElementSibling 없음(마지막 로드된 슬라이드)');
        return;
      }
      var e = video;
      while (e && e.tagName && e.tagName.toLowerCase() !== 'body') {
        var next = e.nextElementSibling;
        if (next && e.parentElement && e.parentElement.scrollHeight > e.parentElement.clientHeight) {
          next.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          log('scrollIntoView(폴백 휴리스틱) 실행(el=' + (e.className || e.tagName) + ')');
          return;
        }
        e = e.parentElement;
      }
      log('scrollIntoView 대상 못 찾음(.swiper-slide도 폴백도 실패)');
    } catch(err) { log('scrollToNextFromVideo 실패: ' + err.message); }
  }
  // 2026-08-13(11차) 사장님 보고("같은영상만 나와", slideNext 단독 시도 이후에도 재현) — Swiper API
  // 단독으로는 실기기에서 안 먹혔다. 예전 8초 강제루프가 "영상이 계속 넘어간다"는 걸 실제로
  // 만들어냈던 것은 특정 한 기법이 아니라 **여러 기법을 한꺼번에 쏘는 것 자체**였을 가능성이
  // 높다(그중 정확히 뭐가 먹혔는지 로그로 특정 못 함 — DOM 덤프가 실기기 세션마다 달랐다). 그래서
  // 이번엔 그 전체 기법 목록을 되살리되, **자연 종료를 감지했을 때 딱 한 번만**(markAdvancedOnce
  // 가드, 8초 블라인드 반복 아님) 전부 순서대로 시도한다 — "언제 넘길지"는 이제 재생 위치로
  // 정확히 판단하고, "어떻게 넘길지"만 예전의 다중기법 산탄식으로 되돌린 것.
  function goToNext(video){
    var moved = false;
    try {
      var allSwipers = document.querySelectorAll('.swiper');
      for (var s = 0; s < allSwipers.length; s++) {
        var inst = allSwipers[s].swiper;
        if (!inst || typeof inst.slideNext !== 'function') continue;
        var before = inst.activeIndex;
        inst.slideNext();
        if (inst.activeIndex !== before) moved = true;
      }
      log('goToNext: Swiper 전수 slideNext() (' + allSwipers.length + '개)' + (moved ? ' → 이동함' : ' → 제자리'));
    } catch(e) { log('goToNext swiper 실패: ' + e.message); }
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
      log('goToNext: PointerEvent 스와이프 실행');
    } catch(e) { log('goToNext PointerEvent 실패: ' + e.message); }
    // 2026-08-13(12차) 사장님 보고("스와이프 안넘어가는데" — 실제 손가락 터치도 안 먹힘) — 데스크톱
    // UA로 서빙되는 페이지라면 Swiper가 터치가 아니라 **마우스 드래그**로 설정돼 있을 가능성이 있다
    // (simulateTouch/마우스 전용 리스너). 합성 마우스 드래그(mousedown→mousemove→mouseup)도 같이 쏜다.
    try {
      var my0 = window.innerHeight * 0.8, my1 = window.innerHeight * 0.15, mx = window.innerWidth / 2;
      var mel = document.elementFromPoint(mx, my0) || document.body;
      function mev(type, y){ return new MouseEvent(type, { clientX: mx, clientY: y, bubbles: true, cancelable: true, button: 0 }); }
      mel.dispatchEvent(mev('mousedown', my0));
      mel.dispatchEvent(mev('mousemove', (my0 + my1) / 2));
      mel.dispatchEvent(mev('mousemove', my1));
      mel.dispatchEvent(mev('mouseup', my1));
      log('goToNext: MouseEvent 드래그 실행');
    } catch(e) { log('goToNext MouseEvent 실패: ' + e.message); }
    try {
      var y0 = window.innerHeight * 0.8, y1 = window.innerHeight * 0.15, x = window.innerWidth / 2;
      var el = document.elementFromPoint(x, y0) || document.body;
      function tev(type, y){ var t = new Touch({identifier: 1, target: el, clientX: x, clientY: y});
        return new TouchEvent(type, {cancelable: true, bubbles: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t]}); }
      el.dispatchEvent(tev('touchstart', y0));
      el.dispatchEvent(tev('touchmove', (y0 + y1) / 2));
      el.dispatchEvent(tev('touchmove', y1));
      el.dispatchEvent(tev('touchend', y1));
      log('goToNext: TouchEvent 스와이프 실행');
    } catch(e) { log('goToNext TouchEvent 실패: ' + e.message); }
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
  // 실제로 다음 영상으로 옮겨갔는지(getActiveVideo()가 바뀌었는지) 확인하고, 안 옮겨갔으면 짧은
  // 간격으로 재시도한다(최대 6회 ≈ 4.2초). 8초 블라인드 반복과 다른 점: 이건 "영상이 이미 끝났다"고
  // 확정된 뒤에만 도는 재시도이지, 재생 중에는 절대 안 돈다.
  function tryAdvance(video, attemptsLeft){
    if (attemptsLeft === undefined) attemptsLeft = 6;
    goToNext(video);
    setTimeout(function(){
      var nowActive = getActiveVideo();
      if (nowActive && nowActive !== video) {
        log('🟢 다음 영상으로 이동 확인됨');
        video.__paceAdvancing = false;
        return;
      }
      if (attemptsLeft > 0) {
        log('아직 이동 안 됨 — 재시도(남은 ' + attemptsLeft + '회)');
        tryAdvance(video, attemptsLeft - 1);
      } else {
        log('🔴 이동 재시도 소진 — 이 영상에 갇힘, 다음 감지 때 다시 시도');
        video.__paceAdvancing = false;
      }
    }, 700);
  }
  function hookVideoEnded(video){
    if (!video || video.__paceEndedHooked) return;
    video.__paceEndedHooked = true;
    try { video.loop = false; } catch(e) {}
    video.addEventListener('ended', function(){
      if (!markAdvancingOnce(video)) return;
      log('🟢 video "ended" 이벤트 실제 발생 — 0.5초 뒤 다음으로');
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
    log('ended 이벤트 옵저버 시작(MutationObserver로 새 video 자동 재부착)');
  }
  // 폴링 백업 — 'ended'가 안 뜨는 경우(loop 되돌림 등)를 대비해 재생 위치로 직접 종료를 감지한다.
  var pollLastT = -1, pollLastVideo = null;
  function pollActiveVideo(){
    var v = getActiveVideo();
    if (!v) return;
    if (v !== pollLastVideo) { pollLastVideo = v; pollLastT = -1; }
    try { if (v.loop) v.loop = false; } catch(e) {}
    if (!v.duration || isNaN(v.duration)) return;
    var t = v.currentTime;
    var nearEnd = t >= v.duration - 0.5;
    var loopedBack = pollLastT > 1 && t < pollLastT - 1;
    if ((nearEnd || loopedBack) && markAdvancingOnce(v)) {
      log('🟡 폴링 자연종료 감지(nearEnd=' + nearEnd + ' loopedBack=' + loopedBack + ') t=' + t.toFixed(2) + '/' + v.duration.toFixed(2));
      tryAdvance(v);
    }
    pollLastT = t;
  }

  // 2026-08-11(2차) 사장님 지시("웹에서 다시 찾아봐") — 합성 터치가 64초간 8번 실패한 뒤 웹서치로
  // 확인: 틱톡 데스크톱 웹은 오른쪽에 위/아래 화살표 버튼이 있다("Video Controls for TikTok" 확장
  // 프로그램이 존재한다는 것 자체가 클릭 가능한 UI 컨트롤이 있다는 증거). 정확한 selector는 검색으로
  // 못 찾아서(문서화가 없음) 실제 라이브 DOM을 직접 덤프해서 찾는다 — 한 번만 실행, 결과를 로그로.
  var domDumped = false;
  function dumpDomOnce(){
    if (domDumped) return; domDumped = true;
    try {
      var found = [];
      var all = document.querySelectorAll('button, [role="button"], [aria-label]');
      for (var i = 0; i < all.length && found.length < 15; i++) {
        var el = all[i];
        var label = el.getAttribute('aria-label') || '';
        var cls = (el.className || '').toString().slice(0, 40);
        if (label || /arrow|next|prev|nav|switch/i.test(cls)) {
          found.push('[' + i + '] aria="' + label + '" cls="' + cls + '"');
        }
      }
      log('DOM덤프(' + found.length + '건): ' + found.join(' | ').slice(0, 400));
    } catch(e) { log('DOM덤프 실패: ' + e.message); }
  }

  // 하우스키핑만 — 강제 다음영상 이동 기법은 전혀 안 부른다(구 advance()는 8초마다 이 전부를
  // 강제 재시도해서 자연 종료 전에도 영상을 밀어버렸다, 위 헤더 코멘트 참고). 다음 영상 이동은
  // hookVideoEnded()의 'ended' 이벤트 + pollActiveVideo()의 재생위치 폴링, 둘 중 먼저 감지되는
  // 쪽으로만 일어난다(markAdvancedOnce로 중복 방지).
  function houseKeeping(){
    dismissAppBanner();
    checkLoginWall();
    trackCurrentVideo();
    dumpDomOnce();
  }

  log('PACE TikTok PoC 주입 완료 — ended 이벤트 + 재생위치 폴링으로만 다음 영상 이동(2026-08-13)');
  trackCurrentVideo();
  startEndedObserver();
  setInterval(houseKeeping, 3000);
  setInterval(pollActiveVideo, 500);
  // 배너는 로드 직후 뜨는 경우가 많아 더 빨리도 한 번 시도.
  setTimeout(dismissAppBanner, 1500);
  setTimeout(dismissAppBanner, 3000);
})();
true;
`;

export default function TikTokPocScreen() {
  const router = useRouter();
  const webRef = useRef<WebView>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);

  if (!__DEV__) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>This screen is dev-only.</Text>
      </View>
    );
  }

  const pushLog = (m: string) => setLogs((prev) => [m, ...prev].slice(0, 60));

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ uri: 'https://www.tiktok.com/foryou' }}
        style={StyleSheet.absoluteFill}
        injectedJavaScript={INJECTED_JS}
        onMessage={(e) => {
          try {
            const { m } = JSON.parse(e.nativeEvent.data);
            pushLog(String(m));
          } catch {
            pushLog(e.nativeEvent.data);
          }
        }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        sharedCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        onError={(e) => pushLog('onError: ' + String(e.nativeEvent?.description).slice(0, 80))}
        onHttpError={(e) => pushLog('httpError: ' + e.nativeEvent?.statusCode)}
        // 2026-08-13(14차) 시뮬레이터 자체 검증 — 검은 화면에 갇힌 채 로그도 멈추는 증상을
        // 재현했는데, YouTubeShortsPlayer.ios.tsx엔 있는 이 핸들러가 여기 빠져 있었다. WKWebView
        // 렌더러 프로세스가 죽으면(메모리 압박, 합성 이벤트 폭주 등) 복구 수단이 전혀 없어 영구히
        // 검은 화면 — 리로드로 복구한다.
        onContentProcessDidTerminate={() => { pushLog('🔴 WebView 렌더러 프로세스 종료 — 리로드'); webRef.current?.reload(); }}
        // 2026-08-12(9차) 사장님 지시("맥이나 윈도우 pc 크롬 브라우져처럼 속여서") — 모바일 UA는
        // 데스크톱 웹 CTA(앱 설치 유도)가 실려있을 수 있다. 데스크톱은 모바일 앱을 설치할 수
        // 없으니 같은 제한이 없을 가능성 — 데스크톱 크롬(맥)으로 위장해 재시도.
        userAgent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      />

      <SafeAreaView style={styles.uiLayer} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>
          <View style={styles.devPill}>
            <Feather name="alert-triangle" size={12} color={colors.warning} />
            <Text style={styles.devPillText}>DEV POC (TikTok) · 출시 금지</Text>
          </View>
          <Pressable onPress={() => setShowLogs((v) => !v)} hitSlop={12} style={styles.iconBtn}>
            <Feather name={showLogs ? 'eye-off' : 'eye'} size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </SafeAreaView>

      {showLogs && (
        <View style={styles.logPanel} pointerEvents="none">
          {logs.map((l, i) => (
            <Text key={i} style={styles.logLine} numberOfLines={1}>· {l}</Text>
          ))}
          {logs.length === 0 && <Text style={styles.logLine}>대기 중 — 로드 후 로그가 뜹니다</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardMuted },
  blockedText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilyMedium },
  uiLayer: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.45)' },
  devPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  devPillText: { color: colors.warning, fontSize: 11, fontFamily: typography.bodyFontFamilyBold },
  logPanel: { position: 'absolute', bottom: spacing.lg, left: spacing.md, right: spacing.md, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.chip, padding: spacing.sm, gap: 2 },
  logLine: { color: '#9EE6A6', fontSize: 10, fontFamily: typography.monoFontFamily },
});
