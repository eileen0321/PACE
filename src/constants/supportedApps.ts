import { Linking, Platform } from 'react-native';
import { openShortsFeed } from '../services/shortsEntry';
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
  // 정확히 추천(For You) 풀스크린 피드로 바로 열림. 기본 우선순위(webFallback 먼저)로 그대로 뒀었다.
  // 🔴 2026-08-13 사장님 지적("틱톡은 실행하면 웹페이지가 나오고 번쩍이다 영상이 플레이돼") —
  //   그 "번쩍임"의 정체가 이 우선순위다. webFallback을 먼저 열면 안드로이드가 **웹 URL을 한 번
  //   띄웠다가** 앱 링크로 TikTok 앱에 넘긴다. 최종 도착지는 같지만 그 사이 브라우저 화면이
  //   깜빡인다. Instagram도 같은 이유로 2026-07-28에 이미 preferScheme: true로 뒤집었다.
  //   → tiktok:// 스킴을 먼저 시도해 앱으로 직행한다. 스킴이 실패하면 기존 webFallback으로
  //     자동 폴백하므로(launchPlatformApp의 [first, second] 구조) 안전망은 그대로다.
  //
  // 🔴🔴 2026-08-13 (2차) — **위 변경을 되돌린다.** 사장님 실기기 지적: *"틱톡 누르는데 왜 시작이
  //   계속 같은 영상이야."* 원인이 정확히 위 `preferScheme: true`다.
  //   `tiktok://`는 **앱의 기본 진입점**이라 틱톡이 마지막으로 보던 상태를 그대로 복원한다 —
  //   카드를 누를 때마다 같은 영상에서 시작한다. 유튜브에서 이미 똑같이 겪었다
  //   (2026-08-05 "첫 영상이 매번 같다" → openShortsFeed로 해결한 그것. 그때 배운 걸 틱톡에
  //   적용하지 않고 오히려 같은 함정으로 들어갔다).
  //   반면 webFallback은 바로 위 2026-07-28 줄이 적어둔 대로 **실기기에서 "정확히 추천(For You)
  //   풀스크린 피드로 바로 열림"을 확인해 둔 경로**다 — 검증된 동작을 연출 문제 때문에 버린 셈이다.
  //   ⚠️ 트레이드오프 판단: 번쩍임은 **거슬리는 연출**이고, 같은 영상 반복은 **제품이 무의미해지는
  //     기능 실패**다. 후자를 먼저 막는다.
  //
  // ✅ 2026-08-14 (3차, 실기기 확정) — **둘 다 되는 경로를 찾았다: `tiktok://feed`.**
  //   사장님 지적("왜 틱톡 팝업이 초반에 떴다 화면이 사라지는게 보여")이 위 2차 변경의 대가였던
  //   번쩍임이다. 경로 없는 `tiktok://`(마지막 상태 복원)와 웹 URL(번쩍임) 사이에서 고르는 문제로
  //   봤는데, **경로를 붙인 스킴**이 제3의 답이었다.
  //   실기기 검증(앱 강제종료 후 두 번 연속 실행, 각 스크린샷 대조):
  //     1회차 `korea #소식` / 2회차 `mylovekbs` — **서로 다른 영상**
  //     둘 다 상단 탭이 "추천"(For You)이고, 웹 화면이 한 번도 안 뜬다(앱 직행).
  //   → androidScheme을 `tiktok://feed`로 바꾸고 preferScheme을 다시 true로 올린다.
  //     webFallback(웹 For You)은 스킴이 실패할 때의 안전망으로 그대로 둔다 — 리전별 설치본에서
  //     스킴이 갈리므로(openTikTokSearch가 snssdk1233://도 시도하는 것과 같은 이유) 없애지 않는다.
  tiktok: { packageNames: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'], label: 'TikTok Video Loop', androidScheme: 'tiktok://feed', webFallback: 'https://www.tiktok.com/foryou', preferScheme: true },
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
  // 2026-08-04 사장님 지적("각자 폰의 유튜브 앱 쇼츠 누른 것과 같은 URL이어야 유튜브 개인 알고리즘을
  // 타는 거 아냐") — 맞는 지적이었다. 아래 webFallback(`www.youtube.com/shorts`, 영상 ID 없음)은
  // **Shorts 탭이 아니라 홈 탭 컨텍스트에서 쇼츠 하나**를 트는 것이었다(실기기 스크린샷으로 확인:
  // 우리 URL로 열면 하단 네비가 "홈" 선택 상태, 사용자가 Shorts 탭을 직접 누르면 "Shorts" 선택 상태
  // 이고 나오는 영상도 완전히 달랐다). 유튜브 앱이 자체 등록해둔 전용 액션으로 진짜 Shorts 탭에
  // 진입한다(PaceOverlayModule.openYouTubeShortsFeed 주석에 근거·검증 과정 상세). 실패하면 기존
  // URL 경로로 그대로 폴백하므로 회귀 위험이 없다.
  //
  // 실기기 검증(2026-08-04)으로 확정한 우선순위 — 각 후보가 실제로 어디로 떨어지는지 스크린샷의
  // 하단 네비 선택 상태로 판정했다:
  //   ① 네이티브 액션 open.shorts        → Shorts 탭 ✅ (사용자 개인 피드로 바로)
  //   ② www.youtube.com/shorts/<영상ID>  → Shorts 탭 ✅ (그 영상으로 시작해 이후 개인 피드로 이어짐)
  //   ③ m.youtube.com/shorts/<영상ID>    → 홈 탭 ❌ (같은 경로라도 m. 서브도메인은 다르게 동작)
  //   ④ www.youtube.com/shorts (ID 없음) → 홈 탭 ❌ (기존 동작 = 이번에 고친 결함)
  // ②는 사장님 지시("쇼츠 시작 링크를 웹에서 가져다 쓴다")대로 앱 시작 때 미리 받아둔 ID를 쓴다
  // (services/shortsEntry.ts). ①이 유튜브 업데이트로 사라져도 ②가 공개 URL만으로 Shorts 탭을
  // 지켜주므로, ④(홈 탭)로 되돌아가는 회귀를 막는다.
  // ⚠️ 전략 자체는 서버(api/shorts-entry.ts)가 내려준다 — 유튜브 동작이 바뀌어도 그 파일만 고쳐
  // 배포하면 설치된 앱 전부가 즉시 고쳐진다(앱 업데이트/스토어 심사 불필요). 서버가 죽어도
  // services/shortsEntry.ts의 내장 기본값으로 동작하므로 새 단일 장애점이 되지 않는다.
  if (platform === 'youtube' && await openShortsFeed()) return;
  const [first, second] = app.preferScheme
    ? [app.androidScheme, app.webFallback]
    : [app.webFallback, app.androidScheme];
  try {
    await Linking.openURL(first);
  } catch {
    await Linking.openURL(second).catch(() => {});
  }
}

// 2026-08-01 사용자 실기기 지적("작아진 화면을 다시 키워야지 왜 전체화면에 새 쇼츠/유튜브 홈이
// 보여") — 세션이 이미 running인데 플랫폼 카드를 다시 탭하면(home.tsx) 세션을 새로 시작하지 않고
// 앱만 다시 앞으로 가져오면 되는데, 이 목적에도 launchPlatformApp()을 그대로 썼다. 근데 그 함수의
// webFallback(예: YouTube `www.youtube.com/shorts`)은 매번 "새 Shorts 진입" URL을 쏴 PIP로 줄어있던
// 기존 화면 대신 새 피드를 열었다. **1차 시도**로 androidScheme(순수 스킴, 예: `vnd.youtube://`)로
// 바꿔봤으나 실기기 재현 결과 이것도 틀렸다 — YouTube가 이 스킴을 "기본 진입점(홈 탭)"으로 매핑해
// 놔서 Shorts도 기존 PIP 화면도 아닌 YouTube 홈이 열렸다(딥링크는 결국 URL의 intent-filter가 매핑된
// 특정 화면으로 내비게이션하는 것이지 "그냥 태스크를 앞으로 가져오기"가 아니다 — 어떤 URL을 골라도
// 이 문제 자체는 못 피함). **최종 수정**: 딥링크를 아예 안 쓰고 네이티브
// getLaunchIntentForPackage+REORDER_TO_FRONT(PaceOverlayModule.resumeThirdPartyApp, 런처 아이콘을
// 다시 탭한 것과 완전히 동일한 방식)로 기존 태스크를 그 상태 그대로 앞으로 가져온다.
/**
 * 세션이 이미 running일 때 대상 앱을 "그 상태 그대로" 다시 앞으로 가져온다.
 * @returns 실제로 복원했으면 true. **false면 복원할 게 없었다는 뜻**이라 호출부가 정상 진입
 *          (launchPlatformApp → openShortsFeed)으로 돌려야 한다.
 */
export async function resumePlatformApp(platform: AppShieldTarget | undefined): Promise<boolean> {
  if (Platform.OS !== 'android' || !platform) return false;
  const app = SUPPORTED_APPS[platform as keyof typeof SUPPORTED_APPS];
  if (!app) return false;
  try {
    const { PaceOverlay } = require('../../modules/pace-overlay');
    // 2026-08-05 사장님 실기기 재현("또 유튜브 앱이야") — resumeThirdPartyApp은 런처 인텐트라
    // 복원할 태스크가 없으면 유튜브를 **홈 탭으로 새로** 열어버린다. 세션이 한 번 running이 되면
    // home.tsx가 항상 이 경로로 빠지므로, 그 뒤로는 쇼츠 진입 코드에 영영 도달하지 못했다.
    // 복원이 옳은 경우(사용자가 PIP로 줄여둔 창이 남아 있음)만 재개하고, 아니면 false를 돌린다.
    // ⚠️ 구버전 네이티브엔 이 함수가 없어 undefined가 나온다 — 그땐 기존 동작(항상 재개)을 유지해
    //    회귀를 만들지 않는다. false일 때만 새 분기를 탄다.
    const inPip = PaceOverlay?.isThirdPartyAppInPip?.(app.packageNames[0]);
    if (inPip === false) return false;
    PaceOverlay?.resumeThirdPartyApp(app.packageNames[0]);
    return true;
  } catch {
    // 네이티브 미링크(Dev Client 빌드 전) — 조용히 무시, 최후 폴백으로 기존 방식 시도.
    await Linking.openURL(app.androidScheme).catch(() => {});
    return true;
  }
}
