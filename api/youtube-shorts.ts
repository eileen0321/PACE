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
//
// 2026-08-04 사장님 지적("HOT 리스트가 어제 본 것과 같고 영어다") — gl/hl 파라미터를 붙여도 영어
// 결과가 계속 나온 진짜 이유가 여기 있었다. **검색어 자체가 영어**라 'gardening'으로 검색하면
// 지역을 KR로 줘도 영어 영상이 나온다. 지역 설정은 "같은 검색어에 대해 어느 지역 결과를 우선할지"를
// 정할 뿐이고, 검색어가 언어를 결정한다. 언어별 검색어 목록을 따로 둬야 실제로 그 나라 콘텐츠가 나온다.
// 목록에 없는 언어는 영어로 폴백(전 세계 대상 앱이라 영어가 가장 넓은 커버리지).
// ⚠️ 2026-08-05 사장님 결정 — 컨셉 전면 교체("재미있는 걸로 가, 저게 뭐야").
//
// 예전 목록은 018b5bd에서 "차분한 힐링/공예 위주"로 정한 것이었다(ASMR·도예·종이접기·라떼아트·
// 뜨개질·수족관·목공…). 두 가지가 문제였다:
//  1) 재미가 없다. 절제 앱이라도 볼 이유가 없으면 안 본다.
//  2) **그게 "중간중간 영어 영상"의 원인이었다.** 저 주제들은 말이 필요 없는 시각적 콘텐츠라
//     국적이 없다 — 실측으로 한/일/미 세 나라가 완전히 같은 3개 주제(커피·뜨개질·수족관)를
//     받았다. 시드 자체는 한국어로 잘 뽑혀도(12개 중 11개), "라떼아트" 관련 영상은 대부분
//     해외 채널이라 유튜브 알고리즘이 한두 개 만에 영어권으로 넘어간다.
//
// 그래서 이번엔 **번역이 아니라 나라마다 다른 목록**으로 짠다. 고르는 기준은 "그 나라 창작자가
// 압도적인 주제"다 — 먹방·예능·아이돌 무대·성대모사·공감물처럼 언어와 문화에 묶인 것들.
// 그래야 시드 이후 유튜브 알고리즘이 그 나라 안에 머문다(위 28~31행의 "검색어가 언어를 결정한다"와
// 같은 원리를, 이번엔 언어가 아니라 **문화권**까지 밀어붙인 것).
const CATEGORIES_BY_LANG: Record<string, string[]> = {
  en: [
    'funny videos', 'mukbang', 'comedy sketch', 'music performance', 'dance challenge',
    'street interview', 'skit', 'impressions', 'song cover', 'funny pets',
    'gaming highlights', 'cooking hacks', 'reaction', 'vlog', 'couple goals',
    'office humor', 'school humor', 'prank', 'workout motivation', 'magic tricks',
  ],
  ko: [
    '웃긴 영상', '먹방', '예능 하이라이트', '케이팝 무대', '댄스 챌린지',
    '길거리 인터뷰', '상황극', '성대모사', '노래 커버', '반려동물 웃긴',
    '게임 하이라이트', '요리 꿀팁', '리액션', '브이로그', '커플 일상',
    '회사 공감', '학교 공감', '몰래카메라', '운동 자극', '마술',
  ],
  ja: [
    '面白い動画', '大食い', 'バラエティ 名場面', 'アイドル ステージ', 'ダンス チャレンジ',
    '街頭インタビュー', 'コント', 'ものまね', '歌ってみた', '猫 面白い',
    'ゲーム実況', '料理 裏技', 'リアクション', 'Vlog', 'カップル 日常',
    '会社 あるある', '学校 あるある', 'ドッキリ', '筋トレ', 'マジック',
  ],
  es: [
    'videos graciosos', 'mukbang', 'sketch de comedia', 'actuación musical', 'reto de baile',
    'entrevista callejera', 'parodia', 'imitaciones', 'cover de canción', 'mascotas graciosas',
    'gameplay destacado', 'trucos de cocina', 'reacción', 'vlog', 'pareja',
    'humor de oficina', 'humor escolar', 'broma', 'motivación gym', 'trucos de magia',
  ],
  pt: [
    'vídeos engraçados', 'mukbang', 'esquete de comédia', 'performance musical', 'desafio de dança',
    'entrevista na rua', 'paródia', 'imitações', 'cover de música', 'pets engraçados',
    'melhores momentos gameplay', 'dicas de culinária', 'reação', 'vlog', 'casal',
    'humor de escritório', 'humor escolar', 'pegadinha', 'motivação treino', 'truques de mágica',
  ],
};
function categoriesFor(hl: string): string[] {
  return CATEGORIES_BY_LANG[hl] ?? CATEGORIES_BY_LANG.en;
}

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const MAX_SHORT_SECONDS = 60;

// 2026-08-04 사장님 실기기 지적("HOT이 왜 같은 리스트야", "같은 영상으로 나온다") — 출시 후 확인된 결함.
//
// 원인 1: 아래 카테고리 로테이션이 `CATEGORIES[page % N]`이라 **page 0은 누구에게나 항상 'satisfying'**
//         이었다. 거기에 CDN 캐시(s-maxage=3600)가 겹쳐, 한 시간 동안 전 세계 모든 사용자가 문자 그대로
//         동일한 리스트 + 동일한 첫 영상을 받았다(실측: X-Vercel-Cache HIT, Age 520).
// 원인 2: 스크래핑이 en-US UA/Accept-Language로 나가고 Data API 폴백도 regionCode=US/en이라
//         한국 사용자에게 영어 콘텐츠만 나갔다(실측 1위: "6 Satisfying Cool 3D Prints... ASMR").
//
// 해결: 시간(KST) 기반 시드로 카테고리를 돌린다. 같은 시간대 안에서는 여전히 캐시가 먹어 스케일
// 이점(사용자 수와 무관하게 YouTube 트래픽 일정)은 그대로 유지되면서, 시간이 지나면 목록이 바뀐다.
// CDN 캐시 때문에 "사용자별로 다르게"는 구조적으로 불가능하다(캐시를 사용자별로 쪼개면 스크래핑
// 횟수가 사용자 수만큼 늘어 원래 문제로 되돌아간다) — 대신 "시간에 따라 바뀌게" 해서 같은 사람이
// 다시 열었을 때 같은 리스트를 보지 않게 한다.
function rotationSeed(): number {
  // 단순히 "시간이 흐르면 값이 변하는 카운터"가 필요할 뿐이라 UTC 기준으로 둔다(특정 시간대에
  // 맞출 이유가 없다 — 전 세계 사용자 대상).
  // 2026-08-04 재조정 — 처음엔 1시간 단위였는데, 그러면 **그 한 시간 동안 접속한 사용자가 전원 같은
  // 목록**을 받는다(사장님이 아이폰에서 확인한 증상, 연속 두 호출의 videoId 나열이 완전 일치했다).
  // 아래 Cache-Control과 같은 주기(5분)로 맞춰 다른 시각에 연 사용자는 다른 조합을 받게 한다.
  // 스크래핑 횟수는 (조합 × 12회/시간)로 늘지만 여전히 **사용자 수와 무관**해서 이 설계가 지키려는
  // 스케일 이점(사용자가 100명이든 100만명이든 YouTube 트래픽 동일)은 그대로다.
  return Math.floor(Date.now() / 300000);
}

// 지역/언어 — 2026-08-04 사장님 지적("각 나라에 맞게 보여야 할 거 아냐"). 처음엔 KR로 박으려 했는데
// 그건 US 하드코딩을 KR 하드코딩으로 바꾸는 것뿐이라 똑같이 틀렸다(앱은 전 세계 대상이다).
// Vercel이 요청마다 넣어주는 `x-vercel-ip-country` 헤더로 **접속한 나라를 그대로 따라간다** —
// 이미 배포된 앱을 고치지 않아도 각 사용자가 자기 나라 콘텐츠를 받는다.
// 헤더가 없는 경우(로컬 개발 등)에만 최후 기본값을 쓴다.
const FALLBACK_GL = 'US';
// 국가 → 유튜브 hl(언어) 매핑. 전 세계를 다 넣을 필요는 없고, 국가코드와 언어코드가 다른 주요
// 시장만 명시하면 나머지는 국가코드를 소문자로 내려도 대체로 맞는다(FR→fr, DE→de, IT→it …).
const COUNTRY_TO_LANG: Record<string, string> = {
  KR: 'ko', JP: 'ja', US: 'en', GB: 'en', AU: 'en', CA: 'en', IN: 'en',
  CN: 'zh', TW: 'zh', HK: 'zh', BR: 'pt', MX: 'es', AR: 'es', VN: 'vi',
  ID: 'id', TH: 'th', PH: 'en', SA: 'ar', AE: 'ar', RU: 'ru', UA: 'uk',
};

type Short = { videoId: string; title: string; channelTitle: string; thumbnailUrl: string | null };

function cleanTitle(s: string): string {
  if (!s) return '';
  const t = s.replace(/\\u0026/g, '&').replace(/\\"/g, '"');
  // accessibilityText는 "<제목>, 조회수 193만회 - Shorts 동영상 재생"(로케일별) 형태 → 뒤 메타 제거.
  const idx = t.lastIndexOf(', ');
  if (idx > 0 && /\d|short|조회|再生|vistas|vues|views/i.test(t.slice(idx))) return t.slice(0, idx);
  return t;
}

async function scrapeOnce(query: string, gl: string, hl: string): Promise<Short[]> {
  // 2026-08-04 — gl/hl을 붙여야 유튜브가 해당 지역·언어 결과를 준다. 예전엔 이 둘이 없어 서버(미국
  // Vercel) 기준 영어 결과만 나왔다 — 사장님 지적("HOT 리스트가 왜 영어냐")의 직접 원인.
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SHORTS_FILTER}&gl=${gl}&hl=${hl}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': `${hl}-${gl},${hl};q=0.9`, Cookie: CONSENT_COOKIE },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`YT_SCRAPE_HTTP_${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  // Shorts 블록에 딸린 videoId만 추출(가로영상 혼입 방지).
  //
  // 2026-08-06 사장님 실기기 발견("쇼츠 아니라 일반 인터뷰 영상이 떴다") — 원래 여기 "구조 변경 시
  // 전체 videoId로 폴백"하는 안전망이 있었는데, 실기기로 재현해보니 그 폴백이 발동하는 진짜 이유는
  // "유튜브가 구조를 바꿔서"가 아니라 **유튜브가 이 요청을 CAPTCHA 페이지로 튕긴 것**이었다(직접
  // curl로 재현 확인 — 응답 본문에 "CAPTCHA" 마커, shortsLockupViewModel 0건). 그 상태에서 "페이지에
  // 있는 아무 videoId나 긁는" 폴백은 CAPTCHA 페이지에 우연히 박힌 임의 videoId(길이/쇼츠 여부 전혀
  // 검증 안 됨)를 그대로 반환했다 — 배포된 프록시에서 정상 쇼츠 사이에 제목 없는 일반 영상 3개가
  // 실제로 섞여 나오는 것으로 재현 확인함.
  //
  // 필터 없는 폴백을 없애고 그냥 빈 배열을 반환한다 — 호출부 scrapeWithRetry가 빈 배열이면 자동
  // 재시도하고(최대 3회, 그 사이 CAPTCHA가 풀릴 수 있음), 그래도 전부 실패하면 handler의
  // dataApiFallback(실제 길이 필터 있음)으로 안전하게 떨어진다. 병렬로 도는 다른 카테고리가 성공하면
  // 이 카테고리만 0건이 되고 전체 결과는 오염되지 않는다(핸들러의 카테고리별 Promise.all 구조).
  const scoped = [...html.matchAll(/shortsLockupViewModel[\s\S]{0,900}?"videoId":"([\w-]{11})"/g)];
  const out: Short[] = [];
  const seen = new Set<string>();
  for (const m of scoped) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const at = m[0].match(/"accessibilityText":"([^"]+)"/);
    out.push({ videoId: id, title: at ? cleanTitle(at[1]) : '', channelTitle: '', thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  }
  return out;
}

// 캐시 미스 시에만 실행되므로(대부분 CDN 히트) 재시도 백오프로 순간 레이트리밋/네트워크 흔들림 흡수.
async function scrapeWithRetry(query: string, gl: string, hl: string, tries = 3): Promise<Short[]> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const s = await scrapeOnce(query, gl, hl);
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
async function dataApiFallback(query: string, apiKey: string, gl: string, hl: string): Promise<Short[]> {
  // 2026-08-04 — regionCode/relevanceLanguage가 US/en 하드코딩이라 한국 사용자에게 영어 결과가 나갔다.
  // order=viewCount도 추가: 메뉴 이름이 "HOT"인데 실제로는 검색 관련도 순이라 인기와 아무 상관이 없었다.
  const sp = new URLSearchParams({ key: apiKey, part: 'snippet', type: 'video', videoDuration: 'short', videoEmbeddable: 'true', q: query, maxResults: '25', order: 'viewCount', regionCode: gl, relevanceLanguage: hl });
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

type VercelRequest = { query: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query.query;
  const reqQuery = typeof q === 'string' ? q : '';
  const pt = req.query.pageToken;
  const page = Math.max(0, parseInt((typeof pt === 'string' ? pt : '0') || '0', 10) || 0);

  // 지역/언어 — 이미 배포된 앱은 안 넘기므로 기본값(KR/ko)이 적용된다. 향후 앱이 사용자 로케일을
  // 넘겨주면 그걸 쓴다. 값 검증을 두는 이유: 그대로 URL에 실리므로 임의 문자열이 들어오면 안 된다.
  // 우선순위: 앱이 명시적으로 넘긴 값 > Vercel 지오IP 헤더(접속 국가) > 최후 기본값.
  // 지오IP를 쓰면 **이미 배포된 앱을 고치지 않아도** 각 사용자가 자기 나라 콘텐츠를 받는다.
  // 값 검증을 두는 이유: 그대로 URL에 실리므로 임의 문자열이 들어오면 안 된다.
  const headerCountryRaw = req.headers?.['x-vercel-ip-country'];
  const headerCountry = (typeof headerCountryRaw === 'string' ? headerCountryRaw : '').toUpperCase();
  const rawGl = typeof req.query.gl === 'string' ? req.query.gl.toUpperCase() : '';
  const rawHl = typeof req.query.hl === 'string' ? req.query.hl.toLowerCase() : '';
  const gl = /^[A-Z]{2}$/.test(rawGl) ? rawGl
    : /^[A-Z]{2}$/.test(headerCountry) ? headerCountry
    : FALLBACK_GL;
  const hl = /^[a-z]{2}$/.test(rawHl) ? rawHl : (COUNTRY_TO_LANG[gl] ?? gl.toLowerCase());

  // 구체적 검색어(향후 검색 기능)면 그걸 쓰고, 기본(#shorts/빈값)이면 카테고리 로테이션.
  // 2026-08-04 — 예전엔 `CATEGORIES[page % N]`이라 page 0이 누구에게나 항상 'satisfying'이었다.
  // 시간 시드를 더해 시간마다 시작 카테고리가 달라지게 한다(rotationSeed 주석 참고).
  const isGeneric = !reqQuery || reqQuery === '#shorts' || reqQuery.toLowerCase() === 'shorts';
  const cats = categoriesFor(hl);
  const seed = rotationSeed();
  // 2026-08-04 사장님 지적("같은 영상 나오고 사람들 다", 아이폰으로 확인) — 시간 시드를 넣어 매시간
  // 목록이 바뀌게는 했지만, **같은 캐시 창 안에서는 여전히 전원이 완전히 동일한 목록**을 받는다
  // (실측: 연속 두 호출의 videoId 나열이 완전 일치). CDN 캐시를 없애면 사용자 수만큼 스크래핑이 늘어
  // 이 설계가 애초에 해결한 스케일 문제로 되돌아가므로 캐시는 유지하되, 겹침을 두 방향으로 줄인다:
  //   (a) 한 응답에 카테고리 3개를 섞는다 → 목록 자체가 넓어져 우연히 같은 영상을 볼 확률이 낮아짐
  //   (b) 캐시 창을 분 단위로 좁힌다(아래 Cache-Control) → 다른 시각에 연 사용자는 다른 목록을 받음
  // ⚠️ 사용자별로 완전히 다르게 하려면 결국 **앱이 받은 목록을 기기에서 섞어야** 한다(그게 진짜
  //    해법이고, 서버가 목록을 정하는 한 캐시를 공유하는 사용자끼리는 같을 수밖에 없다).
  //    그건 앱 업데이트가 필요해 별도 작업으로 남긴다 — 여기서는 앱 수정 없이 지금 설치된 사용자에게
  //    바로 적용되는 개선만 한다.
  const MIX_COUNT = 3;
  const categories = isGeneric
    ? Array.from({ length: MIX_COUNT }, (_, i) => cats[(page * MIX_COUNT + seed + i) % cats.length])
    : [reqQuery];

  try {
    let shorts: Short[] = [];
    try {
      const results = await Promise.all(categories.map((c) => scrapeWithRetry(c, gl, hl).catch(() => [])));
      // 카테고리별 결과를 번갈아 끼워 넣는다(앞쪽에 한 카테고리만 몰리면 첫 화면이 단조로워진다).
      const seen = new Set<string>();
      const maxLen = Math.max(0, ...results.map((r) => r.length));
      for (let i = 0; i < maxLen; i++) {
        for (const r of results) {
          const item = r[i];
          if (!item || seen.has(item.videoId)) continue;
          seen.add(item.videoId);
          shorts.push(item);
        }
      }
    } catch {
      shorts = [];
    }
    if (!shorts.length) {
      const apiKey = process.env.YOUTUBE_API_KEY || process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
      if (apiKey) shorts = await dataApiFallback(categories[0], apiKey, gl, hl);
    }
    // 카테고리 로테이션이라 nextPageToken은 항상 다음 index → 피드가 하드스톱 안 됨(무한).
    // (앱은 videoId로 dedup하므로 한 바퀴 돈 뒤 중복은 자동 제거. 카테고리 20개×~30개면 한 바퀴 ~600개.)
    const nextPageToken = String(page + 1);
    // CDN 캐싱: 사용자 수와 무관하게 YouTube 트래픽을 일정하게 유지하는 이 설계의 핵심이라 유지한다.
    // 다만 2026-08-04 — 예전 값(s-maxage=3600, swr=86400)은 "한 시간 내내 전원 동일 + 최악의 경우
    // 24시간 묵은 리스트"를 뜻했다(실측: Age 520s, X-Vercel-Cache HIT). 위 시간 시드가 매시간 카테고리를
    // 바꾸므로 캐시 창도 그에 맞춰 좁힌다. swr은 30분으로 줄여 하루 지난 목록이 나가는 일을 없앤다.
    // 스크래핑 횟수는 여전히 (카테고리 × 시간당 1회) 수준이라 스케일 이점은 그대로다.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    // ⚠️ 이 헤더가 없으면 CDN이 URL만으로 캐시해서, 맨 처음 요청한 나라의 결과가 전 세계에 그대로
    // 나간다(국가별 분기를 넣어도 무의미해진다). 지오IP 헤더를 캐시 키에 포함시킨다.
    res.setHeader('Vary', 'x-vercel-ip-country');
    res.status(200).json({ shorts, nextPageToken });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'PROXY_ERROR' });
  }
}
