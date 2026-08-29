// iOS 첫 영상 로딩 워밍 — 홈에서 "연결 중" 애니메이션이 도는 ~1.2초 동안 유튜브 페이지를
// 미리 받아 둔다.
//
// ── 왜 필요한가 (2026-08-28 측정) ──
// iOS 피드는 유튜브 **모바일 웹페이지 전체**를 WebView에 띄운다(유튜브 앱처럼 보이게 하려는
// 설계). 그 페이지는 HTML만 646KB에 <script> 30개고, 그게 다 받아진 뒤에야 유튜브 SPA가
// 부팅하고 그제서야 영상을 요청한다. 서버는 병목이 아니다 — 시드는 0.27~0.33초에 온다.
//
// 게다가 프리로드가 **한 번도 쓰이지 않는다**. feed/index.tsx 가 preload prop 을 넘기지 않는데,
// ⚠️ 더 중요한 건 **넘겨서도 안 된다**는 것이다(2026-08-28 확인). NAV_MODE 가 'swipe' 고정이라
//    항상 INJECTED_JS_SWIPE 가 주입되는데 거기엔 paceActivate 도 __pacePreload 도 없다(각각 0건).
//    그 둘은 주입되지 않는 INJECTED_JS 쪽에만 있다. 즉 preload 는 껍데기만 남았다 — 지금
//    preload={true} 를 넘기면 로딩 커버가 사라지고 데드맨 감시가 꺼지며 영상이 **소리를 내며
//    자동재생**된다. 되살리려면 INJECTED_JS_SWIPE 안에 구현부터 해야 한다.
// 그래서 여기서는 플레이어의 preload 에 기대지 않고 **별도의 조용한 WebView** 로 데운다.
//
// 홈의 ConnectingOverlay는 iOS에서 2단계 × 450ms + 300ms = 약 1,200ms를 반드시 머문다.
// 그 시간을 놀리지 않고 워밍에 쓴다.
//
// ⚠️ 이 워밍이 **실제로 이득이 되려면 피드가 같은 영상을 열어야 한다.** 그래서 여기서 고른
//    videoId를 shortsEntry에 넣어두고(setWarmedSeed), useShortsQueueStore가 그걸 먼저 쓴다.
//    다른 영상을 열면 유튜브의 공용 JS 캐시만 데워지고 그 영상의 HTML은 다시 받는다.
//
// ⚠️ 소리는 절대 나면 안 된다. mediaPlaybackRequiresUserAction으로 자동재생을 막고,
//    주입 JS로 모든 <video>를 음소거·정지시킨다(이중 방어).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getShortsSeedVideoId, setWarmedSeed } from '../../services/shortsEntry';
import { getRecentSearchQuery } from '../../store/useShortsSearchStore';
import { youtubeLocale, consentCookie, acceptLanguageHeader } from './YouTubeShortsPlayer';

// 자동재생 차단이 뚫려도 소리가 나지 않도록 하는 2차 방어.
const SILENCE_JS = `(function(){
  try {
    var kill = function () {
      var v = document.getElementsByTagName('video');
      for (var i = 0; i < v.length; i++) { v[i].muted = true; v[i].volume = 0; try { v[i].pause(); } catch (e) {} }
    };
    kill();
    setInterval(kill, 300);
  } catch (e) {}
})(); true;`;

export function ShortsWarmup({ active }: { active: boolean }) {
  const [videoId, setVideoId] = useState<string | null>(null);
  // 한 번 데운 뒤에는 다시 안 한다 — 연결 화면이 여러 번 떠도 매번 1MB를 다시 받으면
  // 데이터만 축낸다(캐시가 살아 있으면 어차피 두 번째 워밍은 이득이 없다).
  const doneRef = useRef(false);
  // 로드가 실제로 끝났는지 — 이게 true 가 되면 WebView 를 내려 메모리를 돌려준다.
  const warmedRef = useRef(false);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!active || doneRef.current) return;
    let cancelled = false;
    // 시드를 못 구해도 조용히 포기한다 — 워밍은 어디까지나 최적화라 실패해도 진입은 정상이다.
    // 🔴 2026-08-30 — 최근 검색이 있으면 큐(useShortsQueueStore.loadInitial)가 **검색 시드를
    //   먼저 쓰고 return** 하므로 여기서 데운 영상은 열리지 않는다. 그대로 두면 1MB 를 받아
    //   통째로 버리는 셈이라, 그 경우엔 아예 데우지 않는다(우선순위는 큐 쪽 그대로 유지).
    getRecentSearchQuery()
      .then((q: string | null) => (q ? null : getShortsSeedVideoId()))
      .then((id: string | null) => {
        if (cancelled || !id) return;
        doneRef.current = true;
        setWarmedSeed(id); // 피드가 같은 영상을 열게 해야 워밍이 의미가 있다
        setVideoId(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active]);

  // 연결 화면이 사라지면(=피드로 이동) 즉시 언마운트해 메모리를 돌려준다. 디스크 캐시는
  // WKWebsiteDataStore가 앱 전역으로 공유하므로 언마운트해도 데운 효과는 남는다.
  // 🔴 doneRef 는 effect 만 막는다. videoId 는 state 에 남으므로, 가드를 여기에도 두지 않으면
  //   연결 화면이 두 번째로 뜰 때 WebView 가 **낡은 videoId 로 리마운트되어 1MB 를 다시 받는다.**
  //   게다가 그때는 setWarmedSeed 가 다시 불리지 않아 피드는 새 시드를 고르므로, 받은 1MB 가
  //   통째로 헛수고가 된다. 한 번 데웠으면 그것으로 끝낸다.
  if (!active || !videoId || warmedRef.current) return null;

  const { hl, gl } = youtubeLocale();
  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        source={{
          uri: `https://www.youtube.com/shorts/${videoId}?hl=${hl}&gl=${gl}&persist_hl=1&persist_gl=1`,
          headers: { Cookie: consentCookie(hl, gl), 'Accept-Language': acceptLanguageHeader() },
        }}
        // 플레이어와 같은 UA — 다르면 유튜브가 다른 페이지를 주고 캐시도 안 맞는다.
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        injectedJavaScriptBeforeContentLoaded={SILENCE_JS}
        injectedJavaScript={SILENCE_JS}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        // 소리·재생 원천 차단: 사용자 제스처 없이는 미디어가 시작되지 않는다.
        mediaPlaybackRequiresUserAction
        allowsInlineMediaPlayback={false}
        scrollEnabled={false}
        // 워밍 중 다른 곳으로 튀지 않게 — 쇼츠 페이지 자체만 받는다.
        onShouldStartLoadWithRequest={(req) => req.url.startsWith('https://www.youtube.com/')}
        // 실패해도 조용히 넘어간다. 워밍 실패가 진입을 막아서는 안 된다.
        // 다 받았으면 내린다 — 더 들고 있어도 이득이 없고 메모리만 쓴다.
        onLoadEnd={() => {
          warmedRef.current = true;
          forceRender((v) => v + 1);
        }}
        onError={() => {}}
        onHttpError={() => {}}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 0×0은 WebView가 로드를 시작하지 않을 수 있어 1×1로 둔다. 화면 밖으로 밀어 눈에 안 보이게 한다.
  hidden: { position: 'absolute', left: -9999, top: -9999, width: 1, height: 1, opacity: 0 },
  web: { width: 1, height: 1 },
});
