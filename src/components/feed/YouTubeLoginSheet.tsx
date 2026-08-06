import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

// 2026-08-05 사장님 지시("유튜브가 로그인 되어 있으면 iOS도 안드로이드처럼 동작하는 거 아냐?
// 이것도 고치라고") — 맞는 지적이라 로그인 경로를 만든다.
//
// ── 왜 필요한가 ──
// 안드로이드는 실제 유튜브 앱으로 넘겨서 사용자 계정의 개인 추천을 그대로 탄다. iOS는 앱 안 WebView라
// 세션이 **익명**이고, 익명 세션의 "다음 쇼츠"는 개인화가 아니라 언어·지역 인기다(그래서 영어가 나왔다).
// 언어·지역은 YouTubeShortsPlayer.ios.tsx에서 맞췄지만, 그건 어디까지나 차선책이다 — 진짜 파리티는
// 그 WebView 세션이 사용자 계정으로 로그인돼 있을 때 나온다.
//
// ── 왜 이렇게(앱 안에서 직접 로그인) 하는가 ──
// iOS는 앱 샌드박스 때문에 **사파리나 유튜브 앱의 로그인 쿠키를 가져올 수 없다.** 그래서 우리 WebView
// 안에서 한 번 로그인하는 것 외에 방법이 없다. 대신 WebView가 sharedCookiesEnabled라 한 번 로그인하면
// 쿠키가 앱 쿠키 저장소에 남아 이후 피드가 계속 그 계정으로 돈다(매번 로그인시키지 않는다).
//
// ⚠️ 실기기 검증 필요(Mac 세션) — 구글은 "임베디드 WebView에서의 계정 로그인"을 차단하는 정책이 있다
// (disallowed_useragent). 우리는 깨끗한 사파리 UA를 쓰기 때문에 통과할 가능성이 있지만, 그건 실기기로
// 확인해야 확정된다. 막히면 이 시트가 구글 오류 페이지를 그대로 보여주게 되므로, 그 경우엔 로그인 경로
// 자체를 접고 언어·지역 차선책만 남기는 판단이 필요하다(사파리로 로그인시켜도 쿠키가 공유되지 않아
// 우회가 되지 않는다 — 위 샌드박스 제약).
const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F';

// 플레이어와 동일한 UA를 써야 한다 — UA가 다르면 로그인 세션이 다른 브라우저 것으로 취급돼
// 정작 피드 WebView에서 로그인이 안 먹은 것처럼 보일 수 있다.
const SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// 2026-08-06 — 구글은 "임베디드 웹뷰에서의 로그인"을 disallowed_useragent로 차단할 수 있다(2023-07-24부터
// 시행된 문서화된 정책, iOS WKWebView가 명시적 대상). 실기기 검증 전이라 확정은 못 하지만, 막히면 구글의
// 날것 에러 페이지(예: "This browser or app may not be secure")를 그대로 보여주는 게 "없는 것만 못하다"
// (핸드오프 문서 §5). 그래서 URL의 에러 파라미터 + 페이지 텍스트 두 신호로 차단을 감지해 조용히 닫고
// 안내 문구로 대체한다 — 실제로 되면 이 코드는 그냥 아무 일도 안 한다(무해).
const BLOCK_TEXT_PATTERNS = [
  'disallowed_useragent',
  'this browser or app may not be secure',
  '이 브라우저 또는 앱은 안전하지 않을 수 있습니다',
];
const DETECT_BLOCK_JS = `
(function () {
  function check() {
    try {
      var text = (document.body && document.body.innerText || '').toLowerCase();
      var href = ('' + location.href).toLowerCase();
      var patterns = ${JSON.stringify(BLOCK_TEXT_PATTERNS)};
      for (var i = 0; i < patterns.length; i++) {
        var p = patterns[i].toLowerCase();
        if (text.indexOf(p) >= 0 || href.indexOf(p) >= 0) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage('BLOCKED');
          return;
        }
      }
    } catch (e) {}
  }
  check();
  setTimeout(check, 800);
  setTimeout(check, 2000);
})();
true;
`;

export function YouTubeLoginSheet({
  onClose,
  onSignedIn,
  onBlocked,
}: {
  onClose: () => void;
  onSignedIn: () => void;
  /** 구글이 임베디드 웹뷰 로그인을 막은 것으로 보임 — 부모가 안내 토스트를 띄우고 시트를 닫아야 한다. */
  onBlocked: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);

  return (
    <View style={styles.backdrop}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('feed.youtubeSignIn')}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('feed.close')}>
            <Feather name="x" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Text style={styles.desc}>{t('feed.youtubeSignInDesc')}</Text>
        <View style={styles.webWrap}>
          <WebView
            source={{ uri: LOGIN_URL }}
            userAgent={SAFARI_UA}
            sharedCookiesEnabled
            javaScriptEnabled
            domStorageEnabled
            injectedJavaScript={DETECT_BLOCK_JS}
            onLoadEnd={() => setLoading(false)}
            // ⚠️ onHttpError로도 감지하려 했으나 뺐다 — 구글 로그인 페이지는 폰트/추적픽셀/광고스크립트 등
            // 수십 개의 서브리소스를 로드하고, react-native-webview 문서가 onHttpError를 메인 프레임으로
            // 한정하는지 명시하지 않는다(확인 불가). 서브리소스 하나만 404여도 오탐으로 정상 로그인 중에
            // 시트가 닫힐 위험이 있어, URL 패턴 + 페이지 텍스트라는 더 정밀한 신호 두 개만 쓴다.
            onMessage={(e) => {
              if (e.nativeEvent.data === 'BLOCKED') onBlocked();
            }}
            // 로그인이 끝나면 continue= 대상(youtube.com)으로 돌아온다 — 그 순간이 성공 신호다.
            // 여기서 시트를 닫고 부모가 플레이어를 리로드하면 새 쿠키(=계정)로 다시 붙는다.
            onNavigationStateChange={(nav) => {
              if (!nav.url) return;
              if (nav.url.toLowerCase().includes('disallowed_useragent')) { onBlocked(); return; }
              if (/^https:\/\/(www|m)\.youtube\.com\//.test(nav.url)) onSignedIn();
            }}
          />
          {loading && (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 2000 },
  sheet: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.bodyFontFamilyBold },
  desc: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  webWrap: { flex: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, overflow: 'hidden' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
