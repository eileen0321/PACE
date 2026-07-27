import { Linking, Platform } from 'react-native';
import type { AppShieldTarget } from '../types/models';

// 세션 시작/오버레이 자동 표시가 실제로 감시하는 MVP 지원 앱 — PACE_ARCHITECTURE.md "제품 전략
// 피벗" 참고. `constants/apps.ts`의 SHORT_FORM_APPS(5개, Focus 탭 Shield 토글용 카탈로그)와는
// 별개 — 이 목록은 좁은 MVP 범위(YouTube Shorts + Instagram Reels만)이고, Focus 탭 Shield는
// 별도 기능(앱 차단 설정)이라 당장 같이 줄이지 않았다. 두 목록이 갈라져 있는 상태이며,
// Focus 탭 스코프를 다시 논의할 때 합칠지 결정 필요.
//
// ⚠️ modules/pace-overlay/android/.../ForegroundAppWatcher.kt의 SupportedApps.PACKAGES와 반드시
// 동기화 — Kotlin이 이 JS 상수를 읽을 방법이 없어 양쪽에 각각 하드코딩돼 있다.
export const SUPPORTED_APPS = {
  // androidScheme: 앱을 직접 여는 공개 URL 스킴(Linking.openURL) — 특정 화면(Shorts 탭 등)으로
  // 바로 딥링크하는 공식 방법은 없어 앱을 기본 진입점으로만 연다. webFallback은 스킴 실행이
  // 실패했을 때(앱 미설치 등) 열 웹 URL.
  // packageNames: 배열인 이유 — TikTok이 리전별로 다른 패키지명을 쓴다(아래 tiktok 항목 참고).
  // 2026-07-28 실기기 재현으로 확인: m.youtube.com/shorts는 App Link로 열려도 YouTube가 그냥 홈 탭을
  // 보여준다(영상 ID 없는 경로라 Shorts로 인식 안 함 — InternalMainActivity가 뜨는 건 같지만 내용물이
  // 홈). www.youtube.com/shorts(같은 경로, m. 대신 www. 서브도메인)는 영상 ID 없이도 정확히 Shorts
  // 풀스크린 피드로 연결됨을 adb am start로 직접 검증. m. 서브도메인만 도메인 검증/라우팅 테이블에서
  // 빠져있는 것으로 추정 — 원인 추적보다 검증된 URL로 교체.
  youtube: { packageNames: ['com.google.android.youtube'], label: 'YouTube Shorts', androidScheme: 'vnd.youtube://', webFallback: 'https://www.youtube.com/shorts', preferScheme: false },
  // 2026-07-28 실기기 재현(adb am start로 직접 검증, YouTube와 정반대 결과) — 여기는 https App Link
  // (`www.instagram.com/reels/`)가 "성공"하면서 Reels가 아니라 그냥 홈 피드를 연다. 반면 커스텀 스킴
  // `instagram://reels_home`은 정확히 릴스 탭(상단 "릴스" 선택된 풀스크린 영상 피드)으로 바로 연결됨을
  // 확인 — YouTube와 우선순위를 반대로(`preferScheme: true`) 둬야 한다. 예전 `instagram://app`은
  // 릴스 전용이 아니라 그냥 앱 진입점이라 이걸로 교체.
  instagram: { packageNames: ['com.instagram.android'], label: 'Instagram Reels', androidScheme: 'instagram://reels_home', webFallback: 'https://www.instagram.com/reels/', preferScheme: true },
  // 2026-07-18: 사용자 지시로 healthy-shorts-assistant(2) 원본 그대로 TikTok도 Home 플랫폼 선택에
  // 복원(원래 MVP 축소안에선 제외했었음) — "제품 전략 피벗" 문서에 이 오버라이드를 기록해둘 것.
  // ⚠️ 2026-07-18 실기기(한국 리전 설치본) 검증 중 발견: 글로벌 패키지명(com.zhiliaoapp.musically)
  // 하나만 등록했더니 실제 한국 리전 TikTok(com.ss.android.ugc.trill)에서 앱 실행 자체는 정상
  // 동작하는데 오버레이가 전혀 안 뜨는 버그로 이어졌다(ForegroundAppWatcher가 포그라운드 패키지를
  // 못 알아봄) — 두 패키지명 다 등록.
  // 2026-07-28 실기기 재현으로 webFallback(`www.tiktok.com/foryou`) 확인 — YouTube/Instagram과 달리
  // 정확히 추천(For You) 풀스크린 피드로 바로 열림. 기본 우선순위(webFallback 먼저)로 그대로 둠.
  tiktok: { packageNames: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'], label: 'TikTok Video Loop', androidScheme: 'tiktok://', webFallback: 'https://www.tiktok.com/foryou', preferScheme: false },
} as const;

// 2026-07-20 실기기 검증 중 발견: 이 함수를 세션 시작 useEffect 안(DB 조회 2번 + Connecting 애니메이션
// 이후)에서 부르면, 원래 탭 제스처로부터 너무 늦게 호출돼 안드로이드의 백그라운드 액티비티 시작
// 제한(BAL) 유예 시간을 넘겨 Linking.openURL이 조용히 막힌다(예외도 없이 그냥 아무 일도 안 일어남 —
// 대신 Pace 자신의 /overlay 화면이 dev 시뮬레이터 콘텐츠를 보여준 채로 남아있어 "유튜브가 까맣게
// 멈췄다"로 오인하기 쉽다). 탭 제스처와 최대한 가깝게(Home 화면 탭 핸들러) 호출해야 한다.
export async function launchPlatformApp(platform: AppShieldTarget | undefined) {
  if (Platform.OS !== 'android' || !platform) return;
  const app = SUPPORTED_APPS[platform as keyof typeof SUPPORTED_APPS];
  if (!app) return;
  // 2026-07-18 실기기 검증 중 발견한 실버그: YouTube는 `vnd.youtube://`(커스텀 스킴)로 열면 앱이
  // 설치돼 있을 때 항상 "성공"으로 catch를 안 타서, Shorts 전용 URL인 webFallback
  // (m.youtube.com/shorts)이 영영 안 쓰이고 매번 YouTube 홈 탭만 열렸다("Shorts 카드를 눌렀는데
  // YouTube 홈이 뜬다"는 사용자 지적으로 발견). https Shorts URL은 Android App Links로 앱이 설치돼
  // 있으면 네이티브 앱의 Shorts 탭으로, 안 돼있으면 브라우저로 자동 라우팅되므로 —
  // 커스텀 스킴 우선순위를 뒤집어 App Link(webFallback)를 먼저 시도.
  // 2026-07-28 Instagram은 정반대로 확인돼(위 주석) `preferScheme` 플래그로 플랫폼별 우선순위를
  // 분리한다 — 모든 플랫폼에 같은 순서를 강제하면 한쪽은 항상 틀린 화면으로 열린다.
  const [first, second] = app.preferScheme
    ? [app.androidScheme, app.webFallback]
    : [app.webFallback, app.androidScheme];
  try {
    await Linking.openURL(first);
  } catch {
    await Linking.openURL(second).catch(() => {});
  }
}
