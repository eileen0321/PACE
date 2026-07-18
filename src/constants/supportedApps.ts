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
  youtube: { packageNames: ['com.google.android.youtube'], label: 'YouTube Shorts', androidScheme: 'vnd.youtube://', webFallback: 'https://m.youtube.com/shorts' },
  instagram: { packageNames: ['com.instagram.android'], label: 'Instagram Reels', androidScheme: 'instagram://app', webFallback: 'https://www.instagram.com/reels/' },
  // 2026-07-18: 사용자 지시로 healthy-shorts-assistant(2) 원본 그대로 TikTok도 Home 플랫폼 선택에
  // 복원(원래 MVP 축소안에선 제외했었음) — "제품 전략 피벗" 문서에 이 오버라이드를 기록해둘 것.
  // ⚠️ 2026-07-18 실기기(한국 리전 설치본) 검증 중 발견: 글로벌 패키지명(com.zhiliaoapp.musically)
  // 하나만 등록했더니 실제 한국 리전 TikTok(com.ss.android.ugc.trill)에서 앱 실행 자체는 정상
  // 동작하는데 오버레이가 전혀 안 뜨는 버그로 이어졌다(ForegroundAppWatcher가 포그라운드 패키지를
  // 못 알아봄) — 두 패키지명 다 등록.
  tiktok: { packageNames: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'], label: 'TikTok Video Loop', androidScheme: 'tiktok://', webFallback: 'https://www.tiktok.com/foryou' },
} as const;

export const SUPPORTED_APP_PACKAGES: readonly string[] = Object.values(SUPPORTED_APPS).flatMap((app) => [...app.packageNames]);
