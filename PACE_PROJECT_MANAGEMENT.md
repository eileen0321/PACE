# PACE 프로젝트 매니지먼트

> 이 문서는 Windows 세션(Android+공통/백엔드 담당)과 Mac 세션(iOS/macOS 담당)이
> 공유하는 **작업 지휘 문서**다. 두 세션은 서로 실시간으로 통신할 수 없고 git
> commit/push/pull만이 유일한 핸드오프 채널이므로, 이 문서가 그 역할을 한다.

## 0. 운영 규칙

1. **세션 시작 시**: 이 문서를 먼저 읽는다(`AGENTS.md`가 가리킴 → 매 세션 자동 로드).
   "5. 다음 지시"에서 자기 담당(Windows=Android/공통, Mac=iOS) 항목을 확인한다.
2. **작업 중 우선순위**: 사장님이 매번 지시하지 않아도, 각 세션이 이 문서의 문제점
   리스트를 보고 **스스로 우선순위를 판단해 다음 작업을 진행**한다. 코드로 해결
   불가능한 항목(계정/키/entitlement — "2-A" 섹션)만 사장님 결정을 기다린다.
3. **세션 종료 시(또는 큰 작업 완료 시)**: "6. 진행 로그"에 날짜+세션 구분으로
   한 일 / 새로 발견한 문제를 append하고, "2. 현재 문제점"과 "5. 다음 지시"를 갱신한다.
   과거 로그는 지우지 않고 쌓는다(요약이 필요하면 상단에 "현재 상태 요약"만 갱신).
4. 상세 조사 근거는 기존 `QA_*.md`, `MAC_SESSION_HANDOFF_*.md`, `PACE_FEATURE_SPEC_*.md`,
   `PACE_ARCHITECTURE.md`에 이미 있다 — 이 문서는 그것들의 **살아있는 요약+실행 큐**이지
   대체가 아니다. 항목 옆에 원본 문서를 링크해둔다.

---

## 1. 현재 상태 요약 (2026-07-26)

- 출시 전 단계. **2-A(D1~D5, D7, D10) 사장님 결정/계정 필요 항목이 2026-07-26에 전부 해결됨** —
  로그인 백엔드(D2, Railway 실배포+`/auth/guest` 실호출 확인), 결제(D1, RC 키), AdMob(D10, 실제
  ID), iOS 차단기능(D3, 기능 삭제), 심사 계정(D4, jlpt-master 계정 재사용), 지원 이메일(D5, 실주소
  교체), 구글 로그인(D7, OAuth 클라이언트 3종 발급). 남은 건 D6(제품 방향, 안 급함)·D8/D9(스펙
  미확정, 보류)·**D11(신규, 진행 중)**. **D11**: 실기기 검증 중 RevenueCat `ConfigurationError`가
  실제로 확인됨(Play Store에 구독 상품 미등록) — Play Console 결제 프로필까지는 완료했으나 입금
  계좌 은행 확인(영업일 2~5일 소요) 대기 중이라 구독 상품 생성이 막혀 있음, 확인되는 대로 이어서
  진행.
  Settings에 게스트용 로그인 진입점도 신규 추가(이전엔 paywall에서 막혀야만 우회로 로그인 화면에
  도달할 수 있었음). **AdMob 실제ID 관련 안전장치 2건 추가**: (1) 다른 세션이 `EXPO_PUBLIC_
  USE_REAL_ADS` 빌드 플래그로 평소엔 테스트ID/출시빌드만 실ID를 쓰게 분리(`5c76cce`), (2) 이
  세션은 그 위에 추가로 `adsConfig.ts`(개발기기를 AdMob 테스트기기로 등록해, 혹시 실ID가 걸린
  빌드를 테스트하더라도 그 기기에선 항상 테스트 광고만 받게 하는 이중 안전장치)를 더함 — 둘 다
  같이 있어도 충돌 없음.
- **Home/Focus/Stats/Settings 하단 콘텐츠가 광고 배너에 가려지던 버그 수정** — 화면들이 실제
  탭바 높이 대신 어긋난 고정 상수(`constants/theme.ts`의 `layout.tabBarContentClearance`)를
  참조하고 있었음. `(tabs)/_layout.tsx`가 계산하는 실제 탭바 높이를 `useAdBannerStore`로 공유해
  4개 화면이 전부 그 값을 쓰도록 통일, 이제 쓸모없어진 `layout.tabBarContentClearance` 상수는
  삭제.
- Android: 기능적으로 대체로 안정. 블루투스 핸즈프리 죽은 UI 정리(B1) 완료, BOOT_COMPLETED(B3)도
  "재부팅 시 활성 세션 복구" 범위로 완료. 단 B3 조사 중 더 근본적인 이슈 발견 — Daily Limit 추적이
  상시 백그라운드 감시가 아니라 전부 사용자가 명시적으로 시작한 세션에만 묶여 있음(제품 결정 필요,
  아래 2-B/6 참고).
- iOS: 2026-07-24 Mac 세션에서 Live Activity·취침감지 구현 완료(실기기 검증 대기).
  Screen Time 차단 기능은 2026-07-26 사장님 결정으로 전면 삭제됨(엔티틀먼트 미승인 + 죽은
  코드였음) — 더 이상 "차단 기능" 자체가 iOS 스코프에 없음, Pace Feed가 유일한 대체 출구.
- Home/온보딩/스플래시 UI 리디자인이 **로컬에 커밋 안 된 상태**로 존재 — 코드상 완결돼
  보이나 실기기 스모크 테스트 전. (아래 진행 로그 참고)

---

## 2. 🔴 현재 문제점 리스트

### 2-A. 사장님 결정/계정 필요 — 코드로 해결 불가, 최우선

| # | 문제 | 필요한 조치 | 근거 |
|---|---|---|---|
| D1 | ~~구독 결제 100% 비활성~~ | ✅ 완료(2026-07-26) — RC iOS/Android SDK 키 발급받아 `.env`에 입력 완료(`goog_jWJgxcRyNFIieGvcyigYvAXBJag`/`appl_XXEGQCLYicODnWDWOaAsEioAIgm`). Metro 재시작 후 실기기 재검증 필요 | MAC_SESSION_HANDOFF §4-4 |
| D2 | ~~백엔드(Railway) 미배포~~ | ✅ 완료(2026-07-26) — Railway CLI로 프로젝트 생성 + MySQL 플러그인 + 환경변수(JWT_SECRET/APPLE_BUNDLE_ID/CORS_ORIGINS/REVENUECAT_WEBHOOK_AUTH_HEADER/DB_*) 설정 + `railway up`으로 실배포. 공개 URL `https://pace-backend-production-2e52.up.railway.app` 발급, `.env`의 `EXPO_PUBLIC_API_BASE_URL`에 반영. `POST /auth/guest` 실제 호출로 JWT 발급 확인(HTTP 200, Flyway 마이그레이션 정상 적용). **미설정 채로 남은 것**: `GOOGLE_CLIENT_ID`(D7과 동일 사유로 비어있음, 구글 로그인만 아직 안 됨 — 게스트/애플은 정상), `REVENUECAT_API_KEY`(RC Secret API Key, 별도 발급 필요 — `/auth/refresh`의 RC reconcile에만 영향, 로그인 자체는 무관) | MAC_SESSION_HANDOFF §2 |
| D3 | ~~iOS Screen Time(Family Controls) entitlement 미승인~~ | ✅ 완료(2026-07-26) — 사장님 결정: (b) 기능 삭제. `screenTimeService.ios/android.ts`, `ScreenTimeService` 타입, `capabilities.supportsScreenTimeControl`/`supportsAppBlocking`, `modules/pace-screentime` 네이티브 모듈 전부 삭제(어차피 UI 어디서도 호출 안 하던 죽은 인프라였음). iOS의 차단 대체 출구는 Pace Feed로 계속 유지. `npx tsc --noEmit` 통과 | QA_FULL_REVIEW B1 |
| D4 | ~~심사 리뷰어 화이트리스트 빈 배열~~ | ✅ 완료(2026-07-26) — 사장님 결정: jlpt-master(`src/config/reviewers.ts`)가 이미 구글 플레이 콘솔에 제출해둔 실제 테스트 계정(`s7.reviewer@gmail.com`)을 그대로 재사용. `src/constants/reviewers.ts`에 반영 | QA_FULL_REVIEW B4 |
| D5 | ~~지원 이메일이 placeholder~~ | ✅ 완료(2026-07-26) — `settings.tsx`의 `SUPPORT_EMAIL`을 실제 수신 이메일 `comfortstride7@gmail.com`으로 교체 | QA_FULL_REVIEW B5 |
| D6 | (B3 조사 중 신규 발견) Daily Limit 추적이 상시 백그라운드 감시가 아니라 전부 사용자가 명시적으로 "YouTube with PACE"를 눌러 세션을 시작한 경우에만 동작함 — 유저가 그냥 일반 YouTube 앱을 직접 열어서 보면 Pace는 그 시청을 아예 감지 못함(재부팅 여부와 무관, 앱의 기존 설계) | 제품 결정 필요: (a) 현재 "opt-in 세션" 모델 유지(문서화·마케팅에 명시) vs (b) Android UsageStatsManager 등으로 상시 감시 추가(배터리/권한/Play정책 트레이드오프 있음) | B3 로그, §6 참고 |
| D7 | ~~Google 소셜 로그인 OAuth 클라이언트 미발급~~ | ✅ 완료(2026-07-26) — Google Cloud Console "Pace-Server" 프로젝트(`pace-server-502818`, jlpt-master와 별개, 이미 YouTube Data API용으로 존재하던 프로젝트)에 Pace 전용 OAuth 클라이언트 3종 신규 발급: Android(패키지 `com.strides7.pace` + 로컬 debug 키스토어 SHA-1, **release SHA-1은 아직 미등록 — 출시 빌드 전 Play Console에서 받아 추가 필요**), Web(`...2ihg3c4bj03vj59smd48m8ef007kcrei...`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` + 백엔드 `GOOGLE_CLIENT_ID`로 사용 — ID 토큰 audience 검증용), iOS(`...fq9o0uudug7bh60ut88pr6atc97nkdqc...`, 번들ID `com.strides7.pace` + 팀ID `328BF833XS`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` + `app.json`의 `iosUrlScheme`로 사용). `.env`(로컬, gitignore)와 Railway `GOOGLE_CLIENT_ID`에 반영, 백엔드 재배포 후 `/auth/guest` 정상 재확인. **iOS `iosUrlScheme`는 네이티브 설정(Info.plist)이라 다음 iOS prebuild/빌드부터 실제 반영됨 — 아직 실기기 검증 안 함.** | 2026-07-26 로그 참고 |
| D8 | (2026-07-26 신규, 사장님 요청이었으나 스펙 미확정이라 보류) "고급 취침모드(Advanced Sleep Mode)"를 프리미엄 전용 기능으로 추가해달라는 요청 — 뭘 "고급"으로 만들지 구체 스펙이 아직 없음(현재 수면감지는 10분 무진동 고정 임계값 하나뿐, 사용자 설정 UI 자체가 없음) | 제품 결정 필요 — 임시 제안(확정 아님): 프리미엄 한정으로 무진동 임계값을 5~20분 사이 직접 조절 + 블루투스 탈착 보조신호 사용 여부 토글 정도가 "코드로 바로 만들 수 있는" 최소 범위. 사장님이 원하는 그림이 이거랑 다르면 다시 정의 필요 | 2026-07-26 로그 참고 |
| D9 | (2026-07-26 신규, 사장님 요청이었으나 기존 동작 회귀 위험 있어 보류) "리모컨 지원"을 프리미엄 전용으로 가둬달라는 요청 — 그런데 핑거스냅/손짓/블루투스 볼륨키 Auto Mode는 **이미 전체 사용자에게 배포돼 실제로 쓰이고 있는 기존 기능**(오늘 밤에도 이걸로 여러 버그를 고침). 지금 프리미엄 뒤로 가두면 기존 사용자 입장에선 "되던 기능이 갑자기 막힘"으로 보일 회귀임 | 제품 결정 필요: (a) 신규 사용자만 프리미엄 게이팅하고 기존 사용자는 유지(grandfather) vs (b) 전체 게이팅하되 출시 공지로 미리 안내 vs (c) 이번엔 게이팅 보류(현 상태 유지) — 방향 정해지면 코드 자체는 간단함(`useSubscriptionStore.isPremium` 체크 하나 추가) | 2026-07-26 로그 참고 |
| D10 | ~~AdMob 테스트 광고 단위 ID~~ | ✅ 완료(2026-07-26) — AdMob 앱 심사 승인됨, Android/iOS 앱 등록 + 배너(양쪽)·보상형(Android) 광고 단위 실제 발급받아 `app.json`(androidAppId/iosAppId), `AdBanner.tsx`, `rewardedAd.ts`에 실제 ID로 교체 완료. `npx tsc --noEmit` 통과. 새 광고 단위는 활성화까지 최대 1시간 걸릴 수 있음 — 실기기에서 광고 실제로 뜨는지 확인 필요 | 2026-07-26 로그 참고 |
| D11 | (2026-07-26 실기기 검증 중 발견) RevenueCat `PurchasesError(code=ConfigurationError)` 실제 발생 — Play Store에 구독 상품이 하나도 등록 안 돼 있음. SDK 키(D1)만으론 결제 불가, 스토어 쪽 상품+RC Offering 연결까지 필요 | 🟡 진행 중 — Google Play Console 정기결제 메뉴가 "Google Payments 판매자 계정 설정 필요"로 막혀 있어 결제 프로필(사업자정보/카테고리/지원이메일 `comfortstride7@gmail.com`/카드명세서명 "PACE")까지 완료, **입금 계좌 등록 후 은행 소액 입금 확인 대기 중**(구글 측, 보통 영업일 2~5일, 코드/설정으로 단축 불가). 확인되는 대로 Play Console 구독 상품 생성 → RevenueCat Offering/Package 연결 이어서 진행. iOS(App Store Connect) 쪽 구독 상품도 별도로 아직 미착수 | 2026-07-26 로그 참고 |

### 2-B. Android 담당(Windows 세션) — 코드로 해결 가능

| # | 문제 | 상태 |
|---|---|---|
| B1 | 블루투스 핸즈프리 — Android OS 레벨에서 실제 유튜브 조작 불가능 **확정**(4가지 우회 전부 실패, 2026-07-19·23 재확인)인데 온보딩/설정/홈/통계 8개 파일에 여전히 광고 중. 유일한 진입점(인앱 Next/Prev 버튼)은 이미 삭제돼 **지금 앱 어디서도 실제로 도달 불가능** | ✅ 완료 (아래 로그, iOS 무변경) |
| B2 | ~~Pace Feed(유튜브 임베드 래핑) Play 정책 위반 가능성~~ | ✅ 실제로는 문제 아님 — 재확인 결과 `focus.tsx:137`에서 `capabilities.supportsPaceFeed`(iOS 전용)로 섹션 전체가 게이팅돼 있어(QA #19, 2026-07-19 수정) Pace Feed는 Android에 애초에 노출된 적이 없음. Mac 핸드오프의 "정책 미해결" 서술은 iOS 관점 서술이었던 것으로 보임 — Android 항목에서 제거 |
| B3 | `BOOT_COMPLETED` 미구현 — 재부팅 후 앱을 직접 안 열면 그날 사용량 감지 자체가 안 됨 | ⚠️ 부분 완료 — 재부팅 시점에 **이미 활성 중이던 세션**의 복구는 구현·완료(아래 §6 로그). 단, 조사 결과 원래 문제 정의 자체가 부정확했음이 드러남: "그날 세션을 한 번도 안 열면 감지가 안 됨"은 재부팅과 무관한 **기존 설계**(Daily Limit 추적이 전부 `overlayService.startSession()`에 묶여 있고 상시 백그라운드 사용량 감시가 애초에 없음) — 이건 BOOT_COMPLETED로 못 고침, 제품 결정 필요(**needs design decision**, 상세 아래 §6) |

### 2-C. iOS/Mac 담당(Mac 세션)

| # | 문제 | 상태 |
|---|---|---|
| C1 | iOS Sleep Timer 네이티브(`react-native-track-player`) 미구현 — 매 실행 Metro 경고, 호출 시 실패 | 열림 |
| C2 | Sign in with Apple이 공식 버튼이 아닌 커스텀 텍스트 버튼 — HIG 4.8 리뷰 리스크 | 열림, 수정 여부 미확인 |
| C3 | Live Activity/다이나믹아일랜드 + 취침감지 블랙아웃 — **실기기 검증 안 됨**(시뮬레이터만 확인) | 진행 중 — 기기 필요 |
| C4 | 위젯 익스텐션(`targets/widget`) 첫 서명 빌드 미검증 | 진행 중 |
| C5 | (B1 조사 중 신규 발견) 전역 `useBluetoothStore`/`bluetoothService.ios.ts` 경로(Home/Settings/Stats의 "Bluetooth Hands-Free")가 iOS에서도 100% no-op 스텁 — "Enable"을 눌러도 토스트만 뜨고 실제로 아무것도 안 켜짐. Pace Feed 안의 별개 볼륨키 리모컨(`useFeedRemoteControl.ios.ts`, 07-22 수정으로 실동작 확인됨)과는 다른 죽은 경로 | 열림 — 신규, 정직성 이슈(가짜로 "동작하는 척" UI) |
| C6 | (2026-07-26 신규) 사장님 전달 — **애플이 마이크 기반 핑거스냅 감지를 심사에서 허용하지 않음**을 통보받음 | ✅ 가이드/문구는 처리됨(Windows 세션) — `capabilities.supportsFingerSnap`(`Platform.OS === 'android'`)을 추가해 `BluetoothOnboardingSheet.tsx`의 "Finger snap" 행과 안내 문구를 iOS에서만 숨김. 어차피 iOS는 C5(no-op 스텁)+Pace Feed(`useFeedRemoteControl.ios.ts`가 `'wave'`만 start, snap 리스너는 등록만 하고 미가동)라 **실제 동작 변화는 없음**, 순수 안내 문구 정직성 수정. Android(`PaceSnapDetector`)는 실기기 검증된 정상 기능이라 구현/문구 그대로 유지 — **삭제 아님, 숨김뿐**. iOS 네이티브(`modules/pace-gesture`)에 혹시 남아있는 `'snap'` 모드 자체를 완전히 뽑아낼지는 Mac 세션 판단 필요(지금은 애초에 start 안 하므로 급하지 않음) | 2026-07-26 로그 참고 |

### 2-D. 공통

| # | 문제 | 상태 |
|---|---|---|
| E1 | RevenueCat 웹훅 로직 구현·단위테스트(8/8) 통과했지만 실배포 엔드포인트로 라이브 웹훅 호출 테스트는 한 번도 안 해봄 | 열림 (백엔드 배포 이후 순서) |

---

## 3. Android 할 일 리스트 (우선순위순, Windows 세션)

1. [x] **B1** 블루투스 핸즈프리 UI 정리 — 완료(아래 §6 로그). focus.tsx/SessionHeroCard/ToastHost는
   조사 결과 이미 참조 없음(과거 정리에서 삭제됨, 코멘트만 남음) — 실제 수정은 capabilities.ts,
   home.tsx, BluetoothOnboardingSheet.tsx, AccessibilityOnboardingSheet.tsx, settings.tsx,
   translations.ts 6개 파일.
2. [x] ~~B2~~ 재확인 결과 이미 해결됨(non-issue) — 위 §2-B 참고
3. [x] **B3** BOOT_COMPLETED 구현 — "재부팅 시점에 활성 중이던 세션 복구" 범위로 완료(아래 §6 로그). "그날
   세션을 한 번도 안 열면 감지 자체가 안 됨"이라는 더 넓은 문제는 재부팅과 무관한 기존 설계라 별도
   제품 결정 필요 — needs design decision, §2-B B3 참고
4. [ ] Home/온보딩/스플래시 UI 리디자인 WIP 스모크 테스트 후 커밋 (현재 unstaged) — 실기기 시도했으나
   dev-client 연결 문제로 미완(아래 §6), 재시도 필요

## 4. iOS/Mac 할 일 리스트 (우선순위순, Mac 세션)

1. [ ] **C3** Live Activity/다이나믹아일랜드 실기기 검증
2. [ ] **C3** 취침감지 블랙아웃 실기기 검증
3. [ ] **C4** 위젯 익스텐션 서명 첫 빌드 검증
4. [ ] **C1** iOS Sleep Timer 네이티브 구현
5. [ ] **C2** Sign in with Apple 공식 버튼 교체
6. [ ] RevenueCat 결제 실기기 검증 (D1 키 세팅 이후)

---

## 5. 📋 다음 지시 (세션별 — 이 섹션을 매번 갱신)

**Windows 세션(다음 작업)** → 2026-07-26 밤 세션에서 Focus Session/연속 시청 통합 + 실기기 라이브
검증 + 수면감지 정확도 개선까지 완료(아래 §6 "2026-07-26 — Windows 세션 (Focus Session 라이브
실기기 검증 완료 + 수면감지 정확도 개선)" 로그 필독). **자동넘김 30편 한도 시스템은 완전히
제거됨**. 다음 세션 우선순위:
1. **수면감지 시간대 게이트(22시~9시) + 정확한 시각 기록 로직의 실제 밤 시간대 재현 테스트** —
   코드 검토로 로직은 확인했지만, 실제로 밤에 폰을 무진동 상태로 10분 두고 (a) 그 창 밖(낮)에서는
   정말 트리거 안 되는지, (b) 트리거될 때 기록되는 시각이 "임계값 넘긴 시각"이 아니라 "마지막
   움직인 시각"과 정확히 일치하는지 실기기로 확인 필요(낮 시간이라 이번 세션엔 못 함).
2. Health Connect(Android)/HealthKit(iOS) 연동으로 워치 수면 데이터를 보조 신호로 추가하는 건
   — 사장님이 제안했으나 새 권한 플로우+의존성 필요한 별도 작업이라 보류 중, 착수 여부 확인 필요.
3. D7/D8/D9(사장님 결정 대기) 중 하나라도 정리되면 그에 맞춰 마저 구현.
4. Home/온보딩/스플래시 WIP 스모크 테스트(이전부터 밀려있던 항목, 아직 미완).

**Mac 세션(다음 작업)** → 기기 연결되면 C3(실기기 검증) 최우선. 기기 없으면 C1(Sleep Timer
네이티브) 먼저 진행. **신규로 C5(전역 Bluetooth Hands-Free가 iOS에서도 가짜 UI) 발견됨 — 위
2-C 참고, 우선순위 판단해서 큐에 반영할 것.**

**사장님 결정 대기 중** → D1/D2/D3/D4/D5/D10 전부 2026-07-26 해결됨. 남은 건 D6~D9뿐:
D7(Google OAuth 클라이언트 발급 — 이제 백엔드도 살아있어서 이것만 받으면 구글 로그인이
완전히 동작함, 가장 임팩트 큼) → D9(리모컨 프리미엄 게이팅 방식, 기존 사용자 회귀 위험) →
D8(고급 취침모드 스펙) → D6(제품 방향, 급하지 않음). 추가로: App Store Connect/Play Console
구독 상품 실제 등록 여부(위 1번 요약 참고) 확인 필요.

---

## 6. 📝 진행 로그 (날짜/세션 역순 아님 — 아래로 계속 append)

### 2026-07-25 — Windows 세션
- 관리 문서(`PACE_PROJECT_MANAGEMENT.md`) 신설. 기존 `QA_*.md` 5종 + `MAC_SESSION_HANDOFF_
  2026-07-24.md` + `APP_REVIEW_NOTES.md`를 취합·검증해 현재 문제점/할일 리스트 정리. `QA_ISSUES_
  2026-07-18.md`의 상당수 항목(tickMinute, confirmReset 등)은 이후 커밋(a1c9176 등)에서 이미
  수정 확인됨 — 이 문서에는 **아직 살아있는 문제만** 반영함.
- `AGENTS.md`에 이 문서 포인터 추가 — 매 세션이 시작 시 자동으로 인지하도록.
- Unstaged WIP 확인(커밋 안 함, 검증 전): Home 히어로카드에 "쉬는시간(Flip Mode)" 표시 추가,
  온보딩 미니멀 재디자인(그래픽 제거), 스플래시 지속시간 2.4s→0.6s 단축, quick-control-sheet를
  RN `<Modal>`에서 expo-router 화면으로 이전(Android edge-to-edge 내비바 투명도 버그 회피,
  expo/expo#39749).
- B1(블루투스 핸즈프리 UI 정리) 착수.

### 2026-07-25 — Windows 세션 (WIP 스모크 테스트 시도 — 미완)

연결된 실기기(Galaxy, `adb devices`로 확인됨, 이미 dev-client APK 설치돼 있음 `com.strides7.pace`)에서
Home/온보딩/스플래시 WIP를 눈으로 확인하려고 시도함. Metro를 기본 8081 대신 8082로 띄움(8081은
이 머신의 다른 프로젝트 `zen-master`가 이미 점유 중 — 그쪽은 안 건드림). `expo start --android`가
처음엔 Expo Go를 새로 받으려 해서(커스텀 네이티브 모듈이 있는 프로젝트라 Expo Go로는 못 돌아감)
중단하고 `--dev-client`로 재시도, `adb shell am start -a VIEW -d "pace://expo-development-client/?url=..."`
로 직접 딥링크 실행까지는 됐음(앱 프로세스 뜨고 MainActivity 포그라운드 확인) — **그런데 JS 번들이
전혀 로드되지 않음**: 네이티브 스플래시 화면(정적 아이콘)에서 멈춘 채 `logcat`에 React Native/Expo
관련 로그가 단 한 줄도 안 찍힘(Metro 서버 자체는 `curl .../status`로 정상 응답 확인, adb reverse도
정상 — 네트워크 문제는 아닌 것으로 보임). 원인 미상— dev-client의 저장된 서버 URL 캐시나 첫 연결
핸드셰이크 쪽 문제로 추정되나 이 세션에서 더 파고들 시간 대비 가치가 낮다고 판단해 중단함(Metro
프로세스 정리하고 종료).

**결론**: 이 WIP 4건(스플래시 속도, 온보딩 재디자인, 히어로카드 Rest Time, quick-control-sheet 라우트
이전)은 **`tsc --noEmit` 통과 확인 + 코드 리뷰로는 이상 없음**이나, **실기기 육안 검증은 아직 못 함**.
다음 세션이나 사장님이 기기에서 직접 앱 열어서(Metro `npx expo start --dev-client` 켠 뒤 앱 내
개발자 메뉴에서 "Fetch development servers" 또는 QR 스캔으로 수동 연결) 확인하는 걸 권장 — 자동
스모크 테스트는 재시도 필요.

### 2026-07-25 — Windows 세션 (B1 완료)

**조사 결과, 원래 문제 정의를 정정함** — B1을 "죽은 기능 전체 삭제"로 시작했으나 코드를 실제로
따라가 보니 `useBluetoothStore`/`bluetoothService`가 묶고 있는 건 **서로 다른 두 기능**이었음:
1. **Bluetooth 헤드셋 하드웨어 버튼으로 YouTube를 직접 조작** — 이게 원래 약속이었고, Android OS
   레벨에서 100% 불가능 확정(`QA_ANDROID_LIFECYCLE_2026-07-22.md` #B22, 미디어 버튼은 항상 실제
   재생 중인 앱(YouTube)으로만 라우팅됨), 대체 진입점(인앱 Next/Prev)도 이미 삭제됨(#B26) — **이
   부분만 확실히 죽음.**
2. **Auto Mode(Focus Session)** — 핑거스냅(`PaceSnapDetector`)·손 밀어내기(`PaceHandWaveDetector`)·
   재생위치 자동감시로 구성된, **완전히 별개의 진짜 동작하는 Android 전용 기능**
   (`PaceOverlayService.setAutoMode`, `PACE_ARCHITECTURE.md` "Focus Session 리디자인"·"핑거스냅
   Hands-Free Next" 절 참고). `useBluetoothStore.toggleAutoMode`/`enableAutoModeForSession`이 이걸
   켜는 진짜 코드 경로이고, 바로 오늘 세션(`35a0b61`)에서도 관련 버그를 고쳤을 만큼 현재 활발히
   관리 중인 기능 — **1번과 이름만 같이 쓰고 있을 뿐 실제로 살아있음, 지우면 안 됨.**

그래서 "8개 파일 전부 삭제"가 아니라 **1번(하드웨어 버튼 약속)만 Android에서 제거하고, 2번(Auto
Mode)의 유일한 진입점(BluetoothOnboardingSheet의 Enable 버튼)은 그대로 남기되 문구만 정직하게
고치는** 쪽으로 범위를 좁혀 진행함. 실제 변경 파일:

- `src/services/platform/capabilities.ts` — `supportsHandsFreeControl`을 `true` 고정값에서
  `Platform.OS !== 'android'`로 변경(하드웨어 버튼 약속을 지키는 UI만 게이팅하는 플래그로 의미
  좁힘, 주석에 Auto Mode는 별개라고 명시). iOS는 그대로 `true` — 동작 무변경.
- `src/app/(tabs)/home.tsx` — YouTube with PACE 카드의 "🎧 Hands-Free Ready" 상태 문구와
  `features=['🎧 Hands-Free', ...]` 칩을 `capabilities.supportsHandsFreeControl`로 게이팅(Android는
  항상 숨김). `BluetoothOnboardingSheet`는 그대로 유지(Auto Mode 진입점이라 안 지움).
- `src/components/home/BluetoothOnboardingSheet.tsx` — `Platform.OS === 'android'`일 때만 본문/3개
  액션 행을 "Bluetooth 헤드셋 Next/Previous/Play-Pause" 대신 "핑거스냅/손 밀어내기/Auto Mode"로
  교체(실제로 Enable을 누르면 벌어지는 일과 일치시킴). iOS 분기는 원문 그대로 100% 무변경.
- `src/components/onboarding/AccessibilityOnboardingSheet.tsx` — (이 시트는 이미 Android 전용,
  settings.tsx의 `Platform.OS==='android'` 블록에서만 뜸) benefit 3줄 중 "Bluetooth/AirPods
  Control" 줄 삭제 — 접근성 권한을 켜도 그 혜택은 생기지 않으므로. 나머지 두 줄(Focus
  Session/Hands-Free Mode)은 실제로 이 권한이 필요한 기능이라 유지.
- `src/app/(tabs)/settings.tsx` — Help Center FAQ의 `faqQ3`/`faqA3`("Bluetooth 이어폰 리모컨 버튼으로
  Shorts 넘기기")를 `capabilities.supportsHandsFreeControl` 기준으로 필터링해 Android 목록에서만
  제외(iOS는 그대로 5개 유지). "Playback Controls" 섹션(READY/BETA 배지, Connected Device,
  Play/Pause Action)은 이미 `capabilities.supportsHandsFreeControl`로 게이팅돼 있었으므로 위
  capabilities.ts 수정만으로 Android에서 자동으로 숨겨짐(이 파일 자체는 그 섹션 코드를 안 건드림).
- `src/app/(tabs)/stats.tsx` — "Bluetooth Controls" 섹션도 이미 같은 플래그로 게이팅돼 있어서
  코드 변경 없이 capabilities.ts 수정만으로 Android에서 자동으로 숨겨짐.
- `src/services/i18n/translations.ts` — 고아가 된 `a11ySheetBenefitBluetooth` 키 삭제(en+ko, 다른
  참조 없음 확인). `faqQ3`/`faqA3`/`bluetoothControls`/`next`/`previous`/`autoModeToggles`/
  `playbackControls`/`handsFreeControl`/`connectedDevice`/`playPauseAction`/`toggleAutoMode` 등은
  iOS 렌더 경로에서 여전히 쓰이므로(런타임 조건부 렌더만 바뀜, 코드 참조 자체는 유지) 그대로 둠 —
  고아 아님.

**조사했지만 손 안 댐**: `focus.tsx`, `SessionHeroCard.tsx`, `ToastHost.tsx` — 셋 다 grep해보니 이미
Bluetooth 관련 참조가 0건(과거 세션에서 이미 정리됐고, 코드 주석에 "삭제함"이라고만 기록돼 있었음).
`app/feed/index.tsx`(Pace Feed 자체 볼륨키 리모컨, iOS 전용 실동작)는 그대로 확인만 하고 안 건드림 —
이번 B1과 무관한 별개 기능.

**검증**: `npx tsc --noEmit` 통과(에러 0건). 실기기 실행은 안 함(WIP 안드로이드 빌드 상태 확인 필요,
다음 세션에서 B2/B3 작업과 함께 실기기 스모크 테스트 권장).

**Mac 세션에 전달할 사항**: iOS 쪽은 코드 한 줄도 안 건드렸지만, 조사 중 발견한 게 하나 있음 —
`useBluetoothStore`/`bluetoothService.ios.ts` 경로(Home/Settings/Stats의 전역 "Bluetooth Hands-Free")는
iOS에서 100% no-op 스텁이라 이 온보딩 시트의 "Enable"을 눌러도 실제로는 아무 것도 안 켜짐(토스트만
뜸) — Pace Feed 안의 별개 볼륨키 리모컨(`useFeedRemoteControl.ios.ts`, 07-22 수정으로 실동작 확인된
바로 그 기능)과는 다른 경로임. 이번 B1은 Android 스코프라 iOS의 이 정직성 문제는 그대로 남겨뒀음 —
필요하면 별도 이슈로 다뤄주길.

### 2026-07-25 — Windows 세션 (B3 — BOOT_COMPLETED, 범위 재정의 후 부분 완료)

**착수 전 조사(지시대로 순서 준수)**: `QA_ANDROID_LIFECYCLE_2026-07-22.md` 전문 + `PACE_ARCHITECTURE.md`의
Android 라이프사이클/네이티브 서비스 관련 절 + `modules/pace-overlay/android` 전체 코드를 먼저 읽음.

**핵심 발견 — 이 앱의 "사용량 추적"이 실제로 뭘로 이뤄지는지**:
1. Daily Limit 카운트다운은 `PaceOverlayService`(포그라운드 서비스) 안에서 60초마다
   `remainingMinutes -= 1`(순수 벽시계 타이머, 실제 포그라운드 앱 사용시간 측정이 아님)로 진행되고,
   `AlarmManager.setAndAllowWhileIdle()`(`PaceTickReceiver` 경유)로 예약된다.
2. **이 서비스는 사용자가 홈 화면에서 "YouTube with PACE" 등을 탭해 `overlayService.startSession()`을
   호출해야만 시작된다** — `PaceAccessibilityService`(접근성)는 Auto Next 스와이프/볼륨키 감지 전용이고,
   `ForegroundAppWatcher`(UsageStatsManager)는 이미 활성 세션이 있을 때 알약을 보이거나 숨기는 보조
   신호일 뿐, 그 자체로 세션을 만들거나 사용량을 독립 집계하지 않는다. 상시 도는 백그라운드 사용량
   감시 루프는 코드 전체에 **존재하지 않음**.
3. `statsRepository.getTodayUsageMinutes()`도 `viewing_sessions` 테이블(=Pace가 명시적으로 시작한
   세션의 기록)만 `SUM`한다 — UsageStatsManager로 유튜브 전체 사용시간을 독립적으로 집계하는 경로가
   아니다.
4. 즉 **"그날 세션을 한 번도 시작 안 했으면 유튜브를 아무리 써도 감지·집행이 전혀 안 된다"는 현상은
   재부팅과 무관하게 원래부터 참**이다 — 재부팅이 유발한 회귀가 아니라 "세션은 사용자가 명시적으로
   켜야 한다"는 이 앱의 기존 설계 자체. `QA_ANDROID_LIFECYCLE_2026-07-22.md`의 재부팅 테스트 관찰은
   실제로는 "재부팅 전에 이미 활성 세션이 있었는데, 재부팅으로 그 진행 중이던 세션의 알람/포그라운드
   서비스가 통째로 날아갔다"는 훨씬 좁은 현상이었던 것으로 재해석됨(재부팅은 시스템에 등록된 모든
   `AlarmManager` 알람을 취소하고 포그라운드 서비스 프로세스도 당연히 죽인다 — `PaceOverlayService`가
   프로세스 킬에는 `START_STICKY`+영속 상태로 견고하지만, 재부팅으로 인한 알람 자체 소멸까지는
   원래 설계가 커버하지 않았음).

**구현(위 4번 재해석에 따라 범위를 명확히 좁힘 — "이미 활성 중이던 세션의 복구"만)**:
- `modules/pace-overlay/android/src/main/java/expo/modules/paceoverlay/PaceBootReceiver.kt` (신규) —
  `BOOT_COMPLETED` 수신 시, `Settings.canDrawOverlays()`로 오버레이 권한이 아직 살아있는지 먼저 확인
  (권한 없으면 아무 것도 안 하고 조용히 리턴 — 지시대로 "권한 없이 뭔가 켜려다 조용히 실패/크래시"를
  피함). 권한이 있으면 `PaceTickReceiver.kt`와 동일한 `PARTIAL_WAKE_LOCK`(10초 상한) 패턴으로
  `PaceOverlayService`를 **action 없이(null)** `startService()` — 이건 `PaceOverlayService.kt`의
  `onStartCommand`에 원래 있던 "프로세스가 SIGKILL로 죽은 뒤 시스템이 `START_STICKY`로 즉시 재시작한
  경우" 복구 분기(`restoreIfNeeded()` → `SharedPreferences`에서 상태 복원 + `ensureInfraReady()` →
  `scheduleNextTick()`, `performTick()`은 안 부름=재부팅 자체로 시간이 깎이지 않음)를 그대로 재사용한
  것 — **새 로직을 새로 만들지 않고 기존 복구 경로에 새 진입점만 하나 추가**(지시사항 "재발명하지
  말고 기존 메커니즘에 연결" 준수). 세션이 원래 비활성이었으면(`PREF_SESSION_ACTIVE==false`)
  `restoreIfNeeded()`가 `false`를 반환해 서비스가 즉시 `stopSelf()`하므로 부작용 없음.
- `modules/pace-overlay/android/src/main/AndroidManifest.xml` — `RECEIVE_BOOT_COMPLETED` 권한 +
  `PaceBootReceiver`를 `BOOT_COMPLETED` 인텐트 필터로 등록(`exported="true"` 필수 — 시스템 브로드캐스트
  수신 요건, protected broadcast라 임의 3rd-party 앱이 스푸핑 불가). 이 프로젝트는 Expo prebuild(CNG)
  관리 방식이라 `android/`가 `.gitignore`돼 있지만, 확인 결과 로컬 모듈(`modules/pace-*`)의 매니페스트는
  기존 파일 상단 주석("Gradle 매니페스트 병합으로 자동 합쳐짐, 별도 config plugin 불필요")대로 Expo
  Modules API 로컬 모듈 컨벤션에 따라 빌드 시 자동 병합되므로 **별도 config plugin을 새로 안 만듦** —
  `pace-flip` 등 기존 네이티브 모듈과 동일한 패턴 그대로 따름.

**범위에서 의도적으로 뺀 것(과잉 구현 금지 지시 준수)**:
- 접근성 서비스(`PaceAccessibilityService`) 재활성화 — 앱이 스스로 접근성 권한을 켤 수 없음은 Android
  OS 자체의 보안 장치(`PaceOverlayModule.kt`의 기존 주석에도 이미 명시)라 애초에 프로그램적으로 불가능.
  게다가 Daily Limit 집행의 주 신호는 접근성이 아니라 `UsageStatsManager`(`ForegroundAppWatcher`)라
  Auto Next/핑거스냅/손 밀어내기 같은 "추가 기능"만 접근성에 의존 — 이건 원래 스코프(B3=Daily Limit
  감지 재부팅 복구) 밖.
- "상시 백그라운드 사용량 감시"를 새로 만드는 것 — 이건 위 3번 재해석대로 별개의 신규 기능(사실상
  전통적 "스크린타임" 앱에 가까운 상시 포그라운드 서비스가 필요, 배터리/Doze 예외, Play 정책상
  "자율적 판단·실행 자동화" 관련 재검토 등 훨씬 큰 설계 변경) — 지시사항의 "더 위험하거나 아키텍처적
  으로 침습적이면 임의로 밀어붙이지 말고 사장님 결정 대기로 남기라"는 조건에 정확히 해당한다고 판단해
  **구현하지 않고 여기 기록만 남김**. 다음 결정이 필요하면: (a) 지금처럼 "세션은 사용자가 명시적으로
  시작" 모델을 유지(현재 상태 그대로 두는 것도 유효한 선택 — Play 정책 리스크가 낮고 배터리 부담도
  적음) vs (b) `UsageStatsManager` 폴링을 상시 포그라운드 서비스로 승격해 세션 시작 여부와 무관하게
  Daily Limit을 집행(더 "제품 약속"에 가깝지만 구현·정책 리스크 모두 커짐).

**검증**:
- `PaceBootReceiver.kt`는 코틀린 문법·API 사용을 `PaceTickReceiver.kt`(같은 디렉터리, 이미 실기기
  검증된 자매 리시버)와 나란히 대조해 눈으로 검증 — `BroadcastReceiver`/`PowerManager`/`Settings`/
  `Intent` 등 표준 Android API만 사용, 새 의존성 없음.
- `./gradlew.bat :pace-overlay:compileDebugKotlin` 실제 실행 시도(Bash·PowerShell 둘 다) — **둘 다
  같은 에러로 실패**: `Configure project :app` 단계에서 `com.facebook.react.rootproject` 플러그인
  적용 중 `java.io.IOException: 파일 이름, 디렉터리 이름 또는 볼륨 레이블 구문이 잘못되었습니다`.
  이 에러는 `pace-overlay` 모듈 컴파일에 도달하기 전, **루트 프로젝트 설정 단계**에서 나는 것이라
  이번에 건드린 파일(모듈 매니페스트, 신규 Kotlin 파일)과 무관 — 이 샌드박스 환경 자체의 Gradle/경로
  처리 문제로 판단(다른 이유로 조사 안 함, 이번 작업 범위 밖). **결론: 이 환경에서는 실제 Gradle
  빌드 검증이 불가능했음 — 다음 세션 또는 실기기 빌드 환경에서 `npx expo run:android`(또는
  `./gradlew assembleDebug`)로 반드시 재확인 필요**, 지시대로 "검증 안 된 코드를 검증됐다고 주장하지
  않음".
- TS/JS는 이번 작업에서 전혀 건드리지 않음 — `npx tsc --noEmit` 실행 불필요(스킵).

**실기기 검증 필요(다음 세션 또는 사장님 직접 확인)**:
1. 세션 활성 중 `adb reboot` → 부팅 완료 후 Pace를 열지 않고 유튜브 직접 열기 → 오버레이 알약이
   자동으로 뜨는지, `remainingMinutes`가 재부팅 전 값에서 정상 이어지는지.
2. `adb shell dumpsys alarm | grep -i pace`로 재부팅 후 다음 틱 알람이 실제로 재등록됐는지 확인.
3. `adb logcat -s PaceBootReceiver:* PaceOverlay:*`로 `BOOT_COMPLETED` 수신·복구 로그 확인.
4. 오버레이 권한을 재부팅 전에 미리 꺼둔 상태에서 같은 테스트 — 크래시 없이 조용히 스킵되는지.
5. (알려진 한계, 이번엔 손 안 댐) 세션이 활성인 채로 기기가 며칠씩 꺼져 있다가 재부팅되는 극단적
   케이스 — `restoreStateFromPrefs()`가 날짜 검사 없이 그대로 복원하므로 오래된 `remainingMinutes`가
   그대로 이어질 수 있음. 이건 재부팅 이전부터 있던 프로세스사망 복구 경로의 기존 동작(이번에
   새로 만든 코드가 원인이 아님)이라 손 안 댔고, 별도 이슈로 남겨둠.

### 2026-07-26 (새벽) — Windows 세션

밤새 실기기(Note20)로 직접 검증하며 진행한 큰 세션. 사장님이 잠들기 전 마지막 지시까지 반영해
아래 항목 전부 코드 완성 + 빌드·설치까지 완료(단, 보상형 광고 실사용 흐름은 실기기 육안 검증 필요 —
위 "다음 지시" 참고). 커밋 `6a0ccc9`/`7abbf2e`(rebase 후) + 이후 커밋에 나뉘어 들어감.

**1. 사용시간 정확도 — "실제 재생 중일 때만 차감"**
`PaceOverlayService.performTick()`이 예전엔 세션이 활성인 동안 실제 재생 여부와 무관하게 매분
무조건 시간을 깎았음(일시정지/백그라운드도 "사용"으로 카운트). `PaceAccessibilityService`의 재생
위치 폴링을 Focus Session(자동넘김) 켜짐 여부와 분리해 세션이 살아있는 동안 항상 돌게 하고
(`isTrackingPlayback`), `isLikelyPlaying()` 신호로 실제 재생 중일 때만 차감하도록 수정. 실기기
로그로 확인함: 일시정지 상태에서 여러 틱이 지나도 시간이 안 깎이는 것 확인됨.

**2. "몇 편 봤는지" 카운트 — 실제 DB에 정직한 값 기록**
예전엔 개발용 시뮬레이터의 `videoIndex`를 그대로 `videos_watched`에 저장하던 버그를 고쳐서 항상
0을 기록하고 있었음(실측 불가능이라 정직하게 0). 재생 위치의 "끝남/되감김" 감지(자동넘김이든
사용자가 직접 스와이프했든 둘 다 잡힘)를 카운터로 승격해 실제 값을 `endSessionRow()`에 기록하도록
변경. iOS는 여전히 0(서드파티 앱 재생 상태를 관찰할 방법 자체가 없음, no-op 유지).

**3. 수면감지 블랙아웃 — 상하단 색 다른 문제 재수정**
이전 세션에서 `FLAG_LAYOUT_IN_SCREEN`/`NO_LIMITS`로 창을 화면 전체로 확장했는데도 사용자가 다시
색이 다르다고 지적 — 원인 재조사 결과 상태바/내비바는 SystemUI가 별개 레이어로 항상 그 위에 그리는
요소라 "색을 맞추는" 접근 자체가 틀렸음. `View.setSystemUiVisibility`로 완전히 몰입형(immersive
sticky)으로 숨기는 방식으로 교체 — 애초에 암전 화면에서 상태바 아이콘이 보이는 것 자체가 이상하므로
올바른 방향. 실기기 재설치 후 크래시 없음 확인, 사용자의 육안 재확인은 아직 못 받음.

**4. Focus Session 자동넘김 무료 한도(30회) + 보상형 광고 20회 연장 (신규 기능, 사장님 지시)**
`PaceAccessibilityService`에 `autoSwipeCount`/`autoSwipeCap`(기본 30) 추가 — 자동넘김이 실제로
스와이프한 횟수만 셈(수동 스와이프 포함하는 위 2번의 `videoAdvanceCount`와는 별개 카운터). 한도
도달 시 스와이프 대신 일시정지하고 `capReachedPending` 플래그를 세움 — `consumeExpired()`와 동일한
"1회성 소비" 패턴으로 JS가 Pace 앱 재포그라운드 시(AppState 'active') 확인, 모달로 "광고 보고 +20회
받기" 노출(문구는 지시대로 "자동재생" 대신 "Focus Session" 사용). `react-native-google-mobile-ads`의
`RewardedAd`를 새로 감싼 서비스(`src/services/ads/rewardedAd.ts`, 지금은 테스트 광고 단위 ID —
배포 전 실제 ID로 교체 필요, `AdBanner.tsx`와 동일한 미해결 사항)로 광고를 보여주고, 보상 획득 시
`extendAutoNextCap(20)`으로 한도를 늘리며 자동넘김을 재개. `useSubscriptionStore.isPremium`이
true면(`_layout.tsx`에서 부팅 시 + 구매/복원 시 네이티브에 동기화) 네이티브가 한도 체크 자체를
건너뛰어 프리미엄은 완전 무제한.

**5. 조사 결과 이미 있던 것으로 확인됨 (사장님이 "없는 줄 알았던" 것들)**
- **소셜 로그인**: 이미 완성돼 있음(`src/services/auth/google.ts`+`useUserStore.ts`, zen-master
  패턴 이식) — 사장님이 참조한 jlpt-master가 아니라 zen-master에서 이식된 것. 코드가 아니라
  **Google Cloud Console에서 Pace 전용 OAuth 클라이언트 ID를 발급 안 받은 것**이 유일한 빈 곳
  (위 D7 참고) — Claude가 대신할 수 없는 부분(계정 필요).
- **프리미엄/구독 인프라**: `useSubscriptionStore`(RevenueCat 연동, `isPremium`/`isReviewer`/
  `purchase`/`restore` 전부 구현됨, 이것도 zen-master/jlpt-master 패턴 이식)가 이미 완성돼 있어서
  위 4번의 "프리미엄이면 무제한" 게이팅을 새 인프라 없이 바로 얹을 수 있었음.
- **배너 광고 프리미엄 게이팅**: `(tabs)/_layout.tsx`에서 이미 `!isPremium`으로 게이팅돼 있었음
  (추가 작업 불필요, 확인만 함).

**6. 사장님 지시 중 스펙 미확정이라 보류한 것 (위 D8/D9 참고, 코드 안 건드림)**
- "고급 취침모드"를 프리미엄 기능으로 — 뭘 "고급"으로 할지 구체안이 없어서 그대로 진행하면 사장님
  의도와 다른 걸 만들 위험이 큼. 확인 필요.
- "리모컨 지원"을 프리미엄 전용으로 — 이미 전체 사용자에게 배포된 기존 기능(핑거스냅/손짓/블루투스
  볼륨키 Auto Mode)이라, 지금 바로 가두면 기존 사용자 입장에서 회귀로 보일 수 있어 방향 확인 필요.

**검증 상태**: `npx tsc --noEmit` 전 구간 통과(에러 0건). `./gradlew assembleDebug` 빌드 성공,
실기기(R3CN80S5GWW) 설치 후 크래시 없이 접근성 서비스 재바인딩 확인. 1/2/3번은 로그 기반으로 동작
확인함. 4번(보상형 광고 실제 시청 흐름)은 adb로 자동화 불가능해 사람이 직접 확인 필요.

**git**: Mac 세션과 동시에 push하다 `src/app/(tabs)/home.tsx`/`SessionHeroCard.tsx`에서 충돌 발생
(둘 다 독립적으로 "쉬는시간(Rest Time)" 표시를 추가한 것이 겹침) — Mac 쪽의 더 최근·완결된 버전
(`restSeconds` prop + 아이콘 있는 별도 행)을 채택하고 이쪽의 구버전(`useFlipStore` 직접 참조 버전)은
버림. rebase로 정리 후 push 완료.

### 2026-07-26 — Windows 세션 (다른 인스턴스, 사장님과 함께 계정 작업)

**D1(RevenueCat 키) 완료**: 사장님이 RevenueCat 대시보드(API keys → SDK API keys)에서 직접 발급 —
`.env`에 `EXPO_PUBLIC_RC_ANDROID_KEY=goog_jWJgxcRyNFIieGvcyigYvAXBJag`,
`EXPO_PUBLIC_RC_IOS_KEY=appl_XXEGQCLYicODnWDWOaAsEioAIgm` 추가. Metro 재시작 후 실제
`Purchases.configure()` 호출되는지 확인 필요(아직 이 세션에서 실기기 검증 못 함).

**D10(신규, AdMob 테스트ID) 완료**: AdMob 앱 심사 승인 확인 후 사장님이 직접 콘솔에서 Android/iOS
앱 등록 + 배너(양쪽 플랫폼)·보상형(Android, `rewardedAd.ts`가 Android 전용이라 iOS 단위는 발급 안 함)
광고 단위 4개 생성:
- Android App ID `ca-app-pub-3201481146134957~4795871538` / 배너 `.../1435065235` / 보상형 `.../5534238136`
- iOS App ID `ca-app-pub-3201481146134957~6000041915` / 배너 `.../9222201702`

`app.json`(androidAppId/iosAppId), `src/components/home/AdBanner.tsx`(`Platform.select`로 플랫폼별
실제 배너ID), `src/services/ads/rewardedAd.ts`(Android 실제 보상형ID)에 반영, `TestIds` 관련 참조는
네이티브 모듈 미링크 시 폴백 용도로만 남김. `npx tsc --noEmit` 통과.

**미검증**: 새 광고 단위 활성화까지 최대 1시간 소요(AdMob 자체 안내) — 오늘 출시 전 실기기에서 배너/
보상형 광고가 실제로 로드되는지(현재는 "새 단위라 아직 채워지지 않음"과 "설정 실수"를 구분 못 함)
확인 필요.

**참고**: 이 세션과 별개로 같은 날 밤 다른 Windows 세션 인스턴스가 §6 "2026-07-26 (새벽)" 항목의
Focus Session 무료한도/보상형광고 기능을 이미 구현해뒀음(`rewardedAd.ts`는 그 세션이 만든 파일, 이
세션은 그 파일의 테스트ID만 실제ID로 교체) — 두 세션이 같은 날 각각 계정작업/코드작업으로 정확히
맞아떨어짐.

### 2026-07-26 (아침) — Windows 세션 (사장님 실시간 지시, "이어폰 관련 문구 없애")

사장님이 직접 "자동넘김이란 용어가 있으면 안 되고 Focus Session으로, 이어폰 가이드도 없애 — 이어폰
안 되잖아"라고 지시. `자동넘김`/`Auto Next`는 grep해보니 유저에게 보이는 실제 문자열에는 딱 하나만
남아있었음(어제 밤 paywall 혜택 목록에 내가 넣은 것) — 그것만 고치면 됐음. "이어폰" 쪽은 더 컸음:

- `onboarding/index.tsx` slide3(온보딩 3번째 화면)과 `settings.tsx` FAQ Q3/A3가 "Bluetooth 이어폰
  리모컨 버튼으로 넘긴다"고 문구가 돼 있었는데, 이건 Android에서 확정적으로 거짓(B1에서 이미 확인된
  사실 — OS가 서드파티 앱에 미디어 버튼을 절대 안 넘김)이라 FAQ Q3/A3는 `capabilities.
  supportsHandsFreeControl`(Android=false)로 이미 숨겨져 있었음. 근데 **온보딩 slide3는 플랫폼 구분
  없이 항상 보여서 Android에서도 거짓 문구가 나가고 있었음** — 이게 진짜 버그.
- `BluetoothOnboardingSheet.tsx`도 iOS 분기만 여전히 "Bluetooth 헤드셋 버튼" 문구를 쓰고 있었음(B1은
  Android 스코프였어서 iOS는 안 건드렸었음) — 근데 §2-C C5(iOS의 `useBluetoothStore`/
  `bluetoothService.ios.ts`가 100% no-op 스텁이라는 이미 알려진 문제)에 따르면 iOS에서도 똑같이
  거짓임.
- 전부 "핑거스냅/손짓으로 넘기기"(실제로 오늘 밤 내내 검증하며 고친, 진짜 동작하는 기능)로 고치고,
  FAQ Q3/A3의 플랫폼 게이팅도 제거(더 이상 하드웨어 버튼 약속이 아니므로 그 플래그로 숨길 이유가
  없음). `BluetoothOnboardingSheet`도 플랫폼 분기 자체를 없애 양쪽 다 같은(정직한) 문구.
- **의도적으로 손 안 댐**: `settings.tsx`의 "Playback Controls" 섹션(Connected Device/Play-Pause
  Action 상태 표시)과 `stats.tsx`의 "Bluetooth Controls" 섹션은 iOS 전용으로만 노출되는데, 이것도
  C5 문제로 실제로는 기능 안 함 — 근데 이건 "가이드/문구"가 아니라 라이브 상태 표시고, Mac 세션이
  지금 이 파일들(제스처/블루투스 관련)을 활발히 건드리고 있어서 충돌 위험이 있다고 판단해 손 안 댐.
  Mac 세션이나 사장님이 C5를 실제로 고칠 때 같이 정리하는 게 안전함.

검증: `npx tsc --noEmit` 통과. 실기기 육안 확인은 아직 못 함(문구만 바뀐 거라 크래시 위험은 낮음).

### 2026-07-26 — Windows 세션 (크레딧 경제 공식 확정 — Mac 세션도 반드시 이 공식 따를 것)

사장님이 크레딧 적립/소비 공식을 명확한 숫자로 확정함. **iOS(Mac 세션) Flip Mode 구현도 아래
공식과 반드시 동일해야 함** — 플랫폼마다 크레딧 계산이 다르면 크로스플랫폼 계정(구글/애플 로그인
공유 시)에서 부정합이 생김.

**적립(Earn):**
| 행동 | 크레딧 |
|---|---|
| 매일 출석(앱 최초 실행 1회/일) | +5 |
| 휴식(Flip Mode 엎어놓기) 10분마다 | +5 |

- 휴식 크레딧 공식: `floor(휴식분 / 10) * 5` — 예) 10분=5, 20분=10, 30분=15.
- 출석 크레딧은 `useAttendanceStore.ts`(신규, 날짜별 리셋 안 되는 별도 지갑)가, 휴식 크레딧은
  기존 `useFlipStore.ts`(날짜별 자정 리셋)가 각각 관리 — 소비 시 두 지갑을 합산해서 씀.
- **심야 시간대(00:00~06:00) 제외**: 사장님이 "자는 시간도 빼야 하는 거 아니냐"고 지적 →
  웹리서치 결과(SleepTown 등 — Forest 제작사가 만든 수면 전용 앱들이 "이게 진짜 수면인지"
  판별을 시도하는 대신 수면을 아예 별도 시간대로 분리 처리하는 게 업계 공통 패턴임을 확인,
  Sources: sleeptown 앱스토어 페이지, sleep.urbandroid.org) 반영해 `useFlipStore.ts`에
  `quietHoursOverlapSeconds()` 추가 — 00:00~06:00에 걸친 face-down 시간은 Stats의 "오늘 쉰
  시간"(`putDownSeconds`, 정직한 실측 통계라 안 건드림)에는 그대로 잡히지만 크레딧 계산용
  `creditEligibleSeconds`에서는 제외됨. 기존 4시간 상한(`MAX_REST_SECONDS`, 한 번의 쉼이 너무
  길면 자르는 것)과는 별개 안전장치 — 상한은 "얼마나 길게"를, 이건 "언제"를 본다.
  - 기존 세션 중 수면감지(PaceOverlayService, 10분 무진동→sleep_detected)와는 다른 문제라
    재사용 안 함(사장님이 "이거로 판단 안 되냐"고 물어서 명시적으로 설명함) — 그건 "가드된 세션이
    활성인 동안만" 도는 별개 신호고, 애초에 무진동 지속시간만으로는 "20분 낮잠"과 "8시간 밤잠"을
    구분 못 함(둘 다 face-down이면 똑같이 무진동). 시간대 기반 제외가 이 문제엔 맞는 도구.

**소비(Spend):**
- **1크레딧 = 1분**(연속 시청 시간 연장, 영상 편수 아님 — 이전엔 "1크레딧=영상 1편"으로
  `extendAutoNextCap()`만 불렀는데, 이번에 단위를 시간으로 바꿈).
- `overlay/index.tsx`의 Focus Session 무료 한도(30편) 도달 모달 → "크레딧 사용" 버튼이 이제:
  1. 기존 "Extend Time" 칩과 동일한 경로로 실제 세션 시간(`remainingMinutes`)을 크레딧 수만큼 연장
     (`useDailyBonusStore.addMinutes` + `useTimerStore.addMinutes` + `overlayService.updateRemaining`).
  2. **동시에** `autoSwipeCap`도 같은 양만큼 늘림(`extendAutoNextCap`) — 시간만 늘고 영상 스와이프
     자체는 여전히 막혀 있는 모순을 피하기 위함(이 모달이 뜬 원인 자체가 영상 편수 한도 도달이므로).
- 보상형 광고 버튼은 안 건드림(여전히 "+20편", `extendAutoNextCap(20)`만 호출) — 광고는 원래부터
  영상 편수 단위였고 사장님이 이번에 바꾸라고 한 건 크레딧 쪽 단위뿐이었음.

**Mac 세션 확인 필요**: iOS Flip Mode(`useFlipStore.ts`는 플랫폼 공용 파일이라 이미 이 공식을
그대로 씀 — 파일 자체는 공유되므로 별도 이식 불필요할 수 있음, 단 iOS 전용 크레딧 소비 UI/경로가
있다면 그쪽도 "1크레딧=1분" 단위로 맞춰야 함. `PACE_ARCHITECTURE.md` §1-A 스펙 문서에도 이 공식을
반영해두는 게 좋음(현재 문서엔 정확한 수치가 없었음).

검증: `npx tsc --noEmit` 통과, 실기기 재설치·재실행 후 크래시 없음 확인(로그 상 RevenueCat 설정
경고만 있음, 무관). 크레딧 소비→세션 시간 실제 연장 여부는 실제로 한도까지 도달시켜야 확인 가능해
아직 육안 검증 못 함 — 다음 세션에서 실제로 30편 도달시켜 크레딧 버튼 눌러보는 걸 권장.

### 2026-07-26 — Windows 세션 (Focus Session/연속 시청 통합 — 시스템 전면 교체)

사장님이 바로 위 항목("자동넘김 30편 한도")을 만든 지 몇 시간 안 지나서, 외부 AI(Copilot)와의
대화를 붙여넣고 핵심을 지적함: **"focus session이 연속 시청이자나"** — 즉 어젯밤에 만든
"Focus Session(10분 고정 시간)"과 그 전날 밤에 만든 "자동넘김 30편 한도(연속 시청)"가 사실
같은 기능(핸즈프리 자동 넘김)을 서로 다른 축(시간 vs 편수)으로 **중복 게이팅**하고 있었다는
뜻 — 무료 사용자 입장에서 "왜 업그레이드 모달이 두 종류(시간 만료 모달 vs 편수 한도 모달)가
따로 뜨는지" 혼란스러울 수 있는 설계 결함. 사장님이 명시적으로 통합 모델을 승인함
("나는 오히려 이렇게 가고 싶음"):

- **무료**: Focus Session 10분 고정(시간 축 하나만 남김) + 출석 +5크레딧/일 + 휴식 10분당
  +5크레딧(기존 §6 "크레딧 경제 공식" 그대로 유지) + 연장: 광고 시청 → +5분 **또는** 크레딧
  5개 → +5분(1크레딧=1분, 기존 공식 그대로).
- **프리미엄**: 지속시간 자유 선택 + 광고 제거 + (선택) 크레딧 2배 적립 — 마지막 항목은
  "선택"이라고 명시했으므로 아직 미확정, 이번 세션에서 구현 안 함.

**"자동넘김 30편 한도" 시스템 전면 제거** (2026-07-26 밤에 막 완성했던 것 포함):
- `PaceAccessibilityService.kt`: `autoSwipeCount`/`autoSwipeCap`/`capReachedPending`/
  `unlimitedAutoNext` 필드, `pauseAutoNextForCap()`, `setUnlimitedAutoNext()`/
  `consumeAutoNextCapReached()`/`extendAutoNextCap()`/`getAutoSwipeCount()`/`getAutoSwipeCap()`
  companion 함수 전부 삭제. `checkPlaybackAndMaybeSwipe()`는 이제 `isWatching`이면 한도 체크 없이
  항상 스와이프(무료/프리미엄 구분 없음 — 스와이프 자체엔 더 이상 편수 제한이 없고, Focus Session
  의 "지속시간"만 무료/프리미엄을 가른다).
- `PaceOverlayModule.kt`: 대응하는 `Function()` 바인딩 4개 삭제(새로 추가한
  `consumeFocusSessionTimedOut`/`extendFocusSession`은 그대로 유지 — 이름이 달라 혼동 없음).
- JS: `AutoNextService` 인터페이스(`types.ts`)에서 `setUnlimitedAutoNext`/
  `consumeAutoNextCapReached`/`extendAutoNextCap`/`getAutoSwipeStatus` 4개 제거,
  `autoNextService.android.ts`/`.ios.ts` 구현도 동일하게 정리. `_layout.tsx`의 부팅
  시/구독상태 변경 시 `autoNextService.setUnlimitedAutoNext(isPremium)` 호출부 삭제(더 이상
  프리미엄이 스와이프 자체를 특별 취급할 이유가 없음 — `enforceFreeFocusSessionDuration`만 남음).
- `overlay/index.tsx`: 예전 "자동넘김 30편 한도 도달" 모달 전체 삭제(`showCapModal`/`watchingAd`
  state, `checkCap` AppState 이펙트, `onWatchAdForMore`/`onUseCredits`/`restCredits`/
  `bonusCredits`/`totalCredits`, Modal JSX, `capModal*` 스타일, 이제 안 쓰는 import들
  `useSubscriptionStore`/`useFlipStore`/`useAttendanceStore`/`showRewardedAd`/`ActivityIndicator`/
  `Modal`). 이 모달의 역할(무료 한도 도달 시 광고/크레딧으로 연장)은 이제
  `FocusSessionExtendModal`(Home) 하나로 완전히 대체됨.
- i18n: `overlay.autoNextCapReachedTitle/Message`, `watchAdForMore`, `useCreditsForMore`,
  `autoNextExtendedToast`, `creditsExtendedToast` 키 삭제(en/ko 둘 다, 더 이상 아무 데서도 참조
  안 함). 대신 `home.useCreditsToExtend` 신규 추가(en/ko) — 아래 크레딧 버튼용.

**`FocusSessionExtendModal.tsx`에 "크레딧 사용" 버튼 신규 추가** — 기존엔 광고 버튼 하나뿐이었음.
`useFlipStore`(휴식 크레딧) + `useAttendanceStore`(출석 보너스)를 합산해 5개 이상 있을 때만
버튼 노출, 눌러도 실제로는 부족분만큼만 소비(`spendCredits`/`spendBonusCredits`가 각각 실제
소비량을 반환하는 기존 clamp 패턴 그대로 재사용), `bluetoothService.extendFocusSession(spent)`
호출.

**Home(`home.tsx`) 폴링 마무리** — 어젯밤 세션이 중단됐던 지점: `FocusSessionExtendModal`의
JSX 렌더는 이미 있었지만 `showFocusSessionExtend` state와 그걸 채우는 AppState 이펙트가
빠져있었음. `overlay/index.tsx`의 `consumeExpired`/`consumeAccessibilityRevoked`와 동일한
패턴(YouTube가 전면일 때 JS 타이머가 죽어있을 수 있어, 네이티브가 이미 판단해둔 1회성 신호를
Pace가 포그라운드로 돌아올 때마다 `consumeFocusSessionTimedOut()`으로 소비)으로 완성.

검증: `npx tsc --noEmit` 통과, `gradlew assembleDebug` 빌드 성공, 실기기(R3CN80S5GWW) 재설치 후
Settings 탭(주간 출석 위젯 렌더 확인)·Focus 탭(실제 YouTube Shorts 세션 시작 → "SESSION ON" 알약
+ "Focus Session Started (10m)" 토스트로 무료 10분 고정이 실제로 적용됨을 확인) 둘 다 크래시
없음. **미검증**: 10분 자연 만료 후 `FocusSessionExtendModal`이 실제로 뜨는지, 광고/크레딧 버튼을
눌렀을 때 `extendFocusSession`이 실제로 5분을 더해주는지 — 10분을 실제로 기다려야 확인 가능해
다음 세션 권장 작업으로 위 §5에 남김.

### 2026-07-26 — Windows 세션 (현재 상태 점검 — 사장님 요청 "현재 문제점 개선점 확인해")

밤사이 여러 세션 인스턴스가 진행한 내용을 문서만 보고 믿지 않고 실제 코드/환경으로 교차검증함:
- `git fetch`+`pull` — origin이 로컬보다 3커밋 앞서 있었음(Mac 세션의 iOS 피드 무음 오버레이
  수정 3건, `feed/index.tsx`/`YouTubeShortsPlayer.ios.tsx`/`PaceGestureModule.swift`만 건드림,
  충돌 없이 fast-forward). 반영 완료.
- D1/D2/D4/D5/D7 — `.env`에 RC/Google 클라이언트 ID 실제로 채워져 있음, `reviewers.ts`에
  `s7.reviewer@gmail.com`, `settings.tsx`의 `SUPPORT_EMAIL`이 `comfortstride7@gmail.com` —
  로그의 주장과 코드 상태 일치 확인.
- `npx tsc --noEmit` 전체 재실행 — 에러 0건, 밤새 쌓인 대량 변경 후에도 타입 정합성 깨진 곳 없음.
- 이전 §6 "WIP 스모크 테스트 미완" 항목(Home 히어로카드/온보딩/스플래시/quick-control-sheet)은
  이후 커밋(`94d137c`/`dfb0e78`/`b3e2563` 등)으로 **이미 커밋 완료 확인** — §3 항목 4는 해소.
- **새로 발견된 미커밋 WIP** (이전 로그에 기록 안 됨, 출처 불명 — 아마 어젯밤 세션 막바지에
  손대고 로그 없이 끝난 것으로 추정): `app.json`(OTA 업데이트에 `expo-channel-name: production`
  요청 헤더 추가 — EAS Update 채널 지정용으로 보임, 타당해 보임), `src/app/_layout.tsx`
  (`checkAndForceUpdate`에 `.catch()` 추가 — unhandled rejection 방지, 안전한 수정),
  `eas.json`(신규 — 프로덕션 EAS 빌드 설정, 표준적인 최소 구성). 셋 다 코드 리뷰상 문제 없어
  보이나 **아직 커밋도 실기기 검증도 안 됨** — 다음 세션 처리 필요.

**결론(사장님께)**: D1~D5/D7/D10 전부 실제로 반영됨 확인. 아직 남은 건 D6(제품 방향)·D8(고급
취침모드 스펙)·D9(리모컨 프리미엄 게이팅 방식) 사장님 결정 3건 + D11(RevenueCat, 은행 확인
대기 — 코드/설정으로 단축 불가, 그냥 기다리는 중) 뿐. Android 쪽 코드 이슈는 B1~B3 모두 종결.
iOS 쪽 C1~C5는 아직 열려있음(Mac 세션 담당, 진행 상황은 이 세션에서 확인 불가 — 그쪽 로그 참고).

### 2026-07-26 — Windows 세션 (Focus Session 라이브 실기기 검증 완료 + 수면감지 정확도 개선)

**위 §5의 미검증 항목을 실제로 확인함** — 실기기(R3CN80S5GWW)에서 진짜 10분(설정값 조작 없이
그대로) Focus Session을 시작해 자연 만료까지 실제로 기다린 뒤 확인:
- `bt_auto_mode`가 정확히 10분 뒤 `false`로 자동 전환(`focusSessionAutoStop` 정상 발동) 확인.
- Pace를 포그라운드로 가져오니 `FocusSessionExtendModal`이 정상적으로 뜸.
- **광고 연장 경로**: 리워드 광고 시청 → "리워드 지급됨" 확인 → 엔드카드 X 눌러 닫으니 Pace로
  정상 복귀 + "Focus Session Started (10m)" 네이티브 토스트까지 확인(광고 SDK의 표준 엔드카드
  UX일 뿐 버그 아님 — 광고 종료 후 자동 복귀가 안 되는 것처럼 보였던 건 사용자가 아직 엔드카드의
  X를 안 눌렀던 것).
- **크레딧 연장 경로**: 실제 저장된 값(휴식 크레딧 0 + 출석 보너스 5)으로 `spendCredits`/
  `spendBonusCredits` 조합 로직을 코드 레벨로 직접 트레이싱 — 5크레딧 정확히 소비, `extendFocusSession(5)`
  호출까지 로직 정합성 확인.
- 부가로 발견된 것(버그 아님, 우리 제어 밖): 리워드 광고 시청 중 하단 시스템 내비게이션 바가
  흰색으로 보이는 것은 구글 Mobile Ads SDK 자체 `AdActivity`가 Pace 테마를 안 받는 것 — 모든 앱이
  겪는 SDK 자체 제약이라 앱 코드로 고칠 수 있는 부분이 아님.

**`FocusSessionExtendModal.tsx` 디자인 개선** — 사용자 피드백("모달 겁내 촌스러운데") 반영. 기존
`DailyCheckInModal.tsx`와 톤을 맞춰 상단 아이콘 배지(Feather `zap`, indigo tint) + 제목/설명 가운데
정렬 + 버튼에 아이콘(광고=`play-circle`, 크레딧=`star`) 추가. JS만 바꾼 변경이라 재빌드 불필요.

**Focus Session 종료 시 동작 방식 — 사장님 명시적 확정(추가 질문 나올 시 재확인 불필요)**:
"Focus Session(10분)이 끝나도 손으로 스와이프하면 시청 자체는 계속 가능(자동 넘김 편의 기능만
꺼짐), 일일 한도(Daily Limit)에 도달해야만 진짜로 막힘" 구조를 **그대로 유지하기로 결정**함
(하드 블록 방식과 양자택일로 물어봤고 "지금처럼 유지" 선택). 즉 Focus Session은 어시스트 기능
게이트일 뿐 시청 자체의 게이트가 아님 — 향후 이 전제를 뒤집는 논의가 나오면 이 결정을 먼저 참고.

**수면감지 정확도 개선 2건** (`PaceOverlayService.kt`, 사용자가 실기기 라이브 테스트 중 직접
지적):

1. **낮 시간대 오탐 방지 — 시간대 게이트 추가**: "가만히 있으면 무조건 수면 판정"이 낮에 거치대에
   세워두거나(이번엔 제 adb 원격 테스트가 원인 — adb `input tap`은 터치 이벤트만 주입할 뿐 실제
   가속도계를 움직이지 않아 "책상에 가만히 10분+"과 똑같이 잡힘) 하는 상황에서 오탐을 낸다는
   지적. `SLEEP_WINDOW_START_HOUR=22`/`SLEEP_WINDOW_END_HOUR=9`(자정 걸침) 상수 추가, 무진동
   임계값(10분/블루투스 해제 시 6분)을 넘겨도 이 창(22시~다음날 9시) 밖이면 `sleepDetected`가
   무조건 `false` — 낮 시간대엔 아무리 오래 안 움직여도 수면으로 판정하지 않음(Daily Limit 등
   다른 종료 조건은 그대로 적용됨, 이 게이트는 수면 판정에만 적용).
2. **수면 판정 시각 정확도 — "감지 시각"이 아니라 "마지막 움직인 시각"으로 기록**: 기존엔
   `markExpired()`가 불린 시각(=무진동 임계값을 "넘긴" 순간, 실제 잠든 시각보다 정확히
   10분/6분 늦음) 그대로가 세션 `ended_at`(→ 홈 화면 "N시 N분에 잠드셨습니다" 배너 근거)으로
   기록되고 있었음 — 사용자 지적: "1시 3분에 잠들었는데 일어나서 다시 만지면 그 시각이 갱신돼야
   지, 마지막 폰 사용 시각이 잠든 시각과 비슷해야 하는 거 아니냐". `markExpired(reason)`이
   `sleep_detected`일 때만 `PREF_SLEEP_ONSET_AT_MS`(마지막 실제 움직임의 벽시계 epoch ms —
   `System.currentTimeMillis() - stillnessElapsedMs`로 환산)를 같이 저장하도록 수정.
   `PaceOverlayModule.consumeExpired()`는 이제 `String?` 대신 `{reason, sleepOnsetAtMs}` 맵을
   반환(JS `OverlayService.consumeExpired()` 타입도 동일하게 변경 — `overlayService.android.ts`/
   `types.ts`). `overlay/index.tsx`가 `sleep_detected`일 때 `sleepOnsetAtMsRef`로 이 값을 들고
   있다가 세션 종료 시 `endSessionRow(...,  new Date(sleepOnsetAtMs).toISOString())`로 실제
   ended_at을 넘김(`sessionsRepository.endSession()`에 5번째 선택 인자 `endedAtOverride` 추가,
   생략 시 기존처럼 `now()`) — duration_seconds 계산도 같은 시각 기준으로 같이 보정됨. **이
   값은 SharedPreferences(XML)에 저장돼 앱 프로세스/기기 재부팅에도 살아남음** — 어젯밤 감지된
   수면이 아침에 앱을 열 때도 정확한 시각으로 반영됨.

**보류/미착수 — Health Connect(Android)/HealthKit(iOS) 연동으로 워치 수면 데이터 보조 신호화**:
사장님이 외부 리서치(Google Health Connect `SleepSessionRecord`, 구글 Sleep API/
`SleepSegmentEvent`, 애플 HealthKit `HKCategoryValueSleepAnalysis`)를 근거로 제안. 웹 조사 결과
Health Connect는 2026년 기준 정식 지원(Google Fit API는 2026년 내 폐지 예정이라 Health Connect가
공식 후속)이고 `SleepSessionRecord` 읽기 자체는 가능하나, **워치(갤럭시워치/픽셀워치/애플워치)가
실제로 수면 데이터를 기록해줘야만 값이 존재** — 폰 단독 사용자에게는 데이터 자체가 없어 보조
신호일 뿐 위 무진동 휴리스틱을 대체할 수 없음. 새 권한 요청 플로우(Health Connect 자체 권한 다이얼로그)
+ 신규 Gradle 의존성 추가가 필요한 별도 크기의 작업이라 이번 세션엔 시간대 게이트로 오탐 문제를
먼저 해결하고 이건 다음 세션으로 보류함. iOS 쪽(HealthKit)은 Mac 세션 스코프.

검증: `npx tsc --noEmit` 통과, `gradlew assembleDebug` 빌드 성공, 실기기 재설치 후 크래시 없음
확인. 시간대 게이트/수면 시각 정확도 수정은 코드 검토로 로직 확인 완료 — **밤 시간대 실제 재현
테스트(22시~9시 사이에 실제로 무진동 10분 만들어 정확한 시각이 기록되는지)는 낮 시간이라 아직
실기기로 못 함**, 다음 밤 세션에서 확인 권장.

### 2026-07-26 (오후) — Mac 세션 (iOS Feed 버그 대량 수정 + 출시 전 수익화 감사)

**iOS Pace Feed 실기기 디버깅 (사장님과 실시간, 이후 자율)** — 실기기 NSLog 콘솔 캡처
(`devicectl --console`) + 시뮬레이터 자가테스트(`pace://feed` 딥링크 대신 임시 __DEV__ 리다이렉트,
`simctl screenshot`/`log stream`)로 원인을 로그로 확정하며 수정. 주요 수정(전부 `.ios.tsx`/Swift):

1. **매 영상 첫 소리 끊김("씹힘")** — VEV 이벤트 로깅으로 확정: 영상 재생 t≈1s에 **유튜브가 스스로
   `video.muted=true`로 자동음소거 → 우리 코드가 되돌리는 왕복**이 오디오 컷의 원인. `volumechange`
   반응은 이미 끊긴 뒤라 늦음 → **`muted` 프로퍼티 setter를 가로채(audibleOk 이후 muted=true 무시)**
   유튜브의 음소거 호출 자체를 no-op화 → 왕복·컷 소멸(안드로이드 `.tsx`의 muted-setter override와 동일).
2. **"탭하여 음소거 해제" 팝업/아이콘** — 팝업 텍스트가 `.html5-video-player`(플레이어 컨테이너, 영상
   포함)에 있어 클릭/`display:none`하면 재생이 죽음(여러 번 겪음). 해결: (a) 재생 안정 후 `movie_player`
   의 플레이어 API `unMute()`를 **1회만** 호출(setter가 실제 음소거를 막고 있어 컷 없음), (b) 작은
   음소거 아이콘 `.ytp-unmute`만 CSS `display:none`(leaf 버튼이라 영상 무해). 시뮬레이터 스크린샷+VEV로
   컷 없음 확인. (남은 초기 텍스트 플래시는 컨테이너라 못 지움 — 소리 우선 원칙.)
3. **손짓(hand-wave) 감지율 낮음/"2번째 영상부터 안 됨"** — 두 원인:
   - iOS Vision이 **손목(wrist) 신뢰도를 자주 0**으로 줘 손목↔MCP 거리 기반 크기측정이 대부분 프레임
     버려짐 → **신뢰도>0.3인 모든 관절점의 바운딩박스 대각선**으로 크기 측정(손목 빠져도 강건).
   - 새 영상 재생이 **AVCaptureSession을 interrupt**시키는데 관찰자가 없어 복구 안 됨 → `WasInterrupted`/
     `InterruptionEnded`/`RuntimeError` 관찰자 추가해 자동 `startRunning` 복구. (orientation은 8방향
     자동탐색→첫 감지 방향 lock; 실기기 `👋 WAVE!` 발화 로그로 동작 확인.)
4. **넘길 때 페이지 재로드 간극("전환 씹힘")** — 다음 영상 preload(현재+next 2 WebView)를 구현해
   시뮬레이터 로그로 즉시전환(`PRELOAD ready`→`ACTIVATE playing t=0.00`)까지 검증했으나, **실기기에선
   YouTube WebView 2개가 디코더/대역폭 경합 → 재생 중 `stalled`(화면 멈췄다 재생)+손짓 카메라 불안정,
   `absoluteFill`이 상태바-유튜브로고 겹침**까지 유발 → **preload 제거하고 단일 플레이어로 되돌림**.
   전환 간극은 아키텍처 비용으로 감수(재생 중 멈춤이 더 나쁨). 큐 프리페치/영속으로만 완화.
5. **쇼츠 로딩 5초** — `isLoading`("쇼츠 불러오는 중")은 Vercel 서버리스 콜드스타트를 피드 열 때 처음
   깨워서였음 → **홈 mount에서 `loadInitial()` prefetch(iOS만)** + **큐 AsyncStorage 영속(재실행 즉시
   재생)** + loadInitial에 큐존재/로딩중 가드. 커밋: `752c4fc`,`ae370ed` 외.

관련 커밋: `61c2d94`,`752c4fc`,`ae370ed`,`af67f2b`,`f63d514`,`d4b46c8`,`02171a4`. 실기기(UDID
00008120-…266BC01E) Release 설치됨.
⚠️ **진단 로그 잔존**: `.ios.tsx`의 `VEV`/`domlog`/`PRELOAD`/`ACTIVATE`/`UNMUTE-once` send + Swift
`PACEWAVE`/`PACEWV` NSLog가 아직 있음(사장님 복귀 실기기 재검증용으로 일부러 유지) — **App Store
제출 빌드 전 반드시 제거**. 관련 위치는 서브에이전트 스캔 결과 참고(아래).

**🔴 출시 전 수익화 감사(서브에이전트 2종, 읽기전용) — 사장님 조치 필요 블로커**:
- **[BLOCKER] 광고: `EXPO_PUBLIC_USE_REAL_ADS`가 어디에도 설정 안 됨 + `eas.json` 부재** →
  게이팅 로직 자체는 정확·fail-safe(`AdBanner.tsx:27`,`rewardedAd.ts:22`, 플래그 'true'일 때만 실ID)
  이지만, 플래그가 안 켜져 **출시 빌드가 구글 테스트 광고를 그대로 송출 = 광고 수익 0**. 로컬
  `expo run:ios --configuration Release`로 빌드하므로 EAS가 아니라 **빌드시 env로 실제 주입 필요**.
  → 출시 빌드에서만 `EXPO_PUBLIC_USE_REAL_ADS=true` 되도록 빌드 방식 정해서 세팅 필요.
- **[BLOCKER] 구독/IAP: RevenueCat 키 공백**(`.env`의 `EXPO_PUBLIC_RC_IOS_KEY`/`_ANDROID_KEY` 빈값)
  → `useSubscriptionStore.init()`이 `Purchases.configure()`를 안 부름 → offerings=[] → **페이월이
  빈 목록, 구독 구매 자체가 불가능**. → 실제 RC 공개 SDK 키(`appl_…`/`goog_…`) 세팅 + 양 플랫폼
  구매/복원 실기기 테스트 필요. (App Store Connect/Play Console 구독 상품 등록 여부도 확인.)
- **[HIGH] 실광고 테스트기기 커버리지**: 실ID 켠 뒤 내부/TestFlight 배포 시 오탭=AdMob 계정정지 위험.
  `adsConfig.ts:16-18` 테스트기기 화이트리스트에 **안드 1대(Note20)뿐, iOS는 0대**. → 실광고 빌드를
  내부 배포하려면 모든 테스터 기기ID(양 플랫폼) 등록 먼저. **당장은 플래그가 꺼져있어 안전**(실광고 미송출).
- **[HIGH] 페이월 문구-실제 게이팅 불일치(App Review 리젝 위험)**: 페이월이 광고하는 4개 혜택 중
  "핸즈프리(손짓/BT 리모컨)"·"고급 취침모드"는 **`isPremium`으로 전혀 안 가둬짐**(현재 `isPremium`
  소비처는 광고배너 숨김·무료 Focus 10분 제한뿐). 없는 잠금을 광고하는 셈 → **D9(리모컨 프리미엄
  게이팅) 결정과 직결**. 결정: (a) 두 기능 실제 게이팅 vs (b) 페이월 문구에서 제거. 코드 자체는
  `isPremium` 체크 하나라 간단하나 **제품/마케팅 결정이라 자율 수정 안 함**.
- **[MEDIUM→수정완료] 보상광고 로드 무한대기** — no-fill 시 프라미스 미해결로 모달 스피너 영구 대기
  → 20초 타임아웃 추가(`rewardedAd.ts`). **[LOW→수정완료]** `purchase()`에 `restore()와 동일 RC 가드
  추가. 커밋 `7297386`.
- 리뷰어 우회(`s7.reviewer@gmail.com`→isPremium 강제)는 의도된 심사용, 정상.

**남은 자율작업 큐**: (1) 사장님 복귀 후 실기기로 위 Feed 수정들(소리컷/손짓/음소거아이콘) 최종 확인
→ OK면 (2) 진단 로그 일괄 제거 후 클린 빌드. (3) 위 수익화 블로커는 사장님 계정/결정 필요.
