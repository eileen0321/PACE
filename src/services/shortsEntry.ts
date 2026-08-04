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

const DEFAULT_POLICY: EntryPolicy = {
  strategies: [
    {
      kind: 'nativeAction',
      action: 'com.google.android.youtube.action.open.shorts',
      packageName: 'com.google.android.youtube',
    },
    { kind: 'url', url: 'https://www.youtube.com/shorts/{videoId}', videoIdSource: ['userSaved', 'serverPool'] },
    { kind: 'url', url: 'https://www.youtube.com/shorts' },
  ],
  seedPool: [],
};

const STORAGE_KEY = 'pace.shortsEntryPolicy.v2';
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
    if (v.kind === 'url') return typeof v.url === 'string' && v.url.startsWith('https://');
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
      // 2026-08-04 사장님 지적("iOS는 아직 외국") — 프록시는 gl/hl이 없으면 접속 IP(x-vercel-ip-country)로
      // 지역을 추정하는데, iOS 요청 IP가 KR로 안 잡히면 US seedPool을 줘 외국 시드가 나왔다(안드는 Railway
      // 하드코딩 KR이라 무관). 기기 로케일(지역/언어)을 명시적으로 넘겨 seedPool을 기기 나라에 맞춘다
      // (하드코딩 아님 — 한국 기기=KR, 미국 기기=US). 프록시가 gl/hl 파라미터를 우선한다.
      const loc = Localization.getLocales()[0];
      const qp = new URLSearchParams();
      if (loc?.regionCode) qp.set('gl', loc.regionCode);
      if (loc?.languageCode) qp.set('hl', loc.languageCode);
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
  const sources = cached.ios?.videoIdSource ?? ['userSaved', 'serverPool'];
  let picked = await resolveVideoId(sources);
  // seedPool이 아직 안 받아진 상태(부팅 프리페치 레이스 — 첫 진입이 프리페치보다 빠른 경우)면
  // 한 번 프리페치를 기다렸다 재시도한다. 이게 없으면 첫 진입이 빈 seedPool→null→공유 큐(외국)로 폴백했다.
  if (!picked && cached.seedPool.length === 0) {
    await prefetchShortsEntryPolicy();
    picked = await resolveVideoId(sources);
  }
  return picked;
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
        const videoId = await resolveVideoId(s.videoIdSource ?? ['userSaved', 'serverPool']);
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
