import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors, radius, spacing, typography } from '../../constants/theme';

// ⚠️⚠️ DEV 전용 · 프로덕션/스토어 제출 금지 ⚠️⚠️
// 2026-08-11 사장님 지시("웹뷰로 틱톡 못띄워?") — dev/shorts-poc.tsx와 똑같은 목적, 대상만 틱톡.
// 시뮬레이터 Safari로 tiktok.com/foryou를 직접 열었더니(react-native-webview가 아니라 진짜 WebKit
// 브라우저) 캡차/로그인벽 없이 실제 영상이 재생됐다 — 오늘 낮에 확인한 "서버 스크래핑이 막힌다"
// (X-Bogus/msToken 서명 없인 API 직접 호출 불가)는 완전히 다른 질문이었다. 이건 "페이지 자체를
// 그대로 띄우면 되는가"(지금 유튜브 쇼츠 iOS가 쓰는 바로 그 방식)라 별도로 검증해야 한다.
// 시뮬레이터를 탭/스와이프로 조작할 방법이 없어서(macOS 접근성 권한 없음), 사람 대신 주입 JS가
// 스스로 스크롤/다음영상 이동을 반복하며 몇 분간 무인으로 관찰한다 — 스크롤할수록 로그인벽이
// 뜨는지, 스와이프 시뮬레이션이 먹히는지가 핵심 질문. 화면 하단 로그 패널로 결과를 본다.
//
// 🔴 결론(수 시간 조사, 8개 기법 시도 — 합성 터치스와이프/wheel/키보드/scrollTop 직접대입/
// Swiper.js 공식 API(slideNext)/nextSibling.scrollIntoView/PointerEvent(Swiper v9+가 내부적으로
// TouchEvent 대신 쓰는 것)/실제 오픈소스 유저스크립트 원문 기법(video.loop=false로 자동반복을
// 끄고 진짜 media 'ended' 이벤트를 기다렸다 .swiper-slide.nextElementSibling으로 스크롤, 8차) —
// 전부 딱 1회만 이동하고 영구히 멈춤(활성 슬라이드 idx=1/2에서 고정, 다음 슬라이드가 DOM에
// 아예 없음). **8차 시도가 특히 중요한 반증이다** — 이건 페이지 JS가 만든 가짜 이벤트가 아니라
// 브라우저가 실제 재생 완료를 보고 발생시키는 100% 신뢰된 미디어 이벤트였는데도 실패했다 —
// 즉 이전까지의 "event.isTrusted를 요구한다"는 가설은 반증됐고, 진짜 원인은 아직 모른다(이
// 세션이 오늘 밤 반복 테스트로 이미 제한된 상태이거나, 로그인이 필요하거나, 시뮬레이터에서
// 관측 못 하는 다른 조건일 수 있다). WebDriver(safaridriver)로 진짜 OS 레벨 입력을 시도했으나
// "Allow Remote Automation"이 꺼져 있고 --enable은 macOS sudo 암호가 필요해(요청 안 함) 검증
// 못 함. 결론: 콘텐츠 로드/재생/로그인벽 없음은 확정, 자동 다음영상 넘김은 **실기기에서 사람이
// 직접 스와이프해야만** 최종 확인 가능 — 원인 불명이라 실기기 테스트 결과와 무관하게 여전히
// 유효한 유일한 다음 단계.

const INJECTED_JS = `
(function() {
  function log(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify({t:Date.now(), m:m})); } catch(e){} }

  // "이 앱을 다운로드하세요" 유도 모달 — 매 페이지 로드 초반에 뜬다. 텍스트 매칭으로 닫기/나중에
  // 버튼을 찾아 자동 클릭한다(좌표 기반 탭이 없어도 DOM 쿼리로는 가능).
  function dismissAppBanner(){
    try {
      var candidates = Array.prototype.slice.call(document.querySelectorAll('button, div[role="button"], a'));
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var txt = (el.textContent || '').trim();
        if (txt === '나중에' || txt === 'Not now' || txt === 'Maybe later' || txt === 'Later') {
          el.click(); log('배너 닫음: "' + txt + '"'); return true;
        }
      }
      // X 아이콘류 — aria-label 기반
      var closeBtn = document.querySelector('[aria-label="Close"], [aria-label="닫기"]');
      if (closeBtn) { closeBtn.click(); log('배너 닫음(X 아이콘)'); return true; }
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

  // 2026-08-12(6차) 사장님 지적("오토스크롤 넣어본건") — Greasyfork 스크립트 전체 원문을 다시
  // 가져와보니 요약에서 빠졌던 핵심이 있었다: **타이머로 강제 스크롤하지 않는다.** video.loop를
  // false로 꺼서 자동 반복을 막고, 영상이 **진짜로 끝까지 재생돼 자연 발생하는 'ended' 이벤트**를
  // 기다렸다가만 다음으로 넘긴다(0.5초 딜레이 후). 지금까지 8초 타이머로 영상 상태와 무관하게
  // 강제로 스크롤을 밀어붙인 것과 근본적으로 다르다 — 'ended'는 브라우저가 실제 재생 완료를 보고
  // 발생시키는 신뢰된 미디어 이벤트라, 틱톡이 "다음 배치를 부를 시점"의 근거로 이걸 볼 가능성이
  // 있다(강제 스크롤엔 반응 안 했지만 이건 다른 신호일 수 있다). shorts-poc.tsx와 같은 방식으로
  // MutationObserver를 써서 새 video가 나타날 때마다 재부착한다.
  function scrollToNextFromVideo(video){
    try {
      // 2026-08-12(7차) — 1차 시도(가장 가까운 "스크롤 가능한 부모"를 아무거나 잡는 휴리스틱)가
      // 실제로는 엉뚱한 컨테이너를 잡았을 수 있다(예전 scrollTop 실험 때도 같은 실수를 한 번
      //했었다). 지금 라이브 DOM에서 이미 확인된 진짜 슬라이드 단위는 .swiper-slide다 — 그걸
      // 정확히 타겟팅한다(Greasyfork 원문의 "DivItemContainer"는 지금 구조에서 이거에 해당).
      var slide = video.closest ? video.closest('.swiper-slide') : null;
      if (slide && slide.nextElementSibling) {
        slide.nextElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        log('ended 이벤트 기반: .swiper-slide.nextElementSibling.scrollIntoView() 실행');
        return;
      }
      if (slide) {
        log('ended 왔음, .swiper-slide는 찾았는데 nextElementSibling이 없음(마지막 로드된 슬라이드)');
        return;
      }
      // 폴백: 예전 휴리스틱(스크롤 가능한 첫 부모).
      var e = video;
      while (e && e.tagName && e.tagName.toLowerCase() !== 'body') {
        var next = e.nextElementSibling;
        if (next && e.parentElement && e.parentElement.scrollHeight > e.parentElement.clientHeight) {
          next.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          log('ended 이벤트 기반(폴백 휴리스틱) nextSibling.scrollIntoView() 실행(el=' + (e.className || e.tagName) + ')');
          return;
        }
        e = e.parentElement;
      }
      log('ended 이벤트는 왔는데 스크롤할 다음 형제를 못 찾음(.swiper-slide도 폴백도 실패)');
    } catch(err) { log('scrollToNextFromVideo 실패: ' + err.message); }
  }
  function hookVideoEnded(video){
    if (!video || video.__paceEndedHooked) return;
    video.__paceEndedHooked = true;
    try { video.loop = false; } catch(e) {}
    video.addEventListener('ended', function(){
      log('🟢 video "ended" 이벤트 실제 발생(신뢰된 미디어 이벤트) — 0.5초 뒤 스크롤');
      setTimeout(function(){ scrollToNextFromVideo(video); }, 500);
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

  // 2026-08-11(2차) 사장님 지시("웹에서 다시 찾아봐") — 합성 터치가 64초간 8번 실패한 뒤 웹서치로
  // 확인: 틱톡 데스크톱 웹은 오른쪽에 위/아래 화살표 버튼이 있다("Video Controls for TikTok" 확장
  // 프로그램이 존재한다는 것 자체가 클릭 가능한 UI 컨트롤이 있다는 증거). 정확한 selector는 검색으로
  // 못 찾아서(문서화가 없음) 실제 라이브 DOM을 직접 덤프해서 찾는다 — 한 번만 실행, 결과를 로그로.
  var domDumped = false;
  var scrollDumped = false;
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

  // 다음 영상 이동 — 여러 방법을 순서대로 시도(shorts-poc.tsx와 같은 폴백 체인 전략).
  function advance(){
    dismissAppBanner();
    checkLoginWall();
    trackCurrentVideo();
    dumpDomOnce();
    // 2026-08-11(4차) — 스크롤 후보 덤프에서 결정적 단서 발견: class="swiper swiper-initialized..."
    // 틱톡 웹 피드가 Swiper.js(유명 캐러셀 라이브러리)로 만들어져 있다. 그러면 합성 터치/스크롤
    // 해킹이 필요 없다 — Swiper 인스턴스는 자기 DOM 엘리먼트에 .swiper 프로퍼티로 스스로를
    // 노출하는 게 라이브러리 표준 관례고, 공식 API slideNext()가 있다. 이게 되면 지금까지 시도한
    // 모든 합성 이벤트보다 압도적으로 신뢰도 높다(진짜 라이브러리 메서드 호출이지 입력 위조가 아님).
    try {
      var allSwipers = document.querySelectorAll('.swiper');
      var info = [];
      var moved = false;
      for (var s = 0; s < allSwipers.length; s++) {
        var inst = allSwipers[s].swiper;
        if (!inst) { info.push('#' + s + ':no-instance'); continue; }
        var slideCount = inst.slides ? inst.slides.length : -1;
        var before = inst.activeIndex;
        info.push('#' + s + ' idx=' + before + '/' + slideCount + ' loop=' + !!inst.params.loop);
        if (typeof inst.slideNext === 'function') {
          inst.slideNext();
          if (inst.activeIndex !== before) moved = true;
        }
      }
      log('Swiper 전수 시도(' + allSwipers.length + '개): ' + info.join(' | ') + (moved ? ' → 이동함!' : ' → 전부 제자리'));
    } catch(e) { log('Swiper.slideNext 시도 실패: ' + e.message); }
    // 2026-08-12 사장님 지적("wkuserscript... 스크롤내리는 자바코드 다 확인했어?") — 웹서치로 확인:
    // Swiper.js v9+는 내부 입력 처리를 TouchEvent가 아니라 **PointerEvent**로 전환했다(v11도
    // pointerdown/move/up 지원 유지). 지금까지 시도한 건 전부 TouchEvent였다 — 틱톡의 Swiper가
    // Pointer Events로 리스너를 붙였다면 TouchEvent는 애초에 Swiper의 리스너에 안 잡혔을 것이다
    // (버블링은 되지만 Swiper 자신의 pointerdown 핸들러가 아예 안 걸렸을 수 있다는 뜻). 같은
    // 좌표/시퀀스로 PointerEvent 버전을 별도로 시도한다.
    try {
      var py0 = window.innerHeight * 0.8, py1 = window.innerHeight * 0.15, px = window.innerWidth / 2;
      var pel = document.elementFromPoint(px, py0) || document.body;
      function pev(type, y, id){
        return new PointerEvent(type, {
          pointerId: id, pointerType: 'touch', isPrimary: true,
          clientX: px, clientY: y, bubbles: true, cancelable: true
        });
      }
      pel.dispatchEvent(pev('pointerdown', py0, 1));
      pel.dispatchEvent(pev('pointermove', (py0 + py1) / 2, 1));
      pel.dispatchEvent(pev('pointermove', py1, 1));
      pel.dispatchEvent(pev('pointerup', py1, 1));
      log('PointerEvent 스와이프 시뮬레이션 실행(pointerType=touch)');
    } catch(e) { log('PointerEvent 시도 실패: ' + e.message); }
    // 2026-08-11(5차) — 실제로 동작하는 오픈소스 유저스크립트(TikTok Autoscroll, Greasyfork) 코드를
    // 확인했다: API 호출도 합성 이벤트도 아니고 nextSibling.scrollIntoView()만 쓴다. 왜 이게 더
    // 나을 수 있는가 — Swiper.activeIndex를 코드로 바꾸는 것과 달리 scrollIntoView는 브라우저가
    // 진짜 스크롤/리플로우를 일으키므로, 틱톡이 "다음 배치를 불러올 시점"을 판단하는 데 흔히 쓰는
    // IntersectionObserver(스크롤 위치 기반 sentinel 감시)가 반응할 가능성이 훨씬 높다 — Swiper
    // 내부 인덱스만 바꾸는 건 그 관찰자를 안 건드릴 수 있다.
    try {
      var activeSlide = document.querySelector('.swiper-slide-active');
      var nextSlide = activeSlide ? activeSlide.nextElementSibling : null;
      if (nextSlide) {
        nextSlide.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        log('nextSibling.scrollIntoView() 실행(활성슬라이드 다음 형제 있음)');
      } else {
        log('nextSibling 없음(activeSlide=' + !!activeSlide + ') — 마지막 로드된 슬라이드인 듯');
      }
    } catch(e) { log('scrollIntoView 시도 실패: ' + e.message); }
    // 방법 0: aria-label 기반 다음영상 버튼을 실제로 클릭(합성 터치보다 훨씬 신뢰도 높음 —
    // "나중에" 배너 닫기가 이미 이 방식으로 성공했다).
    try {
      var btns = document.querySelectorAll('[aria-label]');
      for (var j = 0; j < btns.length; j++) {
        var al = (btns[j].getAttribute('aria-label') || '').toLowerCase();
        if (al.indexOf('next') !== -1 || al.indexOf('다음') !== -1 || al.indexOf('down') !== -1) {
          btns[j].click(); log('다음 버튼 클릭: aria="' + al + '"'); return;
        }
      }
    } catch(e) {}
    // 2026-08-11(3차) — DOM덤프 결과: aria-label 붙은 건 상단 네비 아이콘 3개뿐, "다음 영상" 버튼
    // 자체가 없다(모바일 레이아웃이라 데스크톱의 화살표 UI가 아예 안 뜬 것으로 보임). 합성
    // 터치/wheel/키보드가 전부 실패한 것도 다시 보면 당연하다 — 많은 가상 스크롤 피드는 실제
    // scrollTop 변화를 IntersectionObserver로 감시해 "몇 번째 영상이 화면에 보이는가"로 다음
    // 영상을 트리거한다(이벤트가 아니라 **위치**가 근거). 진짜 스크롤 컨테이너를 찾아 scrollTop을
    // 직접 바꿔본다 — 이벤트 발사가 아니라 DOM 프로퍼티 값 자체를 바꾸는 것이라 isTrusted 같은
    // "진짜 사용자 입력인가" 체크에 안 걸린다.
    try {
      var containers = document.querySelectorAll('div, main, section');
      var candidates = [];
      for (var k = 0; k < containers.length; k++) {
        var c = containers[k];
        var delta = c.scrollHeight - c.clientHeight;
        if (delta > 20) candidates.push({ el: c, delta: delta, top: c.scrollTop, h: c.scrollHeight, cls: (c.className || '').toString().slice(0, 30) });
      }
      candidates.sort(function(a, b){ return b.delta - a.delta; });
      if (!scrollDumped) {
        scrollDumped = true;
        var summary = candidates.slice(0, 8).map(function(c){ return 'Δ' + c.delta + ' top=' + c.top + ' h=' + c.h + ' cls="' + c.cls + '"'; }).join(' | ');
        log('스크롤 후보 ' + candidates.length + '개: ' + summary);
      }
      // 상위 후보 전부에 시도(어느 게 실제 피드인지 모르니 전부 밀어본다 — 값 프로퍼티 대입은
      // 부작용이 적어 여러 개를 건드려도 안전하다).
      for (var m = 0; m < Math.min(3, candidates.length); m++) {
        candidates[m].el.scrollTop = candidates[m].top + window.innerHeight;
      }
      var se0 = document.scrollingElement || document.documentElement;
      se0.scrollTop = se0.scrollTop + window.innerHeight;
    } catch(e) { log('scrollTop 시도 실패: ' + e.message); }
    try {
      var y0 = window.innerHeight * 0.8, y1 = window.innerHeight * 0.15, x = window.innerWidth / 2;
      var el = document.elementFromPoint(x, y0) || document.body;
      function tev(type, y){ var t = new Touch({identifier: 1, target: el, clientX: x, clientY: y});
        return new TouchEvent(type, {cancelable: true, bubbles: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t]}); }
      el.dispatchEvent(tev('touchstart', y0));
      el.dispatchEvent(tev('touchmove', (y0 + y1) / 2));
      el.dispatchEvent(tev('touchmove', y1));
      el.dispatchEvent(tev('touchend', y1));
      log('스와이프 시뮬레이션 실행');
    } catch(e) {
      log('스와이프 실패(' + e.message + ') → scrollBy 폴백');
      try { window.scrollBy({ top: window.innerHeight, behavior: 'smooth' }); } catch(e2) {}
    }
    // wheel 이벤트 — 데스크톱 웹은 스크롤휠로 넘어가는 게 기본일 수 있다(사람은 안 쓰지만 데스크톱
    // 레이아웃이 로드됐을 가능성 있음, UA를 모바일로 줬어도 뷰포트 크기로 데스크톱 CSS가 뜰 수 있다).
    try {
      var wheelEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
      wheelEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 800, bubbles: true, cancelable: true }));
      log('wheel 이벤트 실행');
    } catch(e) {}
    // 키보드 방향키도 같이 시도.
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    } catch(e) {}
  }

  log('PACE TikTok PoC 주입 완료 — 8초마다 강제시도 + ended 이벤트 대기 병행');
  trackCurrentVideo();
  startEndedObserver();
  setInterval(advance, 8000);
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
