// 🔴 2026-08-10 사장님 지시 — "hot 쇼츠 밑에 검색 기능 넣고, 야구 축구 등 사람들이 일반적으로
//   검색하는 빈도가 높은 카테고리를 만들어서 이건 캐싱해서 쓰는 걸로. 근데 국가별로 캐싱 내용이
//   달라질 거잖아. json 등으로 cdn이든 비용 안 드는 방향으로."
//
// ── 왜 프리셋을 서버가 내려주나 ──
// 검색어 목록을 앱에 박으면 유행이 바뀔 때마다 스토어 재배포가 필요하다(오늘 Shorts HOT에서
// "검색어는 계속 변한다"고 지적받은 것과 같은 문제). 서버가 주면 이 파일만 고쳐 배포하면 끝이고,
// 이미 설치된 앱에도 즉시 반영된다.
//
// ── 비용 ──
// 이 응답 자체는 정적에 가까워 CDN이 거의 전부 흡수한다(아래 s-maxage). 그리고 **프리셋을 눌렀을 때
// 실제 검색은 기존 /api/youtube-shorts 를 그대로 탄다** — 그쪽은 YouTube Data API가 아니라 검색
// 페이지 스크래핑이라 **API 쿼터를 전혀 안 쓰고**, 같은 검색어는 CDN에 5분 캐시된다
// (실측: X-Vercel-Cache HIT). 즉 사용자가 몇 명이든 프리셋 하나당 스크래핑은 5분에 1회다.
// → 그래서 프리셋은 무료 사용자에게도 횟수 제한 없이 열어준다(사장님 승인). 제한은 캐시가 잘 안 먹는
//   **자유 검색**에만 건다(무료 하루 1회 / 유료 무제한).
//
// ── 국가별 분리 ──
// 검색어는 언어·문화에 완전히 종속된다("축구"를 미국 사용자에게 줄 수 없다). gl 파라미터가 없으면
// Vercel 지오IP 헤더로 판단하고, 지원 목록에 없으면 US로 폴백한다(youtube-shorts.ts와 같은 규칙).
// ⚠️ CDN이 URL만으로 캐시하면 맨 처음 요청한 나라의 목록이 전 세계에 나간다 —
//   그래서 Vary에 지오IP 헤더를 반드시 넣는다(youtube-shorts.ts에 같은 주석과 같은 이유).

type VercelRequest = { query: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

type Preset = { label: string; query: string };

// 라벨 = 사용자에게 보이는 짧은 말, query = 실제로 유튜브에 던지는 검색어.
// 둘을 나눈 이유: 검색어에는 "쇼츠"나 제외어를 붙여야 결과가 좋아지는데 그게 칩에 그대로 보이면 지저분하다.
const PRESETS_BY_COUNTRY: Record<string, Preset[]> = {
  KR: [
    { label: '축구', query: '축구 쇼츠' },
    { label: '야구', query: '야구 쇼츠' },
    { label: '먹방', query: '먹방 쇼츠' },
    { label: '예능', query: '예능 하이라이트 쇼츠' },
    { label: '음악', query: '음악 쇼츠' },
    { label: '댄스', query: '댄스 챌린지 쇼츠' },
    { label: '운동', query: '홈트 운동 쇼츠' },
    { label: '요리', query: '자취요리 레시피 쇼츠' },
    { label: '동물', query: '강아지 고양이 쇼츠' },
    { label: '게임', query: '게임 하이라이트 쇼츠' },
    { label: '여행', query: '여행 브이로그 쇼츠' },
    { label: '뉴스', query: '뉴스 이슈 쇼츠' },
  ],
  JP: [
    { label: 'サッカー', query: 'サッカー ショート' },
    { label: '野球', query: '野球 ショート' },
    { label: 'グルメ', query: 'グルメ ショート' },
    { label: 'バラエティ', query: 'バラエティ 名場面 ショート' },
    { label: '音楽', query: '音楽 ショート' },
    { label: 'ダンス', query: 'ダンス チャレンジ ショート' },
    { label: '筋トレ', query: '筋トレ ショート' },
    { label: '料理', query: '簡単 レシピ ショート' },
    { label: '動物', query: '犬 猫 ショート' },
    { label: 'ゲーム', query: 'ゲーム ハイライト ショート' },
    { label: '旅行', query: '旅行 vlog ショート' },
    { label: 'ニュース', query: 'ニュース ショート' },
  ],
  US: [
    { label: 'Soccer', query: 'soccer shorts' },
    { label: 'Basketball', query: 'basketball shorts' },
    { label: 'Food', query: 'food shorts' },
    { label: 'Comedy', query: 'comedy shorts' },
    { label: 'Music', query: 'music shorts' },
    { label: 'Dance', query: 'dance challenge shorts' },
    { label: 'Workout', query: 'home workout shorts' },
    { label: 'Recipes', query: 'easy recipe shorts' },
    { label: 'Animals', query: 'dog cat shorts' },
    { label: 'Gaming', query: 'gaming highlights shorts' },
    { label: 'Travel', query: 'travel vlog shorts' },
    { label: 'News', query: 'news shorts' },
  ],
};

const FALLBACK_COUNTRY = 'US';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const rawGl = typeof req.query.gl === 'string' ? req.query.gl.toUpperCase() : '';
  const headerCountryRaw = req.headers?.['x-vercel-ip-country'];
  const headerCountry = (typeof headerCountryRaw === 'string' ? headerCountryRaw : '').toUpperCase();
  const country = PRESETS_BY_COUNTRY[rawGl]
    ? rawGl
    : PRESETS_BY_COUNTRY[headerCountry]
      ? headerCountry
      : FALLBACK_COUNTRY;

  // 프리셋은 거의 안 바뀌므로 길게 캐시한다 — CDN이 사실상 전부 흡수해 함수 실행 자체가 드물다.
  // stale-while-revalidate로, 만료돼도 사용자는 기다리지 않고 옛 값을 즉시 받는다(백그라운드 갱신).
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('Vary', 'x-vercel-ip-country');
  res.status(200).json({ country, presets: PRESETS_BY_COUNTRY[country] });
}
