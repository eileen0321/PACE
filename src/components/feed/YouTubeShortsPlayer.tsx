import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// YouTube 공식 IFrame Player API를 react-native-webview에 임베드한 순차 재생 플레이어.
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의" 참고 — 재생은 반드시 공식 IFrame으로(합법), 스트림을
// 긁지 않는다. videoId prop이 바뀌면 loadVideoById로 "이어붙여" 재생(WebView 재생성 없이).
//
// ⚠️ IFrame 한계: YouTube 브랜딩/광고/일부 컨트롤은 못 벗김(controls=0, modestbranding으로 최소화만).
// 광고가 끝나야 다음 영상 ended가 오므로 순차 재생 타이밍이 광고 영향을 받을 수 있음.

type Props = {
  /** 지금 재생할 Short의 videoId. 부모(feed)가 큐가 비어있지 않을 때만 렌더한다. */
  videoId: string;
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
};

// 초기 videoId 없이 플레이어를 만들고, ready 이후 loadVideoById로 실제 영상을 로드한다
// (first/subsequent 분기 없이 항상 inject로 통일).
const PLAYER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { margin:0; padding:0; }
  html,body { background:#000; height:100%; overflow:hidden; }
  #player { width:100vw; height:100vh; }
</style>
</head>
<body>
<div id="player"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
  var player;
  function send(o){ if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); } }
  function onYouTubeIframeAPIReady(){
    player = new YT.Player('player', {
      height: '100%', width: '100%', videoId: '',
      playerVars: { autoplay:1, controls:0, modestbranding:1, rel:0, playsinline:1, fs:0, iv_load_policy:3 },
      events: {
        onReady: function(){ send({type:'ready'}); },
        onStateChange: function(e){
          if(e.data === YT.PlayerState.ENDED) send({type:'ended'});
          else if(e.data === YT.PlayerState.PLAYING) send({type:'playing'});
          else if(e.data === YT.PlayerState.PAUSED) send({type:'paused'});
        },
        onError: function(e){ send({type:'error', code:e.data}); }
      }
    });
  }
  window.paceLoad = function(id){ if(player && player.loadVideoById){ player.loadVideoById(id); } };
  window.pacePlay = function(){ if(player && player.playVideo){ player.playVideo(); } };
  window.pacePause = function(){ if(player && player.pauseVideo){ player.pauseVideo(); } };
</script>
</body>
</html>`;

export function YouTubeShortsPlayer({ videoId, playing, onEnded, onReady, onError }: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const loadedIdRef = useRef<string | null>(null);
  const html = useMemo(() => PLAYER_HTML, []);

  // ready + videoId 변경 시 loadVideoById 주입.
  useEffect(() => {
    if (!ready || !videoId || loadedIdRef.current === videoId) return;
    loadedIdRef.current = videoId;
    webRef.current?.injectJavaScript(`window.paceLoad(${JSON.stringify(videoId)}); true;`);
  }, [ready, videoId]);

  // 재생/일시정지 반영.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`${playing ? 'window.pacePlay()' : 'window.pacePause()'}; true;`);
  }, [ready, playing]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: 'https://www.youtube.com' }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        onMessage={(e) => {
          let msg: { type?: string; code?: number } = {};
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'ready') {
            setReady(true);
            onReady?.();
          } else if (msg.type === 'ended') {
            onEnded();
          } else if (msg.type === 'error') {
            onError?.(msg.code ?? -1);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
});
