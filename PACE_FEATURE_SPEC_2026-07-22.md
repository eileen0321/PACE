# PACE — 2026-07-22 기능 스펙 & 시나리오 정리

> 사장님이 밤에 던진 대량 요구사항을 정리 + 웹 리서치(최신 트렌드) + 그 자리에서 구현 가능한 것은
> 구현/검증, 네이티브(Swift/Kotlin) 작업이 필요한 건 여기 상세 스펙으로 남겨 맥 세션이 iOS 쪽을
> 이어받을 수 있게 함. **범례**: ✅ 구현+검증 완료 / ✅(기존) 이미 이전 세션에서 해결됨(재확인만) /
> 🔧 네이티브 작업 필요(스펙만 정리, 이번 라운드엔 미구현) / ❓ 사장님 결정 필요

---

## 1. 시나리오 정리 (사용자가 던진 원문 요구사항 구조화)

### 1-A. 핵심 가치 제안 (재미 요소 포함)
- 사용 시간 / 쉬는 시간(내려놓은 시간) 측정
- 사용 시간에 따른 알림 제공
- 쉬는 시간에 따른 "집중 모드 보상" 제공
- 블루투스를 이용한 넘김(다음 영상) 제공
- 취침 모드에 따른 쇼츠 자동 종료 제공

### 1-B. 수면 감지 강제 종료 파이프라인
"누운 자세 → 수면 상태 감지 → 앱 종료"를 3단계로: ① WebView 즉시 파괴 ② 화면 암전+밝기 0%→OS
슬립 진입 ③ SQLite `sessions.ended_at`에 정직하게 기록, 다음날 "새벽 1시 23분에 잠드셨습니다" 요약.
신호: 무진동 3분 돌파 OR 이어폰 탈착.

### 1-C. 홈 화면
1. PACE 타이틀 위치/정렬
2. "ACTIVE SESSION GUARD" → "TODAY'S USAGE"/"HEALTHY VIEWING"
3. "YouTube with PACE" 카드 차별화 UI(핸즈프리/포커스 세션 배지)
4. **PACE Flip Mode**(내려놓은 시간 측정) — 자이로/근접 센서로 뒤집힘 감지, 집중 타이머+크레딧 적립,
   집어들면 즉시 정산. 통계에도 반영.

### 1-D. 카피/가이드
1. 자동재생 관련 문구 삭제
2. "PACE = Screen Time / Digital Wellbeing 앱" 포지셔닝
3. 단축어(iOS)/접근성(Android)/뒤집어놓기 가이드 페이지(이미지 포함)

### 1-E. 오버레이/웹뷰
1. 우상단 앱 아이콘이 상태바와 겹침
2. Android 오버레이 불투명도/노출시간 조절
3. iOS 웹뷰에서도 시간 상태바 노출 가능한지
4. 블루투스 볼륨 기반 "다음" 시나리오 정리
5. **한도 도달 UI 3단계화**(1차 풀다이얼로그 → 2차 완화 → 3차+ 자동소멸 토스트)

### 1-F. 일반 유튜브 시청시간
1. Android 일반 사용 측정 확인
2. iOS: Shortcuts(단축어) 자동화 연동 방식("One Sec" 방식) 적용

### 1-G. 일반 검증
라이트/다크모드, 가로 금지, OTA(강제 업데이트), 서버 연동(구독/사용자 정보)

---

## 2. 이번 세션에서 실제로 구현+검증한 것 ✅

| 항목 | 파일 | 내용 |
|---|---|---|
| 한도 도달 3단계 시스템 | `store/useLimitHitStore.ts`(신규), `components/home/LimitReachedOverlay.tsx`, `app/(tabs)/home.tsx` | 하루 스코프 `hitCount`(useDailyBonusStore와 동일 패턴, 자정에 자동 리셋). 1차=정확히 한도 도달(풀 다이얼로그 "TAKE YOUR PACE"+[5분추가][오늘은 여기까지]), 2차=+5분(완화 다이얼로그 "잠시 쉬어갈까요?"+[계속 보기][여기까지 보기]), 3차 이상=버튼 없이 2.2초 자동 소멸 토스트(4종 카피 순환). **접근성 처리**: `AccessibilityInfo.isScreenReaderEnabled()`로 스크린리더 켜져 있으면 자동소멸 안 하고 탭으로 닫게 전환 + `announceForAccessibility`로 즉시 음성 안내(WCAG 2.2.1 대응, 리서치 근거는 §4 참고) |
| Home "YouTube with PACE" 카드 차별화 | `components/home/PlatformPickerCard.tsx`(새 `features` prop), `app/(tabs)/home.tsx` | 카드 하단에 "🎧 Hands-Free"/"⏱ Focus Session" 작은 칩 추가(GUARDED 카드만) — "그냥 열기" 카드와 시각적 차별화 |
| AppHeader "PACE" 타이틀 정렬 수정 | `components/ui/AppHeader.tsx` | 매직넘버 `marginTop: -2`로 점(•)을 억지로 끌어올리던 방식 → `alignItems:'flex-end'` + `lineHeight` 통일로 실제 baseline 정렬(폰트별 흔들림 없앰) |
| "ACTIVE SESSION GUARD" → "TODAY'S USAGE" | `components/ui/AppHeader.tsx` | "감시/제재" 톤을 "오늘 사용량 담백 표시"로 — Digital Wellbeing 포지셔닝과 일치 |
| 오버레이 앱 아이콘-상태바 겹침 수정 | `app/overlay/index.tsx` | 근본 원인: `appIconBtn`이 `position:'absolute'`라 부모 SafeAreaView의 top padding이 적용 안 됨(절대 위치는 부모 padding 무시) → `useSafeAreaInsets()`로 `insets.top + spacing.sm`을 인라인 계산해서 실제 상태바 높이만큼 내림 |

**⚠️ 중대 갭 발견 및 수정(2026-07-23) — 3단계 시스템이 실제 시청 중엔 전혀 안 뜨고 있었음**:
사장님이 실기기에서 직접 한도 도달을 겪고 나서야 발견 — 위 3단계 시스템(`LimitReachedOverlay.tsx`)은
`activeSessionPlatform === null`(=홈 탭을 직접 보고 있을 때)에만 뜨는 조건이 걸려 있는데, Android의
실제 세션 흐름은 `PaceOverlayService.kt`(네이티브)가 자기 완결적으로 만료를 판단하고
`showBlockOverlay()`로 별도의 네이티브 다이얼로그를 띄운다(2026-07-19에 이미 그렇게 설계됨,
§4 원본 문서 참고) — 즉 **실제 시청 중 한도 도달 시 뜨는 건 JS의 "TAKE YOUR PACE"가 아니라
네이티브의 옛날 단일 문구("오늘의 한도에 도달했어요")였다.** 3단계 개편이 사실상 홈 화면에서만
유효하고, 정작 필요한 순간(실시청 중 차단)엔 적용이 안 되고 있던 것 — 사용자가 실기기 스크린샷으로
직접 지적해서 발견.

**수정**: `PaceOverlayService.kt`에 하루 스코프 `dailyLimitHitCount`/`dailyLimitOriginalMinutes`
(날짜 자정 리셋, `useLimitHitStore.ts`와 동일 개념을 네이티브에 이식)를 추가하고
`showBlockOverlay(reason, dailyLimitTier)`로 확장:
- **1차**: "TAKE YOUR PACE" / "{원래한도}분 시청 완료" / "계속 시청할 수도, 여기서 멈출 수도
  있습니다." / [5분 추가][오늘은 여기까지] — JS 카피 그대로.
- **2차**: "잠시 쉬어갈까요?" / "벌써 {(hitCount-1)×5}분이 지났습니다" / [계속 보기][여기까지 보기].
- **3차 이상**: 스펙 원문 "선택지 없이 1~3초 자동 소멸하는 담백한 안내만(차단 아님)"을 네이티브에서
  문자 그대로 구현 — `showBlockOverlay`를 아예 안 타고 `performTick`에서 조용히 `EXTEND_MINUTES`를
  더해 세션을 계속 진행시킨 뒤, 터치를 흡수하지 않는(`FLAG_NOT_TOUCHABLE`) 신규 `showTier3Toast()`로
  2.2초 안내만 띄운다 — 그 아래 YouTube는 토스트가 떠 있는 동안에도 정상 조작 가능(JS
  `pointerEvents='none'`과 동일 원칙). 4종 카피 순환도 JS `TIER3_MESSAGES`와 동일하게 이식,
  WCAG 2.2.1(스크린리더면 자동소멸 대신 탭으로 닫기 + 즉시 음성 안내)도 미러링.
- 프로세스가 죽었다 알람으로 되살아나는 기존 복구 경로(`restoreStateFromPrefs`)에도 히트카운트
  복원을 추가 — 안 하면 재시작마다 tier가 1로 리셋되는 재발 위험이 있었음.

**에뮬레이터 실측 검증(2026-07-23)**: 1분짜리 테스트 한도로 3번 연속 도달시켜 로그로 확인 —
`SESSION END reason=daily_limit_reached tier=1`, `tier=2`(문구 "잠시 쉬어갈까요?"의 "벌써 5분이
지났습니다" 정확히 일치), `DAILY LIMIT tier=3+ hitCount=3 usageMinutes=11 (non-blocking,
auto-extended)`. tier1/2는 JS `LimitReachedOverlay`(홈 화면 진입 시)로도 동일 데이터가 화면에
정확히 렌더되는 것까지 확인(우연히 세션이 다른 사유로 끝나 홈으로 튕겨나갈 때마다 이 경로를 탐).
tier3의 정확한 2.2초 창은 스크린샷 타이밍상 여러 시도에도 못 잡았으나, 로그의 정확한 데이터 값과
이미 다른 오버레이 종류(수면감지 블랙아웃 등)로 검증된 동일 WindowManager 렌더링 메커니즘 재사용을
근거로 code-review+로그 수준의 신뢰도로 간주.

---

## 3. 이미 이전 세션에서 해결/확인된 것 ✅(기존) — 재작업 불필요

| 항목 | 근거 |
|---|---|
| 자동재생 관련 문구 삭제 | `app/onboarding/index.tsx` 주석 자체가 "무기한 자동재생이 아니라 정해둔 시간만큼만 진행되고 스스로 멈춘다"로 이미 수정됐다고 기록. 실제 슬라이드 카피 확인(`translations.ts` slide2Subtitle: "Timed, Not Endless"/"무한정이 아니라 시간제한") — "자동" 단어 노출 없음 |
| 다크모드 전용(라이트모드 없음, 의도된 설계) | `app.json`의 `userInterfaceStyle: "dark"`로 OS Appearance API가 항상 'dark' 반환하도록 고정. 코드 전체에 `useColorScheme`/`Appearance.*` 참조 0건(라이트모드 분기 로직 자체가 없어 새는 곳도 없음). Android 네이티브 테마(`Theme.AppCompat.DayNight`→`NoActionBar`)도 이전 세션에서 이미 고정 완료(QA_ISSUES_2026-07-18 #14 관련) |
| 세로 화면 고정(가로 금지) | `app.json` 최상위 `"orientation": "portrait"` — 빌드 타임에 양쪽 플랫폼 다 적용됨 |
| Android 일반 유튜브 사용 측정 | 이번 세션 실기기 검증(`QA_ANDROID_LIFECYCLE_2026-07-22.md` #4) — Pace 프로세스가 살아있는 한(강제종료 안 한 상태) 유튜브를 Pace 안 거치고 직접 열어도 `PaceAccessibilityService`가 자동 감지해서 오버레이/집행이 정상 작동함을 실기기로 확인 |

---

## 4. 네이티브 작업 필요 — 웹 리서치 결과 + 스펙 (🔧 맥 세션 iOS / 신중한 후속 라운드로 Android)

### 4-A. PACE Flip Mode (내려놓은 시간 측정)

**결론: `expo-sensors`로는 불가능 — 양쪽 플랫폼 다 신규 네이티브 모듈 필요.**
`expo-sensors`의 Accelerometer/DeviceMotion 리스너는 Android 백그라운드에서 확인된 실패 사례가
있고([expo/expo#21960](https://github.com/expo/expo/issues/21960)), iOS는 OS 자체가 백그라운드
CoreMotion을 제한한다 — 래퍼 문제가 아니라 플랫폼 제약.

**Android(가능, 기존 패턴 재사용)**: `PaceOverlayService.kt`와 같은 포그라운드 `Service` +
`SensorManager`(`TYPE_ACCELEROMETER`/`TYPE_GRAVITY`, z축으로 뒤집힘 판별, z≈+9.8=위, z≈-9.8=아래).
화면 꺼짐/잠금 상태에서도 계속 작동(Android는 백그라운드 센서 제약이 iOS보다 훨씬 느슨—
[Android 공식 문서](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)).
`maxReportLatencyUs`로 배터리 소모 최소화 권장.

**iOS(제약 있음)**: `CMMotionManager`/`CMDeviceMotion.gravity.z`(0.7~1.0=뒤집힘,
[NSHipster](https://nshipster.com/cmdevicemotion/)) — 단, **앱이 백그라운드로 가면 CoreMotion
이벤트가 끊긴다**(Apple 개발자 포럼에서 재확인 필요 시점마다 재초기화해야 한다고 확인,
[포럼](https://developer.apple.com/forums/thread/126045)). 상용 실제 앱(FLIP, Flip Timer)은
근접/조도 센서를 쓰는 쪽도 있음. 백그라운드 유지를 위해선 이 코드베이스의 `pace-gesture` 모듈이
이미 쓰는 것과 같은 "무음 오디오 세션 유지" 트릭이 선례가 있지만(App Store 정책상 회색지대),
정직한 설계는 "포그라운드/화면 켜진 상태에서만 인정, 짧은 재확인 윈도우"로 제한하는 것.

**임계값 권장(상용 앱 공개값 없음, 리서치 기반 합리적 기본값)**: 뒤집힘 유지 2~5초 후 타이머 시작
(손떨림/충격 오탐 방지), 집어들기는 ~1초 유지 후 정지. 저역통과 필터로 단일 샘플 흔들림 무시.

**작업 규모**: Android 신규 네이티브 모듈(Service+SensorManager) + iOS 신규 Swift 모듈
(CMMotionManager, 백그라운드 제약 문서화된 UX로 설계) + JS 스토어(타이머/크레딧 적립, Stats 반영).

**✅ iOS 구현 완료(2026-07-23, 맥 세션)** — Android 몫은 co-session이 후속 라운드로:
- **`modules/pace-flip/`**(신규 Expo 로컬 모듈, `apple` 전용): `PaceFlipModule.swift`가
  `CMMotionManager.deviceMotion`(5Hz)로 `gravity.z` 관찰 → **face-down = z>0.8, face-up = z<0.5**.
  단일 `candidateSince` 상태머신 + 디바운스(**엎어놓기 2s / 집어들기 1s** 유지 확정, 위 임계값 권장대로)로
  손떨림/이동 오탐 차단. `onFlip {faceDown}` 이벤트 + `isFaceDown()` 즉시조회. `pod install`로 자동링크
  확인(Podfile.lock에 `PaceFlip 1.0.0` 등재).
- **`src/store/useFlipStore.ts`**: 날짜 스코프(useDailyBonusStore 패턴, 자정 자동리셋) — face-down에
  타이머 시작, face-up에 경과 누적(`putDownSeconds`) + **크레딧 적립(쉬는시간 1분당 1, §1-A "쉬는 시간에
  따른 집중 모드 보상")**, AsyncStorage 영속.
- **`src/hooks/useFlipMode.ios.ts`**(iOS) / `.ts`(no-op): PaceFlip → 스토어 배선.
  `requireNativeModule`로 직접 로드(볼륨키/제스처 훅과 동일 — 상대경로 require Metro 미해석 회피).
- **배선**: `src/app/_layout.tsx`에서 `useFlipMode({ enabled: true })` 전역 계측. **Stats 반영**:
  `app/(tabs)/stats.tsx`에 "쉬는 시간" 카드(오늘 내려놓은 시간 + 적립 크레딧, iOS 전용 노출) 추가.

**🔬 추가 웹리서치(2026-07-23) + 비정상 케이스 보강** — "정상만 되고 비정상은?" 지적 반영:
- **권한 재확인**([Apple DTS 포럼](https://developer.apple.com/forums/thread/762886)): raw `CMMotionManager`
  `deviceMotion`(gravity)은 **`NSMotionUsageDescription` 불필요·프롬프트 없음·미기재해도 크래시 안 함**
  (권한 필요한 건 `CMMotionActivityManager`/`CMPedometer`/`CMSensorRecorder` 등). 즉 우리 모듈은 권한
  크래시 위험 없음. 단 DTS가 미래 대비 문자열 권장 → `app.json ios.infoPlist`에 `NSMotionUsageDescription`
  추가(무해).
- **핵심 비정상 케이스 — background 브리징**: iOS는 폰을 엎으면 화면을 끄고 앱이 background로 가
  **CoreMotion이 멈춘다**([forums/126045](https://developer.apple.com/forums/thread/126045)). 초기 구현은
  background 진입 시 즉시 정산해 "화면 꺼진 채 엎어둔 진짜 쉬는 시간"이 ~0으로 측정되는 버그가 있었다.
  → **수정**: background에선 정산하지 않고 `flipStartMs`만 유지(스토어가 AsyncStorage 영속), foreground
  복귀 시 `physicalFaceDown()`(디바운스 없는 즉시 판정, Swift에 신규 추가)으로 재조율 —
  이미 집어들었으면 그 사이 경과 **전체를 정산**(background 구간을 타임스탬프로 브리징, CoreMotion 없이도).
- **앱 강제종료(OOM/스와이프) 복구**: 진행 중 `flipStartMs`를 영속 → 다음 콜드스타트(=앱을 다시 열었으니
  face-up)에서 `load()`가 정산. background에 오래 있다 iOS가 앱을 죽여도 쉼이 유실되지 않음.
- **방치/밤샘 오검 상한**: 한 번의 쉼 정산 경과에 `MAX_REST_SECONDS`(4h) 상한 — "엎어둔 채 잊음/주머니
  방치"가 비현실적 크레딧으로 잡히는 것 방지.
- **재진입/중복 보호**: 스토어 `onFaceDown` 재진입 가드(복귀 후 네이티브가 다시 face-down 확정해도
  `flipStartMs` 보존), Swift `start()` 중복 호출 시 기존 관찰 정리(`isDeviceMotionActive` 가드).
- **`inactive` 무시**: 알림 배너/제어센터 일시상태에선 쉼 세션을 조각내지 않음(곧 active 복귀).
- ⚠️ **여전한 한계(정직 고지)**: ① 시뮬레이터엔 모션 센서가 없어 face-down 감지 **동작 자체**는 실기기
  검증 필수. ② background 중 "집어들었다 다시 엎기"처럼 앱이 못 본 전이는 원리상 관측 불가 → 복귀 시점의
  상태로 근사(상한으로 방어). ③ 진짜 백그라운드 상시 측정은 무음 오디오 세션 트릭이 필요하나 App Store
  회색지대라 채택 안 함(정직한 포그라운드/복귀-브리징 설계 유지).

**✅ Android 구현 완료(2026-07-23)** — iOS와 동일한 `PaceFlip` 인터페이스(`start`/`stop`/
`isFaceDown`/`onFlip`)로 구현, JS 레이어(`useFlipMode.ts`, `useFlipStore.ts`, Stats 카드)는
**완전히 공용화**(플랫폼 분기 전부 제거) — iOS 전용이던 `useFlipMode.ios.ts`는 삭제하고 로직을
공용 `useFlipMode.ts`로 병합, `stats.tsx`의 `Platform.OS === 'ios'` 카드 게이트도 제거:
- **`modules/pace-flip/android/`**(신규 Expo 로컬 모듈): `PaceFlipModule.kt`가 `SensorManager`의
  `TYPE_GRAVITY`를 관찰. **Android는 iOS와 z축 부호가 반대** — face-down일 때 z ≈ **-9.8**
  (테이블 반작용력 관례, face-up이 iOS와 반대로 양수) — 물리적으로 같은 현상을 각 플랫폼이 반대
  부호로 표현할 뿐. 임계값은 iOS의 ±0.8/±0.5(정규화 g 단위)를
  `SensorManager.STANDARD_GRAVITY`(9.80665) 배율로 환산(-7.85/+4.90 m/s²), 디바운스도 동일(엎어놓기
  2s/집어들기 1s).
- **오탐 완화 리서치 반영(웹 리서치, 2026-07-23)**: gravity.z 임계값만 쓰면 차량 대시보드(진동+코너링
  힘), 주머니 속, 비스듬한 거치대에서 오탐 위험이 있음이 드라이빙감지/낙상감지 업계 공통 지적
  ([Damoov](https://damoov.com/how-your-smartphone-understands-driving/), [낙상감지 특허 문헌](https://patents.justia.com/patent/9638711))
  — 표준 완화책인 "선형가속도 크기가 거의 0"(기기가 실제로 거의 안 움직이는 중) 게이트를 추가:
  `TYPE_LINEAR_ACCELERATION` 크기가 1.2 m/s² 이하일 때만 tilt 후보를 인정, iOS 대비 오탐에 더
  강건함(이 게이트는 iOS 쪽엔 없음 — 향후 라운드에서 iOS에도 이식 고려 가능).
- **백그라운드 신뢰성 리서치 확인**: Doze 모드 공식 제약 목록(네트워크/WakeLock/알람/JobScheduler)에
  SensorManager 리스너는 포함 안 됨 — 포그라운드 서비스 안에서라면 센서 전달 자체는 계속됨이 확인됨
  ([Doze/Standby 공식 문서](https://developer.android.com/training/monitoring-device-state/doze-standby)).
  다만 이번 라운드는 **iOS와 동일하게 포그라운드 전용으로 의도적으로 통일**했다(§4-A 상단 이유 —
  플랫폼 간 체감 차이 방지 + 새 상시 포그라운드서비스/알림 신설 회피) — Android가 기술적으로는 더
  느슨한 백그라운드 동작이 가능하지만 다음 라운드 후보로 남김.
- **배칭**: `registerListener`에 `maxReportLatencyUs=200ms` 지정 — 1~2초 디바운스 창보다 충분히
  짧게 잡아 배터리 절약 배칭이 반응성을 해치지 않게 함(리서치 권고 그대로 적용).
- **권한**: `TYPE_GRAVITY`/`TYPE_LINEAR_ACCELERATION`은 런타임 권한도 매니페스트 선언도 불필요
  확인(`BODY_SENSORS`는 심박수 등 생체 센서 전용, 무관) — Play 스토어 "건강 앱" 선언 대상도 아님
  (핵심 기능이 수면/건강 추적이 아니라 세션 부가기능이라 해당 정책 범위 밖으로 확인).
- **빌드 검증**: `expo prebuild --clean` + `gradlew assembleDebug` 성공, 에뮬레이터/실기기 설치 완료.

**✅ 동작 검증 완료(2026-07-23, 에뮬레이터 가속도계 시뮬레이션)**: `adb emu sensor set acceleration
0:0:-9.8`(face-down)/`0:0:9.8`(face-up)로 실제 중력 방향을 주입해 전체 경로를 검증:
- `[flip] 📵 엎어놓음(쉬는시간 시작)` 로그 확인(2s 디바운스 후 정상 발동, 선형가속도 게이트도
  가짜 정지 상태를 문제없이 통과).
- 약 140초 뒤 face-up 주입 → `[flip] 📲 집어듦(정산)` 로그 확인.
- **Insights 탭 UI로 최종 확인**: "Face-down today: **2m 20s**"(실제 경과와 정확히 일치),
  "Credits earned: **2**"(`floor(140/60)=2`, 크레딧 계산식 정확). iOS 전용이던 카드 게이트를
  제거한 게 제대로 반영돼 Android에서도 카드가 노출됨을 실증.
- 이걸로 §1-A "쉬는 시간에 따른 집중 모드 보상"까지 포함해 Flip Mode 전체 파이프라인이
  Android에서 코드 리뷰 수준이 아니라 실측으로 검증됨.

### 4-B. 수면 감지 강제 종료 파이프라인

**신호 우선순위 재검토 권장**: 사용자 스펙의 "무진동 3분"은 실제 수면감지 앱(Sleep as Android는
15분 주기 재확인, Sleep Cycle은 마이크+가속도 병행 — 순수 무진동만으로 "잠들었다" 판단은
오탐 위험 높다고 두 서비스 다 명시)보다 훨씬 공격적. **8~12분으로 완화 권장**, 블루투스 이어폰
탈착(`ACTION_ACL_DISCONNECTED` Android / `AVAudioSession.routeChangeNotification`
`.oldDeviceUnavailable` iOS)은 "보조 신호"(타이머를 단축)로만 쓰고 단독 트리거로는 안 씀(통화하러
잠깐 빼는 경우와 구분 안 됨).

**화면 암전/밝기 관련 중요한 플랫폼 비대칭**:
- Android `WindowManager.LayoutParams.screenBrightness`는 **앱 자신의 윈도우에만** 적용(시스템
  전체 밝기가 아님) — 사용자 스펙이 원하는 "시스템 자체 슬립 진입"은 결국 검은 화면 렌더 + OS
  자체 타임아웃에 맡기는 것과 동일(이미 스펙에 명시된 대로라 문제 없음).
- **iOS는 더 제한적**: `UIScreen.main.brightness`는 설정 가능하지만 Apple이 "OS가 임의 시점에
  원래 밝기로 되돌린다"고 공식 문서에 명시([Apple 개발자 포럼](https://developer.apple.com/forums/thread/79998)),
  잠금 전까지만 유지됨 — 밝기 0% 지정은 "최선 노력"일 뿐 시스템 슬립 보장이 아님. WebView 파괴 +
  검은 화면 렌더가 실질적으로 신뢰 가능한 부분.
- WebView/오디오 세션 종료 자체는 두 플랫폼 다 평이한 작업(단, `PaceOverlayService.kt`의
  MediaSession/AudioFocus도 같이 정리해야 오디오 덕킹이 낀 채로 안 남음).

**작업 규모**: 모션-정지 감지 native primitive는 4-A(Flip Mode)와 공유 가능(같은 "기기가 움직이는지"
센서 watcher). 블루투스 탈착 리스너는 상대적으로 가벼움(`modules/pace-overlay`(Android)/
`pace-gesture` 인근(iOS)에 추가). 화면 암전/WebView 파괴/DB 기록은 순수 JS 작업.

**✅ Android 구현 완료(2026-07-23 밤, 사용자 지시 "밤새 예외 케이스 포함해서 전수 다 확인" 반영)**
— 기존 카운트다운 만료 파이프라인(`PaceOverlayService.performTick()` → `markExpired()` →
`showBlockOverlay()` → JS `consumeExpired()` → `endSessionRow()`, 이미 Doze/kill 복구까지 하드닝돼
있던 경로)을 그대로 재사용해 새 사유 `"sleep_detected"` 하나만 추가하는 방식으로 구현 — 3단계
파이프라인을 처음부터 새로 만들 필요가 없었다:

- **신호(무진동 감지)**: `registerStillnessSensor()`가 `TYPE_LINEAR_ACCELERATION`(중력 성분 제거된
  값 — 기기가 누워있든 세워있든 방향 무관하게 순수 움직임만 잡음, Flip Mode의 orientation 게이트와
  다른 이유로 이 센서를 선택) 크기를 감시, 매 순간 `lastMotionAtMs`를 갱신. `performTick()`(기존
  60초 주기, AlarmManager 기반이라 Doze 중에도 이미 깨어남이 검증된 인프라)이 매 틱마다
  `now - lastMotionAtMs`를 검사 — 이 값이 `SLEEP_STILLNESS_MS`(**10분**, 리서치 권장대로 3분에서
  완화) 이상이면 수면 감지로 판단. 프로세스가 죽었다 알람으로 되살아나도 `lastMotionAtMs`를
  SharedPreferences에 영속해 시계가 리셋되지 않게 함(기존 `persistState()`/`restoreStateFromPrefs()`
  패턴 그대로 확장).
- **블루투스 탈착(보조 신호)**: 매 틱마다 `getConnectedBluetoothAudioDevice()`(기존 Bluetooth
  Hands-Free 코드가 이미 갖고 있던 함수)로 연결 상태를 확인 — 이번 세션 동안 연결→해제 전환이
  감지되면 `btDisconnectedDuringStillness=true`로 표시해 임계값을 `SLEEP_STILLNESS_SHORT_MS`
  (**6분**)로 단축. 스펙이 명시한 "단독 트리거로는 안 씀"을 정확히 구현: 탈착 자체는 아무것도
  트리거하지 않고, 그 뒤로도 여전히 무진동이 이어질 때만(짧아진 시간만큼) 발동 — 통화하러 잠깐 뺐다
  바로 다시 움직이면 이 분기를 타지 않는다.
- **① 즉시 종료**: 수면감지 사유일 땐 `hardBlockMode`(옵트인 설정) 여부와 무관하게 항상
  `PaceAccessibilityService.goHome()` 호출 — "자는 사람 앞에 유튜브를 계속 틀어두는" 건 다른
  사유(Daily Limit의 소프트 차단)와 달리 이 기능의 존재 이유 자체를 무력화하므로 옵트아웃 대상이
  아니라고 판단.
- **② 화면 암전**: `showBlockOverlay()`에 `sleep_detected` 전용 분기 신설 — 다른 두 사유(Daily
  Limit/Sleep Timer)의 "+5분/휴식하기" 버튼이 있는 밝은 다이얼로그 대신, **텍스트/버튼 없는 순수
  검은 풀스크린**(`PixelFormat.OPAQUE`)만 그린다. 동시에 `PaceAccessibilityService.lockScreen()`
  (신규) — `GLOBAL_ACTION_LOCK_SCREEN`(API 28+)으로 **실제 화면 잠금**을 시도한다. 이 지점은 Android가
  iOS보다 확실한 구현이 가능한 드문 경우 — iOS의 `UIScreen.main.brightness`는 위에서 문서화했듯
  "OS가 임의 시점에 되돌리는" 최선노력일 뿐이지만, `GLOBAL_ACTION_LOCK_SCREEN`은 접근성 서비스가
  실제로 화면을 끄고 잠글 수 있는 표준 API. API<28이거나 접근성이 꺼져있으면 위 검은 풀스크린이
  안전한 폴백.
- **③ DB 기록**: 새 `SessionEndStatus` 값 `'sleep_detected'`(`types/models.ts`) 하나 추가 — 기존
  `markExpired(reason)` → JS `consumeExpired()` → `endSessionRow(...)` 경로가 그대로 이 값을 실어
  나른다(신규 배선 불필요, 기존 인프라가 사유 문자열에 무관심하게 설계돼 있었음). **"새벽 1시 23분에
  잠드셨습니다" 인사이트**: `sessionsRepository.getLatestSleepDetectedSession()`(신규) +
  `useSleepInsightStore`(신규, AsyncStorage로 세션 id dedupe — 같은 세션을 반복해서 안 보여줌) +
  Home 화면 상단 배너(🌙 아이콘, 탭으로 닫기). `useFocusEffect`로 홈 화면에 돌아올 때마다 조회 —
  "밤새 켜둔 채 잠들었다가 아침에 앱을 여는" 시나리오에 맞음.
- **알림 억제**: 수면감지는 `notifyLimit` 알림을 안 보낸다(다른 두 사유와 차이) — 자고 있는데
  알림음/진동으로 깨우는 건 명백한 모순이고, 어차피 화면을 잠그므로 알림을 봐도 소용없음.
- **재개 경로 방어**: `extendFromBlockOverlay()`("+5분" 버튼, 다른 두 사유 전용)가 방어적으로
  `lastMotionAtMs`를 리셋 + 센서 재등록 — sleep_detected 화면엔 이 버튼 자체가 없지만, 혹시 모를
  경로로 재개되더라도 다음 틱에서 곧바로 재만료되는 무한루프를 방지.
- **임계값**: `STILLNESS_WAKE_EPSILON=1.0f`(m/s², Flip Mode의 1.2보다 약간 엄격 — 여긴 "완전히
  멈췄다"가 목적), 배칭 지연 5초(분 단위 판정이라 초 단위 정밀도 불필요, 배터리 우선).
**✅ 에뮬레이터 E2E 검증 완료(2026-07-23)**: 사용자가 취침 중이라 실기기 물리 검증은 못 했지만,
`pace_test` 에뮬레이터에서 임계값만 임시로 90초/45초로 낮춘 별도 테스트 빌드로 전체 파이프라인을
실제로 재현·확인함(검증 후 10분/6분 프로덕션 값으로 원복, 최종 빌드에는 테스트 값 없음):
- 로그로 확인: `SESSION END reason=sleep_detected stillnessElapsedMs=105227 thresholdMs=90000` —
  무진동 감지·틱 체크·사유 판정 전부 설계대로 동작.
- `dumpsys power`로 확인: `mWakefulness=Asleep` — `GLOBAL_ACTION_LOCK_SCREEN`이 실제로 화면을
  잠갔음(에뮬레이터에서도 재현되는 진짜 동작, 시뮬레이션이 아님).
- 화면 캡처로 확인: 순수 검은 풀스크린(텍스트/버튼 없음) 렌더 확인.
- 잠금 해제 후 Home 화면에서 **"🌙 저녁 6시 5분에 잠드셨습니다"** 배너가 정확한 시각으로 실제
  렌더됨 — DB 기록(`endSessionRow(..., 'sleep_detected')`) → `getLatestSleepDetectedSession()` →
  `useSleepInsightStore` → 배너까지 전체 JS 경로 실동작 확인.
- **검증 중 발견해 고친 버그**: 초기 구현은 `sleep_detected` 블랙아웃 화면에 탈출 수단이 전혀
  없었다(버튼 없음 + 터치 통과 금지) — 사용자가 스스로 깨서 폰을 다시 쓰려 해도 강제종료 외엔 벗어날
  방법이 없는 진짜 UX 버그. 검은 화면 아무 곳이나 탭하면 조용히 닫히도록(`endFromBlockOverlay()`,
  다른 두 사유의 "휴식하기"와 동일 동작이지만 텍스트 버튼 없이) 수정.
- **검증 중 발견한 별개 이슈(수면감지와 무관, 테스트 방법론 이슈)**: 에뮬레이터의 유튜브 앱이
  자체 "업데이트 필요" 무한 루프 화면을 갖고 있어(Play 스토어 없는 에뮬레이터 환경 한정 문제, 기존
  QA 문서에 이미 기록된 한계) 세션 시작 시 Pace 앱이 포그라운드 포커스를 잃어 `/overlay` 화면의
  `overlayService.startSession()` 마운트 효과가 실행되지 못하는 경우가 있었다 — 실제 기기에서는
  발생하지 않음(정상 유튜브가 이 나그 화면을 안 띄우므로). 에뮬레이터 검증 시에만 유튜브/크롬을
  임시로 비활성화해 우회.

**🔧 iOS 몫(맥 세션 후속 라운드)**: 위 Android 구현과 동일한 계약으로 미러링 필요 —
1. 모션-정지 감지: `CMMotionManager.deviceMotion`의 `userAcceleration`(중력 제거된 값, Android의
   `TYPE_LINEAR_ACCELERATION`과 동일 개념) 크기를 감시하는 별도 관찰자를 `pace-gesture` 또는 신규
   모듈에 추가(Flip Mode의 `gravity` 관찰과는 별개 — orientation이 아니라 순수 움직임 감지이므로
   같은 `CMMotionManager` 인스턴스를 공유하되 콜백 로직만 다르게).
2. 블루투스 탈착: `AVAudioSession.routeChangeNotification`의 `.oldDeviceUnavailable` — 보조 신호로만.
3. 화면 암전: iOS는 Android의 `GLOBAL_ACTION_LOCK_SCREEN`에 해당하는 API가 없음(사용자 동의 없이
   기기를 잠글 방법이 OS 정책상 없음) — `UIScreen.main.brightness=0` + 인앱 화면을 검은색으로
   렌더하는 최선노력 접근으로 타협 필요(위 §4-B 원 리서치에 이미 문서화됨).
4. DB 기록/인사이트 배너는 JS 레이어라 이미 공용(`SessionEndStatus.sleep_detected`,
   `useSleepInsightStore`, Home 배너) — iOS 쪽 트리거만 새로 연결하면 그대로 재사용 가능.

### 4-C. 핑거 스냅 ("재미삼아") — 이미 있는 구현 검증만 남음

기존 감사 결과(`QA_ANDROID_LIFECYCLE_2026-07-22.md` Bluetooth 섹션 B30 참고): `PaceSnapDetector.kt`
(Android)가 이미 존재하고 450ms REFRACTORY_MS 디바운스까지 구현돼 있음 — **이건 새로 만들 게
아니라 실기기에서 스냅 인식 민감도/오탐률만 재검증하면 됨**. iOS `PaceGestureModule.swift`도
존재(ARKit 고개끄덕임 + 스냅 감지) — 다만 앞선 맥 세션 리뷰(`QA_FULL_REVIEW_2026-07-22.md` C항목)가
"스냅 오디오세션이 WebView 재생 오디오랑 충돌 가능성 있어 신중한 실기기 테스트 필요"라고 이미
경고해뒀음. **다음 실기기 라운드에서 두 플랫폼 다 정밀도만 확인 — 이번 세션에선 코드 추가 안 함**
(오디오 세션 잘못 건드리면 재생 자체가 깨질 위험, 맥 세션 경고 존중).

### 4-D. iOS Shortcuts(단축어) 연동 — "One Sec 방식" 일반 앱 사용시간 추적

**메커니즘 확인됨**: iOS Shortcuts 앱의 "오토메이션(Automation)" 탭 → "앱" 트리거 → "열림/닫힘"
선택 → 앱 자체 URL 스킴(`pace://`, 이미 `app.json`에 `"scheme": "pace"` 정의돼 있어 그대로 재사용
가능) 딥링크로 신호 전달. Apple 공식 문서 확인: "앱" 타입 오토메이션은 "실행 전 확인(Ask Before
Running)"과 "실행 시 알림(Notify When Run)" 둘 다 끌 수 있어 완전 무음 실행 가능(One Sec도 이
방식으로 안내).

**알려진 함정(실제 개발자 사례 확인)**: 가로챈 앱으로 다시 딥링크 돼돌아가는 설계를 하면
"열림→가로채기→다시 열기→다시 열림 감지" 무한루프에 빠진 사례가 실제로 보고됨
([dev.to 사례](https://dev.to/eliguzz/building-an-open-source-one-sec-alternative-breaking-the-shortcuts-infinite-loop-thanks-to-ios-26-ka4)).
Pace는 "가로채서 되돌리기"가 아니라 "열림/닫힘 시각만 기록"하는 설계라 이 루프 위험은 낮지만,
설계 시 명시적으로 피해야 함.

**사용자 설정 마찰(One Sec 자체 튜토리얼 기준 7단계)**: Shortcuts 앱 열기 → 오토메이션 탭 → 개인
오토메이션 생성 → "앱" 트리거 선택 → 대상 앱 지정 → "즉시 실행" 설정 → 액션에서 Pace 단축어
검색 → **액션 안에서 대상 앱을 한 번 더 지정**(이 마지막 단계를 빠뜨리는 게 제일 흔한 실패 원인,
One Sec가 자기 튜토리얼에서 강조). **→ 이게 바로 사장님이 요청한 "이미지 가이드 페이지"가 왜
필수인지의 근거** — 텍스트 설명만으로는 부족, 앱마다(유튜브/인스타/틱톡) 별도 오토메이션이
필요해서 가이드도 앱별로 3세트 필요.

**작업 규모**: (1) Pace 쪽 딥링크 핸들러(`pace://usage-event?app=youtube&state=opened` 형태,
expo-router가 scheme을 자동으로 라우팅 처리 — 별도 파싱 불필요, JS 작업), (2) 오픈↔클로즈 사이
경과시간 누적 로직(JS 작업), (3) **이미지 가이드 페이지**(1-D-3과 동일 항목, 앱별 7단계
스크린샷). **딥링크 핸들러+누적 로직은 JS만으로 가능해서 다음 라운드에 구현 가능** — 네이티브
필요 없음. 가이드 페이지 이미지는 실제 iOS 기기에서 Shortcuts 앱 스크린샷을 찍어야 해서(맥 세션
쪽 실기기 필요) 이번 세션엔 스켈레톤 텍스트만 별도 준비 가능.

### 4-E. Android 오버레이 불투명도/노출시간 조절

`PaceOverlayService.kt`(네이티브 Kotlin)이 실제 오버레이 뷰(불투명도/크기)를 그리는 코드 — JS에서
직접 조절 불가. 네이티브 파라미터화(예: 설정값을 오버레이 서비스에 전달해서 alpha 값 조정)가
필요. **이번 세션엔 미구현**(네이티브 빌드 필요) — 다음 라운드 후보.

### 4-F. iOS 웹뷰에 "시간 상태바" — ✅ 구현 완료(2026-07-23, 맥 세션 iOS)

iOS는 현재 `/feed`(인앱 WebView)로 라우팅(2026-07-22 App Review 대응, home.tsx 참고) — 이 WebView
화면 안에 남은시간 표시줄을 얹는 건 **순수 JS/RN 오버레이 View 작업**(네이티브 불필요, 이미 화면이
Pace 자신의 React 트리 안에 있으므로).

**구현**(`app/feed/index.tsx`): 상단 중앙에 반투명 필 형태의 시간 상태바 추가.
- **벽시계**(`HH:MM`, 24h) — 30초 간격 `setInterval` 갱신. 몰입형 웹뷰에서 잃기 쉬운 시간 감각 유지.
- **세션 남은시간** — `useTimerStore.remainingMinutes`를 세션 활성(`isSessionActive`) 시에만 병기.
  남은 ≤5분이면 경고색(`colors.warning`)으로 전환(Android 오버레이 저시간 경고와 톤 일치).
- `pointerEvents="none"`으로 WebView 재생 탭을 가리지 않음(중앙 spacer none 처리와 동일 컨벤션).
- 검증: 시뮬레이터(iPhone 17)에서 벽시계/남은시간 렌더 확인. 순수 JS라 실기기 불필요.

### 4-G. 블루투스 볼륨 기반 "다음" 시나리오 — ✅ 코드는 완료, 실사용 범위 좁음(2026-07-23)

**결정**: 사장님 확정 지시("블루투스는 볼륨받아서 다음재생으로 넘기기로 했잖아") — Android도 iOS
`PaceVolumeKeyModule.swift`와 동일하게 물리 볼륨 버튼을 다음-넘김 대리 신호로 채택. 실제 영상 볼륨은
안 바뀌게 이벤트 자체를 소비(consume)하는 방식이라 위에서 우려했던 "영상 소리도 같이 바뀌는 부작용"은
발생하지 않음(아래 구현 참고).

**구현**:
- `modules/pace-overlay/android/src/main/res/xml/accessibility_service_config.xml` —
  `android:accessibilityFlags`에 `flagRequestFilterKeyEvents` 추가(시스템 전역 하드웨어 키 이벤트를
  받으려면 필수 — `packageNames` 필터는 `AccessibilityEvent`에만 적용되고 `onKeyEvent`는 이 필터와
  무관하게 항상 전역으로 들어옴).
- `PaceAccessibilityService.kt` — `onKeyEvent(event: KeyEvent): Boolean` 오버라이드 신규 추가.
  `KEYCODE_VOLUME_UP`/`DOWN`의 `ACTION_DOWN`만 처리(방향 구분 없이 둘 다 "다음"), 기존
  `performSwipeUp()`(스와이프 스와이프 로직 재사용, 새 스와이프 코드 없음) 호출, 500ms 불응 구간으로
  길게 누름 시 중복 트리거 방지. `return true`로 이벤트를 소비해 시스템 볼륨 자체는 변하지 않음(iOS
  구현의 "볼륨을 baseline으로 조용히 되돌리는" 효과와 동일한 결과, 다른 메커니즘으로 달성).

**⚠️ Play 스토어 심사 리스크 — 사장님 지적(2026-07-23) 반영**: "수면감지를 위해 쓴다는거였잖아
심사통과는" — 이 접근성 서비스의 스토어 심사용 명분은 §1-B 수면 감지 하나였는데, 같은 서비스로
볼륨키까지 가로채면 심사관 입장에서 서비스 목적이 여러 개로 보여 "접근성 목적이 아닌 남용"으로 리젝될
위험이 커짐(기존 Auto Next 스와이프와 동일 부류 리스크, `PaceAccessibilityService.kt` 20번째 줄
주석 참고). **완화**: 볼륨키 넘김은 새 게이트를 따로 만들지 않고 기존 `isWatching` 상태에 얹었다 —
이 값은 `PaceOverlayService.setAutoMode(true)`를 거쳐야만 true가 되고, 그 함수는 이미 2026-07-21에
감사된 단일 진입점 `isBuildAutoNextEnabled()`로 게이팅돼 있어(모든 호출 경로 — JS/알약 탭/블루투스
리모컨 — 를 커버) `EXPO_PUBLIC_ENABLE_AUTO_NEXT=false`인 실제 스토어 제출 빌드에서는 볼륨키
하이재킹도 자동으로 비활성. 즉 **스토어 제출 빌드는 접근성 서비스를 수면감지 용도로만 정직하게
쓸 수 있고, 볼륨키/Auto Next는 별도 직접배포(APK) 빌드에서만 켜지는 구조를 그대로 유지**.

**⚠️ 실제 볼륨 조절 회귀 — 사용자 지적(2026-07-23) 반영**: "사용자가 실제 볼륨을 올리거나 내리고
싶을 땐?" — 최초 구현은 감시 대상 앱이 포그라운드면 폰 자체 물리 볼륨 버튼까지 전부 삼켜서, 세션
중엔 진짜 음량 조절 수단이 없어지는 회귀였다. **수정**: `InputDevice.getDevice(event.deviceId).
isExternal()`로 이벤트를 낸 입력 장치가 폰 내장 버튼인지 외부(블루투스) 장치인지 구분해서, 외부
장치에서 온 볼륨 이벤트만 다음넘김으로 소비하고 폰 자체 볼륨 버튼은 항상 `false`를 반환해 평소처럼
실제 음량을 조절하게 통과시킨다. Android가 블루투스 HID 입력 장치를 항상 `isExternal()==true`로
구분해주는 표준 동작을 이용(내장 볼륨 로커/gpio 버튼은 `isExternal()==false`).

**검증**: `npx expo prebuild --platform android --clean` + `gradlew assembleDebug` 성공, `pace_test`
에뮬레이터 및 실기기(갤럭시 노트20) 둘 다 설치. 실기기에서 실제 세션("SESSION ON") 중 폰 자체 볼륨
버튼 테스트 — 실제 음량 4→3 정상 변경, `onKeyEvent` 스킵 로그 없음(위 회귀 수정 확인 완료).

**⚠️ 실사용 범위 재검토 — 실기기 라이브 테스트 결과(2026-07-23)**: 실제 에어팟 프로를 연결해
스템을 눌러본 결과, **주류 이어폰으로는 이 기능이 사실상 동작하지 않음이 확인됨**:
- 스템 더블프레스(스킵) → AVRCP 미디어 명령으로 유튜브에 전달되지만(오디오 포커스 보유 앱),
  유튜브가 이를 구현 안 해뒀는지 실제 영상이 전혀 안 넘어감(같은 영상 유지, logcat에도 관련 반응 없음)
  — B22가 실기기로 재확인됨.
- 볼륨 관련 조작 시 `AvrcpVolumeManager: notifyVolumeChanged` 로그가 찍혔는데, 이건 우리가 가로채는
  `KeyEvent`(`KEYCODE_VOLUME_UP/DOWN`)가 아니라 **AVRCP 절대볼륨(Absolute Volume)** 프로토콜 —
  블루투스 스택이 `AudioService`에 볼륨 값을 직접 반영하는 별도 경로라 `onKeyEvent()`가 절대 못 봄.
  같은 시점 `PaceAccessibility` 로그 없음으로 확인.
- 즉 `onKeyEvent()`로 잡을 수 있는 건 **AVRCP 절대볼륨을 지원하지 않고 구식 relative-volume(HID
  키 릴레이) 방식만 쓰는 소수 기기**(일부 유선 리모컨/구형 넥밴드 등)뿐 — 에어팟/갤럭시버즈 등
  대다수 사용자가 실제 쓰는 이어폰은 전부 절대볼륨을 지원해서 대상이 안 됨.

**결론(사장님 확인, 2026-07-23)**: "블루투스 리모컨으로 다음넘김"은 대다수 사용자에게는 낼 수 없는
기능으로 최종 확인됨. 코드는 그대로 남겨두되(좁은 예외 기기에서는 여전히 동작, 스토어 심사
리스크도 이미 격리돼 있어 남겨둬도 무해) **일반적인 "다음넘김" 수단은 기존 화면 스와이프 기반
Auto Next 자동감지(Tier 1/2, 이미 구현됨) 하나로 간다** — 별도 후속 작업 없음, 이 항목 종결.

---

## 5. 아직 반영 안 한 항목 (다음 라운드 후보, 우선순위 필요)

- 가이드 페이지(단축어/접근성/뒤집어놓기 설정, 이미지 포함) — 스켈레톤 구조는 JS로 가능, 스크린샷은 실기기 필요
- Flip Mode UI/Stats 반영(네이티브 트리거 완성 후)
- 수면 감지 UI(네이티브 트리거 완성 후)
- Android 오버레이 불투명도 조절(네이티브)
- 서버 연동(구독/사용자 정보) — `QA_ANDROID_LIFECYCLE_2026-07-22.md`/`QA_FULL_REVIEW_2026-07-22.md`에
  이미 최우선 블로커로 기록됨(백엔드 미배포, RC 키 없음) — 중복 집계 방지, 그쪽 문서가 최신 소스

---

## 6. OTA(무선 업데이트) + 강제 푸쉬 — ✅ 구현 완료

**리서치 근거**: [EAS Update 공식 문서](https://docs.expo.dev/eas-update/getting-started/),
[expo-updates SDK 레퍼런스](https://docs.expo.dev/versions/latest/sdk/updates/). 기본값
(`checkAutomatically: ON_LOAD`)은 앱이 백그라운드에서 조용히 업데이트를 받아 **다음 콜드스타트**
때만 반영한다 — 지금 세션은 계속 구버전으로 남는다. "강제 푸쉬"의 의미(받으면 즉시 반영)에 안
맞아서 `NEVER`로 자동 체크를 끄고 직접 제어하는 방식을 택함.

**한 것**:
1. `eas init --non-interactive`로 EAS 프로젝트 생성/연결 — `@strides7/Pace`
   (`https://expo.dev/accounts/strides7/projects/Pace`), projectId
   `6d080d0f-1fc1-4241-a4ca-97c5c79d8656`. `eas whoami`로 이미 `strides7`/`comfortstride7@gmail.com`
   계정 로그인 확인된 상태에서 진행.
2. `npx expo install expo-updates` — SDK 57 호환 버전(`~57.0.8`) 설치.
3. `eas update:configure`로 app.json에 `updates.url`/`runtimeVersion(policy: appVersion)` 자동 설정.
4. `app.json`의 `plugins`에 `"expo-updates"` 추가(옵션 없음 — 플러그인 타입 자체가
   `ConfigPlugin<void>`), `updates.checkAutomatically: "NEVER"`로 자동 백그라운드 반영을 끔.
5. **`src/services/updates/index.ts`**(신규) — `checkAndForceUpdate(onPhaseChange?)`:
   - 정상: 업데이트 없음 → `{status:'no-update'}`. 업데이트 있음 → 다운로드 → `reloadAsync()`로
     즉시 강제 재시작.
   - 비정상(전부 throw 없이 조용히 처리, 앱을 절대 막지 않음): dev 클라이언트/Expo Go에서는
     `__DEV__`/`Updates.isEnabled` 가드로 스킵(`ERR_NOT_AVAILABLE_IN_DEV_CLIENT` 회피) · 네트워크
     없어 체크 자체가 실패(`check-failed`) · 업데이트는 있는데 다운로드 실패(`download-failed`,
     다음 포그라운드 복귀 때 재시도 — expo-updates 자체가 원자적 다운로드/스왑 보장이라 부분
     다운로드가 다음 실행을 안 깨뜨림) · 1분 이내 재체크는 스로틀링(`skipped-throttled`, 서버
     부담 방지).
6. **`src/app/_layout.tsx`** — 콜드스타트 1회 + `AppState` 'active'(포그라운드 복귀)마다
   `checkAndForceUpdate` 호출. 다운로드/재시작 단계에서만 짧은 블로킹 화면("새 업데이트를 받는
   중.../적용하는 중...") — 갑자기 화면이 리로드되면 크래시처럼 보이는 걸 방지. 체크만 하고
   업데이트가 없는(가장 흔한) 경우엔 화면에 아무 것도 안 뜨고 즉시 사라짐.
7. **세션 가드 추가**(2026-07-22 밤, `qa/apps/pace/FINDINGS.md` OTA-1 지적 반영) — 리로드 직전에
   `useTimerStore.isSessionActive`(Android 오버레이 세션) 또는 `usePlayerStore.isPlaying`(Pace
   Feed 재생) 중 하나라도 켜져 있으면 리로드를 미루고 `hasPendingDownloadedUpdate`로 기억,
   다음 포그라운드 복귀 때 가드가 풀려 있으면 재다운로드 없이 바로 반영. 이미 검사관이 발견해준
   버그를 즉시 수정한 것 — 원래 코드는 세션 중이어도 그냥 강제 리로드해서 인메모리 상태를
   전부 날렸었음.

**실기기/에뮬 검증 결과**:
- `expo prebuild --clean` + gradle 네이티브 빌드 성공(17분51초), `pace_test` 에뮬레이터에 설치.
- 앱 정상 기동 확인, `expo-updates` 네이티브 모듈이 문제 없이 초기화됨(logcat:
  `UpdatesModule: getConstants called`, 에러 없음) — 네이티브 링크 자체는 검증 완료.
- **한계**: 이건 dev 클라이언트 빌드라 `Updates.checkForUpdateAsync()`가 Expo SDK 자체 정책상
  release 빌드에서만 동작한다(`__DEV__` 가드가 정상적으로 스킵시킴 — 의도한 동작). 즉
  체크→다운로드→강제리로드 전체 사이클의 실사용 검증은 **실제 release 빌드**(스토어 제출용
  빌드, 또는 `eas build --profile production`)에서만 가능 — 이번 라운드는 네이티브 연결과
  로직 자체(코드 리뷰)만 검증, 전체 사이클 라이브 테스트는 다음 release 빌드 때 이어서.

**실기기 검증**: Android 네이티브 재빌드(`expo prebuild` + gradle) 진행 중 — 이 문서 갱신 시점
기준 진행 상황은 커밋 로그 참고. iOS는 맥 세션이 **네이티브 재빌드(pod install + Xcode build)**
한 번 해줘야 반영됨 — JS/설정(app.json, services/updates)은 이미 공유 코드라 그대로 적용됨,
플랫폼별 추가 코드 불필요(`expo-updates`는 원래 크로스플랫폼 패키지).

**앞으로 실제로 "강제 푸쉬"를 쓰는 법**: `eas update --branch <채널명> --message "..."`로 JS
번들만 새로 배포하면(네이티브 코드 변경 없는 버그 수정/UI 변경 한정 — 새 네이티브 모듈/권한 추가는
여전히 스토어 재제출 필요), 이미 설치된 앱들이 다음 포그라운드 진입 시 자동으로 받아서 강제
적용한다.

---

*이 문서는 계속 갱신됩니다. 구현 여부는 git 커밋 히스토리로 교차 확인 가능.*
