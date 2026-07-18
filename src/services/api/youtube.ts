// YouTube Shorts 리스트 소스 — iOS Pace Feed의 "리스트 순차 재생"용(2026-07-18 사용자 지시).
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의 — YouTube Shorts 리스트 순차 재생" 참고.
//
// ⚠️ 여기서 하는 건 "영상 ID(메타) 리스트 확보"뿐이다. 실제 재생은 components/feed/YouTubeShortsPlayer가
//    공식 IFrame Player API로 한다(합법). 스트림을 긁어오지 않는다.
// 경로: (1) Data API v3(권장·합법) → (2) 없으면 스크래핑 폴백(그레이존, videoId만 파싱).
import type { YouTubeShort } from '../../types/models';

export const YOUTUBE_API_KEY = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY || '';
export function hasYouTubeKey(): boolean {
  return YOUTUBE_API_KEY.length > 0;
}

const DATA_API = 'https://www.googleapis.com/youtube/v3';

// Shorts 상한(초). Shorts는 최대 3분까지 늘었지만, "짧게 이어보기" UX상 60초 이하만 큐에 넣는다.
const MAX_SHORT_SECONDS = 60;
const DEFAULT_QUERY = '#shorts';

export type ShortsPage = {
  shorts: YouTubeShort[];
  nextPageToken: string | null;
};

// ISO8601 duration(PT#M#S) → 초.
function parseISODurationSeconds(iso: string): number {
  const m = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2] || '0', 10);
}

type SearchItem = { id?: { videoId?: string } };
type SearchResponse = { items?: SearchItem[]; nextPageToken?: string };
type VideoItem = {
  id: string;
  snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
  contentDetails?: { duration?: string };
};
type VideosResponse = { items?: VideoItem[] };

// Data API: search.list(videoDuration=short) → videos.list(contentDetails)로 ≤60s 후검증(isShort 필드가
// 없으므로 2단계 필수). search.list는 호출당 100 units이므로 배치로 크게 받고 캐시할 것.
async function fetchShortsViaDataApi(query: string, pageToken: string | null): Promise<ShortsPage> {
  const searchParams = new URLSearchParams({
    key: YOUTUBE_API_KEY,
    part: 'snippet',
    type: 'video',
    videoDuration: 'short', // <4분
    q: query,
    maxResults: '25',
    regionCode: 'US',
    relevanceLanguage: 'en',
  });
  if (pageToken) searchParams.set('pageToken', pageToken);

  const searchRes = await fetch(`${DATA_API}/search?${searchParams.toString()}`);
  if (!searchRes.ok) throw new Error(`YT_SEARCH_ERROR ${searchRes.status}`);
  const search = (await searchRes.json()) as SearchResponse;
  const ids = (search.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => !!v);
  if (ids.length === 0) return { shorts: [], nextPageToken: search.nextPageToken ?? null };

  const videosParams = new URLSearchParams({
    key: YOUTUBE_API_KEY,
    part: 'snippet,contentDetails',
    id: ids.join(','),
  });
  const videosRes = await fetch(`${DATA_API}/videos?${videosParams.toString()}`);
  if (!videosRes.ok) throw new Error(`YT_VIDEOS_ERROR ${videosRes.status}`);
  const videos = (await videosRes.json()) as VideosResponse;

  const shorts: YouTubeShort[] = (videos.items ?? [])
    .filter((v) => parseISODurationSeconds(v.contentDetails?.duration ?? '') <= MAX_SHORT_SECONDS)
    .map((v) => ({
      videoId: v.id,
      title: v.snippet?.title ?? 'Short',
      channelTitle: v.snippet?.channelTitle ?? '',
      thumbnailUrl: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url ?? null,
    }));

  return { shorts, nextPageToken: search.nextPageToken ?? null };
}

// 스크래핑 폴백(그레이존): 키/쿼터 없을 때만. YouTube 검색결과 HTML의 ytInitialData에서 videoId만 긁는다.
// 재생은 여전히 공식 IFrame이 하므로 스트림 절도가 아님. 프로덕션 기본값 아님.
async function fetchShortsViaScrape(query: string): Promise<ShortsPage> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' shorts')}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
  });
  if (!res.ok) throw new Error(`YT_SCRAPE_ERROR ${res.status}`);
  const html = await res.text();
  // videoId(11자)만 중복 제거해 추출 — 메타(제목/채널)는 스크래핑에선 생략(플레이어가 로드 시 표시).
  const ids = Array.from(new Set(Array.from(html.matchAll(/"videoId":"([\w-]{11})"/g)).map((m) => m[1])));
  const shorts: YouTubeShort[] = ids.slice(0, 20).map((id) => ({
    videoId: id,
    title: 'YouTube Short',
    channelTitle: '',
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  }));
  return { shorts, nextPageToken: null };
}

/** Shorts 한 페이지를 받는다. 키 있으면 Data API, 없으면 스크래핑 폴백. */
export async function fetchShortsPage(opts: { query?: string; pageToken?: string | null } = {}): Promise<ShortsPage> {
  const query = opts.query || DEFAULT_QUERY;
  if (hasYouTubeKey()) {
    return fetchShortsViaDataApi(query, opts.pageToken ?? null);
  }
  return fetchShortsViaScrape(query);
}
