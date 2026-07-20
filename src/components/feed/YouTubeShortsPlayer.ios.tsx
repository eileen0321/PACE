import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import YoutubePlayer, { type YoutubeIframeRef } from 'react-native-youtube-iframe';

// ⚠️ 플랫폼 분리(2026-07-20): iOS 전용. 같은 폴더 YouTubeShortsPlayer.tsx는 Android 전용(원본페이지).
// iOS는 공식 임베드(합법)로 간다.
//
// ── 왜 react-native-youtube-iframe인가 (2026-07-20 iOS 실검증 + 웹리서치) ───────────────────────
// 직접 IFrame/embed(new YT.Player를 loadHTMLString으로, 또는 /embed URI 직접 로드)는 iOS WKWebView에서
// **재생이 안 붙는다**(error 152 또는 <video> readyState 0). 근본 원인은 WKWebView가 cross-origin
// 요청에 **HTTP Referer를 안 보내는 WebKit 버그(#169846)** — YouTube가 Referer로 임베드를 검증하므로
// 스트림을 거부한다. nocookie 도메인·Referer 헤더로도 해결 안 됨(후속 스트림 요청의 Referer까지 strip).
// react-native-youtube-iframe은 플레이어 HTML을 **실제 호스팅 URL(DEFAULT_BASE_URL)** 에서 로드해
// origin/Referer를 확보 → 이 문제를 우회한다. iOS 실검증: onReady 정상 수신, 영상 프레임 표시됨(152 없음).
//
// ⚠️ 남은 iOS 제약(플랫폼 한계, 라이브러리 문제 아님): iOS는 **사용자 제스처 없는 자동재생을 차단**해
// (무음이어도) 영상이 재생버튼 상태로 멈춘다(play prop=true여도). 사용자가 영상을 한 번 탭하면 재생되고,
// 같은 WebView에서 loadVideoById로 다음 영상을 이어재생하므로 첫 탭 이후 auto-next는 hands-free 가능성이
// 높다(무탭 시뮬레이터에서 첫 탭 이후 동작은 실기기 검증 필요). mute는 자동재생 시도 성공률을 위해 유지.
// TODO(제품): 첫 진입 시 "탭해서 시작" 오버레이 or 첫 영상만 사용자 탭 유도.

type Props = {
  videoId: string;
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
  /** 재생 진행률(0~1) 1초마다 보고 — 피드가 "영상 1/2지점부터 고개짓 카메라 ON" 배터리 게이팅에 사용. */
  onProgress?: (fraction: number) => void;
};

export function YouTubeShortsPlayer({ videoId, playing, onEnded, onReady, onError, onProgress }: Props) {
  const { width } = useWindowDimensions();
  const playerRef = useRef<YoutubeIframeRef>(null);
  const [ready, setReady] = useState(false);

  // 2026-07-21 실기기/시뮬에서 발견: YouTube IFrame 임베드는 **항상 16:9**로 렌더된다(세로 영상도
  // 임베드 안에선 16:9 프레임에 필러박스). height=화면전체로 주면 영상이 위쪽 16:9 띠에만 뜨고 아래가
  // 전부 검정 → 사용자에겐 "까만 화면"으로 보였다. 그래서 플레이어 높이를 16:9로 명시하고 검은 배경
  // 정중앙에 세로 정렬(의도된 레터박스). YouTube 임베드 정책상 진짜 풀블리드 9:16은 불가.
  const playerHeight = Math.round((width * 9) / 16);

  // 영상 바뀌면 ready 리셋(다음 플레이어 onReady 대기).
  useEffect(() => { setReady(false); }, [videoId]);

  // ⚠️ getCurrentTime/getDuration은 YT.Player가 준비된 뒤(onReady)에만 호출해야 한다 — 그 전에
  // 부르면 WebView 안에서 'player.getCurrentTime is not a function' 예외가 1초마다 뜬다(실기기
  // 로그로 발견). ready일 때만 폴링.
  useEffect(() => {
    if (!ready || !onProgress) return;
    const iv = setInterval(async () => {
      try {
        const ref = playerRef.current;
        if (!ref) return;
        const [cur, dur] = await Promise.all([ref.getCurrentTime(), ref.getDuration()]);
        if (dur > 0) onProgress(Math.min(1, cur / dur));
      } catch {}
    }, 1000);
    return () => clearInterval(iv);
  }, [ready, onProgress]);

  return (
    <View style={styles.container}>
      <YoutubePlayer
        ref={playerRef}
        height={playerHeight}
        width={width}
        play={playing}
        mute
        videoId={videoId}
        initialPlayerParams={{ controls: false, modestbranding: true, rel: false, loop: false, preventFullScreen: true }}
        webViewProps={{
          allowsInlineMediaPlayback: true,
          mediaPlaybackRequiresUserAction: false,
          scrollEnabled: false,
        }}
        onReady={() => { console.log('[YTPlayer] ✅ ready', videoId); setReady(true); onReady?.(); }}
        onChangeState={(state: string) => { console.log('[YTPlayer] state=', state, videoId); if (state === 'ended') onEnded(); }}
        onError={(e: string) => { console.log('[YTPlayer] ❌ ERROR', e, videoId); onError?.(-1); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', overflow: 'hidden', justifyContent: 'center' },
});
