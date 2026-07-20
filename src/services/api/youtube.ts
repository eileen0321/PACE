// YouTube Shorts 리스트 소스 — iOS Pace Feed의 "리스트 순차 재생"용(2026-07-18 사용자 지시).
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의 — YouTube Shorts 리스트 순차 재생" 참고.
//
// ⚠️ 여기서 하는 건 "영상 ID(메타) 리스트 확보"뿐이다. 실제 재생은 components/feed/YouTubeShortsPlayer가
//    공식 IFrame Player API로 한다(합법). 스트림을 긁어오지 않는다.
// 경로: (1) 서버 프록시(api/youtube-shorts.ts, 프로덕션 기본) → (2) __DEV__ 전용 클라이언트 직접
//       호출(로컬 개발 편의, 프록시 안 띄웠을 때만) → (3) 스크래핑 폴백(그레이존, videoId만 파싱).
//
// 2026-07-19 보안 수정(사용자 지적): EXPO_PUBLIC_YOUTUBE_API_KEY를 앱 번들에 직접 넣어 클라이언트가
// googleapis.com을 바로 호출하던 방식은, 앱을 디컴파일하면 키가 그대로 노출돼 남이 우리 쿼터를
// 훔쳐 쓸 수 있는 실제 리스크였다. 이제 프로덕션 경로는 api/youtube-shorts.ts(Vercel 서버리스
// 함수, 진짜 키는 서버 환경변수에만 존재)를 거친다 — EXPO_PUBLIC_YOUTUBE_API_KEY는 로컬 __DEV__
// 폴백에서만 쓰이므로 프로덕션 빌드 번들에는 실려도 무해하다(어차피 __DEV__ 분기라 실행 안 됨).
import type { YouTubeShort } from '../../types/models';

export const YOUTUBE_PROXY_URL = process.env.EXPO_PUBLIC_YOUTUBE_PROXY_URL || '';
export function hasYouTubeProxy(): boolean {
  return YOUTUBE_PROXY_URL.length > 0;
}

export const YOUTUBE_API_KEY = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY || '';
export function hasYouTubeKey(): boolean {
  return YOUTUBE_API_KEY.length > 0;
}

/** UI에서 "실제 소스(프록시 또는 dev 직접호출) vs 스크래핑 폴백"을 구분할 때 쓴다. */
export function hasRealYouTubeSource(): boolean {
  return hasYouTubeProxy() || (__DEV__ && hasYouTubeKey());
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
    videoEmbeddable: 'true', // 임베드 막힌 영상은 IFrame 재생 시 즉시 에러 → 다음으로 스킵 반복(2026-07-19 수정)
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

// 프로덕션 기본 경로: api/youtube-shorts.ts(Vercel 서버리스 함수)를 호출 — 진짜 키는 서버에만.
async function fetchShortsViaProxy(query: string, pageToken: string | null): Promise<ShortsPage> {
  const params = new URLSearchParams({ query });
  if (pageToken) params.set('pageToken', pageToken);
  const res = await fetch(`${YOUTUBE_PROXY_URL}/api/youtube-shorts?${params.toString()}`);
  if (!res.ok) throw new Error(`YT_PROXY_ERROR ${res.status}`);
  return (await res.json()) as ShortsPage;
}

// 스크래핑 폴백(그레이존): 프록시/키 둘 다 없을 때만. YouTube 검색결과 HTML의 ytInitialData에서
// videoId만 긁는다. 재생은 여전히 공식 IFrame이 하므로 스트림 절도가 아님. 프로덕션 기본값 아님.
async function fetchShortsViaScrape(query: string): Promise<ShortsPage> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' shorts')}`;
  // 타임아웃(6s) — 시뮬레이터/제한 네트워크에서 응답이 안 오면 loadInitial이 isLoading에 영원히 갇혀
  // dev 폴백까지 도달 못 하는 문제 방지(2026-07-19).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
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

// ⚠️ DEV 전용 폴백 — 프록시/키/스크래핑이 전부 빈 결과일 때(시뮬레이터의 RN fetch는 YouTube 검색
// HTML을 제대로 못 받는 경우가 많음), IFrame 플레이어+큐 순차재생 "메커니즘"을 검증할 수 있게 안정적인
// 공개·임베드 가능 영상 ID 몇 개를 큐에 넣는다. 프로덕션에선 절대 도달 안 함(프록시/키/스크래핑 성공 시 미사용).
const DEV_FALLBACK_SHORTS: YouTubeShort[] = [
  // ⚠️ 인라인 임베드 허용 영상만. VEVO/일부 뮤비(dQw4w9WgXcQ 등)는 "다음에서 보기: YouTube" 오버레이로
  // 인라인 재생이 막혀 폴백에서 제외. Big Buck Bunny 등 CC/오픈 콘텐츠는 인라인 재생·자동재생 OK.
  { videoId: 'aqz-KE-bpKQ', title: '[DEV] Big Buck Bunny', channelTitle: 'dev-fallback', thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg' },
  { videoId: 'jNQXAC9IVRw', title: '[DEV] Me at the zoo', channelTitle: 'dev-fallback', thumbnailUrl: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg' },
  { videoId: 'ScMzIvxBSi4', title: '[DEV] Elephants Dream', channelTitle: 'dev-fallback', thumbnailUrl: 'https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg' },
];

/** Shorts 한 페이지를 받는다. 프록시 설정돼 있으면 프록시, __DEV__면 클라이언트 직접호출,
 * 둘 다 없으면 스크래핑 폴백, 그것도 비면(dev) 샘플. */
export async function fetchShortsPage(opts: { query?: string; pageToken?: string | null } = {}): Promise<ShortsPage> {
  const query = opts.query || DEFAULT_QUERY;
  if (hasYouTubeProxy()) {
    return fetchShortsViaProxy(query, opts.pageToken ?? null);
  }
  if (__DEV__ && hasYouTubeKey()) {
    return fetchShortsViaDataApi(query, opts.pageToken ?? null);
  }
  const scraped = await fetchShortsViaScrape(query).catch(() => ({ shorts: [], nextPageToken: null } as ShortsPage));
  if (scraped.shorts.length === 0 && __DEV__) {
    return { shorts: DEV_FALLBACK_SHORTS, nextPageToken: null };
  }
  return scraped;
}
