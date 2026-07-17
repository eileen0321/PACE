# PACE 아키텍처 현황 (2026-07-17)

> 목적: Pace(숏폼 디지털 웰빙 앱) 구조 설계 결론을 한 곳에 기록. zen-master(`c:\MyData\Project\zen-master`)의
> 공통부/변동부 분리 컨벤션을 그대로 이식하되, 백엔드/상태관리는 아래 "확정 결정"에 따라 zen-master와
> 다르게 간다.

---

## 확정 결정 (사용자 확인 완료)

| 항목 | 결정 | 비고 |
|---|---|---|
| 백엔드 | **커스텀 백엔드(JWT + REST API)** — zen-master와 동일 | Supabase 아님. 최초 기획서엔 Supabase였으나 zen-master 패턴을 그대로 가져오기로 하며 변경 |
| 상태관리 | **Zustand** | zen-master는 Context API(AuthContext/PremiumContext)를 쓰지만, Pace는 원 기획서대로 Zustand 유지 — zen-master의 Context 내부 *로직*(세션 복원, 401 자동로그아웃, RC entitlement 동기화 등)만 스토어 액션으로 이식 |
| 플랫폼 분리 컨벤션 | zen-master 방식 그대로: **폴더 최상위 `platform/android`, `platform/ios` 분리가 아니라, 같은 폴더 안에서 RN 파일 확장자(`.android.tsx`/`.ios.tsx`/`.web.tsx`) + `.shared.ts`(공통 타입/로직) 컨벤션** | Metro가 번들 시점에 자동으로 플랫폼별 파일을 선택 |
| 로컬 DB | expo-sqlite | 세션/통계 로컬 우선 기록 후 서버 동기화(zen-master의 syncService 패턴) |
| 구독 | RevenueCat (`react-native-purchases`) | zen-master의 PremiumContext 로직(entitlement 기반 isPremium, 로컬 만료 캐시, 리뷰어/유료테스터 화이트리스트)을 그대로 참고 |

---

## 폴더 구조

```
src/
  app/                        # Expo Router
    (tabs)/
      home.tsx  stats.tsx  focus.tsx  settings.tsx
    onboarding/
    auth/
    paywall/
    overlay/                  # 세션 중 오버레이 UI (아래 "오버레이 UX" 참고)

  common/                     # 100% 공통 — 플랫폼 분기 없음
    config/                   # env, 상수 설정
    utils/

  components/
    ui/  cards/
    overlays/
      OverlayBar.android.tsx   ← 시스템 오버레이 안에서 렌더될 상태바 UI(네이티브 브릿지 View)
      OverlayBar.ios.tsx       ← 인앱 폴백 상태바(Live Activity 콘텐츠는 네이티브 위젯 익스텐션이 별도로 그림)
      shared/                  ← OverlayBar.types.ts, OverlayExpandedCard.tsx(플랫폼 비의존 펼침 카드), 포맷터

  features/
    autoplay/   ← (현재 로직은 services/platform에 위치, 화면 연동 시 여기로 이관 예정)
    timer/  limits/  stats/  notifications/  subscription/

  services/
    api/                      # 커스텀 백엔드 REST 클라이언트 (zen-master services/api.ts 패턴)
    auth/                     # 소셜 로그인 + JWT 세션
    revenuecat/
    analytics/
    storage/                  # AsyncStorage 키 관리
    platform/                 # UsageService / FocusService / OverlayService 인터페이스 + .android/.ios 구현

  store/                      # Zustand
    useUserStore.ts
    useSettingsStore.ts
    useStatsStore.ts
    useTimerStore.ts
    useSubscriptionStore.ts
    useAutoNextStore.ts        ← 런타임 Auto Next on/off (영속 설정과 분리, "외부 리뷰 반영 3차")
    useSessionStore.ts         ← 세션 주체 상태(id/app/status, "외부 리뷰 반영 4차")
    useCapabilityStore.ts      ← capabilities.ts를 감싼 훅 스타일 래퍼

  database/
    schema.ts  db.ts
    repositories/              ← "외부 리뷰 반영 3차": Store는 DB를 모르고 Repository만 안다
      sessionsRepository.ts  statsRepository.ts  settingsRepository.ts  subscriptionRepository.ts
  hooks/  types/  constants/

modules/
  pace-overlay/                # Expo Modules API 로컬 네이티브 모듈(Android Overlay POC, 프로젝트 루트)
```

**컨벤션 규칙**
1. 화면(`app/`)과 상위 feature 로직은 플랫폼을 몰라야 한다 — 항상 `shared`/배럴(`services/platform/index.ts`) 인터페이스만 import.
2. 네이티브 기능이 필요한 지점만 `.android.ts(x)` / `.ios.ts(x)`로 쪼갠다. **반드시 같은 디렉토리 안에서만** — Metro의 플랫폼 확장자 자동 선택은 `import './Foo'`가 같은 폴더의 `Foo.ios.tsx`/`Foo.android.tsx`를 찾는 방식이라, 폴더 자체를 `android/`·`ios/`로 나누면 자동 선택이 아예 동작하지 않는다(아래 "zen-master 감사 결과" 참고). `Platform.OS` 삼항 분기를 코드 안에 흩뿌리는 대신 이 확장자 분리로 대체한다.
3. iOS에서 지원 불가능한 기능(Auto Next, 시스템 오버레이)은 숨기는 게 아니라 **capability 플래그**(`supportsAutoNext`, `supportsSystemOverlay`)로 상위 UI가 자연스럽게 처리한다(버튼 비활성 또는 iOS 전용 대체 UI로 교체).

**⚠️ zen-master 감사 결과(2026-07-17) — 컨벤션 정정**: 최초에 "zen-master는 `components/android/`,
`components/ios/` 폴더로 나눈다"고 판단해 Pace의 `OverlayBar`도 같은 방식으로 만들었으나, 실제로
zen-master의 `src/ui/components/android/UniversalBlur.android.tsx` / `ios/UniversalBlur.ios.tsx` /
`web/UniversalBlur.web.tsx`는 **어디에서도 import되지 않는 죽은 코드**였다(전수 grep 결과 0건).
zen-master에서 실제로 동작하는 플랫폼 분기 컴포넌트(`GlassSurface.tsx`, 여러 화면에서 실사용 중)는
**같은 파일 안에서 `Platform.OS === 'ios'`로 inline 분기**하는 방식이었다. 결론: Metro의 파일-확장자
자동 선택 자체는 유효한 RN 컨벤션이지만 **같은 디렉토리**여야 하고, zen-master가 실제로 검증해 쓴
패턴은 오히려 `Platform.OS` inline 분기 쪽이다. Pace는 `services/platform/*.android.ts`+`*.ios.ts`
(같은 디렉토리, 파일 확장자 분리)는 그대로 유지하되, `components/overlays/OverlayBar.android.tsx`+
`.ios.tsx`도 같은 디렉토리로 옮겨 실제로 동작하도록 수정했다(최초엔 `overlays/android/`,
`overlays/ios/`로 잘못 분리했던 것을 바로잡음).

---

## 오버레이 UX (핵심 차별점)

Home의 "Start Watching"은 화면 전환이 아니라 **세션 시작 트리거**다. 실제 체류 화면은 YouTube Shorts /
Instagram Reels / TikTok 등 외부 앱이며, Pace는 그 위에 떠 있는 오버레이로 세션을 관리한다.

```
Start 클릭 → 오버레이 세션 시작 → 사용자가 숏폼 앱으로 전환 → Pace가 시간/Auto Next 계속 관리
```

### 기본(최소) 상태
- 높이 40~50px, 반투명(`rgba(255,255,255,0.75)` + blur), 화면 상단 고정
- 표시: `23m Left` / `AUTO ON`
- `AUTO` 탭 → 즉시 ON/OFF 토글

### 확장 상태 (탭하면)
```
Today 37m / 60m
Remaining 23m
Auto Next        ON
Sleep Timer      30m
Break Reminder   ON
[ Pause ]  [ Stop ]
```

### 시간 임박 알림
- 5분 남음 → `⏰ 5 minutes left`
- 1분 남음 → `⏰ 1 minute left`
- 종료 시 → `Today's goal done 🎉` + `[Stop]` `[+5 min]`

### 플랫폼별 구현 가능성

**Android — 시스템 오버레이 가능**
- `Foreground Service` + `TYPE_APPLICATION_OVERLAY` 윈도우로 다른 앱 위에 실제로 띄운다.
- Expo managed workflow로는 안 되고 **커스텀 네이티브 모듈 + config plugin(EAS dev client)** 필요.
- `services/platform/android/overlayService.android.ts` 가 네이티브 모듈을 브릿지.

**iOS — 시스템 오버레이 불가능**
- 다른 앱 위에 always-on-top 윈도우 자체가 OS 정책상 없음.
- 대체: **ActivityKit(Live Activities) + Dynamic Island**로 잠금화면/다이나믹아일랜드에 "23m Left" 표시.
- 오버레이 개념 대신 **로컬 알림(5분/1분 전)** + Live Activity 갱신으로 대체.
- `services/platform/ios/overlayService.ios.ts`는 오버레이 대신 Live Activity 시작/갱신 API로 구현.

---

## 오버레이 UI 원칙 — 하지 말 것 (중요, 2026-07-17 확정)

시안 검토 중 "중앙 원형 호흡 애니메이션 + 하단 플레이어 컨트롤 + 세션 정보 패널"로 그려진 목업이
나왔는데, 이는 **Pace의 역할을 오해한 설계라 폐기**한다.

> Pace는 "쇼츠를 대신 재생하는 자체 플레이어 앱"이 아니라
> **"쇼츠 위에서 시간만 관리해주는 얇은 보조 도구"**다.

**금지 사항**
- ❌ 화면 중앙을 차지하는 원형/애니메이션 UI (Inhale/Exhale 같은 몰입형 콘텐츠) — 이건 별개 제품(명상 앱)의
  패턴이고, 사용자가 "유튜브 위에 또 하나의 앱이 떴다"고 느끼게 만든다.
- ❌ 하단 플레이어 컨트롤(Pause/이전/다음 트랜스포트 바) — 실제 영상 재생은 YouTube/Instagram/TikTok
  네이티브 플레이어가 담당한다. Pace가 재생을 가로채거나 대체하는 UI를 그리면 안 된다.
- ❌ 세션 상세 정보를 상시 노출하는 대형 패널 — 상시 노출은 아래 최소 상태만.

**해야 할 것**
- ✅ 화면 최상단에 붙는 **얇은 상태바 1개**만 상시 표시 — 높이 44~56px, 반투명
  (`rgba(255,255,255,0.75)` + backdrop blur), 좌: `● Pace` 인디케이터, 중앙/우: `23m Left`,
  `AUTO ON` 토글.
- ✅ 상태바를 탭했을 때만 아래로 펼쳐지는 카드(Today 37m/60m, Remaining 23m, Auto Next ON,
  Sleep Timer 30m, `[Pause] [Stop]`) — 펼침 상태도 화면 상단 영역에 머물고, 화면 중앙/하단을
  침범하지 않는다.
- ✅ 그 외 화면 전체(중앙~하단)는 항상 호스트 앱(YouTube 등)의 원래 UI가 그대로 보여야 한다.

이 원칙은 `components/overlays/OverlayBar.android.tsx`, `components/overlays/OverlayBar.ios.tsx`
(Live Activity 콘텐츠 뷰) 둘 다에 동일하게 적용된다. 두 파일은 같은 디렉토리에 있어야 Metro가
자동으로 플랫폼별 구현을 선택한다 — "컨벤션 규칙" 및 "zen-master 감사 결과" 참고.

---

## iOS Live Activity 상세 설계

**ActivityAttributes (Swift, 네이티브 모듈 쪽에서 정의)**
```swift
struct PaceAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var usedMinutes: Int
        var remainingMinutes: Int
        var sleepTimerRemaining: Int
        var autoNextEnabled: Bool  // iOS에선 표시만, 실제 자동 넘김 동작은 없음
    }
    var sessionId: String
}
```

**레이아웃**
- 잠금화면(확장형): `Pace` 타이틀 / `Today 37m / 60m` / `Remaining 23m` / `Auto Close in 30m`
- Dynamic Island Compact: `⏱ 23m`
- Dynamic Island Expanded: leading=`Pace`, center=`37/60m`, trailing=`23m`
- 색상은 `src/constants/theme.ts`의 `colors.primary`(#5856D6, "UI 포팅" 섹션에서 iOS 시스템 인디고로 갱신됨) / `colors.success` / `colors.warning` 재사용 — 위젯 쪽에도 동일 토큰을 하드코딩(Swift는 JS 상수를 못 읽으므로 값만 동기화 유지).

**갱신 주기**: 1분 간격 권장. 10초 단위 등 과도한 `activity.update()` 호출은 배터리 소모가 커서 금지.

**RN 브릿지 인터페이스** (`services/platform/overlayService.ios.ts`가 구현할 대상)
```ts
interface LiveActivityService {
  start(session: { usedMinutes: number; remainingMinutes: number }): Promise<void>;
  update(session: { usedMinutes: number; remainingMinutes: number }): Promise<void>;
  stop(): Promise<void>;
}
```

---

## Android AccessibilityService 최적화 원칙

**절대 금지**: 500ms 폴링, 화면 OCR 반복, RootNode 전체 탐색 — 전부 배터리를 급격히 소모시킨다.

**해야 할 것**
- 이벤트 기반으로만 반응: `TYPE_WINDOW_CONTENT_CHANGED`, `TYPE_WINDOW_STATE_CHANGED`, `TYPE_VIEW_SCROLLED`만 구독.
- 감시 대상 패키지 화이트리스트로 즉시 필터링(그 외 앱 이벤트는 콜백 진입 즉시 return):
  ```kotlin
  private val supportedApps = setOf(
      "com.google.android.youtube",
      "com.instagram.android",
      "com.zhiliaoapp.musically",
  )
  override fun onAccessibilityEvent(event: AccessibilityEvent) {
      if (!supportedApps.contains(event.packageName?.toString())) return
      // ...
  }
  ```
- Swipe 좌표는 하드코딩하지 않고 화면 높이 기준 동적 계산(예: 80% → 20% 지점으로 스와이프).
- `Foreground Service`는 **Auto Next가 켜져 있을 때만** 구동한다. 꺼져 있으면 서비스 자체를 종료해
  Android가 강제로 죽이지 않도록 방지하면서 배터리도 아낀다.
- 클래스 분리 권장: `AutoNextManager`(오케스트레이션) / `VideoEndDetector`(MediaSession 우선,
  Accessibility 폴백) / `GestureController`(dispatchGesture) / `OverlayController`(상태바 갱신).

---

## iOS 앱 차단 설정 예시 (Swift, FamilyControls)

```swift
// 1) 권한 요청
try await AuthorizationCenter.shared.requestAuthorization(for: .individual)

// 2) 앱 선택 (Apple 제공 Picker — Pace가 앱 목록을 직접 볼 수 없음, 토큰만 받음)
FamilyActivityPicker(selection: $selectedApps)

// 3) 사용시간 모니터링 등록
DeviceActivityCenter().startMonitoring(.dailyLimit, during: schedule)

// 4) 임계값 도달 시 콜백 (DeviceActivityMonitor 익스텐션)
override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    let store = ManagedSettingsStore()
    store.shield.applications = selectedApps.applicationTokens
}
```
결과: 사용자가 YouTube를 열면 iOS가 자체 차단 화면(`App Restricted` 류)을 표시. Pace 쪽 UX는
차단 5분 전 `5 minutes remaining` 알림 → 초과 시 `Today's goal reached 🎉 / Available tomorrow`.

---

## 최신 플랫폼 트렌드 반영 (2026-07-17 웹 조사)

**Android — Bubbles API(Android 17)가 SYSTEM_ALERT_WINDOW보다 우선순위 높은 선택지**
Android 17부터 Jetpack Compose의 `Bubbles`(구 알림 버블 API의 확장)가 "다른 앱 위에 뜨는 축소形
플로팅 UI"의 1st-party 표준 경로로 자리잡았다. 레거시 `TYPE_APPLICATION_OVERLAY`(`SYSTEM_ALERT_WINDOW`
권한)보다 (1) 권한 요청이 사용자에게 덜 위협적으로 보이고 (2) 시스템이 창 크기/제스처를 관리해줘서
자체 구현 부담이 적고 (3) Play 정책상 "오버레이 남용" 심사 리스크가 낮다. **결론: Android 17+
기기에서는 Bubbles API를 우선 사용하고, 구버전 호환을 위해 `TYPE_APPLICATION_OVERLAY` 폴백을
`overlayService.android.ts` 뒤에 유지한다.** (Source: Android Developers "Bubbles | Jetpack Compose")

**iOS — Dynamic Island/Live Activity는 "미니멀 + 한눈에" 원칙이 2026 기준으로도 유효**
Live Activity/Dynamic Island는 지속적 상태 표시용이며, Apple 가이드는 여전히 "간결한 레이아웃,
빠른 갱신, 한눈에 이해되는 정보"를 강조한다. 우리가 이미 확정한 "얇은 상태바 하나만" 원칙과
정확히 일치 — 별도 설계 변경 불필요, 다만 콘텐츠는 반드시 컴팩트(예: `⏱ 23m`)하게 유지할 것.
(Source: Apple Developer Live Activities 가이드 요약, pushwoosh.com/blog/ios-live-activities,
newly.app/guides/dynamic-island)

---

## Android: Auto Next 감지/실행 구조

```
YouTube/Instagram/TikTok 감시
  ↓
1순위: MediaSession의 PlaybackState 감지 (STATE_ENDED) — 앱이 지원하면 가장 정확
  ↓ (미지원 시 폴백)
2순위: AccessibilityService 이벤트 분석
       TYPE_WINDOW_CONTENT_CHANGED / TYPE_VIEW_SCROLLED / TYPE_WINDOW_STATE_CHANGED
       → 화면 변화 패턴으로 "다음 영상 필요" 판단
  ↓
dispatchGesture()로 Swipe Up 실행 (3초 카운트 후)
```

- OCR 기반 방식(3순위, 화면 텍스트 분석)은 정확도 낮고 CPU 소모 커서 **채택 안 함**.
- `PaceAccessibilityService`(Kotlin, 네이티브 모듈)가 감시 대상 패키지(`com.google.android.youtube`,
  `com.instagram.android`, `com.zhiliaoapp.musically`, `com.naver.vapp` 등)를 화이트리스트로 관리.
- 설정(`autoNext`, `sleepTimer`, `dailyLimit`, `breakReminder`)은 `user_settings` → Zustand
  `useSettingsStore` → 네이티브 모듈로 단방향 push. 네이티브 서비스는 JS 상태를 poll하지 않고
  변경 시점에만 브릿지 이벤트로 받는다.

---

## iOS: Live Activity + 앱 차단 구조

**Live Activity (오버레이 대체)**
```
Start Session (JS) → ActivityKit.Activity.request(attributes, content) → Live Activity 시작
1분마다 activity.update(...) → 잠금화면/Dynamic Island 갱신
Stop Session → activity.end()
```
표시 정보: `Today 37m/60m`, `Remaining 23m`.

**Focus / App Blocking — FamilyControls + DeviceActivity + ManagedSettings**
```
AuthorizationCenter.shared.requestAuthorization() → 사용자 앱 선택(FamilyActivityPicker)
  ↓
DeviceActivity로 사용시간 모니터링 (예: 60분 한도)
  ↓ 한도 도달 시
DeviceActivityMonitor 콜백 → ManagedSettingsStore.shield.applications 적용 → 앱 실행 시 차단 화면
```
- iOS 16+ 필요. Auto Next와 달리 이건 Apple 공식 API라 심사 리스크가 낮음.

---

## 플랫폼 Feature Matrix

| 기능 | Android | iOS | 구현 방식 |
|---|---|---|---|
| Home / Stats / Settings / Auth / RevenueCat | ✅ | ✅ | 완전 공통 |
| Sleep Timer / Daily Limit / Usage Tracking / Break Reminder | ✅ | ✅ | 공통 로직 + 로컬 알림 |
| **Auto Next** | ✅ | ❌ | Android: AccessibilityService+MediaSession. iOS: 원천 불가, capability flag로 UI 숨김 |
| **시스템 오버레이 바(플로팅)** | ✅ | ❌ | Android: Foreground Service + Overlay Window |
| **Live Activity / Dynamic Island** | ❌ | ✅ | iOS 오버레이의 대체 수단 |
| App Blocking / Focus Mode | ✅ (Accessibility 기반 차단화면) | ✅ (FamilyControls/ManagedSettings) | 플랫폼별 완전히 다른 API, 상위 `FocusService` 인터페이스로 추상화 |

**제품 포지셔닝 결론**: Android는 "Shorts Assistant"(자동재생+오버레이 포함 풀 기능),
iOS는 "Digital Wellbeing Assistant"(Live Activity+Screen Time 계열 제한 기능)로 기능 차이를
기획 단계에서부터 명시한다. UI/비즈니스 로직은 80~85% 공유, 네이티브 기능만 완전 분리.

---

## 구현상 제약 (중요)

- Android 오버레이(`TYPE_APPLICATION_OVERLAY`)와 AccessibilityService, iOS ActivityKit/FamilyControls는
  전부 **Expo managed workflow 범위를 벗어나는 커스텀 네이티브 모듈**이 필요하다 — EAS Dev Client +
  config plugin 빌드가 전제. 이 저장소의 초기 스캐폴딩에서는 `services/platform/*` 아래에
  **인터페이스 + 네이티브 모듈 브릿지 자리(stub)**만 만들어두고, 실제 Kotlin/Swift 네이티브 모듈은
  별도 작업으로 진행한다.
- `AccessibilityService` 사용은 Google Play 정책상 "접근성 목적이 아닌 사용"에 대한 심사가 까다롭다 —
  스토어 심사 리스크를 기획 문서에 명시해둘 것.

---

## DB 스키마 (로컬 SQLite ↔ 서버 동기화)

zen-master의 `AsyncStorage` 기반 진행도 저장 + `syncService` 재시도 동기화 패턴을 참고하되,
Pace는 세션 기록량이 많아 `expo-sqlite`를 로컬 1차 저장소로 쓴다.

```sql
-- users: 서버 응답 캐시(로컬 조회용, 진실원천은 서버)
users (id, email, name, avatar_url, provider, created_at)

-- subscriptions: RevenueCat entitlement 로컬 캐시 (zen-master PremiumContext와 동일 사상)
subscriptions (id, user_id, plan, status, renewal_date, updated_at)

-- user_settings: AsyncStorage(진실원천)의 SQLite 미러(write-through). appShields/perApp은 JSON 텍스트.
user_settings (user_id, auto_next, sleep_timer_min, daily_limit_min, break_interval_min,
                pre_session_breathing, app_shields_json, per_app_json, theme, updated_at)

-- viewing_sessions: Auto Next 엔진 / Live Activity가 실시간 기록. status는 세션 종료 사유.
viewing_sessions (id, user_id, started_at, ended_at, duration_seconds, videos_watched, platform_app,
                   status, synced)

-- daily_stats: viewing_sessions 집계 캐시 (통계 화면 조회 최적화용, 현재 미사용 — statsRepository가
-- 쿼리 시점 GROUP BY로 대체 중이라 이 테이블은 향후 성능 최적화 시점에 채울 예정)
daily_stats (id, user_id, date, total_minutes, total_videos, longest_session_seconds)

-- overlay_events: 네이티브 Auto Next/Overlay 디버그 이벤트 로그(외부 리뷰 반영 3차)
overlay_events (id, user_id, session_id, event_type, detail, created_at)
```

동기화 원칙(zen-master `syncService.syncWithRetry()` 패턴): 오프라인 기록 → 로그인/포그라운드 복귀 시
서버로 flush → 실패 시 큐 유지 후 재시도. 로그아웃/탈퇴 시 삭제해야 할 로컬 스코프 키는
zen-master `AuthContext.tsx`의 `USER_SCOPED_KEYS` 방식(정적 목록 + 동적 프리픽스 목록)을 그대로 따른다.

---

## UI 포팅 (2026-07-17) — healthy-shorts-assistant → Pace RN

**소스**: `C:\Users\eileen\Downloads\healthy-shorts-assistant` — AI Studio가 생성한 Vite+React+Tailwind
웹 프로토타입("Healthy Viewing Assistant"). iOS 시스템 팔레트(`#5856D6` 인디고)를 쓴 고품질 Apple
Fitness/Screen Time 스타일 목업이며, `src/App.tsx` 기준 4탭(Home/Focus/Stats/Settings) + 세션 오버레이
(`ShortsPlayer.tsx`) 구조. **전수 확인 결과 9개 컴포넌트 + data.ts + types.ts + index.css를 모두
읽고 포팅 여부를 판단**했다 — 아래 표 참고.

| 소스 파일 | 포팅 대상(Pace RN) | 처리 |
|---|---|---|
| `Header.tsx` | `components/ui/AppHeader.tsx` | iOS 상태바(시간/배터리) 부분은 실기기가 자체 렌더하므로 제외, 인사말+아바타만 이식 |
| `UsageHero.tsx` | `components/cards/UsageHeroCard.tsx` | 테스터용 +/-분 버튼(프로토타입 전용 디버그 UI)은 제외 |
| `StartShortsButton.tsx` | `components/ui/StartShortsButton.tsx` | 그대로 이식 |
| `StatsGrid.tsx` | `components/cards/StatsGridCard.tsx` | 그대로 이식(Focus 탭 이동 배너 포함) |
| `WeeklyGraph.tsx` | `components/cards/WeeklyGraphCard.tsx` | 데이터 소스만 웹 목업 배열 → `useStatsStore().weeklyStats`(SQLite 실데이터)로 교체 |
| `SettingsSection.tsx` | `app/(tabs)/focus.tsx` + `components/ui/SettingsRow.tsx` | 그대로 이식. "System Sync Shields"(앱별 차단 토글)를 위해 `UserSettings.appShields` 타입 신설 |
| `StatsTab.tsx` | `app/(tabs)/stats.tsx` | 스트릭은 `weeklyStats` 기반 실계산으로 교체. "Wholesome Feed Breakdown" 카테고리 비중은 원본도 정적 목업값 — 실제 카테고리 계측 전까지 TODO로 남김(레이아웃만 이식) |
| `SettingsTab.tsx` | `app/(tabs)/settings.tsx` | "Reset All App Data"를 실제 로그아웃+로컬 초기화(`useUserStore.logout`)로 연결. 구독 배지는 `useSubscriptionStore.isPremium` 실연동 |
| `ShortsPlayer.tsx`(오버레이 바 부분) | `components/overlays/OverlayBar.{android,ios}.tsx` + `shared/OverlayExpandedCard.tsx` | **핵심 UX가 이미 기존에 합의한 "얇은 상태바" 원칙과 정확히 일치** — 컴팩트(48px, Pace/⏱remaining/AUTO ON 필)·확장(그리드 통계+진행바+스위치+Pause/Stop) 상태를 충실히 이식 |
| `ShortsPlayer.tsx`(하단 재생 화면 부분) | `app/overlay/index.tsx`의 "DEV SIMULATOR" 영역 | **프로덕션 코드 아님, 명시적으로 격리**. 실제 YouTube 등이 없는 개발 환경에서 오버레이-위-콘텐츠 상호작용을 눈으로 확인하기 위한 시뮬레이터로만 사용, 화면에 "DEV SIMULATOR" 배지로 항상 표시 |
| `data.ts`(CURATED_VIDEOS) | `constants/curatedVideos.ts` | 위 시뮬레이터 전용 데이터로만 사용 |
| `index.css`(색상/폰트 토큰) | `constants/theme.ts` | 아래 "디자인 시스템 갱신" 참고 |

### 디자인 시스템 갱신
- Primary 색상을 원 기획서의 `#4F46E5`에서 프로토타입의 **iOS 시스템 인디고 `#5856D6`**로 교체(Apple
  Fitness/Screen Time과의 시각적 일치, 이미 검증된 값이므로 승계).
  `colors.primaryTint`(15% 투명 배경), `colors.cardMuted`(#F9F9FB), `colors.successBg`/`dangerBg` 추가.
- 폰트 스택(Inter/Plus Jakarta Sans/JetBrains Mono)은 `typography.displayFontFamily`/`monoFontFamily`에
  자리만 만들어두고 실제 폰트 파일(`expo-font`) 추가 전까지는 시스템 폰트로 폴백 — TODO.
- `radius.cardLarge`(28, 오버레이 확장 카드), `radius.chip`(12) 추가.

### Android=floating pill / iOS=frame 차분 (사용자 지시 반영)
기존에 Android/iOS 모두 같은 모양의 얇은 pill 오버레이로 만들어뒀던 것을, 사용자 지시에 따라
**형태 자체를 다르게** 재설계했다:
- **Android(`OverlayBar.android.tsx`)**: 화면 상단에 여백을 두고 떠 있는 둥근 알약(pill, `radius.cardLarge`
  + `marginHorizontal`) — 실제로 다른 앱 위에 뜨는 시스템 오버레이(Bubbles API/legacy overlay window)이므로
  "떠 있는" 형태가 그 실체와 일치.
- **iOS(`OverlayBar.ios.tsx`)**: 화면 상단에 여백 없이 붙는 사각 "프레임" 배너(모서리만 살짝 둥글고,
  상단에 3px 컬러 accent 라인) — 실기기에서 진짜 오버레이가 아니라 ActivityKit Live Activity/Dynamic
  Island가 잠금화면·아일랜드에 표시를 대신하고, 이 컴포넌트는 Pace 앱이 포그라운드일 때만 보이는
  인앱 폴백이라는 점을 형태로도 드러낸다. Auto Next 토글도 없음(`supportsAutoNext=false`).

---

## 외부 리뷰 반영 2차 (2026-07-17) — 설계→코드 정합화

전체 설계에 대한 외부 리뷰(9.5/10, 감점 요인은 Android Auto Next의 Accessibility 정책 리스크뿐이라는
평가)에서 나온 구체적 개선 4가지를 실제 코드에 반영했다. "설계를 더 늘리기보다 실제 코드로" 라는
방향 제안에 따라 문서화가 아니라 구현으로 처리.

1. **AppCapabilities 통합 서비스** (`services/platform/capabilities.ts` 신설) — 기존엔
   `autoNextService.supportsAutoNext`, `overlayService.supportsSystemOverlay`처럼 서비스마다 흩어져
   있던 capability 플래그를 `capabilities.supportsAutoNext/supportsSystemOverlay/supportsLiveActivity/
   supportsAppBlocking` 하나로 통합. `focus.tsx`, `OverlayExpandedCard.tsx`가 이제 개별 서비스가 아니라
   이 배럴만 import — "상위 화면은 OS를 절대 모르고 capabilities만 본다" 원칙을 코드로 강제.
2. **앱별 Auto Next override** (`types/models.ts`의 `AppSettingsOverride`/`resolveAppSettings`,
   `useSettingsStore.updateAppOverride`, `focus.tsx`의 "Per-App Auto Next" 섹션) — "유튜브만 Auto Next,
   틱톡은 OFF" 같은 요구를 `UserSettings.perApp: Record<AppShieldTarget, {autoNext, dailyLimitMinutes}>`
   (값이 `null`이면 전역 설정 상속)로 지원. UI는 Default→ON→OFF 3단 순환.
3. **앱별 사용량 분석** (`database/sessionsRepo.ts`의 `getTodayUsageByApp()`) — 별도 집계 테이블 없이
   기존 `viewing_sessions.platform_app` 컬럼을 `GROUP BY`해서 "YouTube 40m/Instagram 10m/TikTok 5m"
   분석을 지원. 다만 네이티브 Auto Next/Usage 모듈이 아직 `platform_app`을 채우지 않으므로 현재는
   호출해도 빈 배열 — 네이티브 연동 후 바로 쓸 수 있게 스키마/쿼리만 미리 준비해둔 상태.
4. **Auto Next Play 스토어 심사 리스크 완화** (`autoNextService.android.ts`) — AccessibilityService로
   "사용자 대신 스와이프"하는 기능은 "접근성 목적이 아닌 남용"으로 리젝될 수 있다는 지적을 반영해,
   `EXPO_PUBLIC_ENABLE_AUTO_NEXT` 환경변수로 게이트. 스토어 제출 빌드는 기본 OFF(`capabilities.
   supportsAutoNext=false`로 상위 UI가 자동으로 관련 토글을 숨김), 직접 배포(APK) 빌드에서만
   `true`로 켜서 기능을 노출한다.

**의도적으로 보류한 것**: Bubble-우선/Overlay-폴백 전략은 이미 "최신 플랫폼 트렌드 반영" 섹션에
문서화돼 있고 실제 네이티브 모듈이 아직 없어 인터페이스 레벨 변경은 시기상조로 판단 — 네이티브
`PaceOverlay` 모듈 작성 시 Android 버전 분기(`Build.VERSION.SDK_INT >= 35` 등 실제 Android 17 API
레벨 확인 후)로 구현할 예정.

---

## 외부 리뷰 반영 3차 (2026-07-17) — Repository 계층 분리 + jlpt-master RevenueCat 계약 + 웹 트렌드 재검증

### Repository 계층 분리
"Store는 DB를 모르고 Repository만 안다"는 제안을 받아들여 `database/sessionsRepo.ts`(단일 플랫 파일)를
`database/repositories/`로 분리했다:
- `sessionsRepository.ts` — 쓰기 전용(startSession/endSession/getUnsyncedSessions/markSynced) +
  신설된 `logOverlayEvent`/`getRecentOverlayEvents`
- `statsRepository.ts` — 집계/읽기 전용(getTodayUsageMinutes/getTodayVideoStats/getWeeklyStats/
  getTodayUsageByApp/getSessionEndReasons)

class 기반(`new SessionsRepository()`) 제안도 있었으나, 프로젝트 전체가 함수형 모듈 스타일(zustand
스토어, 다른 서비스 전부)이라 class 싱글톤을 섞으면 스타일이 갈라진다 — 동일한 계층 분리 효과를
함수형 모듈로 그대로 달성했으므로 class화는 채택하지 않음.

### ⚠️ 외부 제안 코드 검증 — expo-sqlite는 async API가 맞다
외부 리뷰가 예시로 준 코드(`SQLite.openDatabaseSync`, `db.runSync`/`getAllSync`)는 **틀린 방향**이다.
2026-07-17 웹 조사 결과, Expo 공식 문서는 `openDatabaseAsync()` + `runAsync`/`getAllAsync`/`getFirstAsync`를
권장하며, sync API는 무거운 쿼리에서 메인 스레드를 블로킹할 위험이 있다고 명시한다. Pace의
`database/db.ts`/`repositories/*.ts`는 처음부터 async API로 작성돼 있었고 이번 재검증으로 **변경 없이
유지**하기로 확정 — 사용자가 지시한 "웹 트렌드 검증"이 기존 구현을 재확인해준 사례.
(Source: docs.expo.dev/versions/latest/sdk/sqlite)

### 신규 스토어: useAutoNextStore
`useSettingsStore.settings.autoNext`(영속 설정, "사용자가 켜뒀는가")와
`useAutoNextStore`(런타임 상태, "지금 네이티브 서비스가 실제로 도는가")를 분리했다. 세션이 없으면
설정이 ON이어도 `isRunning=false`로 Foreground Service를 띄우지 않아야 배터리를 아낀다는 원칙
("Android AccessibilityService 최적화 원칙" 섹션)을 스토어 레벨에서 강제하기 위함.

### 스키마 확장
- `viewing_sessions.status`(`completed`/`daily_limit_reached`/`sleep_timer_expired`/`manual_stop`) —
  세션이 왜 끝났는지 분포 분석용. `statsRepository.getSessionEndReasons()`로 조회.
- `overlay_events` 테이블(event_type: `AUTO_NEXT`/`SESSION_STOP`/`DAILY_LIMIT`/`BREAK_REMINDER`/
  `SLEEP_TIMER`) — 네이티브 모듈 디버깅 로그. `app/overlay/index.tsx`의 DEV SIMULATOR가 이미
  `AUTO_NEXT`/`SESSION_STOP` 이벤트를 실제로 기록하도록 연결해뒀다(네이티브 붙기 전에도 로그 파이프라인
  자체는 검증 가능).

### RevenueCat 백엔드 웹훅 계약 — jlpt-master 실전 검증본 채택
"RevenueCat은 jlpt-master 것을 그대로 가져오면 되지 않냐"는 질문에 대한 답: **맞다, 게다가
zen-master보다 jlpt-master 쪽이 더 완성도가 높다.** zen-master.md 자체가 "backend 디렉토리가 없어서
webhook 서버 검증 불가"라고 명시했던 반면, jlpt-master(`backend/SUBSCRIPTION_REVENUECAT.md`,
`RevenueCatClient.java`)는 실제 프로덕션 백엔드 웹훅 처리까지 구현·검증돼 있다. 핵심 계약을 Pace의
향후 커스텀 백엔드 설계에 그대로 채택한다:

- **RC(RevenueCat)가 단일 진실원천(entitlement)**, 백엔드는 webhook으로만 갱신되는 미러 — 프론트는
  RC `CustomerInfo`로 프리미엄을 즉시 판정(`useSubscriptionStore`가 이미 이 사상으로 구현됨).
- **로그인 시 `Purchases.logIn(email)`** → RC `app_user_id` = 이메일(익명 ID 탈출). `useUserStore`의
  `loginWithGoogle`/`loginWithApple`/`init`(세션 복원)이 성공 시 `useSubscriptionStore.identify(email)`을
  호출하도록 연결 완료(게스트는 이메일이 없어 스킵, RC 익명 ID 유지). `logout`/`deleteAccount`는
  `reset()`으로 RC 세션을 익명으로 되돌린다.
- **웹훅 이벤트별 처리 정책**(향후 백엔드 구현 시 그대로 적용):
  - `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION`/`TRANSFER`/`PRODUCT_CHANGE` → 프리미엄 부여(만료일 갱신)
  - `CANCELLATION` → **즉시 박탈 금지**(만료일까지 유지, 이후 `EXPIRATION` 대기). 단 환불/즉시취소
    (`cancel_reason`이 `CUSTOMER_SUPPORT`/`UNSUBSCRIBE`)면 즉시 박탈
  - `EXPIRATION` → 박탈(단, 그 사이 재구독됐으면 무시)
  - `BILLING_ISSUE` → grace 기간, 박탈 보류
  - **순서 보장**: 지연된/역전된 이벤트는 스킵(새 만료일이 기존보다 이전이면 grant 스킵, 만료일이
    미래면 revoke 스킵)
  - ⚠️ **jlpt-master가 실제로 겪은 버그**: `CANCELLATION`을 즉시 박탈로 처리했다가 "결제했는데 해지
    시점에 즉시 이용 정지"가 되어 Apple/Google 정책 위반 및 환불 분쟁을 유발함 — 이미 수정 완료된
    사항이므로 Pace 백엔드는 처음부터 "만료일까지 유지" 정책으로 구현할 것.
- 가격 정책 참고(잠정): 월간+연간 2티어, 평생권은 보류(대역폭 누적 비용 리스크).

**결론**: RevenueCat 클라이언트 로직(`useSubscriptionStore.ts`)은 지금 상태로 충분하고, 진짜 남은 작업은
**백엔드 웹훅 서버**(위 정책 그대로 구현) — 이건 Pace 자체 커스텀 백엔드가 만들어질 때 jlpt-master의
`RevenueCatClient.java`/`WebhookController`를 참고 구현체로 그대로 이식하면 된다.

---

## 구현 상태 상세 (2026-07-17 기준)

| 레이어 | 파일 | 상태 | 비고 |
|---|---|---|---|
| DB 스키마 | `database/schema.ts` | ✅ 완료 | users/subscriptions/user_settings(+JSON 컬럼)/viewing_sessions(+status)/daily_stats/overlay_events |
| DB 연결 | `database/db.ts` | ✅ 완료 | openDatabaseAsync 싱글톤, 스키마 자동 마이그레이션 |
| Repository | `database/repositories/sessionsRepository.ts` | ✅ 완료 | CRUD + overlay_events 로깅 |
| Repository | `database/repositories/statsRepository.ts` | ✅ 완료 | 집계 쿼리 5종 |
| Repository | `database/repositories/settingsRepository.ts` | ✅ 완료(미러만) | write-through, read 경로 미연결 |
| Repository | `database/repositories/subscriptionRepository.ts` | ✅ 완료(미러만) | RC CustomerInfo write-through 캐시 |
| Store | `store/useUserStore.ts` | ✅ 완료 | 로그인/게스트/로그아웃 + RC identify/reset + Google/Apple SDK 연동 |
| Store | `store/useSettingsStore.ts` | ✅ 완료 | 전역+앱별 override, AsyncStorage 영속 + SQLite 미러 |
| Store | `store/useStatsStore.ts` | ✅ 완료 | statsRepository 연동 |
| Store | `store/useTimerStore.ts` | ✅ 완료 | 세션 카운트다운 |
| Store | `store/useAutoNextStore.ts` | ✅ 완료(런타임 상태만, 네이티브 미연결) | |
| Store | `store/useSessionStore.ts` | ✅ 완료(런타임 상태만, 네이티브 미연결) | 세션 주체(id/app/status) |
| Store | `store/useCapabilityStore.ts` | ✅ 완료 | capabilities.ts 훅 래퍼 |
| Store | `store/useSubscriptionStore.ts` | 🟡 부분 | RC 클라이언트 로직 + identify/reset + SQLite 미러 완료, 백엔드 웹훅 서버는 미착수 |
| Service | `services/api/client.ts` | 🟡 부분 | 클라이언트 완료, 실제 서버 없음(API_BASE_URL 자리표시자) |
| Service | `services/auth/google.ts`, `apple.ts` | ✅ 완료(코드), 🔴 실기기 미검증 | 실키+Dev Client 빌드 필요 |
| Service | `services/platform/usageService.*`, `autoNextService.*`, `focusService.*` | 🔴 인터페이스만 | 네이티브 모듈 없음 |
| Service | `services/platform/overlayService.android.ts` | 🟡 POC 연결됨 | `modules/pace-overlay` 방어적 require, 컴파일 미검증 |
| Service | `services/platform/capabilities.ts` | ✅ 완료 | 통합 capability 배럴 + useCapabilities() 훅 |
| 네이티브(Android) | `modules/pace-overlay`(Expo Modules API) | 🟡 POC 작성 완료 | Foreground Service + TYPE_APPLICATION_OVERLAY, prebuild+Dev Client 빌드 검증 전 |
| 네이티브(Android) | PaceAccessibilityService, Bubbles(17+) | 🔴 미착수 | |
| UI | `app/(tabs)/*`, `app/overlay`, `app/auth`, `app/paywall`, `app/onboarding` | ✅ 완료 | healthy-shorts-assistant 포팅 완료, tsc 0 errors |
| 네이티브(iOS) | ActivityKit, FamilyControls | 🔴 미착수 | EAS Dev Client + Swift 모듈 필요 |
| 백엔드 | 커스텀 REST 서버 | 🔴 미착수 | jlpt-master RevenueCat 웹훅 계약 참고해 구현 예정 |

---

## 외부 리뷰 반영 4차 (2026-07-17) — 실제 구현: 스토어 마무리 + Auth 연동 + Android Overlay 네이티브 POC

"문서 그만 쓰고 코드로" 지시에 따라 이번 라운드는 전부 실제 코드로 반영했다.

### 신규 스토어 2종
- **`useSessionStore`** — 세션의 "주체" 상태(`currentSessionId`/`platformApp`/`startedAt`/
  `status: idle|running|paused|finished`)를 한 곳에 모음. 기존 `useTimerStore`(숫자 카운트다운)와
  `useAutoNextStore`(런타임 on/off)는 그대로 두고 역할을 명확히 분리 — Overlay/Live Activity
  네이티브 모듈이 붙으면 이 스토어가 브릿지의 JS측 진실원천이 된다. `constants/apps.ts`의
  `ShortFormApp`(이미 존재하던 앱 화이트리스트 — 외부 제안의 "SupportedApps"와 동일 목적이라
  중복 생성하지 않고 재사용)을 `platformApp` 타입으로 사용.
- **`useCapabilityStore`** — 기존 `services/platform/capabilities.ts`(plain export)를 그대로 감싼
  얇은 Zustand 스토어. capabilities는 빌드당 고정값이라 실제 상태 로직은 없지만, 나머지 6개
  스토어와 동일한 훅 패턴(`useCapabilityStore()`)으로 컴포넌트에서 쓸 수 있게 스타일 일관성만 맞춤.

### Repository 2종 추가 (SQLite 미러)
- **`settingsRepository`** — `useSettingsStore`의 진실원천은 여전히 AsyncStorage(변경 없음)이고,
  `update()`/`updateAppOverride()` 호출 시 로그인된 유저가 있으면 `user_settings` 테이블에
  write-through 미러링만 한다(향후 백엔드 push용, 현재 read 경로는 미사용). 스키마에
  `pre_session_breathing`/`app_shields_json`/`per_app_json`/`updated_at` 컬럼을 추가해 실제
  `UserSettings` 전체를 손실 없이 미러링하도록 확장.
- **`subscriptionRepository`** — `useSubscriptionStore.applyCustomerInfo()`가 RC `CustomerInfo`를
  받을 때마다 `subscriptions` 테이블에 write-through(오프라인 부팅 시 최근 entitlement 즉시 표시용
  캐시). RC가 여전히 단일 진실원천이며 이 미러는 참고용 캐시일 뿐이다.

### Auth 실연동 (Google/Apple)
- **Google**: `@react-native-google-signin/google-signin` 설치 + `services/auth/google.ts`
  (zen-master의 방어적 require 패턴 이식 — 네이티브 모듈 미링크 시 크래시 대신 경고 후 비활성화).
  2026-07-17 웹 조사로 Expo 공식 가이드가 `expo-auth-session`(브라우저 OAuth) 대신 이 네이티브
  모듈을 권장함을 재확인(SDK 53에서 브라우저 방식이 깨진 이력 있음) — 처음부터 네이티브 모듈로
  선택한 것이 맞았음을 재검증.
- **Apple**: `expo-apple-authentication`(이미 설치돼 있던 패키지) 기반 `services/auth/apple.ts`.
- `useUserStore`에 `signInWithGoogle()`/`signInWithApple()` 액션 추가(SDK 호출→백엔드 로그인까지
  한 번에) — `app/auth/index.tsx` 버튼이 이제 실제로 이 액션을 호출한다. `googleAuth.isAvailable()`이
  false면(키 미설정) 버튼 자체가 안 보인다.
- `.env.example`에 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` 추가.

### Android Overlay 네이티브 POC (최우선 항목)
"Android Overlay POC부터 들어가는 게 가장 가치 높다"는 지시대로 실제 네이티브 코드를 작성했다.
2026-07-17 웹 조사 결과 확인한 현재 권장 패턴(**Expo Modules API** — 구식 `NativeModules`+
`@ReactMethod` 대신 `Module`/`ModuleDefinition` DSL, 로컬 모듈은 `./modules` 디렉토리 컨벤션으로
자동 오토링킹)을 그대로 따라 구성:

```
modules/pace-overlay/
  expo-module.config.json       # platforms: ["android"], PaceOverlayModule 등록
  android/
    build.gradle
    src/main/AndroidManifest.xml  # SYSTEM_ALERT_WINDOW 권한 + Service 선언(매니페스트 병합으로 자동 합류)
    src/main/java/expo/modules/paceoverlay/
      PaceOverlayModule.kt        # hasOverlayPermission/requestOverlayPermission/start/updateRemaining/stop
      PaceOverlayService.kt       # Foreground Service + WindowManager.TYPE_APPLICATION_OVERLAY 알약 뷰
  index.ts                        # requireNativeModule('PaceOverlay') JS 바인딩
```

- `services/platform/overlayService.android.ts`가 이 모듈을 방어적 `require`로 로드 —
  `npx expo prebuild` + EAS Dev Client 빌드 전(Expo Go 등)에는 자동으로 `supportsSystemOverlay=false`
  로 폴백해 capabilities가 상위 UI에 정확히 반영된다.
- `app/overlay/index.tsx`(DEV SIMULATOR 화면)가 세션 시작/틱/종료마다 `overlayService.startSession/
  updateRemaining/endSession`을 실제로 호출하도록 연결 — 네이티브 모듈이 링크된 실기기에서는 인앱
  시뮬레이터와 진짜 시스템 오버레이가 동시에 뜨는 걸 바로 확인할 수 있다.
- **⚠️ POC 단계 명시**: `PaceOverlayService.kt`의 오버레이 뷰는 RN 컴포넌트(`OverlayBar.android.tsx`)를
  그대로 렌더링하지 않고 순수 네이티브 `TextView`로 최소 정보(`Pace ⏱ Xm Left`)만 표시한다 — 별도
  윈도우에 React 트리를 브릿지하는 건 두 번째 `ReactRootView` 인스턴스가 필요한 상당한 후속 작업이라
  1단계 POC 범위에서 제외. 색상(`#5856D6` 등)은 `constants/theme.ts`와 수동으로 값만 맞춰뒀다(Kotlin이
  JS 상수를 못 읽음 — 값이 바뀌면 양쪽 다 갱신 필요). **이 코드는 아직 `npx expo prebuild` + 실기기
  빌드로 컴파일 검증되지 않았다** — 다음 단계는 Dev Client 빌드 후 실기기(또는 에뮬레이터)에서
  권한 요청→오버레이 표시→갱신→종료 전체 플로우를 확인하는 것.
- Android 17+ Bubbles API 우선 전략(이미 문서화됨)은 별도 `PaceBubbleService`로 후속 구현 예정 —
  이번 POC는 레거시 `TYPE_APPLICATION_OVERLAY` 경로만 구현.

### 남은 것 (다음 세션 우선순위, 이번엔 범위상 보류)
Android AccessibilityService(Auto Next 감지), iOS ActivityKit(Live Activity), iOS FamilyControls
(앱 차단), 커스텀 백엔드 서버 — 전부 실제 네이티브 빌드 환경(Android Studio/Xcode + 실기기 또는
에뮬레이터)이 있어야 검증 가능한 영역이라, 이번 세션은 "코드로 작성 가능한 최대치"인 Overlay POC까지
진행하고 나머지는 다음 라운드로 넘긴다.

---

## 실기기(에뮬레이터) 검증 1차 (2026-07-17) — pace_test AVD

기존에 다른 프로젝트(jlpt_test, jlpt_test2 AVD) 검증용으로 쓰던 에뮬레이터와 별도로 Pace 전용
**`pace_test`** AVD(Android 14, google_apis, x86_64, Pixel 6 프로필)를 새로 만들어 `npx expo prebuild`
+ `npx expo run:android`로 실제 네이티브 빌드·설치·구동까지 검증했다. 코드를
[github.com/eileen0321/PACE](https://github.com/eileen0321/PACE)에 최초 push.

### 빌드 단계에서 발견·수정한 버그 (전부 이번에 처음 실제 컴파일해봐서 드러남)
1. **`modules/pace-overlay/android/build.gradle`이 이 프로젝트의 Expo/AGP 버전과 안 맞는 옛날 API**
   (`ExpoModulesCorePlugin.gradle` + `getDefaultConfigProperty()`) 사용 — 실제 설치된 다른 Expo 모듈
   (`node_modules/expo-blur/android/build.gradle`)을 참고해 현재 표준인
   `plugins { id 'expo-module-gradle-plugin' }` 패턴으로 교체.
2. **`react-native-worklets` 누락** — Reanimated 4.x가 별도 peer dependency로 분리했는데 설치 안 돼
   있어서 Gradle이 즉시 실패. `npx expo install react-native-worklets`로 해결.
3. **`PaceOverlayModule.kt` Kotlin 컴파일 에러**: 0-인자 `Function`/`AsyncFunction` 블록에서 값 없는
   `return@Function`(암묵적 `Unit`)을 쓰면 Expo Modules DSL이 기대하는 `Any?`와 타입이 안 맞는다 —
   `appContext.reactContext?.let { }` 패턴으로 이른 return을 제거해 해결.

### 런타임에서 발견·수정한 버그 (빌드 성공 후 실제 탭/화면 조작으로 발견)
4. **Expo Router `Unmatched Route`** — `/(tabs)/home.tsx`는 있는데 루트 `/`에 매칭되는 라우트가 없어서
   콜드 스타트마다 404 화면이 떴다. `src/app/index.tsx`(→`/(tabs)/home` 리다이렉트) 신설로 해결.
5. **`useUserStore` ↔ `useSubscriptionStore` 순환참조** — Metro가 띄우는 지속형 LogBox 경고 배너가
   화면 하단 탭바 터치 영역을 실질적으로 가로막았다(시각적으로는 안 겹쳐 보여도 터치가 안 먹힘).
   `useSubscriptionStore`에 자체 `currentUserId` 상태를 둬서 `useUserStore`를 import하지 않도록
   순환을 끊어 해결 — 배너도 사라지고 탭 네비게이션도 정상화됨.
6. **게스트 로그인 폴백 부재(가장 심각)**: 백엔드가 아직 없어(`API_BASE_URL` 자리표시자) `loginAsGuest()`의
   네트워크 호출이 항상 실패하는데, 예전 코드는 실패 시 그냥 포기해 `user`가 영원히 `null`로 남았다.
   Home 화면 등은 `user?.email ?? 'guest@pace.app'` 같은 폴백 문구 때문에 겉보기엔 "Guest"로 정상
   렌더돼 문제를 못 알아챘지만, `user.id`를 요구하는 모든 SQLite 흐름(`app/overlay`의 세션 시작 등)이
   조용히 broken 상태였다 — Overlay 진입 시 "0m Left"만 계속 뜨는 증상으로 발견. `deviceId` 기반
   로컬 전용 유저(`local-${deviceId}`)로 폴백하도록 수정.
7. **`database/db.ts` 싱글톤 레이스**: `dbInstance`(값)만 캐싱해서, `openDatabaseAsync()`가 resolve되기
   전에 동시에 여러 곳에서 `getDb()`를 부르면(세션을 빠르게 여러 번 시작하는 등) 각자 별도 커넥션을
   열고 동시에 `execAsync(SCHEMA_SQL)`을 실행 — 네이티브 브릿지에서
   `NativeDatabase.prepareAsync` NullPointerException을 유발했다. `dbInstance` 대신 in-flight
   **Promise 자체**를 캐싱하도록 수정.

### 성공적으로 검증된 것
- `expo-modules-autolinking resolve --platform android` 결과에 `pace-overlay` 모듈이 정확히
  잡히고, 실제 Gradle 빌드에도 `Using expo modules: ... pace-overlay (0.1.0)`으로 포함됨.
- 앱 설치·구동, 4개 탭(Home/Stats/Focus/Settings) 전체 네비게이션 정상.
- `capabilities.supportsAutoNext`가 `EXPO_PUBLIC_ENABLE_AUTO_NEXT` 미설정 시 정확히 `false`로 평가돼
  Focus 탭에서 Auto Next 토글이 자동으로 숨겨짐 — capability 게이팅이 실기기에서도 의도대로 동작.
- Start Shorts → `/overlay` 진입 → SQLite 세션 기록 → `OverlayBar`(Android 플로팅 pill)에
  "Pace ⏱ 60m Left / AUTO ON" 정상 표시, DEV SIMULATOR 콘텐츠(healthy-shorts-assistant curated
  video 이식분)도 정상.
- **`PaceOverlay.hasOverlayPermission()`/`requestOverlayPermission()`이 실제로 Android
  "다른 앱 위에 표시" 시스템 설정 화면을 열고, 권한 허용/거부 상태를 JS가 정확히 읽어온다** —
  JS→Kotlin 네이티브 브릿지가 실기기에서 end-to-end로 동작함을 확인한 것이 이번 검증의 핵심 성과.

### 미해결 (다음 라운드)
- **`PaceOverlayService`의 실제 `WindowManager` 오버레이 렌더링은 육안으로 아직 확인 못 함** — 권한을
  허용한 뒤 재시도했으나, `pm clear`로 앱 데이터를 반복 초기화하며 테스트하는 과정에서 권한이 같이
  초기화되거나 좌표 실수로 토글을 놓치는 등 수동 테스트 자체의 재현성이 흔들려 결론을 못 냈다.
  다음엔 (1) 권한을 한 번 허용한 뒤 앱 데이터를 건드리지 않고 (2) 홈으로 나가서 (3) 오버레이 뷰가
  실제로 그려지는지만 깨끗하게 재확인할 것.
- 좌표 기반 UI 자동화 시 `adb shell input tap`은 **스크린샷의 displayed 픽셀이 아니라 항상 실제
  기기 해상도 좌표**를 써야 하고(이번에 여러 번 실수함), `uiautomator dump`로 정확한 `bounds`를
  구해서 중심좌표를 계산하는 편이 훨씬 안전하다 — 다음 실기기 테스트 세션을 위한 메모.

---

## i18n / 리뷰어 화이트리스트 / 결제 로그인 가드 (2026-07-17) — jlpt-master 공용 자산 이식

"jlpt-master에서 공용으로 가져올 건 다 가져와라"는 지시에 따라, 언어 설정·심사관 우회·결제 전
로그인 가드를 jlpt-master의 실전 검증된 패턴 그대로 이식했다(단, 시각적 요소는 Pace 자체 플랫
디자인 원칙과 충돌하지 않는 범위로 제한 — 아래 "포팅하지 않은 것" 참고).

### 언어 설정 (jlpt-master `src/i18n/index.ts` + `LangContext.tsx` 패턴)
- **`services/i18n/translations.ts`**: `{ en: {...}, ko: {...} }` 딕셔너리. jlpt-master는 화면 구분
  없이 완전 플랫 구조를 쓰지만(문자열이 72KB, JLPT 콘텐츠가 훨씬 많아서), Pace는 문자열 수가
  훨씬 적어 화면별로 중첩(`home.*`, `focus.*` 등)해 가독성을 높였다 — 접근 방식(`t(key)`,
  파라미터 보간)은 동일하게 유지.
- **번역 원칙(사용자 지시 반영)**: 문장/설명은 자연스러운 한국어로 의역하되, 이미 굳어진 짧은
  기능명(`Auto Next`, `Sleep Timer`, `Daily Limit`, `ON`/`OFF`, `PRO MEMBER` 등)은 한국어 UI에서도
  영문 그대로 유지 — "무조건 전부 한글화" 금지. 오버레이 압축 표기(`23m Left`)는
  `formatRemaining.ts`에 명시했듯 로케일 무관으로 고정(화면이 좁아 압축 표기가 필수).
- **`services/i18n/index.ts`**: `useTranslation()` 훅이 `useSettingsStore.settings.language`를
  구독해 언어 변경 시 자동 리렌더 — jlpt-master의 `LangContext`(React Context)와 달리 Pace는
  기존 "확정 결정"(Zustand 우선)을 그대로 따라 Context 없이 구현했다. `language: 'system'`이면
  `expo-localization`의 기기 로케일을 따르고(ko가 아니면 en으로 폴백), `'en'`/`'ko'`로 직접 고정도
  가능 — Settings 탭에 System/English/한국어 3단 선택 칩 추가.
- `types/models.ts`의 `UserSettings.language` + `database/schema.ts`의 `user_settings.language`
  컬럼(SQLite 미러)까지 일관되게 추가.

### 스토어 심사관 화이트리스트 (jlpt-master `src/config/reviewers.ts` + `PremiumContext.tsx` 이식)
- **`constants/reviewers.ts`**: `REVIEWER_EMAILS` 배열 + `isReviewerEmail()`. 이 이메일로 소셜
  로그인하면 RC(RevenueCat) 응답과 무관하게 로컬에서 즉시 프리미엄을 부여한다 — 애플/구글 심사관이
  프리미엄 기능을 결제 없이 검증할 수 있어야 앱 심사를 통과할 수 있다(히든 리뷰어 링크 없이 이메일
  화이트리스트만으로 판정하는 방식이 일반 유저의 프리미엄 우회를 막으면서도 심사관 접근은 보장).
- **`useSubscriptionStore.identify()`**: `userId`(=이메일, jlpt-master 계약)가 화이트리스트에 있으면
  `isReviewer: true` + `isPremium: true`로 즉시 확정하고, 이후 `applyCustomerInfo()`(RC 콜백)는
  `isReviewer`가 true인 동안 절대 덮어쓰지 않는다 — jlpt-master가 실제로 겪은 버그("리뷰어인데
  RC entitlement가 나중에 도착해 무료로 되돌아감")를 처음부터 방지.
- Settings 화면 플랜 배지가 심사관 세션에서는 "REVIEWER"로 별도 표시(일반 PRO MEMBER와 구분).

### 결제 전 로그인 가드 (jlpt-master `PremiumPaywallModal.tsx`의 `blockIfNotSignedIn` 로직만 이식)
- `app/paywall/index.tsx`에 게스트/비로그인 상태에서 결제를 막는 가드 추가 — 로그인 없이 결제하면
  RC가 익명 ID로 구매를 잡아 이후 실제 계정 이메일과 영영 매칭이 안 되는 사고가 날 수 있다
  (jlpt-master가 2026-07-17 실결제 사고로 직접 확인한 리스크). 비로그인 상태로 구매/복원을 누르면
  로그인 화면으로 안내하는 Alert를 띄우고 결제 자체는 진행하지 않는다.

### 포팅하지 않은 것 (의도적 제외)
`PremiumPaywallModal.tsx`의 시각 요소(골드 그라디언트 왕관 배지, `GlassBlurLayer`, 컨페티,
PanResponder 드래그-닫기, 다크모드 테마 시스템)는 이식하지 않았다 — Pace 기획서의 디자인 원칙
("No Gradients, No Glassmorphism, No 3D")과 정면으로 배치되고, 이걸 온전히 가져오려면
`GlassBlurLayer`/`AppAlertSheet`/`useReduceMotion`/`useSheetNavBarColor`/`DarkModeContext`/
`prodLogger` 등 jlpt-master 전용 인프라를 통째로 이식해야 해서 비용 대비 가치가 낮다고 판단.
**로직(가드·플랜 선택·구매/복원 흐름)만 골라 이식하고 화면은 Pace 자체 플랫 디자인을 유지**하는
쪽이 "가져올 건 다 가져오되 Pace 정체성은 지킨다"는 절충으로 적절하다고 판단했다.

---

## 진행 상황

- [x] Expo TypeScript 프로젝트 생성 (`create-expo-app` blank-typescript)
- [x] 핵심 의존성 설치 (expo-router, expo-sqlite, reanimated, safe-area-context, gesture-handler, zustand, react-query, react-native-purchases, @expo/vector-icons 등)
- [x] Zustand 스토어 5종 (useUserStore, useSettingsStore, useStatsStore, useTimerStore, useSubscriptionStore)
- [x] 커스텀 백엔드 API 클라이언트 + 인증 서비스(`services/api/client.ts`, `services/auth/deviceId.ts`)
- [x] SQLite 스키마/마이그레이션 + sessionsRepo(오늘 사용량/주간 통계/비디오 통계 쿼리)
- [x] `services/platform` 인터페이스 + android/ios stub (Usage/AutoNext/Overlay/Focus)
- [x] Expo Router 화면 스캐폴딩 (tabs, onboarding, auth, paywall, overlay) — `app.json`에 `expo-router` root를 `./src/app`로 지정, `main`을 `expo-router/entry`로 변경
- [x] 테마/디자인 토큰 상수화 — healthy-shorts-assistant UI 포팅 후 iOS 시스템 인디고 팔레트로 갱신
- [x] healthy-shorts-assistant UI 전체 이식 (Home/Focus/Stats/Settings 4탭 + 오버레이 바) — "UI 포팅" 섹션 참고, tsc 0 errors 확인
- [x] Android=floating pill / iOS=frame 오버레이 형태 차분 적용
- [x] AppCapabilities 통합 서비스, 앱별 Auto Next override, 앱별 사용량 쿼리, Auto Next 스토어 리스크 feature-flag (외부 리뷰 2차 반영)
- [x] Repository 계층 분리(sessions/stats), jlpt-master RevenueCat 웹훅 계약 문서화, RC identify/reset 로그인 연동 (외부 리뷰 3차 반영)
- [x] useSessionStore/useCapabilityStore, settingsRepository/subscriptionRepository(SQLite 미러), Google/Apple 소셜 로그인 SDK 코드 연동, Android Overlay 네이티브 POC(`modules/pace-overlay`) (외부 리뷰 4차 반영)
- [x] 실기기(pace_test AVD) 빌드/설치/전체 탭 네비게이션 검증 + 발견된 버그 7종 수정(게스트 폴백, SQLite 레이스, 순환참조, Unmatched Route 등) — "실기기 검증 1차" 섹션
- [x] Android Overlay 네이티브 모듈 컴파일 성공 + `hasOverlayPermission`/`requestOverlayPermission`이 실제 Android 설정 화면을 여는 것까지 확인(실제 `WindowManager` 오버레이 렌더는 아직 육안 미확인)
- [x] i18n 시스템(jlpt-master `i18n`/`LangContext` 패턴 이식, `services/i18n`) + Settings 언어 선택 UI
- [x] 스토어 심사관 화이트리스트(jlpt-master `reviewers.ts`/`PremiumContext` 패턴 이식, `constants/reviewers.ts` + `useSubscriptionStore.isReviewer`)
- [x] 결제 전 로그인 가드(jlpt-master `PremiumPaywallModal.blockIfNotSignedIn` 로직 이식, 시각 요소는 Pace 플랫 디자인 유지)
- [ ] RevenueCat 연동 실키 발급 및 실기기 검증 (현재는 `EXPO_PUBLIC_RC_*` 미설정 시 로컬 캐시 폴백만 동작)
- [ ] Google/Apple 로그인 실기기 검증 (실키 + `npx expo prebuild` + EAS Dev Client 빌드 필요, 코드 자체는 완료)
- [ ] Android Overlay `WindowManager` 실제 렌더 재확인 (권한 허용 상태 유지한 채 깨끗하게 재테스트 필요 — "실기기 검증 1차" 미해결 항목 참고)
- [ ] 커스텀 백엔드 서버 자체 구현(현재 `API_BASE_URL`은 자리표시자, 실제 서버 없음)
- [ ] Android AccessibilityService(Auto Next 감지), Bubbles(17+) 네이티브 모듈
- [ ] iOS 네이티브 모듈(ActivityKit, FamilyControls) — EAS Dev Client 빌드 전제, 별도 작업
- [ ] 폰트 파일 추가(Inter/Plus Jakarta Sans/JetBrains Mono) 후 `typography.displayFontFamily`/`monoFontFamily` 연결
- [ ] "Wholesome Feed Breakdown" 카테고리 실계측(현재 정적 목업 비율)
- [ ] `REVIEWER_EMAILS`에 실제 스토어 제출용 테스트 계정 등록(현재 빈 배열 — 스토어 제출 전 필수)
