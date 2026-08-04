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

type Strategy =
  // 네이티브 인텐트 액션(안드로이드 전용). 앱이 이 액션으로 유튜브를 연다.
  | { kind: 'nativeAction'; action: string; packageName: string }
  // URL 열기. `{videoId}` 자리표시자가 있으면 앱이 아래 seedVideoIds 중 하나로 치환한다.
  | { kind: 'url'; url: string };

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
  {
    kind: 'nativeAction',
    action: 'com.google.android.youtube.action.open.shorts',
    packageName: 'com.google.android.youtube',
  },
  // 영상 ID를 붙인 www 주소 — Shorts 탭으로 들어가고, 스와이프하면 사용자 개인 알고리즘 피드로
  // 이어지는 것을 실기기에서 확인했다(시작 영상 하나만 우리가 정하고 그 뒤는 유튜브가 개인화).
  { kind: 'url', url: 'https://www.youtube.com/shorts/{videoId}' },
  // 최후 폴백 — 홈 탭으로 떨어지지만 아무것도 안 열리는 것보다는 낫다(출시본의 기존 동작).
  { kind: 'url', url: 'https://www.youtube.com/shorts' },
];

// 시작 영상 후보를 여러 개 내려준다 — 앱이 그중 하나를 무작위로 고른다. 하나만 주면 같은 캐시
// 창 안의 사용자가 전부 같은 영상으로 시작하게 되는데, 그게 애초에 사장님이 지적한 "다 같은
// 영상" 문제였다. 시작점만 갈라주면 그 뒤는 각자의 개인 피드로 흩어진다.
const SEED_COUNT = 12;

async function fetchSeedVideoIds(origin: string, gl: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // 같은 프로젝트의 기존 프록시를 재사용한다 — 스크래핑/캐싱/지역분기 로직을 중복 구현하지 않는다.
      const res = await fetch(`${origin}/api/youtube-shorts?query=%23shorts&gl=${gl}`, {
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { shorts?: Array<{ videoId?: string }> };
      return (data.shorts ?? [])
        .map((s) => s.videoId)
        .filter((v): v is string => typeof v === 'string' && v.length === 11)
        .slice(0, SEED_COUNT);
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
  // 배포 도메인을 코드에 박지 않는다 — 프리뷰/프로덕션 어디에 배포돼도 자기 자신을 부른다.
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const seedVideoIds = origin ? await fetchSeedVideoIds(origin, gl) : [];

  // 진입 전략은 거의 안 바뀌므로 길게 캐시해도 되지만, 시드 영상은 자주 갈려야 사용자마다 시작점이
  // 흩어진다 — 둘의 요구가 반대라 짧은 쪽(시드)에 맞춘다. 어차피 앱이 부팅 때 1회만 부른다.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  res.setHeader('Vary', 'x-vercel-ip-country');
  res.status(200).json({ strategies: STRATEGIES, seedVideoIds });
}
