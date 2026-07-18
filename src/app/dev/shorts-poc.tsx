import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors, radius, spacing, typography } from '../../constants/theme';

// ⚠️⚠️ DEV 전용 · 프로덕션/스토어 제출 금지 ⚠️⚠️
// PACE_ARCHITECTURE.md "iOS 전략 확정 — 원안 ①의 처리" 참고. 원안 ①(WKWebView로 YouTube Shorts를
// 감싸 자동넘김)은 YouTube 약관 위반 + Apple 4.2/5.2.5 리스크(MEDIUM-HIGH)로 출시 토대에서 제외됐다.
// 이 화면은 "그래도 기술적으로 자동넘김이 되는가"(POC #5)와 "어떤 예외 레이아웃에서 깨지는가"(#7)를
// Mac 실기기에서 눈으로 검증하기 위한 버리는 실험일 뿐이다. __DEV__에서만 접근한다(아래 가드).
//
// 주입 스크립트는 문서 POC #5의 3단계 폴백 체인 + (모바일 웹 Virtualized Feed 대비) TouchEvent
// 스와이프 시뮬레이션 폴백을 더한 것. RN WebView는 window.ReactNativeWebView.postMessage로 로그를 준다.
const INJECTED_JS = `
(function() {
  function log(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify({t:Date.now(), m:m})); } catch(e){} }
  function attach(video){
    if (!video || video.__paceHooked) return;
    video.__paceHooked = true;
    video.addEventListener('ended', function(){
      log('ENDED → 다음 이동 시도');
      // A: Shorts 스크롤 컨테이너
      var c = document.querySelector('#shorts-container') || document.querySelector('ytd-shorts') || document.querySelector('#shorts-inner-container');
      if (c) { c.scrollBy({ top: window.innerHeight, behavior: 'smooth' }); log('A: 컨테이너 scrollBy'); return; }
      // B: 현재 렌더러의 다음 형제
      var cur = video.closest('ytd-reel-video-renderer') || video.closest('.reel-video-in-sequence') || video.closest('.shorts-video-container');
      var nx = cur ? cur.nextElementSibling : null;
      if (nx) { nx.scrollIntoView({ behavior: 'smooth' }); log('B: nextSibling scrollIntoView'); return; }
      // C: TouchEvent 스와이프 시뮬레이션(Virtualized Feed 대비)
      try {
        var y0 = window.innerHeight*0.8, y1 = window.innerHeight*0.2, x = window.innerWidth/2;
        var el = document.elementFromPoint(x, y0) || document.body;
        function tev(type, y){ var t = new Touch({identifier:1, target:el, clientX:x, clientY:y});
          return new TouchEvent(type, {cancelable:true, bubbles:true, touches:type==='touchend'?[]:[t], targetTouches:type==='touchend'?[]:[t], changedTouches:[t]}); }
        el.dispatchEvent(tev('touchstart', y0));
        el.dispatchEvent(tev('touchmove', y1));
        el.dispatchEvent(tev('touchend', y1));
        log('C: TouchEvent 스와이프 시뮬레이션');
      } catch(e){ log('C 실패: '+e.message); window.scrollBy({top: window.innerHeight}); }
    });
    log('video 후킹 완료');
  }
  var v = document.querySelector('video');
  if (v) attach(v);
  // Virtualized Feed는 새 video 노드가 계속 들어오므로 MutationObserver로 재부착.
  var mo = new MutationObserver(function(){ var nv = document.querySelector('video'); if (nv) attach(nv); });
  mo.observe(document.documentElement, { childList:true, subtree:true });
  log('Pace PoC 주입 완료');
})();
true;
`;

export default function ShortsPocScreen() {
  const router = useRouter();
  const webRef = useRef<WebView>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);

  // 프로덕션 안전장치: __DEV__가 아니면 아무것도 렌더하지 않는다.
  if (!__DEV__) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>This screen is dev-only.</Text>
      </View>
    );
  }

  const pushLog = (m: string) => setLogs((prev) => [m, ...prev].slice(0, 40));

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ uri: 'https://m.youtube.com/shorts' }}
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
        userAgent={Platform.OS === 'ios'
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : undefined}
      />

      <SafeAreaView style={styles.uiLayer} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>
          <View style={styles.devPill}>
            <Feather name="alert-triangle" size={12} color={colors.warning} />
            <Text style={styles.devPillText}>DEV POC · 출시 금지</Text>
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
          {logs.length === 0 && <Text style={styles.logLine}>대기 중 — Shorts 로드/재생 후 로그가 뜹니다</Text>}
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
