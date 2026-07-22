# PACE — Android 실기기 라이프사이클/구독/블루투스 QA (2026-07-22)

> 목적: 이번 주 출시 목표에 맞춰 Android 실기기(Galaxy Note20, `com.pace.app`)에서 세션
> 라이프사이클(백그라운드/슬립/전원/프로세스 종료), 구독(RevenueCat) 흐름, 블루투스 리모컨
> 정상/비정상 케이스를 검증. **iOS 쪽(맥 세션)도 아래 각 항목의 iOS 대응 동작을 확인 필요** —
> Android는 AccessibilityService+SYSTEM_ALERT_WINDOW 오버레이, iOS는 Family Controls/Screen
> Time 기반이라 구현이 다르므로 항목별로 별도 검증 요망.
>
> **검증 상태 범례**: `RUNTIME` 실기기 확인, `CODE` 코드 확인, `NEEDS-RETEST` 재검증 필요(아래 사유 참고)

---

## 🚨 이번 주 출시 관련 최우선 요약

**아래 세 가지는 "버그"가 아니라 이번 주 출시 자체를 막는 구조적 gap입니다. 사장님 우선순위 결정 필요:**

1. **구독 결제가 지금 빌드에서 100% 작동 불가** — RevenueCat API 키 자체가 비어있어서
   `Purchases.configure()`가 아예 호출 안 됨(#S1). 게다가 프리미엄으로 잠긴 기능이 앱 전체에
   **단 하나도 없음**(#S2) — 지금 상태로는 "팔 것"이 없음. 커스텀 백엔드도 미배포라 실 로그인
   자체가 안 돼서(#S3) 게스트가 아닌 진짜 사용자가 결제 화면까지 갈 방법이 없음.
2. **Bluetooth "핸즈프리 컨트롤"의 핵심 약속(AirPods/버즈로 실제 유튜브 조작)이 Android OS
   설계상 원천적으로 불가능**함이 이미 이전 실기기 검증(7차)에서 확인돼 있었음(#B22) — 앱 내
   코드 문제가 아니라 Android가 서드파티 앱의 미디어 버튼 가로채기를 막는 보안 정책. 그런데
   온보딩 시트와 Settings "READY" 배지는 여전히 이 기능이 되는 것처럼 광고 중(#B23, #B24).
   **어젯밤 제 지시로 Focus 탭의 인앱 Next/Previous 버튼도 삭제해서, 이제 이 기능은 앱 어디에도
   실제로 작동하는 진입경로가 없음**(#B26 — 제가 만든 회귀, 아래 상세).
3. **iOS는 잠금화면/다이나믹아일랜드 오버레이(Live Activity)가 전혀 구현 안 됨** — 전부 빈
   함수 스텁(`overlayService.ios.ts`). 네이티브 Swift/ActivityKit 작업이 필요해서 맥 세션에서
   처리해야 함.

이 세 가지를 이번 주 안에 다 해결할지, 아니면 v1은 "무료만" + "Bluetooth 리모컨 기능 숨김"으로
축소해서 먼저 내보낼지 — **결정이 필요합니다.**

---

## 요약 (진행 중 — 계속 갱신됨)

| # | 심각도 | 제목 | 상태 | iOS 확인 필요 |
|---|---|---|---|---|
| 1 | 🟡 조사중 | 세션 활성 중 홈 버튼으로 나가면 네이티브 오버레이 알약이 홈 화면 위에 안 보임(재현 조건 불확실, 재검증 중) | NEEDS-RETEST | N/A (Android 전용 오버레이) |
| 2 | ℹ️ 오탐 아님 | `PaceAccessibilityService` ConnectionRecord가 dumpsys에 다수 DEAD로 표시됨 — 실제 크래시(FATAL EXCEPTION) 로그는 없음, 이번 세션에서 테스터가 반복적으로 `am force-stop`한 이력이 원인으로 보임. 크래시 재현 안 됨. | CODE(로그 확인) | - |
| 3 | ✅ 정상 확인 | 세션 중 화면 슬립(20초)→재점등: 타이머 정확히 진행(60m→58m), 오버레이 알약/SESSION ON 상태 정상 복원. 잠금화면 자체엔 오버레이 미표시(Android 보안 정책상 정상, 버그 아님) | RUNTIME 확인 완료 | 확인 요 (iOS Live Activity는 잠금화면에 원래 표시되는 게 정상이므로 다른 기준) |
| 4 | 🔴 Critical | iOS `overlayService.ios.ts`가 전부 빈 함수(no-op) 스텁 — Live Activity/Dynamic Island 잔여시간 표시가 전혀 구현 안 됨. 네이티브 ActivityKit 브릿지 필요 | `src/services/platform/overlayService.ios.ts` (전체) | **맥 세션 처리 필요** |

(테스트 계속 진행 중 — 아래 섹션에 상세 추가 예정)

---

## 진행 중인 테스트 계획

1. 세션 중 화면 슬립(전원 버튼) → 재점등: 오버레이/타이머 상태 유지 확인
2. 전원 오프→온(재부팅): 세션 상태 복구 여부
3. 앱 프로세스 강제 종료(kill) 후 재실행: 세션 정보 유실 여부, DB 기록 정합성
4. ✅ 확인 완료: Pace 앱 프로세스가 살아있는 상태(백그라운드, force-stop 안 함)에서 유튜브를
   **직접**(Pace 안 거치고 유튜브 아이콘으로 바로) 열어도 오버레이 알약("Pace • 60m Left •
   SESSION ON")이 자동으로 뜸 — `PaceAccessibilityService`의 `TYPE_WINDOW_STATE_CHANGED` 상시
   감지가 정상 작동, 우회 안 됨. 단, **Pace 프로세스 자체를 완전히 강제 종료(force-stop)한 뒤**
   유튜브를 열면 당연히 감지 안 됨(AccessibilityService도 같이 죽으므로 — Android 구조상 모든
   접근성 서비스 기반 앱의 공통 한계이지 Pace만의 결함 아님). 사용자가 "설정→앱→강제 중지"를
   수동으로 누르지 않는 한 이 우회는 발생 안 함.
5. 블루투스 이어폰(AirPods/Buds) 리모콘 정상/비정상 케이스 — 별도 에이전트 위임(웹 리서치 포함)
6. 구독(RevenueCat) 업그레이드/취소/다운그레이드 흐름 코드 감사 — 별도 에이전트 위임

---

## 상세

### 🟡 1. 세션 중 홈 버튼 → 네이티브 오버레이 알약 미표시 (재검증 필요)
- **증상**: `YouTube with PACE`로 세션 시작 후 `KEYCODE_HOME`으로 홈 화면 이동 시, 스크린샷 상
  Pace 오버레이 알약("Pace • Nm Left")이 보이지 않음. 단, 이 세션 동안 다른 무관한 Samsung
  PopUp View 플로팅 비디오 창이 화면에 떠 있어 오버레이가 그 아래 가려졌을 가능성도 배제 못 함.
- **재현 조건 불확실 이유**: 테스터가 같은 세션에서 앱을 여러 번 force-stop/재실행했고, 세션
  상태(useSessionStore, 네이티브 오버레이 서비스)가 JS 재시작과 정확히 동기화되지 않았을 가능성.
  즉 "재현됨"이 아니라 "테스트 중 오염된 상태에서 관찰됨" — 확실한 결론 전 클린 상태(fresh
  install 또는 최소한 fresh session)에서 재확인 필요.
- **다음 단계**: 세션 새로 시작 → 즉시 홈 버튼 → 오버레이 알약 유무 확인(플로팅 팝업 없는 상태에서).

### ℹ️ 2. PaceAccessibilityService dumpsys DEAD 다수 — 오탐
- **관찰**: `dumpsys activity services com.pace.app`에서 `PaceAccessibilityService` 관련
  ConnectionRecord 60여 개 중 대부분이 `DEAD` 표시.
- **재확인**: `logcat`에서 `FATAL EXCEPTION`, `AndroidRuntime: Process ... died` 검색 결과
  0건(최근 20000줄 버퍼). Android가 서비스 바인딩 이력을 계속 남기는 특성상, 이번 세션에서
  테스터가 반복 `am force-stop com.pace.app`을 실행한 횟수(10회 이상)와 DEAD 개수가 대략
  일치 — 실제 크래시가 아니라 **정상적인 재바인딩 이력**으로 판단.
- **결론**: 현재까지 크래시 증거 없음. 다만 실사용 중(테스터 개입 없이) 이 서비스가 자연
  발생적으로 죽는지는 별도로 장시간 관찰 필요(아래 진행 중 테스트 참고).

---

---

## Bluetooth Hands-Free Control — 위임 에이전트 감사 결과 (2026-07-22)

> 웹 리서치(Android MediaSession / iOS MPRemoteCommandCenter 정석 구현) + 코드 감사 결과.

**정석 구현 요약**: Android는 `MediaSession.Callback`(onPlay/onPause/onSkipToNext/onSkipToPrevious)
+ `AudioFocus` 요청이 정석(레거시 `ACTION_MEDIA_BUTTON`/`registerMediaButtonEventReceiver`는
Android 8+에서 사실상 사용 불가). iOS는 `MPRemoteCommandCenter` + 활성 `AVAudioSession`가 정석
(오디오 세션이 없으면 리모컨 이벤트 자체가 안 옴 — 알려진 함정).

| # | 심각도 | 제목 | 위치 | 상태 |
|---|---|---|---|---|
| B22 | 🔴 Critical | Android: 실제 YouTube 앱 재생 중엔 AirPods/버즈 하드웨어 버튼이 Pace로 절대 안 옴(4가지 우회 전부 실패, OS `MediaSessionService`가 오디오를 실제로 재생 중인 앱으로 타겟을 강제 지정 — Pace가 고칠 수 없는 OS 보안 설계) | `modules/pace-overlay/android/.../PaceOverlayService.kt:140-182`, `PACE_ARCHITECTURE.md:2753-2836`("실기기 검증 7차") | CODE+RUNTIME(자체 기록 있음) |
| B23 | 🟠 High | `bluetoothHardwareVerified`가 "모듈 링크됨"만 확인하고 "버튼이 실제로 온다"는 확인 안 함 — Android Settings에 "READY" 배지로 과장 표시(B22와 모순) | `services/platform/capabilities.ts:40`, `bluetoothService.android.ts:39`, `(tabs)/settings.tsx:407` | CODE |
| B24 | 🟠 High | Bluetooth 온보딩 시트가 B22로 확인된 존재하지 않는 능력("Next/Previous/Play-Pause로 실제 Shorts 제어")을 여전히 광고 | `components/home/BluetoothOnboardingSheet.tsx:24-38` | CODE |
| B25 | 🟠 High | iOS: 정석인 `MPRemoteCommandCenter` 미구현(리포 전체 0건). 대체된 `AVAudioSession.outputVolume` KVO 방식(`PaceVolumeKeyModule.swift`)은 실제 AirPods/버즈 탭 제스처가 아니라 물리 볼륨 버튼 HID만 감지하는 걸로 보임 — 실기기 미검증 | `services/platform/types.ts:74`, `bluetoothService.ios.ts:3-9`, `modules/pace-volumekey/ios/PaceVolumeKeyModule.swift:7-50` | STATIC |
| B26 | 🟡 Medium | **2026-07-22 Focus 탭 단순화(이 세션의 지시)로 인앱 Next/Previous 버튼 자체가 삭제됨** — `useBluetoothStore.next/previous`를 부르는 UI가 리포 전체에 0건(죽은 코드). 남은 유일한 진입경로(하드웨어 MediaSession 콜백)는 B22로 이미 무력화 확정 → **이 기능은 이제 앱 어디에도 실제로 작동하는 진입경로가 없음** | `(tabs)/focus.tsx:16-24`, grep 전체(`bluetooth.next()/previous()` 0건) | CODE |
| B27 | 🟢 Low | iOS 스텁(`supportsHardwareRemote:false`→"BETA")은 정직한데 Android는 B23처럼 과장 — 플랫폼 간 "검증됨" 기준 불일치 | `bluetoothService.ios.ts:10-31` vs `.android.ts:39` | CODE |
| B28 | 🟡 Medium | BT 기기 중도 연결해제 감지 안 됨 — 수동 폴링(`refresh()`)뿐, `AudioDeviceCallback`/ACL 이벤트 구독 없음 | `modules/pace-overlay/.../PaceOverlayModule.kt:28-34` | STATIC |
| B29 | 🟢 Low | 동시에 여러 BT 기기 연결 시 `.firstOrNull`로 임의 선택 | `PaceOverlayModule.kt:30-33` | STATIC |
| B30 | 🟢 Low | MediaSession 콜백에 디바운스 없음(`PaceSnapDetector`의 450ms REFRACTORY_MS와 대조) | `PaceOverlayService.kt:143-148` vs `PaceSnapDetector.kt:30,172` | STATIC |

**참고**: Pace Feed(양쪽 플랫폼)는 Pace 자신이 오디오를 재생하는 유일한 화면이라(경쟁 앱 없음)
하드웨어 버튼이 실제로 작동 확인됨(Android `PaceFeedMediaSession.kt`, `PACE_ARCHITECTURE.md:2926-2941`).
즉 "핸즈프리 컨트롤"을 완전히 죽이지 않으려면, **YouTube 세션이 아니라 Pace Feed 안에서만
동작하는 기능으로 포지셔닝을 바꾸는 게 유일하게 정직한 방향.**

---

## 구독/결제(RevenueCat) — 위임 에이전트 감사 결과 (2026-07-22)

> 정적 코드 감사(실 결제 샌드박스 테스트는 불가). 클라이언트 쪽 RevenueCat 연동 자체는
> **잘 만들어져 있음**(구매/복원/리스너/에러처리 다 있음, 기존 QA #6 "무한 로딩" 버그도 이미 수정됨).
> 문제는 코드가 아니라 **설정/인프라가 비어있어서 지금 빌드에서 전혀 작동 안 함.**

| # | 심각도 | 제목 | 위치 | 상태 |
|---|---|---|---|---|
| S1 | 🔴 Critical | RevenueCat 실키(`EXPO_PUBLIC_RC_ANDROID_KEY`/`EXPO_PUBLIC_RC_IOS_KEY`) 미설정 — 비어있으면 `Purchases.configure()` 자체가 호출 안 됨 → **실구매 완전 불가**(코드 문제 아니라 설정 누락) | `store/useSubscriptionStore.ts:14-16,70-74`, `.env.example:20-21`, `PACE_ARCHITECTURE.md:1626`(체크리스트 미완료로 이미 기록돼 있음) | CODE |
| S2 | 🔴 Critical | `isPremium`을 실제로 게이팅(잠금)하는 기능이 앱 전체에 단 하나도 없음 — Paywall 진입점도 Settings 1곳뿐. 즉 "팔 것"이 없는 상태 | `settings.tsx:207,212` + 전체 grep | CODE |
| S3 | 🔴 Critical | 커스텀 백엔드 미배포(`API_BASE_URL` 비어있음)로 실 로그인(구글/애플) 자체가 항상 실패 → 게스트가 아닌 실사용자가 Paywall의 로그인 가드를 절대 통과 못함 | `paywall/index.tsx:20-29`, `store/useUserStore.ts:75-91`, `services/api/client.ts:6-8`, `PACE_ARCHITECTURE.md:1628` | CODE |
| S4 | 🟠 High | 구독 취소/만료를 포그라운드 복귀 시 명시적으로 재조회하는 로직 없음(콜드스타트+리스너뿐, 백엔드 웹훅도 미착수) | `store/useSubscriptionStore.ts`(AppState 리스너 부재) | STATIC |
| S5 | 🟠 High | Paywall 재시도 버튼을 누를 때마다 `Purchases.configure`+리스너를 매번 새로 등록(누적) | `paywall/index.tsx:89`, `useSubscriptionStore.ts:76,81` | CODE |
| S6 | 🟡 Medium | 캐시된 `isPremium`에 만료 TTL 없음 — 오프라인 상태로 무기한 프리미엄 유지 가능(의도된 설계로 추정, 확인 필요) | `services/storage/keys.ts:9-10` | CODE(의도 추정) |
| S7 | 🟡 Medium | "구독 관리" 버튼이 네이티브 구독관리 화면이 아니라 Paywall 재오픈만 함 | `settings.tsx:212` | CODE |
| S8 | 🟢 Low | 심사관 화이트리스트(`REVIEWER_EMAILS`)는 현재 비어있고, 실 이메일 소유 없이는 우회 불가(안전) — 제출 전 실제 이메일로 채워야 함(운영 리마인더) | `constants/reviewers.ts:6-8` | CODE |
| S9 | 🟢 Low | 백엔드 `AuthResult.isPremium` 필드가 클라이언트에서 미사용(죽은 필드) | `services/api/client.ts:70` | CODE |

**이미 정상 확인된 것(수정 불필요)**: 구매취소 처리, 구매복원+RC_NOT_CONFIGURED 메시지, 기존
QA#6 무한로딩 수정 확인됨, 취소/만료 시 `isPremium` 재계산 로직, 콜드스타트 레이스 없음,
게스트-구매 불일치 방지 로그인 가드 — 전부 `paywall/index.tsx`, `useSubscriptionStore.ts`에서
확인.

---

## 출시 전 플레이스홀더 점검 (2026-07-22)

| # | 심각도 | 제목 | 위치 | 상태 |
|---|---|---|---|---|
| P1 | 🟠 High | `SUPPORT_EMAIL = 'support@pace.app'`가 실제 모니터링되는 수신함이 아닌 자리표시자 — "기능 건의 및 피드백 전송" 버튼이 실제로는 아무도 안 보는 주소로 메일을 보냄 | `(tabs)/settings.tsx:31` (주석에 "출시 전 실제 수신함으로 교체 필수"라고 이미 자체 기록됨) | CODE(자체 인지된 gap) |
| P2 | 🔴 Critical | (S3과 동일 근본 원인) `API_BASE_URL`이 자리표시자라 백엔드 자체가 없음 — 로그인/설정 동기화/구독 검증 전부 이 위에 얹혀있음 | `store/useUserStore.ts:116`, `services/api/client.ts:6-8` | CODE |
| P3 | 🟢 Low | `REVIEWER_EMAILS`가 빈 배열 — 스토어 제출 전 실제 심사관 테스트 계정 이메일로 채워야 함(안 채우면 프리미엄 리뷰 배지 관련 심사 편의 기능이 무의미) | `constants/reviewers.ts:6-8` | CODE(운영 절차) |

**참고**: P2는 S1/S3(구독 감사)와 근본 원인이 같음(백엔드 미배포) — 중복 집계 방지를 위해
하나의 이슈로 취급 권장.

---

## 전원 재부팅 테스트 — 기존 결정 재확인 필요 (2026-07-22)

- **실기기 재현**: 세션 활성 중 `adb reboot`로 완전 재부팅 → 부팅 완료 후 **Pace를 수동으로 한 번도
  안 연 상태에서** 유튜브를 직접 열어봄 → 오버레이 전혀 안 뜸(감지 자체가 안 됨).
- **이미 문서화된 결정**: `PACE_ARCHITECTURE.md:2650-2651`에 "기기 재부팅 후 복구는 다루지 않음
  (`BOOT_COMPLETED` 리시버 미구현) — 재부팅되면 세션 자체가 의미없어지는 경우가 대부분이라
  우선순위 낮음"이라고 이미 의도적으로 결정돼 있음.
- **재확인이 필요한 이유**: 문서의 전제는 "기존 세션 복구"가 무의미하다는 것인데, 실제로 확인한
  건 그보다 넓은 범위 — 재부팅 후 **Pace를 한 번도 열지 않으면 그날 유튜브를 아무리 써도 전혀
  감지·집행이 안 됨**(기존 세션 복구가 아니라 신규 감지 자체가 꺼져있음). 폰 재부팅은 흔한
  이벤트(야간 자동재시작, 배터리 방전, OS 업데이트 등)라 "그날은 그냥 한도가 안 걸림"이 하루
  단위로 반복될 수 있음. `BOOT_COMPLETED` 리시버로 접근성 서비스 감지 로직만 재기동(세션 자체를
  복구할 필요 없이)하는 건 상대적으로 작은 작업일 수 있어 우선순위 재검토 권장 — 다만 이건 이미
  한 번 의도적으로 내린 결정이라 **제가 임의로 뒤집지 않고 사장님 확인 요청**.

---

---

## 실사용 중 발견(사장님이 실기기로 직접 확인, 2026-07-22 저녁)

### 🟡 세션이 실제로 안 쓰는데도 "5분 남음" 알림이 뜸 — 원인: 테스터가 남긴 좀비 세션
- **증상**: 사장님이 유튜브를 보고 있지 않은데(다른 앱 사용 중) "5분 남았다"는 팝업/알림을 받음.
- **원인 확인(dumpsys)**: `PaceOverlayService`가 그 시점에도 계속 실행 중이었음 — 이번 세션
  내내 테스터(저)가 "YouTube with PACE"로 세션을 여러 번 시작하고, 몇 번은 `router.back()`
  버그(이미 수정됨) 때문에 제대로 안 끝내고 넘어간 게 누적된 결과. 실제 제품 버그가 아니라
  테스트 잔재 — `am force-stop`으로 즉시 해소(Android가 force-stop 시 알람/서비스를 전부
  취소하는 게 의도된 동작, `PACE_ARCHITECTURE.md:2648-2649` 참고).
- **후속 고려사항**: 다만 이게 "몇 시간이고 계속 켜져 있을 수 있는 세션"이 실제로 가능하다는
  뜻이기도 함 — 하루 한도(기본 60분+보너스) 자체는 지키지만, 세션을 명시적으로 안 끝내면
  다음날로 넘어가도 세션이 계속 "활성" 상태로 남는지는 별도 확인 필요(자정 롤오버 시 세션
  자동 종료 로직이 있는지 코드 확인 안 됨 — 다음 라운드 후보).

### 🟠 핑거스냅이 실제 사용 중 동작 안 함 — 원인: 접근성 권한 꺼짐
- **증상**: 실기기에서 핑거스냅을 시도했지만 반응 없음.
- **원인 확인**: `adb shell settings get secure enabled_accessibility_services`가 완전히
  빈 값 — `PaceAccessibilityService` 자체가 비활성. `RECORD_AUDIO` 권한은 정상 부여돼 있어
  마이크 문제 아님. `PaceSnapDetector` 로그가 최근 3000줄 버퍼에 단 한 줄도 없음 — 디텍터
  자체가 시작을 안 한 것으로 보임(접근성 서비스 연결 없이는 스와이프 실행이 불가능하니 애초에
  디텍터를 안 켜는 구조로 추정, 코드 확인은 아직 안 함).
- **재현 가능성 높은 원인**: 이날 초저녁에 `adb reboot`으로 전원 재부팅 테스트를 했음 —
  삼성 기기는 사이드로드(스토어 미배포) 앱의 접근성 서비스를 재부팅 후 보안상 자동
  비활성화하는 경우가 있음. 즉 **제 재부팅 테스트가 실사용 중이던 접근성 권한을 꺼버렸을
  가능성 높음** — 사장님께 사과 및 인지 필요.
- **조치**: Settings 탭 → "포커스 세션 스와이프 상태" 눌러서 재부여 안내(이미 있는 온보딩
  플로우, `AccessibilityOnboardingSheet` 참고)로 해결 가능 — 코드 수정 불필요, 사용자 액션만
  필요.

---

*이 문서는 작업 진행 중 계속 갱신됩니다.*
