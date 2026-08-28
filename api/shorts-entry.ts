// Vercel Serverless Function — "Shorts with PACE" 진입 전략 공급자.
//
// ── 왜 이걸 서버에 두는가 (2026-08-04 사장님 지시) ──
// "주소 변환 방식을 백엔드에 두고 업데이트를 하든 푸시 방식을 고려하든 할 수 있는 건 다 찾아서 해라"
//
// 앱은 이미 출시됐다. 그런데 유튜브 앱으로 Shorts 탭에 진입하는 방법은 **공개 API가 아니다** —
// 내부 인텐트 액션과, 특정 URL 형태가 어느 화면으로 라우팅되는지에 의존한다. 실제로 이번에
// 실기기로 확인한 것만 봐도 형태마다 결과가 갈렸다:
//
//   ① 인텐트 액션 com.google.android.youtube.action.open.shorts → Shorts 탭 ✅
//   ② https://www.youtube.com/shorts/<영상ID>                    → Shorts 탭 ✅
//   ③ https://m.youtube.com/shorts/<영상ID>                      → 홈 탭 ❌
//   ④ https://www.youtube.com/shorts (영상ID 없음)                → 홈 탭 ❌ (출시본의 기존 동작)
//
// 유튜브가 앱을 업데이트하면 이 표는 언제든 바뀔 수 있고, 그때 진입 전략이 **앱에 하드코딩**돼
// 있으면 스토어 심사를 다시 타야만 고칠 수 있다(며칠~수주). 이미 설치된 사용자는 그동안 계속
// 홈 탭으로 떨어진다. 그래서 "무엇을 어떤 순서로 시도할지"를 서버가 내려주고 앱은 그대로 실행만
// 하게 한다 — 이 파일만 고쳐 배포하면 **설치된 앱 전부가 즉시 고쳐진다**.
//
// 앱은 이 응답을 부팅 때 받아 캐시하고(services/shortsEntry.ts), 카드를 탭하는 순간에는 캐시된
// 전략을 즉시 실행한다(탭 시점에 네트워크를 기다리면 그게 곧 체감 지연이 된다).
// 서버가 죽거나 응답이 이상해도 앱에 내장된 기본 전략으로 동작하므로 안전하다.

type VideoIdSource = 'userSaved' | 'serverPool';
type Strategy =
  // 네이티브 인텐트 액션(안드로이드 전용). 앱이 이 액션으로 유튜브를 연다.
  | { kind: 'nativeAction'; action: string; packageName: string }
  // URL 열기. `{videoId}` 자리표시자가 있으면 앱이 videoIdSource 순서대로 시작점을 구해 치환한다.
  | { kind: 'url'; url: string; videoIdSource?: VideoIdSource[] };

type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

// 실기기 검증 순서 그대로. 앞의 것이 실패하면 다음으로 넘어간다.
// ⚠️ 여기를 고치면 앱 업데이트 없이 모든 사용자에게 즉시 반영된다 — 유튜브 동작이 바뀌면
//    새 후보를 앞에 끼워 넣거나 순서만 바꾸면 된다.
const STRATEGIES: Strategy[] = [
  // 2026-08-04 사장님 지적("앱이나 다른 데 갔다가 다시 Shorts with PACE를 누르면 아까 나왔던 시작
  // 영상이 다시 보인다", "누를 때마다 영상을 새로 받아와서 실행해야지") — 순서를 바꾼다.
  //
  // 네이티브 액션(open.shorts)은 유튜브의 Shorts 탭을 "열" 뿐이라, 유튜브가 **보던 자리를 그대로
  // 이어서** 보여준다. 그래서 나갔다 다시 들어오면 같은 영상이 다시 나온다. 사용자가 기대하는 건
  // "누를 때마다 새로 시작"이므로, **시작 영상을 명시하는 URL을 1순위로 올린다** — 이러면 매번
  // 기기가 새로 고른 영상에서 출발하고, 그 뒤 스와이프는 유튜브 알고리즘이 이어간다(실기기 확인).
  //
  // ⚠️ 시작 영상 "목록"을 서버가 정해 내려주면 같은 캐시 창의 사용자가 전부 같은 영상에서 시작한다 —
  // 원래 문제였던 "전원 동일"이 재발한다. 그래서 서버는 **어디서 뽑을지 순서만** 지시하고 실제 값은
  // 각 기기가 매 탭마다 새로 고른다:
  //   userSaved  = 그 사용자가 직접 저장/캡처한 영상 → 기기마다 다름(진짜 개인화)
  //   serverPool = 위가 비어 있는 신규 사용자용 최후 수단(앱이 풀에서 무작위 선택)
  {
    kind: 'url',
    url: 'https://www.youtube.com/shorts/{videoId}',
    // 2026-08-04 — 순서를 serverPool 먼저로 둔다. userSaved(사용자가 저장/캡처한 영상)는 보통
    // 몇 개뿐이라 그걸 1순위로 쓰면 누를 때마다 같은 영상이 나온다(사장님 지적의 증상 그대로).
    // 게다가 이미 저장해둔 영상은 사용자가 이미 본 것이라 "새로 시작"에 어울리지 않는다.
    // 시드의 목적은 Shorts 탭에 진입할 시작점을 만드는 것뿐이고, 그 뒤는 유튜브 알고리즘이 이어간다 —
    // 따라서 개인화보다 **매번 달라지는 것**이 우선이다. serverPool은 12개가 10분마다 갱신된다.
    videoIdSource: ['serverPool', 'userSaved'],
  },
  // 시작 영상을 못 구했을 때(신규 사용자 + 서버 풀도 비어 있음)의 폴백 — Shorts 탭으로는 확실히
  // 들어가지만 유튜브가 보던 자리를 이어서 연다.
  {
    kind: 'nativeAction',
    action: 'com.google.android.youtube.action.open.shorts',
    packageName: 'com.google.android.youtube',
  },
  // 🔴 2026-08-09 사장님 지적("지금 기기가 왜 유투브 홈을 보여주냐" → "제대로 고쳐") — 여기 있던
  //   `https://www.youtube.com/shorts`(영상 ID 없음) 최후 폴백을 **제거했다.**
  //   그 URL은 Shorts 탭이 아니라 **홈 탭을 여는 것이 확정**이라(앱 쪽 shortsEntry.ts 상단 표 ④),
  //   "아무것도 안 열리는 것보다 낫다"는 근거가 성립하지 않았다 — 바로 위 nativeAction이 시드가
  //   없어도 진짜 Shorts 탭에 확실히 들어가기 때문이다. 즉 이건 폴백이 아니라 **홈으로 떨어지는
  //   유일한 경로**였고, 실기기에서 실제로 그렇게 떨어졌다.
  //   ⚠️ 앱도 sanitize()에서 이 형태를 거부하도록 같이 막았다 — 이미 캐시된 옛 정책이 남아 있는
  //     기기에서도 홈으로 안 떨어지게 하기 위함(서버만 고치면 캐시된 기기는 안 고쳐진다).
];

// 시작 영상 후보를 여러 개 내려준다 — 앱이 그중 하나를 무작위로 고른다. 하나만 주면 같은 캐시
// 창 안의 사용자가 전부 같은 영상으로 시작하게 되는데, 그게 애초에 사장님이 지적한 "다 같은
// 영상" 문제였다. 시작점만 갈라주면 그 뒤는 각자의 개인 피드로 흩어진다.
const SEED_COUNT = 12;

// 마지막으로 성공한 시드를 기억한다. 유튜브가 스크래핑을 막는 동안에도 "조금 묵은 시드"로
// 시작은 되게 하려는 것 — 시작조차 못 하는 것보다 언제나 낫다. 서버리스라 인스턴스가 갈리면
// 사라지므로 이것만으로는 부족하고, 아래 stale-if-error(CDN)가 진짜 안전망이다.
let lastGoodSeed: string[] = [];

async function fetchSeedVideoIds(origin: string, gl: string, hl: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      // 같은 프로젝트의 기존 프록시를 재사용한다 — 스크래핑/캐싱/지역분기 로직을 중복 구현하지 않는다.
      // ⚠️ 2026-08-05 — hl을 안 넘기고 있었다. 앱은 ?hl=을 보내는데 이 핸들러가 읽지도, 안쪽 호출에
      //   붙이지도 않아 그냥 버려졌다. youtube-shorts는 hl이 없으면 COUNTRY_TO_LANG[gl]로 추정하므로
      //   한국폰(gl=KR)은 우연히 맞았지만, **한국에 사는 영어 사용자**(gl=KR, hl=en)는 앱이 en을
      //   보내도 한국어 시드를 받았다. 이 호출은 서버-투-서버라 지오IP 폴백도 안 먹으니 반드시 넘긴다.
      const qp = new URLSearchParams({ query: '#shorts' });
      if (gl) qp.set('gl', gl);
      if (hl) qp.set('hl', hl);
      const res = await fetch(`${origin}/api/youtube-shorts?${qp.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { shorts?: Array<{ videoId?: string }> };
      const ids = (data.shorts ?? [])
        .map((s) => s.videoId)
        .filter((v): v is string => typeof v === 'string' && v.length === 11)
        .slice(0, SEED_COUNT);
      if (ids.length) lastGoodSeed = ids;
      return ids;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawGl = typeof req.query.gl === 'string' ? req.query.gl.toUpperCase() : '';
  const gl = /^[A-Z]{2}$/.test(rawGl) ? rawGl : '';
  // 2026-08-05 — 앱이 보내는 hl(언어)을 실제로 읽어 시드 조회에 넘긴다. 값 검증을 두는 이유는
  // gl과 같다 — 그대로 URL에 실리므로 임의 문자열이 들어오면 안 된다.
  const rawHl = typeof req.query.hl === 'string' ? req.query.hl.toLowerCase() : '';
  const hl = /^[a-z]{2}$/.test(rawHl) ? rawHl : '';
  // 배포 도메인을 코드에 박지 않는다 — 프리뷰/프로덕션 어디에 배포돼도 자기 자신을 부른다.
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const fetched = origin ? await fetchSeedVideoIds(origin, gl, hl) : [];
  // 이번에 못 받았으면 직전 성공분을 쓴다(위 lastGoodSeed 주석 참고).
  const seedVideoIds = fetched.length ? fetched : lastGoodSeed;

  // 진입 전략은 거의 안 바뀌므로 길게 캐시해도 되지만, 시드 영상은 자주 갈려야 사용자마다 시작점이
  // 흩어진다 — 둘의 요구가 반대라 짧은 쪽(시드)에 맞춘다. 어차피 앱이 부팅 때 1회만 부른다.
  // 빈 시드를 10분간 캐시하면 그 10분 동안 모든 사용자가 쇼츠를 시작조차 못 한다
  // (실측 2026-08-28: 안쪽 호출이 18~28초 걸려 8초 제한에 걸리는 바람에 빈 배열이 캐시됐다).
  // 빈 결과는 성공이 아니므로 짧게만 캐시해 다음 요청이 곧바로 다시 시도하게 한다.
  // stale-if-error — 시드가 하나도 없으면 200 대신 503 을 돌려, CDN 이 **마지막 정상 응답**을
  // 최대 하루까지 대신 서빙하게 한다. 200 으로 빈 배열을 돌려주던 게 장애를 10분씩 연장한
  // 원인이었다(youtube-shorts 에서 이미 같은 교훈을 적용했다).
  if (!seedVideoIds.length) {
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60, stale-if-error=86400');
    res.setHeader('Vary', 'x-vercel-ip-country');
    res.status(503).json({ error: 'NO_SEED', strategies: STRATEGIES });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800, stale-if-error=86400');
  res.setHeader('Vary', 'x-vercel-ip-country');
  // 2026-08-04 사장님 설계 확정("안드로이드랑 애플이 시작 주소만 다를 뿐, 다음 영상은 유튜브
  // 알고리즘이 보여준다") — 두 플랫폼이 **같은 정책 소스**를 쓰고 시작 주소 형태만 다르다.
  //   android: 유튜브 앱을 여는 방법(인텐트 액션 / App Link URL)
  //   ios    : 앱 안 WebView가 로드할 URL (외부 앱을 열지 않는다)
  // 시작점(videoId)은 어느 쪽이든 기기가 정한다 — 서버가 목록을 정하면 캐시를 공유하는 사용자끼리
  // 같은 영상에서 시작하게 되므로(그게 원래 문제였다), 서버는 재료(seedPool)와 규칙만 준다.
  //
  // ⚠️ `strategies`는 기존 필드명을 그대로 유지한다 — 이미 배포된 Android 앱이 이 이름으로 파싱한다.
  //    새 필드(ios)는 구버전 앱이 그냥 무시하므로 하위호환이 깨지지 않는다.
  res.status(200).json({
    strategies: STRATEGIES,
    ios: {
      // iOS는 이 URL을 WebView에 로드하고, 그 뒤 스와이프/자동넘김은 유튜브 페이지가 스스로 처리한다
      // (주입 JS의 window.paceAdvance가 scrollBy + ArrowDown으로 페이지 자체를 넘긴다).
      startUrl: 'https://www.youtube.com/shorts/{videoId}',
      // Android와 같은 이유로 serverPool 먼저 — userSaved는 개수가 적어 누를 때마다 같은 영상이
      // 나온다(위 STRATEGIES의 videoIdSource 주석 참고). 양 플랫폼 동작을 일치시킨다.
      videoIdSource: ['serverPool', 'userSaved'],
    },
    seedPool: seedVideoIds,
  });
}
