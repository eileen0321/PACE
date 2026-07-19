// Vercel Serverless Function — YouTube Data API 프록시(2026-07-19).
// 실제 목적: EXPO_PUBLIC_YOUTUBE_API_KEY를 앱 번들에 직접 박아두면 디컴파일로 추출돼 남이 우리
// 쿼터를 훔쳐 쓸 수 있다는 실제 보안 리스크(사용자 지적) — 진짜 키는 여기(Vercel 프로젝트 환경변수
// YOUTUBE_API_KEY, EXPO_PUBLIC_ 접두사 없음 = 클라이언트에 절대 안 실림)에만 두고, 앱은 이 프록시
// 엔드포인트만 호출한다. src/services/api/youtube.ts의 fetchShortsViaDataApi 로직(search.list →
// videos.list 2단계, ≤60초 필터)을 그대로 옮겼다.
//
// 배포: 이 저장소를 Vercel 프로젝트로 연결하면 /api/*.ts가 zero-config로 서버리스 함수가 된다.
// Vercel 대시보드 프로젝트 설정 > Environment Variables에 YOUTUBE_API_KEY를 등록해야 동작한다.

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const MAX_SHORT_SECONDS = 60;

type SearchItem = { id?: { videoId?: string } };
type SearchResponse = { items?: SearchItem[]; nextPageToken?: string };
type VideoItem = {
  id: string;
  snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
  contentDetails?: { duration?: string };
};
type VideosResponse = { items?: VideoItem[] };

function parseISODurationSeconds(iso: string): number {
  const m = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return 0;
  return parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10);
}

// req/res는 Vercel 런타임이 표준 Node http 형태로 넘겨준다 — @vercel/node 타입 패키지를 이 앱
// 저장소에 새 의존성으로 안 넣으려고 최소 구조 타입만 인라인으로 선언(런타임 동작에는 영향 없음).
type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel 프로젝트에 EXPO_PUBLIC_YOUTUBE_API_KEY라는 이름으로 이미 등록돼 있어(대시보드에서 직접
  // 확인) 두 이름 다 받아준다 — EXPO_PUBLIC_ 접두사가 붙어 있어도 이건 Vercel 서버 환경변수일 뿐이라
  // 클라이언트 번들에 실리지 않는다(그 접두사는 Expo 빌드 쪽 컨벤션이지 Vercel과는 무관).
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'YOUTUBE_API_KEY not configured on server' });
    return;
  }

  const queryParam = req.query.query;
  const query = typeof queryParam === 'string' && queryParam ? queryParam : '#shorts';
  const pageTokenParam = req.query.pageToken;
  const pageToken = typeof pageTokenParam === 'string' ? pageTokenParam : undefined;

  try {
    const searchParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet',
      type: 'video',
      videoDuration: 'short',
      q: query,
      maxResults: '25',
      regionCode: 'US',
      relevanceLanguage: 'en',
    });
    if (pageToken) searchParams.set('pageToken', pageToken);

    const searchRes = await fetch(`${DATA_API}/search?${searchParams.toString()}`);
    if (!searchRes.ok) {
      res.status(searchRes.status).json({ error: `YT_SEARCH_ERROR ${searchRes.status}` });
      return;
    }
    const search = (await searchRes.json()) as SearchResponse;
    const ids = (search.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => !!v);

    if (ids.length === 0) {
      res.status(200).json({ shorts: [], nextPageToken: search.nextPageToken ?? null });
      return;
    }

    const videosParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet,contentDetails',
      id: ids.join(','),
    });
    const videosRes = await fetch(`${DATA_API}/videos?${videosParams.toString()}`);
    if (!videosRes.ok) {
      res.status(videosRes.status).json({ error: `YT_VIDEOS_ERROR ${videosRes.status}` });
      return;
    }
    const videos = (await videosRes.json()) as VideosResponse;

    const shorts = (videos.items ?? [])
      .filter((v) => parseISODurationSeconds(v.contentDetails?.duration ?? '') <= MAX_SHORT_SECONDS)
      .map((v) => ({
        videoId: v.id,
        title: v.snippet?.title ?? 'Short',
        channelTitle: v.snippet?.channelTitle ?? '',
        thumbnailUrl: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url ?? null,
      }));

    // CDN 캐싱(60초) — 같은 쿼리/페이지를 짧은 시간 내 여러 사용자가 요청해도 YouTube API 쿼터를
    // 한 번만 소모하게 한다. stale-while-revalidate로 캐시 만료 직후에도 지연 없이 응답.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ shorts, nextPageToken: search.nextPageToken ?? null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'PROXY_ERROR' });
  }
}
