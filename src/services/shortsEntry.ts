import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { Linking, Platform } from 'react-native';
import { YOUTUBE_PROXY_URL } from './api/youtube';
import { getSavedVideos } from '../database/repositories/savedVideosRepository';
import { useUserStore } from '../store/useUserStore';

// "Shorts with PACE" 진입 — **정책은 서버가, 시작점은 기기가** 정한다. (2026-08-04 사장님 지시)
//
// ── 왜 정책을 서버에서 받는가 ──
// 앱은 이미 출시됐는데 유튜브 Shorts 탭 진입은 공개 API가 아니다. 내부 인텐트 액션과, URL 형태별
// 라우팅 동작에 의존한다. 실기기 전수 확인 결과:
//   ① 인텐트 액션 open.shorts                  → Shorts 탭 ✅
//   ② https://www.youtube.com/shorts/<영상ID>  → Shorts 탭 ✅ (이후 스와이프하면 개인 피드로 이어짐)
//   ③ https://m.youtube.com/shorts/<영상ID>    → 홈 탭 ❌ (www와 m이 다르게 라우팅됨)
//   ④ https://www.youtube.com/shorts (ID 없음) → 홈 탭 ❌ (출시본의 기존 동작)
// 유튜브가 앱을 업데이트하면 이 표는 언제든 바뀐다. 전략이 앱에 박혀 있으면 스토어 심사를 다시
// 타야만 고칠 수 있고, 그동안 기존 사용자는 계속 홈 탭으로 떨어진다. 그래서 "무엇을 어떤 순서로
// 시도할지"를 서버(api/shorts-entry.ts)가 내려주고 앱은 **그걸 해석해 실행만** 한다.
// ※ 유튜브가 등록한 open 계열 액션은 shorts/search/subscriptions 3개가 전부임을 기기 매니페스트
//   덤프로 확인했다 — 즉 ①보다 나은 후보는 현재 존재하지 않는다.
//
// ── 왜 시작 영상 "리스트"를 서버에서 받으면 안 되는가 (사장님 지적) ──
// "리스트를 백엔드에서 받아오는 게 아니라, 이러면 다 똑같은 쇼츠잖아. 정책을 받아오게."
// 정확한 지적이다. 서버가 목록을 주면 같은 캐시 창의 모든 사용자가 같은 목록을 받고, 결국 같은
// 영상에서 시작한다 — 처음에 문제였던 "전원 동일"이 그대로 재발한다. 그래서 서버는 **어디서
// 시작점을 뽑을지(videoIdSource)만 지시**하고, 실제 값은 각 기기가 자기 데이터에서 고른다:
//   userSaved  — 이 사용자가 직접 저장/캡처한 영상(기기마다 다름 = 진짜 개인화)
//   serverPool — 위가 비어 있을 때만 쓰는 최후 수단(신규 사용자). 서버 풀에서 무작위로 고르되
//                기기별로 다른 값이 나오도록 앱에서 무작위 선택한다.
// 애초에 ①이 성공하면 시작점 자체가 필요 없다(사용자 개인 피드로 바로 들어간다) — 시드 경로는
// ①이 사라졌을 때를 대비한 안전망이다.
//
// ── 안전장치 ──
// 서버가 죽거나 응답이 깨져도 DEFAULT_POLICY로 동작한다(서버 의존이 새 단일 장애점이 되지 않는다).
// 받은 정책은 검증 후 사용하고(https 외 스킴 거부) AsyncStorage에 저장해 오프라인에서도 최신 정책을
// 쓴다. 부팅 때 미리 받아두고 탭 순간엔 캐시만 쓴다 — 탭 시점에 네트워크를 기다리면 그게 곧 체감
// 지연이 된다.

type VideoIdSource = 'userSaved' | 'serverPool';

type Strategy =
  | { kind: 'nativeAction'; action: string; packageName: string }
  | { kind: 'url'; url: string; videoIdSource?: VideoIdSource[] };

// 2026-08-04 §4-1(Mac) — 서버가 iOS용 시작 정책도 내려준다(`ios.videoIdSource`). iOS Pace Feed는
// 이걸로 시드(첫 영상)를 기기가 고른다 — 공유 큐(전원 동일·외국) 대신. 이후는 WebView SWIPE로 유튜브 알고리즘.
type EntryPolicy = { strategies: Strategy[]; seedPool: string[]; ios?: { videoIdSource: VideoIdSource[] } };

// ⚠️ 2026-08-05 사장님 지적("안드로이드는 계속 첫 영상이 같다") — 여기 순서가 서버 정책(api/shorts-entry.ts)과
// **정반대**였다. 서버는 9cbfef5에서 "누를 때마다 새 영상"을 위해 url{videoId}를 1순위로 올렸는데, 앱 내장
// 기본값은 nativeAction이 1순위인 옛 순서 그대로 남아 있었다. nativeAction은 유튜브 Shorts 탭을 "열" 뿐이라
// 유튜브가 보던 자리를 이어서 보여준다 = 매번 같은 영상. 게다가 openShortsFeed는 첫 성공에서 return하므로
// 이 기본값이 쓰이는 한 시드 경로에는 영영 도달하지 못한다.
//
// 기본값은 "서버를 못 받았을 때"만 쓰이지만 그 경우가 드물지 않다 — 프리페치 실패/타임아웃, 오프라인 첫 실행,
// 그리고 **부팅 프리페치보다 탭이 빠른 레이스**. 사장님 기기가 계속 같은 영상이던 게 이 경로다.
// 서버 정책과 순서를 일치시킨다. (서버가 살아 있으면 어차피 덮어써지므로 중복이 아니라 안전망 정합이다.)
const DEFAULT_POLICY: EntryPolicy = {
  strategies: [
    // 1순위 — 시작 영상을 명시해 매번 새 영상에서 출발한다. 그 뒤 스와이프는 유튜브 알고리즘이 이어간다.
    // videoIdSource도 서버와 같은 serverPool 우선: userSaved는 보통 몇 개뿐이라 1순위로 두면 누를 때마다
    // 같은 영상이 나오고, 이미 저장해 본 영상이라 "새로 시작"에도 안 맞는다(서버 주석 58~63행과 동일 근거).
    { kind: 'url', url: 'https://www.youtube.com/shorts/{videoId}', videoIdSource: ['serverPool', 'userSaved'] },
    // 시작 영상을 못 구했을 때의 폴백 — Shorts 탭엔 확실히 들어가지만 보던 자리를 이어서 연다.
    {
      kind: 'nativeAction',
      action: 'com.google.android.youtube.action.open.shorts',
      packageName: 'com.google.android.youtube',
    },
    // 🔴 2026-08-09 사장님 지적("지금 기기가 왜 유투브 홈을 보여주냐" → "제대로 고쳐") —
    //   예전엔 여기 `https://www.youtube.com/shorts`(영상 ID 없음)가 "최후 폴백"으로 있었다.
    //   그런데 이 URL은 **확정적으로 홈 탭을 연다**(위 표 ④, 이 파일이 처음부터 그렇게 적어뒀다).
    //   즉 "폴백"이 아니라 **실패를 보장하는 경로**였다 — 시드를 못 구하면 반드시 홈이 열렸다.
    //   nativeAction(위 ②)은 시드가 없어도 진짜 Shorts 탭에 확실히 들어간다. 홈으로 떨어질 바에는
    //   "보던 자리에서 이어보기"가 언제나 낫다. 그래서 홈行 전략을 목록에서 **없앤다**.
    //   (실기기 A/B 재확인: `www.youtube.com/shorts/<id>`는 지금도 Shorts 전체화면으로 정상 진입.)
  ],
  seedPool: [],
};

// ⚠️ 2026-08-05 v3 → v4. 서버 전략 순서가 9cbfef5에서 바뀌었는데(nativeAction 1순위 → url{videoId}
// 1순위) 저장 키를 안 올렸다. 그래서 그 전에 정책을 캐시한 기기는 부팅 때 **옛 순서를 먼저 올려두고**
// (아래 prefetch가 stored를 즉시 cached에 반영한다) 새 응답이 도착하기 전에 탭하면 nativeAction으로
// 열려 유튜브가 보던 자리 = 매번 같은 영상이 나왔다. 키를 올려 옛 정책을 버린다 — 새 키로 처음
// 뜰 땐 저장값이 없어 (수정된) DEFAULT_POLICY로 동작하므로 옛 순서가 되살아날 경로가 없다.
const STORAGE_KEY = 'pace.shortsEntryPolicy.v4';
const VIDEO_ID_RE = /^[\w-]{11}$/;
let cached: EntryPolicy = DEFAULT_POLICY;

// 서버 응답을 그대로 믿지 않는다 — 형태가 깨진 값이 들어오면 진입이 통째로 막히므로 검증한다.
function sanitize(raw: unknown): EntryPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { strategies?: unknown; seedPool?: unknown };
  if (!Array.isArray(obj.strategies)) return null;
  const strategies = obj.strategies.filter((s): s is Strategy => {
    if (!s || typeof s !== 'object') return false;
    const v = s as Record<string, unknown>;
    if (v.kind === 'nativeAction') return typeof v.action === 'string' && typeof v.packageName === 'string';
    // https만 허용 — 서버가 오염돼도 임의 스킴(intent:, file: 등)을 실행하지 않는다.
    if (v.kind === 'url') {
      if (typeof v.url !== 'string' || !v.url.startsWith('https://')) return false;
      // 🔴 2026-08-09 — **영상 ID 없는 Shorts URL은 거부한다.** 그건 Shorts 탭이 아니라 홈 탭을
      //   여는 것이 확정이라(위 표 ④), 어떤 순서에 있든 "여기까지 오면 홈이 열린다"는 뜻이 된다.
      //   서버 정책에서 뺐지만 **이미 캐시된 옛 정책**이 기기에 남아 있을 수 있어(STORAGE_KEY가
      //   같으면 그대로 재사용된다) 여기서도 막는다. 앱 쪽에서 한 번 더 막아야 이미 설치된 기기가
      //   서버 응답을 못 받는 상황(오프라인/프리페치 실패)에서도 홈으로 안 떨어진다.
      if (!v.url.includes('{videoId}') && /\/shorts\/?$/.test(v.url)) return false;
      return true;
    }
    return false;
  });
  if (!strategies.length) return null;
  const seedPool = Array.isArray(obj.seedPool)
    ? obj.seedPool.filter((v): v is string => typeof v === 'string' && VIDEO_ID_RE.test(v))
    : [];
  // iOS 시작 정책(선택) — videoIdSource만 검증해 쓴다(startUrl은 앱이 www.youtube.com/shorts/{id}로 고정).
  const iosRaw = (obj as { ios?: unknown }).ios;
  let ios: EntryPolicy['ios'];
  if (iosRaw && typeof iosRaw === 'object') {
    const src = (iosRaw as { videoIdSource?: unknown }).videoIdSource;
    const vids = Array.isArray(src)
      ? src.filter((s): s is VideoIdSource => s === 'userSaved' || s === 'serverPool')
      : [];
    if (vids.length) ios = { videoIdSource: vids };
  }
  return { strategies, seedPool, ios };
}

/** 앱 시작 시 1회. 실패해도 조용히 무시한다 — 내장 기본 정책으로 계속 동작한다. */
export async function prefetchShortsEntryPolicy(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = sanitize(JSON.parse(stored));
      if (parsed) cached = parsed; // 새로 못 받아도 직전 정책은 즉시 쓸 수 있게 먼저 올려둔다
    }
  } catch {
    // 저장값 파손 — 기본 정책 유지.
  }
  try {
    if (!YOUTUBE_PROXY_URL) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // 2026-08-04 사장님 지적("iOS는 아직 외국" + "안드 확인해") — 서버(api/shorts-entry)는 seedPool을
      // 만들 때 앱이 넘긴 gl을 쓰는데, gl이 없으면 서버-투-서버 호출이라 IP추정도 안 돼 US로 떨어진다.
      // 그래서 앱이 gl을 넘겨야 한다. ⭐ 안드로이드는 지역(스토어)이 아니라 **언어**로 판단한다
      // (PaceOverlayService.isKoreanLocale() = configuration.locales[0].language == "ko"). 폰 스토어 지역이
      // US여도 한국어 사용자는 한국 콘텐츠를 원하기 때문. iOS도 동일하게 "언어" 기준으로 gl을 정한다
      // (하드코딩 아님 — 한국어=KR, 일본어=JP, 그 외는 폰 지역). hl은 그대로 언어.
      const loc = Localization.getLocales()[0];
      const lang = (loc?.languageCode || '').toLowerCase();
      const LANG_TO_GL: Record<string, string> = { ko: 'KR', ja: 'JP' };
      const gl = LANG_TO_GL[lang] || (loc?.regionCode || '').toUpperCase();
      const qp = new URLSearchParams();
      if (gl) qp.set('gl', gl);
      if (lang) qp.set('hl', lang);
      const entryUrl = `${YOUTUBE_PROXY_URL}/api/shorts-entry${qp.toString() ? `?${qp}` : ''}`;
      const res = await fetch(entryUrl, { signal: controller.signal });
      if (!res.ok) return;
      const parsed = sanitize(await res.json());
      if (!parsed) return;
      cached = parsed;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // 네트워크/파싱 실패 — 기본 정책 또는 직전 저장값으로 계속.
  }
}

// 이 기기의 사용자가 직접 저장/캡처한 영상 ID들 — 기기마다 다르므로 "전원 동일" 문제가 없다.
async function userSavedVideoIds(): Promise<string[]> {
  try {
    const userId = useUserStore.getState().user?.id;
    if (!userId) return [];
    const lists = await Promise.all([getSavedVideos(userId, 'favorite'), getSavedVideos(userId, 'capture')]);
    return lists
      .flat()
      .map((v) => v.videoId)
      .filter((v): v is string => typeof v === 'string' && VIDEO_ID_RE.test(v));
  } catch {
    return [];
  }
}

function pickRandom(list: string[]): string | null {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// 서버가 지시한 출처 순서대로 시작 영상을 구한다. 매 호출마다 새로 고른다 — 고정하면 같은 사용자가
// 열 때마다 같은 영상으로 시작하게 된다.
async function resolveVideoId(sources: VideoIdSource[]): Promise<string | null> {
  for (const src of sources) {
    if (src === 'userSaved') {
      const picked = pickRandom(await userSavedVideoIds());
      if (picked) return picked;
    } else if (src === 'serverPool') {
      const picked = pickRandom(cached.seedPool);
      if (picked) return picked;
    }
  }
  return null;
}

/**
 * iOS Pace Feed의 시작 시드 videoId — 기기가 스스로 고른다(userSaved→serverPool 무작위, §4-1).
 * 매 진입마다 새로 고르므로 같은 사용자도 열 때마다 다른 시작점(=유튜브 알고리즘이 각자 다르게 이어감).
 * null이면(신규 사용자 + 서버 seedPool 빈 경우) 호출부가 기존 공유 큐로 폴백한다.
 */
export async function getShortsSeedVideoId(): Promise<string | null> {
  // 기본 출처 순서는 서버와 동일하게 serverPool 우선(2026-08-05) — userSaved를 앞에 두면 저장 영상이
  // 몇 개뿐인 사용자는 누를 때마다 같은 영상이 나온다(서버 주석 58~63행과 동일 근거).
  return resolveVideoIdWithPrefetch(cached.ios?.videoIdSource ?? ['serverPool', 'userSaved'], null);
}

// 탭 순간 seedPool이 비어 있을 때 얼마나 기다릴지. 안드로이드는 이 함수가 곧 "유튜브 앱 열기"라
// 무한정 기다리면 그게 체감 지연이 된다 — 짧게만 기다리고 못 받으면 다음 전략으로 넘어간다.
const SEED_WAIT_MS = 1200;

/**
 * 시드 레이스 방지 — seedPool이 아직 비어 있으면(부팅 프리페치보다 탭이 빨랐거나 프리페치 실패)
 * 프리페치를 한 번 기다렸다 재시도한다. 이게 없으면 첫 진입이 곧바로 폴백 전략으로 떨어진다
 * (안드로이드에선 그게 nativeAction = 유튜브가 보던 자리 = **매번 같은 영상**).
 * @param waitMs null이면 끝까지 기다린다(iOS 인앱 피드 — 이미 로딩 커버가 떠 있어 대기가 보이지 않는다).
 */
async function resolveVideoIdWithPrefetch(
  sources: VideoIdSource[],
  waitMs: number | null
): Promise<string | null> {
  const picked = await resolveVideoId(sources);
  if (picked || cached.seedPool.length > 0) return picked; // 풀이 있는데 못 골랐으면 기다려도 소용없다
  const prefetching = prefetchShortsEntryPolicy(); // 내부에서 전부 try/catch — reject 안 함
  if (waitMs === null) await prefetching;
  else await Promise.race([prefetching, new Promise<void>((r) => setTimeout(r, waitMs))]);
  return resolveVideoId(sources);
}

/**
 * 캐시된 정책을 순서대로 실행한다. 하나라도 성공하면 true.
 * 네트워크를 기다리지 않는다(부팅 때 받아둔 정책만 쓴다).
 */
export async function openShortsFeed(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  for (const s of cached.strategies) {
    try {
      if (s.kind === 'nativeAction') {
        const { PaceOverlay } = require('../../modules/pace-overlay');
        if (PaceOverlay?.openYouTubeShortsFeed?.(s.action, s.packageName)) return true;
        continue;
      }
      if (s.url.includes('{videoId}')) {
        // 자리표시자가 있는데 시작점을 못 구하면 이 전략은 건너뛴다 — 빈 ID로 열면 홈 탭으로
        // 떨어지므로, 다음 폴백을 시도하는 편이 낫다.
        // ⚠️ 2026-08-05 — 예전엔 여기서 곧바로 continue했다. seedPool이 아직 안 왔을 뿐인데(부팅
        // 프리페치 레이스) 바로 nativeAction으로 떨어져 유튜브가 보던 자리를 열었다 = "매번 같은 영상".
        // iOS 경로(getShortsSeedVideoId)엔 dfd4fb7로 레이스 대응이 들어갔는데 안드로이드 경로에는
        // 빠져 있었다. 동일한 대응을 넣되, 탭 응답성을 위해 대기를 SEED_WAIT_MS로 제한한다.
        const videoId = await resolveVideoIdWithPrefetch(
          s.videoIdSource ?? ['serverPool', 'userSaved'],
          SEED_WAIT_MS
        );
        if (!videoId) continue;
        await Linking.openURL(s.url.replace('{videoId}', videoId));
      } else {
        await Linking.openURL(s.url);
      }
      return true;
    } catch {
      // 이 전략 실패 — 다음으로.
    }
  }
  return false;
}
