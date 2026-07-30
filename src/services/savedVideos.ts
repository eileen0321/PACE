import { Platform } from 'react-native';
import { bluetoothService } from './platform';
import { addSavedVideo, type SavedVideo, type SavedVideoKind } from '../database/repositories/savedVideosRepository';

// 2026-07-31 사장님 지시(오버레이 P 메뉴) — Favorite("다시 보려고 저장")/Capture("공유하려고 저장")
// 둘 다 "지금 유튜브에 떠 있는 영상 정보를 읽어서 저장" 흐름을 공유한다. Android는 실제 정보를
// 읽어오고(bluetoothService.captureCurrentVideoInfo), iOS는 이 오버레이 자체가 없어 no-op.
export async function addCurrentVideo(userId: string, kind: SavedVideoKind): Promise<SavedVideo | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const info = await bluetoothService.captureCurrentVideoInfo();
    // videoId/title/channel 전부 못 얻었으면(공유시트 실패 + 텍스트 추출도 실패) 빈 항목을 저장해봤자
    // 사용자에게 아무 의미가 없으니 저장 자체를 스킵 — "실패를 조용히 무시"보다 null 반환으로 알려줘서
    // 호출부(UI)가 "추가 실패" 토스트를 띄울 수 있게 한다.
    if (!info.title && !info.videoId) return null;
    return await addSavedVideo({
      userId,
      kind,
      videoId: info.videoId,
      title: info.title,
      channel: info.channel,
      url: info.url,
      platformApp: 'youtube',
    });
  } catch (e) {
    console.warn('[savedVideos] addCurrentVideo failed', e);
    return null;
  }
}
