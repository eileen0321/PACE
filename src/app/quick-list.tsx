import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUserStore } from '../store/useUserStore';
import { SavedVideoListOverlay } from '../components/overlays/SavedVideoListOverlay';
import type { SavedVideoKind } from '../database/repositories/savedVideosRepository';

// 2026-07-31 사장님 지시 — 오버레이 네이티브 알약의 "P" 버튼 메뉴에서 Saved/Favorite을 고르면
// 여기로 온다. quick-control-sheet.tsx와 동일한 이유로 transparentModal 프레젠테이션(_layout.tsx
// 등록) — RN <Modal>은 edge-to-edge 내비게이션 바 투명도를 못 물려받는 알려진 업스트림 한계
// (expo/expo#39749) 때문에 이 방식을 계속 따른다. 네이티브 P 메뉴는 실제 앱(Activity)을 전경으로
// 가져오는 딥링크(pace://quick-list?kind=favorite)로 여기 도달 — 세션 자체는 네이티브 오버레이가
// 그대로 유지하므로 화면 전환이 세션을 끊지 않는다(overlay/index.tsx의 appIconBtn과 동일 원칙).
export default function QuickListScreen() {
  const { kind } = useLocalSearchParams<{ kind: SavedVideoKind }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);

  if (!user?.id) return null;

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <SavedVideoListOverlay
        userId={user.id}
        kind={kind === 'capture' ? 'capture' : 'favorite'}
        onClose={() => router.back()}
      />
    </View>
  );
}
