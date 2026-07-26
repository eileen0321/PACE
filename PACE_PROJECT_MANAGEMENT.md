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

## 1. 현재 상태 요약 (2026-07-25)

- 출시 전 단계. **로그인(백엔드 미배포) / iOS 차단기능(entitlement 미승인) / 심사 계정
  미설정** 3개가 실제 출시를 막는 핵심 블로커 — 전부 사장님 결정·계정·키가 필요하고
  코드로는 못 고침 (아래 2-A). **결제(RC 키)와 AdMob 테스트ID는 2026-07-26 해결됨**(D1/D10) —
  단, App Store Connect/Play Console에 실제 구독 상품(가격/구독그룹)이 등록돼 있고
  RevenueCat 대시보드에 Offering/Package로 연결돼 있는지는 **별도 미확인** — SDK 키가
  있어도 스토어 쪽 상품 자체가 없으면 구매 버튼을 눌러도 실패함, 다음 확인 필요.
- Android: 기능적으로 대체로 안정. 블루투스 핸즈프리 죽은 UI 정리(B1) 완료, BOOT_COMPLETED(B3)도
  "재부팅 시 활성 세션 복구" 범위로 완료. 단 B3 조사 중 더 근본적인 이슈 발견 — Daily Limit 추적이
  상시 백그라운드 감시가 아니라 전부 사용자가 명시적으로 시작한 세션에만 묶여 있음(제품 결정 필요,
  아래 2-B/6 참고).
- iOS: 2026-07-24 Mac 세션에서 Live Activity·취침감지 구현 완료(실기기 검증 대기).
  Screen Time 차단은 여전히 완전히 죽어있음(entitlement 문제).
- Home/온보딩/스플래시 UI 리디자인이 **로컬에 커밋 안 된 상태**로 존재 — 코드상 완결돼
  보이나 실기기 스모크 테스트 전. (아래 진행 로그 참고)

---

## 2. 🔴 현재 문제점 리스트

### 2-A. 사장님 결정/계정 필요 — 코드로 해결 불가, 최우선

| # | 문제 | 필요한 조치 | 근거 |
|---|---|---|---|
| D1 | ~~구독 결제 100% 비활성~~ | ✅ 완료(2026-07-26) — RC iOS/Android SDK 키 발급받아 `.env`에 입력 완료(`goog_jWJgxcRyNFIieGvcyigYvAXBJag`/`appl_XXEGQCLYicODnWDWOaAsEioAIgm`). Metro 재시작 후 실기기 재검증 필요 | MAC_SESSION_HANDOFF §4-4 |
| D2 | 백엔드(Railway) 미배포 → 구글/애플 로그인 전부 실패(게스트만 가능) | Railway 배포 + `EXPO_PUBLIC_API_BASE_URL`에 배포 URL 입력 | MAC_SESSION_HANDOFF §2 |
| D3 | iOS Screen Time(Family Controls) entitlement 미승인 → 핵심 차단 기능 iOS에서 무동작 | 이번 주 결정 필요: (a) entitlement 신청 후 대기 vs (b) iOS에서 기능 숨기고 우선 출시 | QA_FULL_REVIEW B1 |
| D4 | 심사 리뷰어 화이트리스트 빈 배열(`src/constants/reviewers.ts`) | 제출용 테스트 계정 이메일 추가 | QA_FULL_REVIEW B4 |
| D5 | 지원 이메일이 placeholder(`support@pace.app`, `settings.tsx:33`) | 실제 수신 가능한 메일함으로 교체 | QA_FULL_REVIEW B5 |
| D6 | (B3 조사 중 신규 발견) Daily Limit 추적이 상시 백그라운드 감시가 아니라 전부 사용자가 명시적으로 "YouTube with PACE"를 눌러 세션을 시작한 경우에만 동작함 — 유저가 그냥 일반 YouTube 앱을 직접 열어서 보면 Pace는 그 시청을 아예 감지 못함(재부팅 여부와 무관, 앱의 기존 설계) | 제품 결정 필요: (a) 현재 "opt-in 세션" 모델 유지(문서화·마케팅에 명시) vs (b) Android UsageStatsManager 등으로 상시 감시 추가(배터리/권한/Play정책 트레이드오프 있음) | B3 로그, §6 참고 |
| D7 | (2026-07-26 신규) Google 소셜 로그인 — 코드는 이미 완성돼 있음(`src/services/auth/google.ts`+`useUserStore.ts`, zen-master 패턴 이식, jlpt-master와 별개 프로젝트지만 동일 설계). **막힌 건 코드가 아니라 설정값**: `.env`의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`가 빈 플레이스홀더, `app.json`의 `@react-native-google-signin/google-signin` 플러그인에 `iosUrlScheme`도 없음 | Google Cloud Console에서 Pace 전용 OAuth 클라이언트를 **새로 발급**해야 함(패키지명 `com.strides7.pace` 기준) — jlpt-master/zen-master의 기존 `WEB_CLIENT_ID`/iOS 클라이언트ID/`iosUrlScheme`는 **절대 재사용 금지**(다른 앱 전용, 재사용하면 로그인이 조용히 실패하거나 다른 앱 계정과 충돌). 이건 Claude가 코드로 대신할 수 없음(계정 접근 필요) — 사장님이 콘솔에서 발급 후 값만 넘겨주면 됨 | 2026-07-26 로그 참고 |
| D8 | (2026-07-26 신규, 사장님 요청이었으나 스펙 미확정이라 보류) "고급 취침모드(Advanced Sleep Mode)"를 프리미엄 전용 기능으로 추가해달라는 요청 — 뭘 "고급"으로 만들지 구체 스펙이 아직 없음(현재 수면감지는 10분 무진동 고정 임계값 하나뿐, 사용자 설정 UI 자체가 없음) | 제품 결정 필요 — 임시 제안(확정 아님): 프리미엄 한정으로 무진동 임계값을 5~20분 사이 직접 조절 + 블루투스 탈착 보조신호 사용 여부 토글 정도가 "코드로 바로 만들 수 있는" 최소 범위. 사장님이 원하는 그림이 이거랑 다르면 다시 정의 필요 | 2026-07-26 로그 참고 |
| D9 | (2026-07-26 신규, 사장님 요청이었으나 기존 동작 회귀 위험 있어 보류) "리모컨 지원"을 프리미엄 전용으로 가둬달라는 요청 — 그런데 핑거스냅/손짓/블루투스 볼륨키 Auto Mode는 **이미 전체 사용자에게 배포돼 실제로 쓰이고 있는 기존 기능**(오늘 밤에도 이걸로 여러 버그를 고침). 지금 프리미엄 뒤로 가두면 기존 사용자 입장에선 "되던 기능이 갑자기 막힘"으로 보일 회귀임 | 제품 결정 필요: (a) 신규 사용자만 프리미엄 게이팅하고 기존 사용자는 유지(grandfather) vs (b) 전체 게이팅하되 출시 공지로 미리 안내 vs (c) 이번엔 게이팅 보류(현 상태 유지) — 방향 정해지면 코드 자체는 간단함(`useSubscriptionStore.isPremium` 체크 하나 추가) | 2026-07-26 로그 참고 |
| D10 | ~~AdMob 테스트 광고 단위 ID~~ | ✅ 완료(2026-07-26) — AdMob 앱 심사 승인됨, Android/iOS 앱 등록 + 배너(양쪽)·보상형(Android) 광고 단위 실제 발급받아 `app.json`(androidAppId/iosAppId), `AdBanner.tsx`, `rewardedAd.ts`에 실제 ID로 교체 완료. `npx tsc --noEmit` 통과. 새 광고 단위는 활성화까지 최대 1시간 걸릴 수 있음 — 실기기에서 광고 실제로 뜨는지 확인 필요 | 2026-07-26 로그 참고 |

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

**Windows 세션(다음 작업)** → 2026-07-26 밤 세션에서 사용시간 정확도/영상 카운트/수면 블랙아웃/
Focus Session 무료한도+보상형광고 기능을 새로 완성함(아래 §6 로그). 다음 세션 우선순위:
1. **자동넘김 30회 한도 + 보상형 광고 20회 연장 흐름 실기기 검증** — 코드는 완성·설치까지 했지만
   실제 광고 시청(네트워크+구글 광고서버+실제 터치)은 adb로 자동화할 수 없어 사람이 직접 확인
   필요(YouTube with PACE 세션 켜고 Focus Session으로 30편 넘기거나, 테스트 편의상 코드의
   `DEFAULT_AUTO_SWIPE_CAP`을 잠깐 낮춰서 테스트하는 것도 방법).
2. D7/D8/D9(사장님 결정 대기) 중 하나라도 정리되면 그에 맞춰 마저 구현.
3. Home/온보딩/스플래시 WIP 스모크 테스트(이전부터 밀려있던 항목, 아직 미완).

**Mac 세션(다음 작업)** → 기기 연결되면 C3(실기기 검증) 최우선. 기기 없으면 C1(Sleep Timer
네이티브) 먼저 진행. **신규로 C5(전역 Bluetooth Hands-Free가 iOS에서도 가짜 UI) 발견됨 — 위
2-C 참고, 우선순위 판단해서 큐에 반영할 것.**

**사장님 결정 대기 중** → 2-A(D1~D9). 아무거나 하나씩 정리해주면 해당 세션이 나머지 코드
작업은 알아서 진행함. 순서 추천: D3(entitlement 여부, 시간 걸림 → 먼저 결정) → D1/D2(키·배포)
→ D7(Google OAuth 클라이언트 발급, 소셜 로그인 코드는 이미 완성돼 있어 이것만 있으면 바로 동작)
→ D4/D5(가벼움) → D9(리모컨 프리미엄 게이팅 방식, 기존 사용자 회귀 위험 있어 방향 필요)
→ D8(고급 취침모드 스펙) → D6(제품 방향, 급하지 않음).

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
