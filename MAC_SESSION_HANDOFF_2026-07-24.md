# PACE — Mac 세션 인수인계 (2026-07-24)

> 목적: Windows 세션에서 진행한 번들ID 변경 + 전체 구현 현황 재조사 결과를 맥 세션에
> 전달. **아래 1번(번들ID 변경)은 pull 받자마자 가장 먼저 처리해야 Xcode 빌드가 안 깨짐.**
> 2번 이후는 OS별 구현 상태 스냅샷(2026-07-23 마지막 커밋 기준 재조사) + iOS 우선순위 정리.

---

## 1. 🚨 최우선 — iOS 번들ID 변경됨: `com.pace.app` → `com.strides7.pace`

RevenueCat "In-app purchase key configuration" 검증이 계속 실패해서 원인을 추적한 결과,
**`com.pace.app`이 Apple 전체 시스템에서 이미 다른 제3자가 선점**하고 있어서 이 계정
(EUNHEE LEE, Team ID: 328BF833XS)으로는 등록 자체가 불가능한 상태였음이 확인됨.

**변경 사항 (오늘 완료):**
- Apple Developer → Identifiers에 새 App ID `com.strides7.pace` 등록 (Sign in with Apple
  capability 포함)
- App Store Connect에 새 앱 "Pace Pro" 생성 (기존 시도했던 이름 "Pace"도 이미 타 앱이 선점 중)
- `app.json`의 `ios.bundleIdentifier`를 `com.strides7.pace`로 변경
- RevenueCat "PACE (App Store)" 앱의 App Bundle ID를 `com.strides7.pace`로 수정 →
  In-app purchase key(`SubscriptionKey_2TCHTR7ZLH.p8`) 검증 통과 확인(Valid credentials)
- `backend/.env.example`, `backend/src/main/resources/application.yml`의
  `APPLE_BUNDLE_ID` 기본값도 `com.strides7.pace`로 동기화(Apple identityToken의 aud claim
  대조용이라 안 맞추면 서버 배포 후 애플 로그인 검증이 전부 실패함)

**Android는 그대로 `com.pace.app`... 이 아니라 확인 중 추가로 발견:** Google Play
Console에 이미 생성돼 있던 "PACE" 앱(설치자 0명, "임시" 상태, 아직 빌드 미업로드)의 실제
패키지명이 `com.pace.app`이 아니라 **`com.strides7.pace`**로 이미 등록돼 있었음(누가 언제
그렇게 만들었는지는 불명, Play Console 패키지명은 앱 삭제 전엔 변경 불가). 그래서
Android도 `app.json`의 `android.package`를 `com.strides7.pace`로 통일함. **결과적으로
지금은 iOS/Android 둘 다 `com.strides7.pace`로 완전히 일치.**

**맥 세션에서 pull 후 확인 필요:**
- Xcode에 로컬 캐시된 프로비저닝 프로파일/서명 설정이 옛 번들ID(`com.pace.app` 또는
  `com.pace.app.eunhee`)를 참조하고 있을 가능성 — Signing & Capabilities에서 자동 서명
  재선택하거나 프로파일 재생성 필요할 수 있음
- GoogleService-Info.plist / Google Sign-In iOS Client ID가 만약 별도로 존재한다면(리포에는
  없었음, 이 세션에서 검색해봤지만 파일 자체가 없음) 번들ID 기준으로 재발급 필요
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` 등 실제 값이 세팅돼 있었다면 재확인

---

## 2. OS별 구현 현황 스냅샷 (2026-07-23 마지막 커밋까지 재조사)

Windows 세션에서 `PACE_ARCHITECTURE.md`(3392줄) 후반부 + `QA_ANDROID_LIFECYCLE_2026-07-22.md`
+ `QA_FULL_REVIEW_2026-07-22.md` + `QA_IOS_IFRAME_2026-07-20.md` + `QA_FLIP_MODE_2026-07-23.md`
+ `PACE_FEATURE_SPEC_2026-07-22.md` + `APP_REVIEW_NOTES.md`를 다시 훑어서 정리한 것.
자세한 항목은 각 QA 문서 원본 참고, 여기는 요약만.

### Android — 대체로 안정, 미해결은 정책/광고 정합성 문제 위주
- 작동 확인(실기기/에뮬레이터): 오버레이 알약, Daily Limit/Sleep Timer/Break Reminder(네이티브
  tick), Block Overlay + Hard Block Mode, 3단계 한도 경고, 취침 감지→화면잠금(에뮬레이터만),
  Flip Mode(에뮬레이터만), 통계 타임존 버그 수정 완료
- **블루투스 핸즈프리로 실제 유튜브 조작은 Android OS 레벨에서 불가능 확정**(4가지 우회 전부
  실패, 2026-07-19·07-23 두 라운드에서 재확인). 근데 온보딩/설정 배지는 아직 이 기능을 광고
  중이고, 유일했던 진입점(인앱 Next/Prev 버튼)은 최근 정리에서 삭제돼서 **지금 앱 어디서도
  실제로 진입 불가능** — UI 정리 필요
- Pace Feed(유튜브 화면 그대로 감싸기)는 **Play 정책 위반 가능성 미해결 상태로 그대로 출시
  경로**로 남아있음 (공식 IFrame Embed API는 Android에서 서버측 차단 확인됨, iOS와 다름)
- BOOT_COMPLETED 미구현 — 재부팅 후 앱을 직접 안 열면 그날 사용량 감지 자체가 안 됨(이전에
  의도적으로 미룬 결정, 재검토 필요 플래그만 걸려있음)

### iOS — 여기가 맥 세션이 주로 봐야 할 부분
- 작동 확인: Pace Feed(react-native-youtube-iframe, 실제 재생됨/자동 다음영상 됨 — Android와
  달리 iOS는 공식 embed가 통과함), 볼륨키 핸즈프리(버그로 죽어있던 것 07-22 수정), 핑거스냅
  재활성화, Flip Mode(JS/빌드 경로만 시뮬레이터 검증, **실제 기기 센서 동작은 아직 실기기
  테스트 진행 중이었음** — 진행 상황 확인 필요)
- **🔴 iOS Live Activity/다이내믹 아일랜드: 전혀 미구현.** `overlayService.ios.ts`가 100%
  빈 stub 함수. 네이티브 Swift/ActivityKit 작업 필요 — 맥 세션 담당 항목으로 반복 플래그됨
- **🔴 iOS Screen Time 차단(Family Controls): 코드는 있는데 완전히 안 됨.** Apple의 별도
  entitlement 승인이 아직 안 나서 `modules/pace-screentime`의 권한 흐름/FamilyActivityPicker/
  DeviceActivity 스케줄 코드가 죄다 무동작 상태. **"차단"이 이 앱의 핵심 약속인데 iOS에서
  지금 아예 안 됨 — 이번 주 안에 결정 필요: (a) entitlement 신청하고 승인 기다리기 vs
  (b) 기능 숨기고 일단 출시**
- iOS Sleep Timer 네이티브 메서드(`react-native-track-player`) 미구현 — 매 실행마다 Metro
  경고 로그, 호출하면 실패함. 네이티브 구현 또는 JS 폴백 필요
- 취침 감지 킬 파이프라인(Android는 완료) — iOS는 스펙만 있고 미착수
  (`PACE_FEATURE_SPEC_2026-07-22.md` §4-B: `CMMotionManager.userAcceleration` +
  `AVAudioSession.routeChangeNotification` 블루투스 단절 보조 신호). 단, iOS는 Android의
  `GLOBAL_ACTION_LOCK_SCREEN` 같은 "동의 없이 화면 잠그기" API가 원천적으로 없어서, 밝기
  낮추기 + 인앱 블랙스크린 정도가 최선(Android보다 구조적으로 약한 보장)
- Sign in with Apple이 공식 버튼 컴포넌트가 아니라 커스텀 텍스트 버튼 — HIG/Guideline 4.8
  리뷰 리스크로 플래그됨(QA_ISSUES_2026-07-18 #14), 이후 수정 여부 미확인
- RevenueCat: 클라이언트 코드는 양쪽 다 잘 짜여 있으나 `EXPO_PUBLIC_RC_IOS_KEY`가
  비어있어서 `Purchases.configure()` 자체가 호출 안 됨(Android도 동일)
- 로그인(구글/애플 실계정): 백엔드(Railway) 미배포라 게스트 말고는 실 로그인 자체가 안 됨
  (iOS/Android 공통 원인)

### 공통/백엔드
- 백엔드(Java/Spring) 5개 컨트롤러 전부 구현·H2로 로컬 검증 완료, **Railway 실배포는
  아직 안 함** — 로그인/구독 안 되는 근본 원인이 사실상 이거 하나
- RevenueCat 웹훅 로직(jlpt-master 검증된 상태머신 이식) 구현·단위테스트(8/8) 통과, 근데
  실제 배포된 엔드포인트로 라이브 웹훅 호출 테스트는 아직 한 번도 안 해봄
- OTA 강제 업데이트(`expo-updates`): Android는 네이티브 링크 확인됨, **iOS는 Mac에서
  pod install + Xcode 재빌드해야 JS 공유 코드가 실제로 반영됨 — 아직 미확인**

---

## 3. 이번 주 출시 관련 최우선 결정 사항 (다시 정리)

1. 구독 결제 100% 비활성(양쪽 RC 키 비어있음 + 프리미엄 게이트 기능 0개 + 백엔드 미배포) —
   셋 다 풀려야 실제로 팔 수 있음
2. **iOS Screen Time 차단 기능 죽음** — Apple entitlement 승인 여부 결정 필요 (맥 세션 담당)
3. 블루투스 핸즈프리는 Android OS 레벨에서 불가능 확정인데 광고/UI 정리가 안 됨 — 삭제 또는
   "실험적" 표기로 축소 필요
4. **iOS Live Activity 미구현** — 맥 세션 담당, 네이티브 작업 필요

이 문서는 조사 스냅샷이며, 각 항목의 최신 상세 근거는 원본 QA 문서(`QA_ANDROID_LIFECYCLE_
2026-07-22.md`, `QA_FULL_REVIEW_2026-07-22.md`, `QA_IOS_IFRAME_2026-07-20.md`,
`QA_FLIP_MODE_2026-07-23.md`, `PACE_FEATURE_SPEC_2026-07-22.md`)을 참고할 것.
