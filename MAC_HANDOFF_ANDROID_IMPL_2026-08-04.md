# 🍎 Mac 세션 인계 — Android에 구현된 것 전수 목록 (2026-08-04)

> **이 문서의 목적**: Windows 세션(Android/공통 담당)이 지금까지 구현한 것을 **실제 코드로 다시 확인해서**
> 한 장에 정리한 것이다. 맥 세션이 "iOS에도 있어야 하는데 없는 것"과 "iOS에서는 애초에 불가능해서
> 안 하는 게 맞는 것"을 구분해서 볼 수 있게 나눠 적었다.
>
> **작성 근거**: 기억이나 과거 로그가 아니라 이번에 다음을 직접 읽어서 확인했다 —
> `git ls-files`로 플랫폼 분기 파일 전수, `modules/**/*.kt`·`*.swift` 네이티브 인벤토리,
> `PaceOverlayModule.kt`의 export 목록 전수, `src/services/platform/types.ts`(플랫폼 계약 원문),
> `overlayService.ios.ts`/`bluetoothService.ios.ts`/`autoNextService.ios.ts`(스텁 실제 반환값),
> `api/shorts-entry.ts`·`src/services/shortsEntry.ts`, 광고 3파일, `stats.tsx`.
>
> 상세 배경·실측 로그는 `PACE_PROJECT_MANAGEMENT.md` §6에 있다. 이 문서는 **그것의 iOS 관점 색인**이다.

---

## 0. 30초 요약

| 구분 | 개수 | 뜻 |
|---|---|---|
| 🟢 이미 양쪽 적용 | 4건 | Mac이 할 일 없음 |
| 🔴 iOS 작업 필요 | 6건 | 아래 §4 — 우선순위순 |
| ⛔ iOS 불가능(구조적) | 3건 | 시도하지 말 것, 근거 첨부 |
| ⚠️ iOS "가짜 UI" | 2건 | 정직성 이슈 — 숨기든 구현하든 결정 필요 |

**가장 급한 것 하나만 고르면**: §4-1 **iOS 쇼츠 다음 영상을 유튜브 알고리즘에 맡기기**
(사장님이 설계를 확정하셨고, 지금 iOS만 정반대로 구현돼 있다. "아이폰에서 다 같은 영상"의 근본 원인).

---

## 1. 네이티브 모듈 인벤토리 (실측)

### Android — Kotlin 12개

| 파일 | 역할 |
|---|---|
| `PaceOverlayService.kt` | **핵심.** 포그라운드 서비스 = 알약(오버레이), Daily Limit 카운트다운, 취침 타이머, 휴식 알림, 수면감지 2단계 상태기계, 실시청 초 누적(`watched_seconds`) |
| `PaceAccessibilityService.kt` | 접근성 — 자동 넘김(`dispatchGesture` 스와이프), 볼륨키/BT 키 이벤트(`onKeyEvent`), 재생 위치 관찰 |
| `PaceOverlayModule.kt` | JS 브릿지 — **함수 53개 + 이벤트 1개**(`onFeedMediaCommand`) |
| `PaceHandWaveDetector.kt` | 카메라 손 밀어내기(shoo) 감지 — growth/sweep + **속도 축**(2026-08-03 추가) |
| `PaceSnapDetector.kt` | 마이크 핑거스냅 감지 — **현재 비활성**(`capabilities.supportsFingerSnap=false`, 코드는 보존) |
| `ForegroundAppWatcher.kt` | UsageStats 기반 전경 앱 폴링(알약 표시/숨김) |
| `PaceBootReceiver.kt` | `BOOT_COMPLETED` + **`ACTION_MY_PACKAGE_REPLACED`**(앱 업데이트 시 세션 복구) |
| `PaceTickReceiver.kt` | `AlarmManager` 틱 수신(Doze 대응) |
| `PaceFeedMediaSession.kt` | 피드용 독립 MediaSession + AudioFocus |
| `PaceRewardedAdActivity.kt` | 쇼츠 위에 띄우는 네이티브 보상형 광고 |
| `PaceShareCaptureActivity.kt` | 공유/캡처 수신 |
| `PaceFlipModule.kt` | 뒤집기 감지(양쪽 다 있음) |

### iOS — Swift 6개

`PaceFlipModule` / `PaceGestureModule` / `PaceLiveActivityModule`+`PaceAttributes` / `PaceSleepModule` / `PaceVolumeKeyModule`

→ **비대칭이 크다.** Android는 "유튜브 앱을 밖에서 조종"하는 인프라가 통째로 있고, iOS는 "앱 안 Pace Feed"에
필요한 최소 모듈만 있다. 이건 OS 제약에서 오는 정당한 비대칭이지 결함이 아니다 — 다만 **어느 기능이 어느
쪽에 얹혀 있는지**를 아래에서 나눈다.

---

## 2. 플랫폼 계약 = `src/services/platform/types.ts`

**맥 세션이 이 파일 하나만 읽으면 전체 지도가 나온다.** 메서드마다 "Android는 실제 동작 / iOS는 무엇을
반환하는지"가 주석으로 전부 적혀 있고, 그게 실제 구현과 일치하는 것을 이번에 대조 확인했다.

iOS 스텁의 실제 반환값(확인함):

| 메서드 | iOS 반환 | 호출부에 미치는 영향 |
|---|---|---|
| `getWatchedSeconds()` | `null` | 통계가 **벽시계로 폴백** — Android와 기준이 다름(§4-2) |
| `getSupportedAppForegroundSecondsToday()` | `null` | 분석 "기록 범위" 섹션 자체가 렌더 안 됨(§5-2) |
| `getVideoWatchCount()` | `0` | 편수 통계 0 고정 |
| `consumeExpired()` | `null` | 네이티브 만료 경로 없음 |
| `hasAccessibilityPermission()` 외 권한 6종 | `true` | 개념 없음 — 정상 |
| `bluetoothService.*` **20개 메서드 전부** | no-op / `0` / `false` | §6 "가짜 UI" 문제의 뿌리 |
| `autoNextService.start()` | **throw** | 상위 UI가 `supportsAutoNext=false`로 이미 숨김 |

---

## 3. 🟢 이미 양쪽에 적용됨 — Mac이 할 일 없음

| 항목 | 왜 자동으로 적용되는가 |
|---|---|
| HOT/피드 리스트 지역·언어 자동 분기 | `/api/youtube-shorts`를 iOS Pace Feed도 공유(`useShortsQueueStore → fetchShortsPage`). **백엔드만 고쳤으므로 iOS 앱 수정 없이 이미 적용 중** |
| 언어별 검색어(ko/ja/es/pt) | 위와 동일 — iOS Pace Feed도 한국어 영상이 나온다 |
| 시간 시드 로테이션 / 캐시 창(5~15분) + 카테고리 3개 혼합 | 위와 동일(`5afa142`) |
| 쇼츠 HOT의 라이브·프리미어 제외(`P0D`) + 카테고리당 50개 | 백엔드 `ShortsHotService.java` — Windows에서 컴파일·배포 검증 완료 |

---

## 4. 🔴 iOS에 작업이 필요한 것 (우선순위순)

### 4-1. 🔴🔴 쇼츠 "다음 영상"을 유튜브 알고리즘에 맡기기 — 사장님 설계 확정

**사장님 원문**: *"안드로이드랑 애플이 시작 주소만 다를 뿐 유튜브 알고리즘 타서 다음 영상을 보여야지"*

확정된 설계:
```
서버(정책)  →  시작 주소/시드 재료만 준다
기기        →  시작 영상을 스스로 고른다 (userSaved 우선, 없으면 serverPool 무작위)
그 다음      →  유튜브가 자기 알고리즘으로 이어간다   ← 우리가 관여하지 않는다
```

**지금 iOS는 정반대다** — 스와이프를 가로채 우리 큐의 다음 영상으로 강제 이동시킨다:
```
onUserSwipe → src/app/feed/index.tsx:551  goNext() → player.advance() → videoId 교체 → WebView 네비게이션
```
목록은 CDN 캐시로 공유되므로 **결과적으로 아이폰 사용자 전원이 같은 영상을 본다**(사장님 지적의 근본 원인).
Android는 유튜브 앱으로 넘겨버리니 그 뒤가 자동으로 유튜브 알고리즘이었는데, iOS만 우리가 계속 운전 중이다.

**바꿀 방향**: `goNext()/player.advance()` 대신 **이미 있는** `window.paceAdvance()`를 호출해 유튜브 페이지가
스스로 넘어가게 하고, 우리는 `onVideoChange`로 **관찰만** 한다.

> ⚠️ **앞선 기록 정정** — 문서 어딘가에 "유튜브에 맡기면 볼륨키/BT 리모컨으로 넘길 수단이 사라진다"고
> 적혀 있는데 **과한 우려였다.** `YouTubeShortsPlayer.ios.tsx:222`에 `window.paceAdvance`가 이미 있고
> 내부 `swipe()`가 릴 컨테이너 `scrollBy` → `window.scrollBy` → `ArrowDown` KeyboardEvent 3중으로 시도한다.
> **자동재생·볼륨키·리모컨을 유지한 채** 유튜브 알고리즘을 탈 수 있다.

**서버는 이미 iOS 몫을 내려주고 있다** — `api/shorts-entry.ts`가 `ios.startUrl`을 응답에 포함한다(`e5deaa2`):
```json
{ "strategies": [...],
  "ios": { "startUrl": "https://www.youtube.com/shorts/{videoId}",
           "videoIdSource": ["userSaved", "serverPool"] },
  "seedPool": ["...", "..."] }
```

> 🔧 **Mac이 반드시 같이 고쳐야 할 지점(안 고치면 위 필드가 버려진다)**:
> `src/services/shortsEntry.ts`가 현재 **Android 전용**이다 —
> - `openShortsFeed()`가 `if (Platform.OS !== 'android') return false;`로 즉시 반환한다(L153)
> - `sanitize()`가 `{ strategies, seedPool }`만 통과시켜 **`ios` 필드를 그대로 버린다**(L65~82)
> - `prefetchShortsEntryPolicy()` 호출부도 Android로 게이팅돼 있다(`94a22de`)
>
> → iOS에서 쓰려면 `sanitize`에 `ios` 보존을 추가하고, 프리페치 게이팅을 iOS도 통과하도록 풀어야 한다.
> `resolveVideoId()`(userSaved → serverPool)는 플랫폼 무관 코드라 **그대로 재사용 가능**하다.

**Mac이 검증할 체크리스트** (구조를 바꾸면 아래가 전부 이 경로에 얹혀 있다):

| # | 항목 | 확인 방법 | 깨지면 나타나는 증상 |
|---|---|---|---|
| 1 | 다음 영상이 유튜브 알고리즘인가 | 시드 영상 진입 → 2~3회 스와이프 → 우리 카테고리(힐링/공예)와 무관한 영상이 나오는지 | 계속 우리 목록만 나옴 = 안 바뀐 것 |
| 2 | 기기마다 다른 영상인가 | 다른 계정의 아이폰 2대에서 동시에 열어 비교 | 같은 영상 = 여전히 목록 공유 |
| 3 | 자동재생(AutoNext) | Focus Session 켜고 영상 끝까지 두기 | 안 넘어감 = `paceAdvance` 미동작 |
| 4 | 볼륨키 / BT 리모컨 다음 | 에어팟·다이소 리모컨 | 반응 없음 |
| 5 | 사용시간·편수 추적 | 몇 개 보고 분석 탭 숫자 증가 | 0 고정 = `onVideoChange` 미수신 |
| 6 | 수면감지 입력 신호 | 스와이프 후 무입력 시계 리셋되는지 로그 | 안 자는데 수면 종료됨 |
| 7 | 비로그인 인터스티셜 | 로그아웃 상태로 진입 | "앱에서 보기" 배너(기존 트레이드오프) |

> ⚠️ **제품 결정 필요**: 유튜브 알고리즘이 다음을 정하면 **우리가 큐레이션하던 "차분한 피드"(힐링/공예/자연)
> 컨셉이 사라진다.** 자극적인 콘텐츠가 나올 수 있다. 사장님이 이 설계를 지시하셨으므로 그대로 가되,
> **페이월·스토어 설명에 "차분한 대체 피드" 문구가 있으면 함께 조정**해야 한다.

---

### 4-2. 🔴 광고 개인화 분기가 iOS에도 걸렸다 — ATT 관점 검증 필요

`requestNonPersonalizedAdsOnly` **하드코딩을 제거하고 UMP 동의 기반으로 바꿨는데, 이 코드는 양 플랫폼 공용**이다:
- `src/components/home/AdBanner.tsx:98` → `requestNonPersonalizedAdsOnly: !canRequestPersonalizedAds`
- `src/services/ads/rewardedAd.ts:84` → 동일

즉 **iOS도 이제 GDPR 비대상 지역에서는 개인화 광고를 요청한다.** 그런데 iOS는 `app.json`에
`NSPrivacyTracking=false`이고 **ATT(App Tracking Transparency) 프롬프트가 없다.**

→ **Mac 확인 사항**: ATT 미동의 상태에서 개인화 광고 요청이 애플 심사/정책상 문제가 없는지.
문제가 있으면 **iOS만 NPA로 되돌리는 분기**가 필요하다(`Platform.OS === 'ios' ? true : !canRequestPersonalizedAds`).

참고 — 같이 들어간 광고 수정 중 **iOS에 영향 없는 것**:
- `adsConfig.ts`의 테스트기기 등록 해제(`if (!__DEV__ && !FORCE_TEST_DEVICES) return;`) — 기기ID가 Android 것
- `setAdsConsent` 네이티브 전달 — Android 전용 경로(§5-3)

**iOS에도 그대로 적용되는 것**:
- `_layout.tsx`의 **동의 실패 시 백오프 재시도**(5→10→20→40s + 포그라운드 복귀 시 리셋). 부팅 순간의
  일시적 네트워크 실패 하나로 그 세션 내내 배너가 안 뜨던 문제 — **iOS도 같은 코드라 같이 고쳐졌다.**
- `AdBanner.tsx`의 **로드 실패 사유 로깅**(`__DEV__` 게이트 일부러 안 걸었음). iOS 출시빌드 진단에도 쓸 수 있다.

---

### 4-3. 🔴 사용 시간 "실시청" 기준 — iOS는 오히려 더 정확히 만들 수 있다

Android는 접근성으로 재생 여부를 추정해 **실제 재생 중일 때만** 차감하도록 바꿨다(`watched_seconds`,
`PaceOverlayService`가 누적, prefs라 프로세스가 죽어도 이어짐). iOS는 `getWatchedSeconds()`가 `null`이라
**기존 벽시계로 폴백**한다 — 회귀는 없지만 두 OS의 통계 기준이 다르다.

> ⚠️ **정정** — 이 항목을 처음 쓸 때 "iOS는 IFrame 플레이어라서"라고 적었는데 **틀렸다**(사장님 지적).
> iOS는 IFrame을 쓰지 않는다. `YouTubeShortsPlayer.ios.tsx`는 `react-native-webview`로
> `youtube.com/shorts/<ID>` **페이지를 직접 로드**한다. Android의 base `.tsx`도 같은 WebView 방식이지만
> **파일이 갈린 별개 구현**이고, Pace Feed 자체는 `supportsPaceFeed: Platform.OS === 'ios'`로 iOS 전용이다.

**이유는 틀렸지만 결론은 유효하다**: 그 WebView에 주입한 JS가 실제 `<video>` 엘리먼트에 붙어
`play`/`pause`/`playing`/`waiting`/`stalled` 이벤트를 `postMessage`로 RN에 보내고 있다
(`send({type:'audio', ... paused: v.paused})` 및 이벤트 리스너 등록부). 즉 **iOS는 접근성 추정이 아니라
플레이어의 실제 상태를 이미 받고 있다** — 그 신호로 실시청 초를 누적해 `getWatchedSeconds()`가 실제 값을
반환하게 하면 양쪽 기준이 통일된다. **새 배선이 아니라 이미 오는 이벤트를 집계만 하면 된다.**

---

### 4-4. 🔴 앱 업데이트 후 세션 표시 복구 — iOS에도 같은 구멍이 있는지

Android에서 발견: **스토어 업데이트가 패키지를 교체하며 포그라운드 서비스를 죽여**, 세션 중에 업데이트하면
알약이 조용히 사라지고 세션만 prefs에 남았다. 재부팅 복구(`BOOT_COMPLETED`)는 있었는데 업데이트 경로만
빠져 있었다 → `PaceBootReceiver`에 `ACTION_MY_PACKAGE_REPLACED` 추가로 해결.

→ **iOS도 앱 업데이트 시 Live Activity가 어떻게 되는지 확인 필요.** 세션은 살아있는데 Live Activity만
사라지면 Android와 똑같은 증상이다.

---

### 4-5. 🔴 App Store Connect 마케팅 URL — app-ads.txt 크롤링용

app-ads.txt 호스팅은 **사장님이 완료하셨고 검증됐다**: `https://eileen0321.github.io/app-ads.txt`
(내용이 저장소 루트 `app-ads.txt`와 완전 일치, 퍼블리셔 ID `pub-3201481146134957`도 `app.json`과 대조 확인.
`github.io`는 Public Suffix라 독립 루트 도메인으로 인정됨).

→ **App Store Connect의 마케팅 URL에 같은 도메인(`https://eileen0321.github.io`)을 넣어야** AdMob이 iOS 쪽도
크롤링한다. 안 넣으면 **iOS 인벤토리가 계속 "승인되지 않음"으로 남아 수익이 깎인다.**
(파일 하나로 양 플랫폼 커버됨 — 같은 퍼블리셔 ID.)

---

### 4-6. 🔴 `git ls-files ios/` 확인 (이전부터 열려 있던 항목)

Android는 `/android`가 `.gitignore`에 걸려 있어 네이티브 커스터마이징이 **전부 로컬에만** 있었고 매
prebuild/EAS 빌드마다 조용히 사라지고 있었다(§6 "2026-07-29" 로그). **iOS도 같은 구조라면
Info.plist/entitlements 등 수동 수정분이 실제 빌드에 반영 안 되고 있었을 수 있다.**

관련: D7의 Google 로그인 `iosUrlScheme`는 네이티브 설정(Info.plist)이라 다음 prebuild/빌드부터 반영된다 —
**아직 실기기 검증 안 됨.**

---

## 5. ⛔ iOS에서는 불가능 — 구현 시도하지 말 것 (근거 포함)

### 5-1. 쇼츠 진입 "정책"의 Android 부분 (`strategies`)
`strategies`는 "**유튜브 앱을 어떻게 열지**"를 정하는 것인데 iOS는 애초에 외부 앱을 열지 않는다(앱 안
Pace Feed가 직접 재생). `launchPlatformApp`/`openShortsFeed` 모두 iOS에서 즉시 반환한다.
→ **단, `ios.startUrl`은 다르다** — 그건 §4-1에서 Mac이 실제로 써야 하는 필드다. 혼동 주의.

### 5-2. 유튜브 앱 사용 시간 조회 (분석 화면 "기록 범위" 섹션)
`getSupportedAppForegroundSecondsToday()`가 iOS에서 `null`이고, 그래서 `stats.tsx`의 그 섹션 자체가 렌더되지
않는다. 이건 우리가 못 만든 게 아니라 **애플이 막았다**: Screen Time 사용량 데이터는 `DeviceActivityReport`
확장의 **샌드박스를 절대 벗어날 수 없다는 게 애플의 명시적 설계**다(확장은 네트워크 요청도 저장도 불가,
토큰조차 앱으로 전달 불가). 웹으로 확인함(2026-08-04). **우회로 없음.**

> Android는 이미 보유한 `PACKAGE_USAGE_STATS`로 "오늘 유튜브 켠 시간" vs "Pace가 기록한 시간"을 나란히
> 보여주고 차이가 5분 이상일 때만 안내 문구를 붙인다. 신규 권한 0개, 백그라운드 루프 0개.
> ⚠️ 두 값은 **측정 자가 다르다**(위는 `totalTimeInForeground`=켠 시간, 아래는 실제 재생 시간) —
> 그래서 문구를 "본 시간"이 아니라 **"켠 시간"**으로 썼다.

→ **스토어 설명에서 "사용 시간 추적"을 두 플랫폼 공통 기능처럼 쓰면 안 된다.** iOS의 정확한 경로는
앱 안의 Pace Feed다.

### 5-3. 광고 동의의 네이티브 전달 (`setAdsConsent`)
Android는 쇼츠 위에 **네이티브 액티비티**(`PaceRewardedAdActivity`)로 보상형 광고를 띄우기 때문에 네이티브가
동의 상태를 알아야 했다. iOS는 그 경로 자체가 없고 RN이 직접 광고를 띄우므로 **no-op이 맞다.**

---

## 6. ⚠️ iOS "가짜 UI" — 정직성 이슈, 결정 필요

### 6-1. 전역 Bluetooth Hands-Free (C5)
`useBluetoothStore` / `bluetoothService.ios.ts` 경로(Home / Settings / Stats의 "Bluetooth Hands-Free")는
**iOS에서 20개 메서드 전부 no-op 스텁**이다(이번에 파일 원문으로 재확인). "Enable"을 눌러도 **토스트만 뜨고
실제로 아무것도 안 켜진다.**

Pace Feed 안의 **별개** 볼륨키 리모컨(`useFeedRemoteControl.ios.ts`, 2026-07-22 수정으로 실동작 확인됨)과는
**다른 죽은 경로**다 — 이름이 비슷해서 계속 혼동돼 왔다.

→ 사장님이 "출시버전에서 블루투스가 하나도 안 된다"고 보고하셨는데, **iOS 쪽이라면 버그가 아니라 미구현**이다.
UI를 숨기든(`capabilities`에 플래그 추가) 실제 구현하든(`MPRemoteCommandCenter`) **결정이 필요하다.**

> 참고 — Android 쪽 같은 신고의 유력 원인은 다르다: `canRequestFilterKeyEvents`는 **서비스가 바인딩되는
> 시점에** 시스템이 부여하는 권한이라, 앱을 업데이트만 하고 접근성을 껐다 켜지 않으면 예전 capability(33,
> `FILTER_KEY_EVENTS` 없음)가 유지돼 `onKeyEvent()`가 아예 호출되지 않는다. 실기기에서 접근성 마스터 토글이
> 꺼져 있던 것도 확인됨 → 재활성화 후 `capabilities=41` 확인.

### 6-2. Sign in with Apple 커스텀 버튼 (C2)
공식 버튼이 아닌 커스텀 텍스트 버튼 — HIG 4.8 리뷰 리스크. 열려 있음, 수정 여부 미확인.

---

## 7. Android 전용이지만 **개념은 iOS에도 필요한** 것 (참고)

수면감지 2단계는 Android에서 **전 구간 검증 완료**(2026-08-04):
```
23:37:29  SLEEP stage=SUSPECT noInputMs=630389        ← 1단계(무입력 10분)
23:42:44  SLEEP stage=PROMPTED — "아직 보고 계세요?"   ← 2단계 확정 + 팝업
23:44:29  SESSION END reason=sleep_detected           ← 30초 무응답 → 종료
```
**"2단계 보류"가 특히 중요하다** — 조명 켜진 방에서 폰이 세워져 있을 때(`dark=false(lux=57.3)
flat=false(gz=5.33)`) 정확히 확정을 거부했다. 예전 수면감지가 폐기된 결정적 이유("거치대에 세워두고 보는데
강제 종료")가 구조적으로 재발할 수 없다는 증거다.

iOS에는 `PaceSleepModule.swift` + `useSleepGuard.ios.ts` + `sleepBackfill.ios.ts`가 이미 있다 — **같은 2단계
게이트(밤 시간대 + 어두움 + 눕힘)를 쓰고 있는지 대조해볼 가치가 있다.** 1단계(무입력)만으로 종료하면
위 "거치대" 회귀가 iOS에서 재발한다.

---

## 8. Mac 세션 액션 아이템 (복사해서 쓰는 체크리스트)

- [ ] **§4-1** iOS 쇼츠를 유튜브 알고리즘에 맡기기 — `feed/index.tsx:551` + `shortsEntry.ts`의 `sanitize`/게이팅
- [ ] **§4-1** 위 7개 항목 실기기 검증
- [ ] **§4-2** ATT 미동의 상태의 개인화 광고 요청이 애플 정책상 안전한지 확인 → 필요시 iOS만 NPA 분기
- [ ] **§4-3** WebView `<video>` 이벤트로 실시청 초 누적 → `getWatchedSeconds()` 실제 값 반환
- [ ] **§4-4** 앱 업데이트 시 Live Activity 생존 여부 확인
- [ ] **§4-5** App Store Connect 마케팅 URL에 `https://eileen0321.github.io` 입력
- [ ] **§4-6** `git ls-files ios/`로 네이티브 폴더 커밋 여부 확인
- [ ] **§6-1** iOS 전역 Bluetooth Hands-Free — 숨김 vs 구현 결정
- [ ] **§7** iOS 수면감지가 2단계 게이트를 쓰는지 대조
- [ ] 기존 큐: C3(Live Activity 실기기) / C4(위젯 서명 빌드) / C1(Sleep Timer 네이티브) / C2(Apple 버튼)

---

## 9. 이 문서에서 **바로잡은** 과거 기록

문서가 길어지며 틀린 서술이 몇 개 쌓였다. 맥 세션이 옛 서술을 근거로 헛수고하지 않도록 여기 모아둔다.

| 과거 서술 | 정정 |
|---|---|
| "iOS Pace Feed는 IFrame 플레이어" | **틀림.** `react-native-webview`로 `youtube.com/shorts/<ID>` 페이지 직접 로드 |
| "유튜브에 맡기면 볼륨키/리모컨으로 넘길 수단이 사라진다" | **과한 우려.** `window.paceAdvance`가 이미 있고 3중 폴백으로 동작 |
| "Play Store에 구독 상품이 없다"(D11) | **낡음.** `pace_premium_monthly`/`yearly` 둘 다 ACTIVE. 남은 건 RC Offering 배선뿐 |
| "Play 등록정보 없어서 실광고 서빙 불가" | **틀림.** 릴리즈 빌드에서 실광고 정상 표시 확인. 원인은 동의 재시도 부재였음 |
| "알약 잔상이 앱 두 번 열림의 원인" | **틀림.** 홈 인사이트 배너 재추첨으로 인한 레이아웃 이동이었음 |
