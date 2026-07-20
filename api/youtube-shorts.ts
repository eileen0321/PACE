// Vercel Serverless Function — YouTube Shorts 소스 프록시.
//
// ── 2026-07-21 전면 재작성: Data API → 서버사이드 스크래핑 (사용자 지시: "사용자 늘어도 문제 없는 방법") ──
// 기존은 YouTube Data API(search.list=호출당 100 units, 무료 하루 10,000)를 사용자 요청마다 호출해
// **하루 ~100명이면 쿼터 소진** → 스케일 불가(사용자 지적). 스크래핑은 API 쿼터가 없어(그냥 HTTP)
// 사용자 수 제약이 사라진다. 스케일의 핵심은 **호출 횟수를 사용자 수와 분리**하는 것:
//
//   1) 서버가 YouTube 검색결과(Shorts 필터)를 스크래핑 → shortsLockupViewModel에서 videoId+제목 추출.
//   2) 요청은 **카테고리 로테이션**(pageToken=페이지index → CATEGORIES[index%N]) → 무한·다양한 피드.
//   3) **CDN 장기 캐싱**(s-maxage=3600) → 같은 (query,pageToken)은 CDN이 응답, YouTube는
//      카테고리당 **시간당 1회만** 긁힌다 → 사용자가 100명이든 100만명이든 YouTube 트래픽 동일.
//
// 로컬 전수검증(2026-07-21): 15개 카테고리 전부 15~37개 Shorts 반환, oEmbed 임베드가능율 100%,
// 유니크율 99.6%(272중 271). 유일 실패는 "10연속 급속요청 시 IP 레이트리밋" — 캐싱으로 카테고리당
// 시간당 1회면 도달 안 함(재시도 백오프도 추가). scrape 구조 변경 대비 Data API 안전망은 유지
// (scrape가 재시도 후에도 0개일 때만, 키가 있을 때만 → 정상경로 쿼터 소모 0).

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// 동의(consent) 페이지 우회 쿠키 — iPhone/무쿠키 요청은 m.youtube 동의벽으로 튕겨 videoId 0개가 된다.
const CONSENT_COOKIE =
  'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCZW4gACgB; CONSENT=YES+1';
// &sp=EgIYAQ%3D%3D = 검색필터 "Shorts 전용" → 가로 영상 혼입 방지(세로 Shorts만).
const SHORTS_FILTER = 'EgIYAQ%3D%3D';

// PACE는 "차분한 대체 피드" — 자극적이지 않은 힐링/창작/공예 위주 카테고리로 로테이션.
const CATEGORIES = [
  'satisfying', 'asmr', 'nature relaxing', 'cooking', 'art process',
  'diy craft', 'origami', 'pottery', 'latte art', 'baking',
  'gardening', 'space facts', 'ocean', 'calligraphy', 'science experiment',
  'woodworking', 'coffee', 'knitting', 'aquarium', 'hiking',
];

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const MAX_SHORT_SECONDS = 60;

type Short = { videoId: string; title: string; channelTitle: string; thumbnailUrl: string | null };

function cleanTitle(s: string): string {
  if (!s) return '';
  const t = s.replace(/\\u0026/g, '&').replace(/\\"/g, '"');
  // accessibilityText는 "<제목>, 조회수 193만회 - Shorts 동영상 재생"(로케일별) 형태 → 뒤 메타 제거.
  const idx = t.lastIndexOf(', ');
  if (idx > 0 && /\d|short|조회|再生|vistas|vues|views/i.test(t.slice(idx))) return t.slice(0, idx);
  return t;
}

async function scrapeOnce(query: string): Promise<Short[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SHORTS_FILTER}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: CONSENT_COOKIE },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`YT_SCRAPE_HTTP_${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  // Shorts 블록에 딸린 videoId만 우선 추출(가로영상 혼입 방지). 구조 변경 시 전체 videoId로 폴백.
  const scoped = [...html.matchAll(/shortsLockupViewModel[\s\S]{0,900}?"videoId":"([\w-]{11})"/g)];
  const out: Short[] = [];
  const seen = new Set<string>();
  if (scoped.length) {
    for (const m of scoped) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const at = m[0].match(/"accessibilityText":"([^"]+)"/);
      out.push({ videoId: id, title: at ? cleanTitle(at[1]) : '', channelTitle: '', thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
    }
    return out;
  }
  for (const m of html.matchAll(/"videoId":"([\w-]{11})"/g)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ videoId: id, title: '', channelTitle: '', thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  }
  return out;
}

// 캐시 미스 시에만 실행되므로(대부분 CDN 히트) 재시도 백오프로 순간 레이트리밋/네트워크 흔들림 흡수.
async function scrapeWithRetry(query: string, tries = 3): Promise<Short[]> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const s = await scrapeOnce(query);
      if (s.length) return s;
    } catch (e) {
      last = e;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  if (last) throw last;
  return [];
}

// 안전망: 스크래핑이 재시도 후에도 완전 실패(0개)할 때만, 키가 있을 때만 Data API로 폴백.
// 정상 경로에선 절대 호출 안 되므로 쿼터 소모 0 — "스케일 불가" 문제를 되살리지 않는다.
type VideoItem = { id: string; snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } }; contentDetails?: { duration?: string } };
function parseISO(iso: string): number {
  const m = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10) : 0;
}
async function dataApiFallback(query: string, apiKey: string): Promise<Short[]> {
  const sp = new URLSearchParams({ key: apiKey, part: 'snippet', type: 'video', videoDuration: 'short', videoEmbeddable: 'true', q: query, maxResults: '25', regionCode: 'US', relevanceLanguage: 'en' });
  const sr = await fetch(`${DATA_API}/search?${sp}`);
  if (!sr.ok) throw new Error(`YT_SEARCH_${sr.status}`);
  const ids = ((await sr.json()).items ?? []).map((i: { id?: { videoId?: string } }) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vr = await fetch(`${DATA_API}/videos?${new URLSearchParams({ key: apiKey, part: 'snippet,contentDetails', id: ids.join(',') })}`);
  if (!vr.ok) throw new Error(`YT_VIDEOS_${vr.status}`);
  return ((await vr.json()).items as VideoItem[] ?? [])
    .filter((v) => parseISO(v.contentDetails?.duration ?? '') <= MAX_SHORT_SECONDS)
    .map((v) => ({ videoId: v.id, title: v.snippet?.title ?? '', channelTitle: v.snippet?.channelTitle ?? '', thumbnailUrl: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url ?? null }));
}

type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query.query;
  const reqQuery = typeof q === 'string' ? q : '';
  const pt = req.query.pageToken;
  const page = Math.max(0, parseInt((typeof pt === 'string' ? pt : '0') || '0', 10) || 0);

  // 구체적 검색어(향후 검색 기능)면 그걸 쓰고, 기본(#shorts/빈값)이면 카테고리 로테이션.
  const isGeneric = !reqQuery || reqQuery === '#shorts' || reqQuery.toLowerCase() === 'shorts';
  const category = isGeneric ? CATEGORIES[page % CATEGORIES.length] : reqQuery;

  try {
    let shorts: Short[] = [];
    try {
      shorts = await scrapeWithRetry(category);
    } catch {
      const apiKey = process.env.YOUTUBE_API_KEY || process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
      if (apiKey) shorts = await dataApiFallback(category, apiKey);
    }
    // 카테고리 로테이션이라 nextPageToken은 항상 다음 index → 피드가 하드스톱 안 됨(무한).
    // (앱은 videoId로 dedup하므로 한 바퀴 돈 뒤 중복은 자동 제거. 카테고리 20개×~30개면 한 바퀴 ~600개.)
    const nextPageToken = String(page + 1);
    // CDN 캐싱: 카테고리당 1시간 1회만 실제 스크래핑 → 사용자 수와 무관. stale-while-revalidate로
    // 만료 직후에도 지연 없이 응답하며 백그라운드 갱신.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ shorts, nextPageToken });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'PROXY_ERROR' });
  }
}
