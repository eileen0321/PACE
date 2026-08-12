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
  // 오직 hookVideoEnded()의 진짜 'ended' 미디어 이벤트로만 일어난다.
  function houseKeeping(){
    dismissAppBanner();
    checkLoginWall();
    trackCurrentVideo();
    dumpDomOnce();
  }

  log('PACE TikTok PoC 주입 완료 — ended 이벤트로만 다음 영상 이동(강제 재시도 루프 제거, 2026-08-12)');
  trackCurrentVideo();
  startEndedObserver();
  setInterval(houseKeeping, 3000);
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
