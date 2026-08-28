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
import * as Localization from 'expo-localization';
import type { YouTubeShort } from '../../types/models';

export const YOUTUBE_PROXY_URL = process.env.EXPO_PUBLIC_YOUTUBE_PROXY_URL || '';
export function hasYouTubeProxy(): boolean {
  return YOUTUBE_PROXY_URL.length > 0;
}

// 2026-08-03 출시 전 검증에서 실제 유출 확인 — 위 주석의 "프로덕션 번들에 실려도 무해하다
// (어차피 __DEV__ 분기라 실행 안 됨)"는 판단이 틀렸다. 실행 여부와 무관하게 문자열 리터럴 자체가
// 번들에 박히고, 그 번들은 APK에 그대로 들어가 디컴파일하면 평문으로 나온다. 실제로 릴리즈 번들
// (android/app/build/generated/assets/react/release/index.android.bundle)을 검사해 키가 평문으로
// 들어있는 것을 확인했다 — 바로 위 문단이 경고한 "남이 우리 쿼터를 훔쳐 쓸 수 있는 리스크"가
// 프로덕션 빌드에 그대로 남아 있던 것이다.
// __DEV__를 값 자체에 걸면 Metro가 프로덕션 빌드에서 __DEV__를 false로 치환하며 상수 폴딩해
// 키 리터럴이 번들에서 완전히 사라진다(개발 편의는 그대로 유지). 사용처가 아니라 값에 걸어야 한다.
export const YOUTUBE_API_KEY = __DEV__ ? (process.env.EXPO_PUBLIC_YOUTUBE_API_KEY || '') : '';
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
  // 2026-07-21 실기기 디버깅으로 재작성. 기존 구현은 **iPhone User-Agent**를 보내
  // YouTube가 m.youtube.com **동의(consent) 페이지**로 리다이렉트 → HTML에 videoId가 0개라
  // 항상 dev 폴백(가로 영상)만 떴다("이거 쇼츠 아닌데"의 원인). 고친 3가지:
  //   1) 데스크톱 UA → m.youtube 리다이렉트 회피(데스크톱 results 페이지를 그대로 받음)
  //   2) 동의 우회 쿠키(SOCS/CONSENT) → "before you continue" 벽 통과
  //   3) &sp=EgIYAQ%3D%3D → 검색 필터를 **Shorts 전용**으로 고정 → 가로 영상 혼입 방지(세로 Shorts만)
  // 2026-08-28 — gl/hl 을 붙인다. 예전엔 Accept-Language 가 en-US 고정이라 한국어 사용자도
  //   영어 결과를 받았다(서버 프록시는 이미 같은 이유로 2026-08-04 에 고쳤다).
  const loc = Localization.getLocales()[0];
  const lang = (loc?.languageCode || '').toLowerCase();
  const LANG_TO_GL: Record<string, string> = { ko: 'KR', ja: 'JP' };
  const gl = LANG_TO_GL[lang] || (loc?.regionCode || '').toUpperCase();
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIYAQ%3D%3D`
    + (gl ? `&gl=${gl}` : '') + (lang ? `&hl=${lang}` : '');
  // 타임아웃(6s) — 제한 네트워크에서 응답이 안 오면 loadInitial이 isLoading에 갇혀 폴백까지 도달 못 함(방지).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': lang && gl ? `${lang}-${gl},${lang};q=0.9` : 'en-US,en;q=0.9',
      Cookie: 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCZW4gACgB; CONSENT=YES+1',
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`YT_SCRAPE_ERROR ${res.status}`);
  const html = await res.text();
  // Shorts만 추출: shortsLockupViewModel 블록에 딸린 videoId를 우선 잡아 가로영상 videoId 혼입 방지.
  // ⚠️ 페이지 전체 videoId 로 폴백하던 것을 없앤다. 유튜브가 요청을 차단 페이지로 튕기면
  //   lockup 이 0개인데, 그때 "아무 videoId나" 긁으면 쇼츠가 아닌 영상이 섞여 들어온다.
  //   서버 프록시가 2026-08-06 실기기에서 겪고 지운 바로 그 코드다(사장님 지적:
  //   "쇼츠 아니라 일반 인터뷰 영상이 떴다"). 0개면 그냥 0개로 두고 호출부가 판단한다.
  const starts = Array.from(html.matchAll(/shortsLockupViewModel":\{/g))
    .map((m) => m.index ?? -1)
    .filter((i) => i >= 0);
  const shorts: YouTubeShort[] = [];
  const seen = new Set<string>();
  for (let bi = 0; bi < starts.length && shorts.length < 20; bi++) {
    const block = html.slice(starts[bi], starts[bi + 1] ?? starts[bi] + 9000);
    const idM = block.slice(0, 900).match(/"videoId":"([\w-]{11})"/);
    if (!idM || seen.has(idM[1])) continue;
    seen.add(idM[1]);
    const pt = block.match(/"primaryText":\{"content":"((?:[^"\\]|\\.)*)"/);
    shorts.push({
      videoId: idM[1],
      title: pt ? pt[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, "$1") : "YouTube Short",
      channelTitle: '',
      thumbnailUrl: `https://i.ytimg.com/vi/${idM[1]}/hqdefault.jpg`,
    });
  }
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

// 2026-08-10 파리티 — 안드 커밋 dd4dd06(쇼츠 검색, P메뉴 Search)의 iOS 이식. 프리셋은
// api/search-presets.ts(Vercel, 국가별 캐시)가 내려주고, 실제 검색은 위 fetchShortsPage를
// 커스텀 query로 그대로 재사용한다(쿼터 0, 이미 iOS 메인 피드가 쓰던 경로).
export type SearchPreset = { label: string; query: string };
export async function fetchSearchPresets(gl?: string): Promise<SearchPreset[]> {
  if (!hasYouTubeProxy()) return [];
  const params = gl ? `?gl=${encodeURIComponent(gl)}` : '';
  const res = await fetch(`${YOUTUBE_PROXY_URL}/api/search-presets${params}`);
  if (!res.ok) throw new Error(`SEARCH_PRESETS_ERROR ${res.status}`);
  const json = (await res.json()) as { presets?: SearchPreset[] };
  return json.presets ?? [];
}

/** Shorts 한 페이지를 받는다. 프록시 설정돼 있으면 프록시, __DEV__면 클라이언트 직접호출,
 * 둘 다 없으면 스크래핑 폴백, 그것도 비면(dev) 샘플. */
export async function fetchShortsPage(opts: { query?: string; pageToken?: string | null } = {}): Promise<ShortsPage> {
  const query = opts.query || DEFAULT_QUERY;
  if (hasYouTubeProxy()) {
    // 2026-08-28 — 예전엔 여기서 곧바로 return 이라, 프록시가 실패하면 아래 직접 스크래핑
    //   경로에 **영영 도달하지 못했다**(프로덕션에선 프록시가 항상 설정돼 있으므로 죽은 코드).
    //   실제로 유튜브가 Vercel IP 를 막아 프록시가 0개를 주는 동안 앱이 통째로 멈췄다.
    //   측정(2026-08-28): 같은 검색이 서버에선 간헐적으로 0개, 가정용 IP 에선 항상 30~35개.
    //   유튜브가 조이는 건 데이터센터 IP 라 폰(통신사/가정용 IP)은 안 막힌다.
    //   그래서 프록시를 여전히 1순위로 두되(캐시 덕에 빠르고 데이터도 거의 안 씀),
    //   프록시가 못 주면 그때만 폰이 직접 받는다.
    const viaProxy = await fetchShortsViaProxy(query, opts.pageToken ?? null).catch(() => null);
    if (viaProxy?.shorts?.length) return viaProxy;
    const direct = await fetchShortsViaScrape(query).catch(() => null);
    if (direct?.shorts.length) return direct;
    return viaProxy ?? { shorts: [], nextPageToken: null };
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
