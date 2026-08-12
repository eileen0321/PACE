import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
import { sharedShortsPlayerStyles as styles, type ShortsPlayerHandle } from './sharedShortsPlayer';

// Android(.tsx, .ios.tsx 없는 쪽)는 이 웹뷰 피드를 /feed로 안 쓴다(네이티브 오버레이 +
// 실제 TikTok 앱 실행 경로, supportedApps.ts 참고) — YouTubeShortsPlayer.tsx와 같은 이유로,
// Metro가 feed/index.tsx를 안드 빌드에서도 번들해야 해서 임포트가 해석될 자리만 채우는 no-op.
type Props = { playing: boolean; onEnded: () => void; onReady?: () => void; onError?: (code: number) => void; onProgress?: (fraction: number) => void };

export const TikTokShortsPlayer = forwardRef<ShortsPlayerHandle, Props>(function TikTokShortsPlayer(_props, ref) {
  useImperativeHandle(ref, () => ({ advance: () => {}, previous: () => {}, setMuted: () => {} }), []);
  return <View style={styles.container} />;
});
