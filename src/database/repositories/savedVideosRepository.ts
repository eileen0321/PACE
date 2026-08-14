import { getDb } from '../db';

// 2026-07-31 사장님 지시 — 오버레이 P 메뉴의 Favorite(다시 보려고 저장)/Capture(공유하려고 저장)
// 둘 다 이 저장소를 공유한다(데이터 모양이 동일 — kind로만 구분). 실제 스크린샷은 안 찍는다(MediaProjection
// 권한 불필요 결정, PACE_PROJECT_MANAGEMENT.md 2026-07-31 참고) — thumbnailUrl은 유튜브 공식 썸네일
// URL을 videoId만으로 즉시 구성한다.
export type SavedVideoKind = 'favorite' | 'capture';

export type SavedVideo = {
  id: string;
  userId: string;
  kind: SavedVideoKind;
  videoId: string | null;
  title: string | null;
  channel: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  platformApp: string | null;
  addedAt: string;
};

// 유튜브 공식 썸네일 URL 컨벤션 — 별도 API 호출/권한 없이 videoId만으로 항상 구성 가능.
// hqdefault는 거의 모든 영상에 존재(maxresdefault는 일부 영상엔 없어 깨진 이미지가 될 수 있음).
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

type SavedVideoRow = {
  id: string;
  user_id: string;
  kind: string;
  video_id: string | null;
  title: string | null;
  channel: string | null;
  url: string | null;
  thumbnail_url: string | null;
  platform_app: string | null;
  added_at: string;
};

function rowToSavedVideo(row: SavedVideoRow): SavedVideo {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as SavedVideoKind,
    videoId: row.video_id,
    title: row.title,
    channel: row.channel,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    platformApp: row.platform_app,
    addedAt: row.added_at,
  };
}

export async function addSavedVideo(params: {
  userId: string;
  kind: SavedVideoKind;
  videoId: string | null;
  title: string | null;
  channel: string | null;
  url: string | null;
  platformApp: string | null;
  // 2026-08-15 안드 파리티(64730a1의 thumbnailOverride) — youtubeThumbnailUrl(videoId)는 유튜브
  // 전용 공식 썸네일 URL 컨벤션이라 videoId만으로 구성 가능하지만, 틱톡은 그런 컨벤션이 없어
  // videoId(숫자 ID)로 만들면 깨진 URL이 된다. 준 값이 있으면 그걸 그대로 쓰고, 없으면(유튜브)
  // 기존처럼 videoId로 구성한다.
  thumbnailOverride?: string | null;
}): Promise<SavedVideo> {
  const db = await getDb();
  const id = `sv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const addedAt = new Date().toISOString();
  const thumbnailUrl = params.thumbnailOverride !== undefined ? params.thumbnailOverride : (params.videoId ? youtubeThumbnailUrl(params.videoId) : null);
  await db.runAsync(
    `INSERT INTO saved_videos (id, user_id, kind, video_id, title, channel, url, thumbnail_url, platform_app, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, params.userId, params.kind, params.videoId, params.title, params.channel, params.url, thumbnailUrl, params.platformApp, addedAt]
  );
  return {
    id,
    userId: params.userId,
    kind: params.kind,
    videoId: params.videoId,
    title: params.title,
    channel: params.channel,
    url: params.url,
    thumbnailUrl,
    platformApp: params.platformApp,
    addedAt,
  };
}

// 🔴 2026-08-15 — 안드로이드(64730a1 "틱톡 즐겨찾기 — 유튜브용/틱톡용 리스트 분리")와 동일한 파리티
// 갭이 iOS에도 있었다: addSavedVideo는 platformApp을 저장하는데(692cc86) 조회는 그걸 전혀 안 걸러서
// 유튜브/틱톡 즐겨찾기가 한 리스트에 섞여 있었다. platform을 주면 그 값(+구버전 platform_app이 NULL인
// 행 — 이 컬럼 도입 전에 저장된, 전부 유튜브였던 행)만 반환한다. 안 주면(예: Focus 탭 전체 목록처럼
// "지금 보는 특정 플랫폼"이 없는 화면) 기존처럼 전부 반환 — 호출부 전수 변경 불필요.
export async function getSavedVideos(userId: string, kind: SavedVideoKind, platform?: string): Promise<SavedVideo[]> {
  const db = await getDb();
  // 2026-08-01 사장님 지시 — Saved/Favorite 병합(네이티브 P 메뉴와 동일). 'favorite' 조회 시 예전
  // 'capture' 저장분도 같은 리스트에 함께 보여준다(마이그레이션 없이 조회 시점 병합). 'capture'는 P
  // 메뉴에서 제거됐지만 타입/호출 호환을 위해 유지.
  const kinds: SavedVideoKind[] = kind === 'favorite' ? ['favorite', 'capture'] : [kind];
  const placeholders = kinds.map(() => '?').join(',');
  const platformClause = platform ? (platform === 'youtube' ? 'AND (platform_app = ? OR platform_app IS NULL)' : 'AND platform_app = ?') : '';
  const rows = await db.getAllAsync<SavedVideoRow>(
    `SELECT * FROM saved_videos WHERE user_id = ? AND kind IN (${placeholders}) ${platformClause} ORDER BY added_at DESC`,
    platform ? [userId, ...kinds, platform] : [userId, ...kinds]
  );
  return rows.map(rowToSavedVideo);
}

// 2026-08-09 파리티 — 안드로이드 PaceOverlayService의 oEmbed 제목 보정(2026-08-05)과 동일 목적.
// videoId는 아는데 title이 비어 저장된 행(접근성 트리 값을 못 읽은 경로 등)의 제목/채널을 나중에 채운다.
export async function updateSavedVideoMeta(id: string, title: string | null, channel: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE saved_videos SET title = ?, channel = ? WHERE id = ?`, [title, channel, id]);
}

export async function removeSavedVideo(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM saved_videos WHERE id = ?`, [id]);
}

// 같은 영상을 중복 저장하지 않기 위한 존재 확인(videoId가 있을 때만 의미 있음 — 추출 실패로
// videoId가 null인 저장 건은 매번 새로 추가되게 둔다, 중복 방지보다 "일단 저장되게"가 우선).
export async function isVideoSaved(userId: string, kind: SavedVideoKind, videoId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM saved_videos WHERE user_id = ? AND kind = ? AND video_id = ? LIMIT 1`,
    [userId, kind, videoId]
  );
  return !!row;
}
