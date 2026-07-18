// Pexels Video API 클라이언트 — Pace Feed(iOS 대체 피드)의 실제 콘텐츠 출처.
// Pexels 라이선스: 상업적 이용 무료, 출처표기 불필요(https://www.pexels.com/license/) — YouTube/IG
// 콘텐츠와 달리 자체 플레이어에서 재생·자동넘김·리스킨이 100% 합법이다.
// PACE_ARCHITECTURE.md "iOS 전략 확정" 참고.
//
// 키: EXPO_PUBLIC_PEXELS_KEY (무료 발급 https://www.pexels.com/api/). 미설정 시 DEV 샘플 피드로 폴백.
import type { PaceFeedCategory, PaceVideo } from '../../types/models';
import { DEV_SAMPLE_FEED, PACE_FEED_CATEGORIES } from '../../constants/paceFeed';

const PEXELS_BASE = 'https://api.pexels.com/videos';
export const PEXELS_KEY = process.env.EXPO_PUBLIC_PEXELS_KEY || '';

export function hasPexelsKey(): boolean {
  return PEXELS_KEY.length > 0;
}

type PexelsVideoFile = {
  id: number;
  quality: string; // 'hd' | 'sd' | 'uhd'
  file_type: string; // 'video/mp4' 등
  width: number | null;
  height: number | null;
  link: string;
};
type PexelsVideo = {
  id: number;
  duration: number;
  image: string;
  width: number;
  height: number;
  user?: { name?: string };
  video_files: PexelsVideoFile[];
};
type PexelsSearchResponse = { videos?: PexelsVideo[] };

// 세로(height ≥ width) mp4 중 ~1080p에 가장 가까운 파일을 고른다 — 너무 큰 uhd는 모바일 대역폭 낭비.
function pickPortraitFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4 = files.filter((f) => f.file_type === 'video/mp4' && !!f.link);
  if (mp4.length === 0) return null;
  const portrait = mp4.filter((f) => (f.height ?? 0) >= (f.width ?? 0));
  const pool = portrait.length ? portrait : mp4;
  const sorted = [...pool].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  return sorted.find((f) => (f.height ?? 0) >= 1000) ?? sorted[sorted.length - 1] ?? null;
}

function toPaceVideo(v: PexelsVideo, category: PaceFeedCategory): PaceVideo | null {
  const file = pickPortraitFile(v.video_files);
  if (!file) return null;
  return {
    id: `pexels_${v.id}`,
    title: category.charAt(0).toUpperCase() + category.slice(1),
    creator: v.user?.name || 'Pexels',
    durationSeconds: v.duration || 0,
    url: file.link,
    thumbnailUrl: v.image || null,
    width: file.width ?? v.width,
    height: file.height ?? v.height,
    category,
    source: 'pexels',
  };
}

export type FetchFeedOptions = {
  category?: PaceFeedCategory;
  page?: number;
  perPage?: number;
};

/** Pace Feed를 가져온다. 키 없으면 DEV 샘플로 폴백(해당 카테고리로 필터). */
export async function fetchPaceFeed(opts: FetchFeedOptions = {}): Promise<PaceVideo[]> {
  const category = opts.category ?? 'calm';
  if (!hasPexelsKey()) {
    const filtered = DEV_SAMPLE_FEED.filter((v) => v.category === category);
    return filtered.length ? filtered : DEV_SAMPLE_FEED;
  }

  const meta = PACE_FEED_CATEGORIES.find((c) => c.key === category);
  const params = new URLSearchParams({
    query: meta?.query ?? category,
    orientation: 'portrait',
    size: 'medium',
    page: String(opts.page ?? 1),
    per_page: String(opts.perPage ?? 15),
  });

  const res = await fetch(`${PEXELS_BASE}/search?${params.toString()}`, {
    headers: { Authorization: PEXELS_KEY },
  });
  if (!res.ok) {
    throw new Error(`PEXELS_ERROR ${res.status}`);
  }
  const json = (await res.json()) as PexelsSearchResponse;
  return (json.videos ?? [])
    .map((v) => toPaceVideo(v, category))
    .filter((v): v is PaceVideo => v !== null);
}
