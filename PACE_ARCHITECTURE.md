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
| 제품 전략(2026-07-17 피벗) | **Android="Overlay Assistant", iOS="Pace Player"** | 아래 "제품 전략 피벗" 섹션 참고. iOS는 더 이상 Live Activity 컴패니언이 아니라 자체 영상 재생+오토넥스트 — 단, iOS 콘텐츠 출처는 미확정 블로커 |
| MVP 지원 앱 | **YouTube Shorts + Instagram Reels만** (설정 UI 없이 하드코딩, 자동 감지) | 5개 앱 전체 지원은 추후 확장 |

---

## 제품 전략 피벗 — Android "Overlay Assistant" vs iOS "Pace Player" (2026-07-17 확정)

기존 설계(아래 "iOS Live Activity 상세 설계", "iOS: Live Activity + 앱 차단 구조", "플랫폼 Feature
Matrix"의 "제품 포지셔닝 결론")는 **iOS를 "실제 YouTube/Instagram을 쓰는 동안 Live Activity로
시간만 보여주는 컴패니언"으로 설계**했었다. 이번에 "Auto Next(자동 넘김)가 Pace의 핵심 가치"라는
재정의에 따라 방향이 바뀌었다 — iOS는 Live Activity 컴패니언 대신 **"Pace Player"**, 즉 앱 내부에서
자체 영상 피드를 재생하고 자동 넘김까지 직접 처리하는 독립 플레이어로 간다. 아래 iOS Live
Activity/FamilyControls 섹션들은 **폐기가 아니라 "미래 보조 기능(잠금화면 상태 표시 등)"으로
강등** — 핵심 경로는 더 이상 그쪽이 아니다.

> ⚠️ **미해결 블로커 (구현 착수 전 필수 확인)**: Pace Player가 재생할 **영상 콘텐츠의 실제 출처가
> 아직 정해지지 않았다.** 실제 YouTube Shorts/Instagram Reels 콘텐츠를 라이선스 없이 자동재생
> 제어권까지 가진 서드파티 플레이어에 가져오는 건 일반적으로 각 플랫폼 이용약관상 허용되지 않는다.
> 이 문제를 풀지 않고 "Select Source: YouTube Shorts / Instagram Reels" 같은 라벨을 붙이면 사용자를
> 오도하는 UI가 된다. 두 가지 현실적 경로 중 하나를 확정해야 실제 구현에 들어갈 수 있다:
> 1. **콘텐츠를 무드/웰니스 큐레이션(호흡·마인드풀니스·짧은 학습 등, 지금 dev 시뮬레이터의
>    `CURATED_VIDEOS` 목업과 유사한 성격)로 명확히 재정의**하고 UI 라벨도 "YouTube Shorts"가 아니라
>    "Pace Feed" 같은 자체 브랜드로 정직하게 표기.
> 2. 실제 플랫폼 API/제휴를 통한 합법적 임베드 경로를 조사(대부분의 경우 자동 재생·자동 다음 넘김
>    같은 제어권까지는 안 줌 — 사업적으로 난이도 높음).
>
> 이 문서는 사용자가 "Pace Player로 전환"을 확정한 방향을 기록하지만, 콘텐츠 출처는 별도로 결정
> 필요 — 확정되기 전까지 아래 UI 플로우의 "Select Source" 화면은 실제 구현이 아니라 설계 초안으로만
> 취급할 것.

### MVP 지원 앱 축소
기존 5개 앱(YouTube/Instagram/TikTok/Facebook/Naver Clip) 전체 지원 대신,
**YouTube Shorts + Instagram Reels 2개만** MVP 범위로 축소 확정. 사용자가 앱을 켜고 끄는 설정
화면도 만들지 않는다 — `SUPPORTED_APPS` 상수에 하드코딩하고, Android는 AccessibilityService가
현재 포그라운드 앱의 packageName을 감지해 지원 앱일 때만 오버레이를 자동으로 표시/숨김한다
(아래 "필요한 것" 참고 — 이 감지 로직 자체는 아직 미구현).

```ts
// 향후 constants/supportedApps.ts
export const SUPPORTED_APPS = {
  youtube: 'com.google.android.youtube',
  instagram: 'com.instagram.android',
} as const;
```

### Start 버튼 플로우 — 플랫폼별 분기 (Home 화면은 공통 유지)

**Android — "Overlay Assistant"**
```
Home → Start
  ↓
App Picker 바텀시트 (YouTube Shorts / Instagram Reels)
  ↓ 사용자 선택
overlayService.startSession() → 선택 앱 실행(딥링크/인텐트) → 시스템 오버레이 표시
  ↓
AccessibilityService가 포그라운드 앱 계속 감시
  → 지원 앱이면 오버레이 유지, 아니면(카톡 등 전환 시) 자동 숨김 → 복귀 시 자동 재표시
  ↓
Auto Next는 Accessibility+제스처로 실제 YouTube/Instagram 위에서 동작(기존 설계 그대로 유지)
```

**iOS — "Pace Player" (신규 방향, 콘텐츠 출처 미확정 상태로 설계만 기록)**
```
Home → Start
  ↓
최초 1회만: 온보딩 시트("Auto Next is provided through Pace Player — videos play inside Pace")
  ↓
Source 선택 시트 (라벨은 콘텐츠 출처 결정 후 확정 — 위 블로커 참고)
  ↓ 사용자 선택
Pace Player 화면 진입(앱 내부, 새 탭/스택) → 영상 피드 자동 재생 + 자동 다음 넘김
  ↓
오버레이 없음(iOS는애초에 시스템 오버레이 불가 — 기존 제약 그대로) — Player 자체가 상태 표시 겸함
```

### 필요한 것 (구현 착수 전 정리)
1. **[블로커] iOS Pace Player 콘텐츠 출처 확정** — 위 경고 박스 참고. 이게 안 풀리면 iOS Player
   자체를 실제로 만들 수 없음(무엇을 재생할지가 없으므로).
2. **Android AccessibilityService 신규 모듈** — 현재 `modules/pace-overlay`는 오버레이 렌더만
   구현돼 있고, "포그라운드 앱이 뭔지 감지"하는 AccessibilityService는 아직 없음(진행 상황
   체크리스트에 이미 "아직 시작 안 함"으로 기록돼 있던 항목 — 이번 피벗으로 우선순위 상승).
3. **Android App Picker 바텀시트 UI** — Start 탭 시 YouTube/Instagram 선택 화면(신규 컴포넌트).
4. **iOS 온보딩 시트 + Source 선택 시트 UI** — 신규 화면 2개(콘텐츠 출처 확정 후 착수).
5. **iOS Pace Player 화면 + Player 엔진** — 신규 탭/스택 화면, 영상 재생 컴포넌트, 자동 다음 넘김
   로직(콘텐츠 출처 확정 후 착수). 기존 `overlay/index.tsx`의 dev 시뮬레이터 콘텐츠(`CURATED_VIDEOS`)
   재사용 가능성 있음(콘텐츠 출처를 "무드 큐레이션"으로 갈 경우).
6. **DB 스키마 확장(iOS Player용)** — `videos`(플랫폼/영상ID/제목/썸네일/길이) +
   `playlist_sessions`(재생 세션 기록) 테이블 신규 필요.
7. **`usePlayerStore`(Zustand) 신규** — currentVideo/currentIndex/isPlaying/autoNextEnabled +
   loadVideo/nextVideo/previousVideo 액션.
8. `services/platform`의 세션 시작 로직을 Android(오버레이)/iOS(Player)로 완전히 갈라야 함 —
   기존 `overlayService` capability 패턴을 확장하되, iOS 쪽은 더 이상 "오버레이 대체용
   Live Activity 시작"이 아니라 "Player 화면으로 네비게이션"이 됨(라우팅 로직 변경 필요).

### iOS Pace Player 성립 가능성 검증 — POC 체크리스트 (2026-07-18)

위 "[블로커] iOS Pace Player 콘텐츠 출처 확정" 항목에 대한 구체적 검증 계획. 현재 가설은
**"`WKWebView`로 `m.youtube.com/shorts`를 로드하면 실제 YouTube Shorts 피드 + 로그인 + Auto Next가
가능한가?"** — 이게 성립하면 콘텐츠 출처 블로커가 실질적으로 풀린다. **이 검증은 Xcode/iOS
시뮬레이터가 필요해 이 저장소(Windows 환경)에서는 실행 불가 — Mac 개발자 또는 Mac 환경의 Claude
Code/Gemini CLI/Cursor에게 아래 내용을 그대로 전달해서 진행할 것.**

**콘텐츠 출처 정리(중요, 이전 초안 대비 수정)**: 이 방식이 성립하면 Pace가 영상을 직접 호스팅하거나
큐레이션할 필요가 **전혀** 없다 — 첫 영상도, 다음 영상도 100% YouTube 자체 웹서버가 공급한다.
- **첫 영상**: 앱 실행 시 WKWebView가 `m.youtube.com/shorts`를 로드 — 로그인돼 있으면 구글 서버가
  유저의 시청 기록 기반 개인화 추천을, 비로그인이면 일반적인 인기 Shorts를 띄운다.
  Pace는 그저 이 웹페이지를 커스텀 UI로 감싸는 역할만 한다.
- **다음 영상**: YouTube Shorts 특유의 "무한 스크롤 피드" 메커니즘을 그대로 활용 — 재생 중 다음
  영상 3~4개가 이미 프리페치돼 있고, Pace는 `video.ended` 신호를 받으면 JS로 스크롤/터치 이벤트를
  주입해 그 다음 영상으로 "넘겨주기"만 한다. 서버 비용도 거의 안 든다.
- 즉 "이전 초안"에서 언급했던 "YouTube Data API로 Pace가 직접 큐레이션한 영상 큐"보다 **이 방식이
  훨씬 낫다** — 사용자의 실제 개인화 Shorts 피드를 그대로 보여주므로 "진짜 Shorts 관리 도구"라는
  제품 취지에도 더 부합. 단, 아래 검증이 실패하면 이 경로 자체가 무효가 되고 Data API 큐레이션
  경로(또는 콘텐츠 재정의)로 후퇴해야 한다.

**⚠️ 과도한 낙관 경계**: 위 가설은 이론상 그럴듯하지만, YouTube 모바일 웹의 Shorts 피드는
**React + Shadow DOM + Virtualized Feed**(화면에 보이는 부분만 렌더링하는 가상 스크롤) 구조일
가능성이 높다 — 그러면 단순 `window.scrollBy()` 한 줄로는 다음 영상이 안 넘어갈 확률이 높다.
아래 POC #5가 이 검증의 핵심이자 전체 가설의 성패를 가르는 지점.

**성공 조건**: 아래 10개 POC 중 8개 이상 PASS.

| # | 검증 항목 | 방법 | PASS 기준 |
|---|---|---|---|
| 1 | Shorts 로드 | `WKWebView`로 `https://m.youtube.com/shorts` 로드 | 첫 화면이 일반 YouTube Home이 아니라 Shorts 세로 풀스크린 피드, 로그인 없이도 재생됨, 자동재생됨, 주소창/하단바 숨김 가능 |
| 2 | Google 로그인 유지 | 로그인 후 앱 재실행 | 쿠키/세션 유지, 추천 피드가 계정 기반으로 개인화됨, 구독 피드/프리미엄 피드 접근 가능 |
| 3 | Shorts DOM 구조 확인 | Safari Web Inspector로 WKWebView 연결, `document.querySelector("video")` / `querySelectorAll("video")` | video 태그 발견됨 |
| 4 | 영상 종료 감지 | Injected JS: `video.addEventListener("ended", () => console.log("ENDED"))` | 영상이 끝날 때 이벤트 발생 확인 — 안 되면 Auto Next 자체가 성립 안 할 가능성 높음 |
| 5 | 다음 영상 이동 (**가장 중요, 아래 스크립트로 검증**) | 컨테이너 스크롤 → DOM 형제 요소 탐색 → 가상 터치 이벤트, 3단계 폴백 체인(아래 스니펫) | Short #1 → #2 → #3로 실제로 자동 이어지는가 — 세 가지 결과 해석은 아래 참고 |
| 6 | 연속 시청 안정성 | 10개/20개/30개 영상, 30분 이상 연속 재생 | 멈춤/광고/렌더링 깨짐/메모리 증가 여부 기록 |
| 7 | 광고 처리 (**매우 중요**) | 연속 시청 중 광고 발생 여부 관찰 | 광고 있음/없음, 광고 나올 때 Auto Next 동작 여부, 광고에서 멈추는지, 댓글창 팝업 등 예외 레이아웃에서 스크롤 로직이 꼬이지 않는지 |
| 8 | App Store 정책 리스크 | WebView 기반 YouTube Shorts 플레이어 + 주소창 숨김 + 커스텀 UI + 자동 스크롤 조합의 반려 가능성 검토 | LOW / MEDIUM / HIGH 중 하나로 결론 |
| 9 | 성능 측정 | iPhone 13/14/15 중 최소 1대, 30분 연속 재생 중 CPU/메모리/배터리 측정 | 수치 기록 |
| 10 | 최종 통합 검증 (**가장 중요**) | Shorts 카드 클릭 → 즉시 재생 → 영상 종료 → 다음 영상 자동 진행 → 10개 이상 연속 시청 | YES면 iOS Pace Player 진행, NO면 iOS 전략 재설계 필요 |

**POC #5용 검증 스크립트 (WKWebView에 주입, 3단계 폴백 체인)**:
```javascript
(function() {
  const currentVideo = document.querySelector('video');
  if (!currentVideo) {
    console.log('Pace PoC: 현재 화면에서 비디오를 찾을 수 없습니다.');
    return;
  }
  currentVideo.addEventListener('ended', function() {
    console.log('Pace PoC: 영상 종료 감지 성공! 다음 영상 이동 시도...');
    // 방법 A: Shorts 전용 스크롤 컨테이너(있으면 이게 정석 — 모바일 웹 Shorts는 window가 아니라
    // 내부 특정 div가 스크롤을 담당하는 경우가 많음)
    const shortsContainer = document.querySelector('#shorts-container') || document.querySelector('ytd-shorts');
    if (shortsContainer) {
      shortsContainer.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      return;
    }
    // 방법 B: 현재 Shorts 엘리먼트의 DOM 트리 상 다음 형제 요소로 강제 포커싱
    const currentEl = currentVideo.closest('ytd-reel-video-renderer') || currentVideo.closest('.shorts-video-container');
    const nextEl = currentEl ? currentEl.nextElementSibling : null;
    if (nextEl) {
      nextEl.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    // 방법 C: 최후 수단 — window 스크롤(Virtualized Feed면 안 먹힐 가능성 높음)
    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
  });
  console.log('Pace PoC: 유튜브 쇼츠 감지 및 JS 주입 완료.');
})();
```
**세 가지 결과 해석**:
- ✅ **성공** — 영상이 끝나자마자 화면이 넘어가며 다음 Shorts가 정상 재생됨 → iOS Pace Player
  방향 확정. 다음 단계 진행.
- 🟡 **절반의 성공** — 스크롤은 되는데 다음 영상이 로딩되지 않고 검게 나옴 → Virtualized List가
  실제 뷰포트 진입을 인식 못 한 상태. 단순 스크롤이 아니라 **가상 터치 이벤트(TouchEvent) 시뮬레이션**
  으로 다음 단계 추가 검증 필요(스크롤이 아니라 실제 스와이프 제스처를 흉내내야 할 가능성).
- ❌ **실패** — 아무 반응 없거나 에러 → YouTube 모바일 웹 구조가 완전히 막혀 있는 상태, iOS 전략
  전면 재설계 필요(콘텐츠 출처 블로커의 경로 1: Pace 자체 큐레이션 콘텐츠로 재정의).

**개발자에게 그대로 전달할 한 줄 지시문**:
> Build a native iOS WKWebView POC using m.youtube.com/shorts and verify: 1) Shorts feed loads
> correctly, 2) Google login persists, 3) video ended events can be captured, 4) JavaScript can
> advance to the next Short, 5) Auto-next can run for at least 20 consecutive videos, 6) no
> critical App Store review blocker exists. Provide screen recordings, console logs, and PASS/FAIL
> results for every item.

**외주/계약 시 팁**: 전체 앱을 한 번에 계약하지 말고, 위 5대 핵심 항목(POC #1·2·4·5·7)만 검증하는
미니 PoC를 먼저 별도로 계약하고, "1~5번이 모두 성공해 다음 영상 자동 전환이 증명됐을 때"만 본 계약
(전체 앱 개발)으로 전환하는 조건을 거는 게 리스크 관리 측면에서 안전하다.

**이 검증이 나오기 전까지는** iOS Pace Player의 실제 화면 구현(Player 화면, `usePlayerStore`, DB
스키마 등, 위 "필요한 것" 5~7번)에 깊게 투자하지 않는 게 합리적 — UI보다 "WKWebView + YouTube
Shorts + Auto Next가 실제로 되는가"가 선행 조건. 결과가 NO로 나오면 iOS는 Pace-큐레이션 콘텐츠
방향(위 블로커의 경로 1)으로 재설계해야 한다.

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

> ⚠️ **2026-07-17 피벗으로 핵심 경로 아님** — "제품 전략 피벗" 섹션 참고. iOS는 이제 Live Activity
> 컴패니언이 아니라 "Pace Player"(자체 재생)로 간다. 이 섹션은 향후 Player 화면이 백그라운드에
> 있을 때 잠금화면 상태 표시 등 **보조 기능**으로 재활용될 수 있어 삭제하지 않고 남겨둔다.

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

> ⚠️ **2026-07-17 피벗으로 "Live Activity(오버레이 대체)" 부분은 핵심 경로 아님** — "제품 전략
> 피벗" 섹션 참고. 아래 "Focus / App Blocking" 부분(FamilyControls/DeviceActivity/ManagedSettings)은
> Player 모델과 무관하게 계속 유효(콘텐츠 재생과 별개로 앱 차단은 여전히 필요한 기능).

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

> ⚠️ **2026-07-17 피벗으로 아래 표의 Auto Next/오버레이/Live Activity 행과 "제품 포지셔닝 결론"은
> 구버전** — "제품 전략 피벗" 섹션이 최신. 표는 피벗 이전 스냅샷으로 남겨둔다(비교용).

| 기능 | Android | iOS | 구현 방식 |
|---|---|---|---|
| Home / Stats / Settings / Auth / RevenueCat | ✅ | ✅ | 완전 공통 |
| Sleep Timer / Daily Limit / Usage Tracking / Break Reminder | ✅ | ✅ | 공통 로직 + 로컬 알림 |
| **Auto Next** | ✅ | ❌ (구버전) → ✅ Pace Player 자체 구현으로 변경 | Android: AccessibilityService+MediaSession(실제 앱 위). iOS: Player 내부 재생 엔진이 직접 처리 |
| **시스템 오버레이 바(플로팅)** | ✅ | ❌ | Android: Foreground Service + Overlay Window (변경 없음) |
| **Live Activity / Dynamic Island** | ❌ | (구버전 핵심) → 보조 기능으로 강등 | 피벗 후에는 Player 백그라운드 상태 표시 등 부가 용도로만 검토 |
| App Blocking / Focus Mode | ✅ (Accessibility 기반 차단화면) | ✅ (FamilyControls/ManagedSettings) | 변경 없음 — Player 모델과 무관하게 유효 |

**제품 포지셔닝 결론(구버전, 참고용)**: ~~Android는 "Shorts Assistant", iOS는 "Digital Wellbeing
Assistant"~~ → **신버전**: Android = "Overlay Assistant"(실제 앱 위 오버레이+오토넥스트),
iOS = "Pace Player"(자체 재생 피드+오토넥스트) — 두 플랫폼 모두 "Start 누르면 자동 넘김되는 쇼츠
경험"이라는 동일한 사용자 가치를 다른 구현으로 제공. 상세는 "제품 전략 피벗" 섹션 참고.

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

### 서버 저장 데이터 명세 — Privacy First (2026-07-18 확정)

> ⚠️ **현재 상황**: 이 저장소에는 `backend/` 디렉토리 자체가 없다(jlpt-master는 있음). `services/api/client.ts`는
> 클라이언트 코드만 완성돼 있고 `API_BASE_URL`은 자리표시자(`localhost:8080` 또는 빈 문자열) — 실제
> 서버는 미착수. 아래는 서버를 만들 때 따를 데이터 명세이며, **로컬 SQLite 스키마(`database/schema.ts`)와
> 1:1은 아니다** — 서버는 로컬보다 더 적게 가져간다(Privacy First 원칙 때문에 로컬에만 남고 서버로
> 안 올라가는 컬럼이 있음, 아래 표에 컬럼 단위로 명시).

**원칙**: Pace는 "영상을 관리해주는 도구"이지 "영상을 지켜보는 도구"가 아니다. 서버는 시청 **메타데이터**
(시간·횟수·플랫폼·설정·구독 상태)만 저장하고, 콘텐츠 자체나 콘텐츠를 특정할 수 있는 정보는 절대
저장하지 않는다.

| 저장 금지 항목 | 이유 |
|---|---|
| ❌ 이메일을 세션/통계 테이블에 재저장 | `users` 테이블에만 존재, 다른 테이블은 `user_id`(UUID)로만 참조 |
| ❌ 실제 영상 제목 | 콘텐츠 식별 정보 — 애초에 수집하지 않음 |
| ❌ 영상 URL/영상 ID | 위와 동일 |
| ❌ 좋아요/구독/댓글 등 플랫폼 활동 데이터 | Pace의 관심사가 아님, 수집 시 각 플랫폼 ToS 위반 소지 |
| ❌ 실제 시청 콘텐츠(썸네일/스크린샷 등) | 위와 동일 |

서버가 아는 것은 예를 들면 `platform_app: "youtube"`, `videos_watched: 42`, `duration_seconds: 2220`
같은 **집계 숫자뿐** — "무엇을 봤는지"가 아니라 "얼마나/몇 개 봤는지"만.

**MVP 5개 테이블** (Pace 로컬 스키마와 이름 그대로 대응, 서버는 이 중 사용자 식별 가능한 컬럼만 최소로):

| 서버 테이블 | 컬럼(로컬 `database/schema.ts` 대비 서버 전송분만) | 로컬에만 남고 서버 미전송 |
|---|---|---|
| `users` | `id, email, name, provider, created_at` | `avatar_url`(로컬 캐시 성격, 서버 왕복 불필요 — 소셜 로그인 응답을 그때그때 반영) |
| `subscriptions` | `id, user_id, plan, status, renewal_date, updated_at` | 없음 — RC entitlement는 웹훅으로 서버가 갱신, 전량 필요("외부 리뷰 반영 3차 · RevenueCat 백엔드 웹훅 계약" 참고) |
| `user_settings` | `user_id, auto_next, sleep_timer_min, daily_limit_min, break_interval_min, pre_session_breathing, theme, language, updated_at` | `app_shields_json, per_app_json`은 **로컬 전용으로 보류** — 특정 앱을 얼마나 차단했는지는 기기별로 달라도 되는 로컬 설정, 서버 동기화 필요성 낮음(다기기 사용 시나리오 나오면 재검토) |
| `viewing_sessions` | `id, user_id, platform_app, started_at, ended_at, duration_seconds, videos_watched, status` | `synced`(로컬 동기화 플래그 자체가 서버에 갈 이유 없음) |
| `daily_stats` | `user_id, date, total_minutes, total_videos, longest_session_seconds` | 없음 — 로컬 `daily_stats`가 현재 "미사용"(주석 참고)이라 서버도 아직 채울 데이터 없음, MVP에서는 서버가 `viewing_sessions`로부터 직접 GROUP BY해서 응답하는 편이 테이블 두 개를 항상 일치시키는 것보다 단순 |

**Phase 2 이후 (MVP에는 없음, 스키마 확장 필요)**:

| 테이블 | 목적 | 비고 |
|---|---|---|
| `user_streaks`(`user_id, current_streak, best_streak, last_active_date`) | 연속 사용일 표시 | 현재는 `stats.tsx`가 `weeklyStats`로 **클라이언트에서 그때그때 계산**(UI 포팅 섹션 참고) — 다기기 로그인 시 스트릭이 기기마다 따로 계산되는 문제가 생기기 전까지는 서버 테이블 불필요 |
| `platform_usage`(`user_id, platform, minutes, videos, date`) | 플랫폼별 일별 집계 | **이미 로컬에서 별도 테이블 없이 해결 중** — `statsRepository.getTodayUsageByApp()`가 `viewing_sessions.platform_app`을 쿼리 시점 `GROUP BY`("외부 리뷰 반영 2차" 3번 참고). 서버도 같은 방식으로 별도 테이블 없이 `viewing_sessions` 집계 쿼리로 충분, 트래픽이 실제로 무거워질 때만 캐시 테이블로 승격 |
| `user_metrics`(`user_id, date, focus_score, longest_session, average_watch_seconds, auto_next_ratio, daily_limit_hit`) | AI Insights 고도화용 | `auto_next_ratio` 계산을 하려면 `viewing_sessions`에 현재 없는 **`auto_next_used` 컬럼(BOOLEAN) 추가가 선행 조건** — 로컬 스키마에도 아직 없음(`videos_watched`만 있고 이 중 몇 개가 자동 넘김이었는지는 미기록). `focus_score` 산출 공식 자체도 미정 — MVP 이후 별도 설계 필요 |

**용량 추정**: 사용자 1명당 하루 세션 10개 ≈ 2~3KB. 10만 사용자 기준으로도 PostgreSQL 저장 비용은
무시할 수준 — MVP 5개 테이블만으로 충분하고 조기 최적화(파티셔닝 등) 불필요.

**결론**: 서버 스키마는 로컬 스키마의 부분집합이며, 컬럼을 늘리기 전에 항상 "이게 콘텐츠 식별 정보인가?"
"다기기 동기화가 실제로 필요한가?"를 먼저 물을 것. `avatar_url`/`app_shields_json`/`per_app_json`처럼
로컬에만 있어도 충분한 컬럼을 서버까지 무분별하게 복제하지 않는다.

---

## 백엔드 스택 확정 (2026-07-18) — jlpt-master 다이어트 이식

### 결정 배경
처음엔 "2026 웹 트렌드"를 근거로 Node.js/TypeScript(Fastify+Drizzle+Postgres) 신규 스택을 검토했으나,
사용자가 방향을 정정했다: **jlpt-master(`c:\MyData\Project\jlpt-master\backend`)는 2년치 학습앱 운영
노하우가 실전 검증된 자산이고, 특히 JWT `tokenVersion` 구조·RevenueCat grant/revoke 상태 머신(실사고
이력 반영)·webhook 상수시간 인증은 그대로 가져올 가치가 크다.** 반면 Study/Ranking/Galaxy/Wallet 같은
JLPT 전용 도메인은 Pace와 무관하므로, **스택은 그대로 재사용하고 도메인만 잘라내는 "다이어트" 이식**으로
확정했다. 이번 결정은 "매번 최신 트렌드를 조사해 신규 스택을 고른다"는 원칙보다, **실전에서 사고를 겪고
고친 코드(RevenueCat 웹훅 로직 등)는 새로 짜지 말고 재사용하는 게 낫다**는 원칙이 우선한 사례로 기록한다
— 트렌드 조사는 "새로 만들 때 무엇으로 만들까"에는 유효하지만, "이미 검증된 자산이 있을 때"는 그 자산의
재사용 여부를 먼저 물어야 한다.

### jlpt-master 조사 요약
- **스택**: Java 17 + Spring Boot 3.2.5 + Maven, Spring Data JPA + MySQL(운영)/H2(개발), Spring Security.
- **약점**(Pace가 반드시 개선): Flyway/Liquibase 등 마이그레이션 도구 미사용(`ddl-auto=update`로 임시
  운영, 저자도 "운영 안정화 후 전환 권장"이라 인지하고 있었음), 전역 예외처리 없음(컨트롤러마다 ad-hoc
  `Map.of("error", ...)` 응답 반복), Bean Validation 저활용(2곳뿐), 아직 Railway 실배포 전(계획 문서
  단계).
- **JWT**: `tokenVersion` claim을 JWT에 심고 DB `UserAccount.tokenVersion`과 대조 — 새 로그인마다
  버전 증가시켜 기존 토큰을 전부 무효화(단일기기 로그인 강제 겸 토큰 일괄 폐기 수단).
- **RevenueCat 웹훅**: `Authorization` 헤더를 `MessageDigest.isEqual`로 상수시간 비교(fail-closed).
  `CANCELLATION`은 즉시 박탈하지 않고 만료일까지 유지(`CUSTOMER_SUPPORT`/환불 사유만 즉시 박탈) —
  과거 "해지 즉시 이용정지"로 처리했다가 Apple/Google 정책 위반·환불 분쟁을 겪고 고친 이력이 주석에
  남아 있음. `EXPIRATION`은 실제 만료 처리(단 그 사이 재구독됐으면 무시). `/auth/refresh` 시점에
  RevenueCat REST API(`GET /v1/subscribers/{id}`)로 재조회해 웹훅 누락을 보정.
- **컨트롤러 14개 중 Pace에 유의미한 건 Auth/Webhook뿐** — Study/Progress/Content/Audio/
  PremiumDownload/Ranking/Galaxy/Wallet/Widget/Log/AppVersion은 단어학습·소셜·게이미피케이션 전용이라
  전부 제외.

### 도메인 다이어트

| jlpt-master (14 컨트롤러) | Pace | 판단 |
|---|---|---|
| Auth | **Auth** | 유지(Kakao/Naver/reviewer-login/bind는 제외 — 아래 "스코프 밖" 참고) |
| Study, Progress, Content, Audio, PremiumDownload | ❌ 전부 삭제 | 단어학습 전용, Pace 도메인과 무관 |
| Ranking, Galaxy, Wallet | ❌ 전부 삭제 | 소셜/게이미피케이션, Pace MVP 불필요 |
| Widget, Log, AppVersion | ❌ 전부 삭제 | |
| (jlpt엔 없음) | **Session**(신설) | Pace 핵심 — 시청 세션 기록/조회 |
| (jlpt엔 DailyUsage가 쿼터용으로만 존재) | **Stats**(신설) | Pace 핵심 — 일별/주별 집계, 인사이트 |
| (jlpt엔 UserSettings 없음) | **Settings**(신설) | auto_next/sleep_timer/daily_limit 등 |
| Webhook | **Webhook** | 유지, 로직 거의 100% 이식 |

**Pace 최종 컨트롤러 5개**: `AuthController`, `SessionController`, `StatsController`,
`SettingsController`, `WebhookController` — jlpt-master 14개 대비 도메인 규모 20~30% 수준.

### 최종 스택

| 항목 | 선택 | 비고 |
|---|---|---|
| 언어/프레임워크 | Java 17 + Spring Boot 3.2.x | jlpt-master와 동일, 검증된 조합 |
| 인증 | Spring Security + 커스텀 JWT 필터 | jlpt-master `JwtProvider`/`JwtAuthenticationFilter` 이식 |
| ORM | Spring Data JPA | jlpt-master와 동일 |
| DB | MySQL | jlpt-master와 동일(Railway MySQL 플러그인) |
| 빌드 | Maven | jlpt-master와 동일 |
| 마이그레이션 | **Flyway**(신규 도입) | `ddl-auto=validate`로 스키마 드리프트 방지 — jlpt-master엔 없던 것 |
| 결제 | RevenueCat(webhook + REST reconcile) | jlpt-master `PaymentService`+`RevenueCatClient` 로직 이식 |
| API 문서 | **springdoc-openapi(Swagger UI)**(신규 도입) | jlpt-master엔 없던 것 — 프론트 개발 시 API 계약 확인용 |
| 배포 타겟 | Railway(Dockerfile) | jlpt-master `RAILWAY_DEPLOY.md`를 그대로 참고 가능 |

**중요 — 파일을 그대로 복붙하지 않는다**: jlpt-master는 별도 git 저장소이자 다른 프로젝트다. 코드를
그대로 복사하지 않고, 읽어서 로직/구조만 참고해 Pace 전용 패키지(`com.pace.backend`)로 새로 작성한다.

### DB 스키마 (MySQL, Flyway `V1__init.sql`)

`user_account` / `user_settings` / `viewing_session` / `daily_stats` / `subscription` 5개
테이블 — 위 "서버 저장 데이터 명세 — Privacy First" 섹션의 5개 테이블 설계(컬럼명·Privacy First 원칙)를
그대로 계승하되, 이번에 두 컬럼을 신규 확정했다:
- `viewing_session.auto_next_used`(BOOLEAN) — 앞선 대화에서 확인한 gap, 그린필드로 짓는 지금이
  마이그레이션 없이 추가할 수 있는 유일한 시점이라 포함.
- `daily_stats.session_count`(INT) — Copilot 제안 스키마에는 있었지만 로컬 스키마엔 없던 컬럼, 서버
  전용으로 신규 확정.

> ⚠️ **2026-07-18 정정** — 아래 스키마는 최초 설계본이었으나, 실제 프론트(다른 세션이 병행 구현 중이던
> `useSettingsStore`/`useStatsStore`/SQLite `schema.ts`)와 대조한 결과 필드명·컬럼이 여러 곳에서 어긋나
> 있었다. 바로 다음 섹션 "프론트-백엔드 데이터 정합화"에서 확정한 **최신 스키마로 이미 코드에 반영
> 완료** — 아래 블록은 결정 이력 보존용으로 남겨두고, 실제 구현 기준은 다음 섹션을 볼 것.

```sql
user_account(id BIGINT PK AUTO_INCREMENT, email VARCHAR UNIQUE, name VARCHAR, provider VARCHAR,
             premium BOOLEAN DEFAULT FALSE, premium_expires_at DATETIME NULL,
             token_version INT DEFAULT 0, device_id VARCHAR NULL,  -- 게스트 upsert 키
             created_at DATETIME, updated_at DATETIME)

user_settings(user_id BIGINT PK/FK, auto_next_enabled BOOLEAN DEFAULT TRUE,
              sleep_timer_minutes INT NULL, daily_limit_minutes INT DEFAULT 60,
              break_reminder_minutes INT DEFAULT 20, pre_session_breathing BOOLEAN DEFAULT TRUE,
              theme VARCHAR DEFAULT 'system', language VARCHAR DEFAULT 'system', updated_at DATETIME)

viewing_session(id VARCHAR(36) PK,  -- 클라이언트가 이미 UUID로 생성(sessionsRepository) → 그대로 PK로 씀
                user_id BIGINT FK, platform VARCHAR, started_at DATETIME, ended_at DATETIME NULL,
                duration_seconds INT DEFAULT 0, videos_watched INT DEFAULT 0,
                auto_next_used BOOLEAN DEFAULT FALSE,
                status VARCHAR NULL,  -- 'completed'|'daily_limit_reached'|'sleep_timer_expired'|'manual_stop'
                                      -- ⚠️ 로컬 SQLite(database/schema.ts)가 이미 이 소문자 snake_case 값을
                                      -- 그대로 만들어 보내므로, 서버는 대문자 enum으로 바꾸지 않고 동일 문자열
                                      -- 그대로 저장 — 클라이언트-서버 간 변환 계층을 두지 않기 위함
                created_at DATETIME, INDEX(user_id, started_at))

daily_stats(id BIGINT PK AUTO_INCREMENT, user_id BIGINT FK, date DATE,
            total_minutes INT DEFAULT 0, total_videos INT DEFAULT 0, session_count INT DEFAULT 0,
            focus_score INT NULL,  -- 산출 공식 미정 — MVP는 NULL 허용, 추후 공식 확정 시 배치/트리거로 채움
            UNIQUE(user_id, date))

subscription(user_id BIGINT PK/FK, plan VARCHAR, is_active BOOLEAN, expires_at DATETIME NULL,
              updated_at DATETIME)  -- RC 상세 이력/감사용 엔티티명은 Subscription. 실제 인증서버 판정
                                     -- (JWT의 isPremium, AuthenticationFilter의 ROLE_PREMIUM)은
                                     -- UserAccount.premium을 씀
```

### 프론트-백엔드 데이터 정합화 (2026-07-18) — 최신 스키마/API 기준

다른 세션이 병행 구현 중이던 프론트(`useSettingsStore`/`useStatsStore`/`useSessionStore`/`database/schema.ts`)의
**실제 필드명을 전수 대조**한 결과, 위 최초 스키마와 여러 곳이 어긋나 있었다. 원칙: **프론트가 이미 실제
UI+SQLite로 동작 중인 진실원천이고 백엔드는 이제 막 만든 쪽이라, 백엔드를 프론트에 맞춘다.**

| 항목 | 최초(위 블록) | 정정 후(현재 코드) | 사유 |
|---|---|---|---|
| 자동 넘김 필드 | `auto_next_enabled` | **`auto_next`** | `useSettingsStore`가 이미 `autoNext`로 씀 |
| 휴식 알림 필드 | `break_reminder_minutes` | **`break_interval_minutes`** | `models.ts`의 `breakIntervalMinutes`와 일치 |
| 앱별 설정 | (없음) | **`app_shields_json`, `per_app_json` 추가**(TEXT, opaque JSON 미러) | settings.tsx가 이미 `appShields`/`perApp`로 앱별 토글 UI를 그리고 있어 다기기 동기화 필요 — 처음엔 "로컬 전용으로 보류"했던 판단을 뒤집음 |
| daily_stats | `session_count`, `focus_score` | **`session_count`, `longest_session_seconds`**(focus_score 삭제) | `focus_score`는 로컬 스토어/UI/계산식이 전혀 없는 "서버가 먼저 만든 허상 개념"이라 제거. `longest_session_seconds`는 로컬 `daily_stats`에 이미 있던 컬럼이라 채택 |
| platformBreakdown | (없음) | **`GET /stats/insights` 응답에 `platformBreakdown: [{app, minutes}]` 추가** | 로컬 `statsRepository.getTodayUsageByApp()`과 동일 개념. 별도 테이블 없이 `viewing_session`에서 응답 시점 계산(저장 안 함) |
| 세션 종료 사유 | (없음) | **`GET /stats/session-end-reasons` 신규**(`{completed, dailyLimitReached, sleepTimerExpired, manualStop}`) | 로컬 `statsRepository.getSessionEndReasons()`와 동일 개념, 저장 없이 응답 시점 계산 |

**결론적으로 API 계약은 유지, 스키마/필드명만 프론트 기준으로 정정**: `AuthResult`(`token/userId/email/name/isPremium`)와 `viewing_session.status` 값(`completed`/`daily_limit_reached`/`sleep_timer_expired`/`manual_stop`)은 이미 프론트와 일치해 변경 없음 — 확인 결과 실제로 어긋났던 건 설정 필드명 2개, daily_stats 컬럼 구성, 그리고 아직 서버에 없던 두 통계 개념뿐이었다.

### API 명세 (5 컨트롤러)

**AuthController** — 기존 `client.ts` 계약과 100% 호환(클라이언트 코드 변경 불필요) + `GET /status` 신규:
- `POST /auth/google {idToken}` → Google idToken 검증 → email upsert → `AuthResult{token,userId,email,name,isPremium}`
- `POST /auth/apple {identityToken,name?,authorizationCode?}` → Apple JWKS 검증 → email upsert
  (name은 최초 로그인에만 옴 — jlpt와 동일 이슈, 최초값만 저장하고 이후 null이면 덮어쓰지 않음)
- `POST /auth/guest {deviceId}` → **deviceId로 upsert**(존재하면 기존 유저 반환) — `useUserStore.
  loginAsGuest`가 재호출해도 항상 같은 서버 유저가 나오게 해서, 로컬id→서버id 마이그레이션 문제를
  애초에 피함
- `POST /auth/refresh`(Bearer) → tokenVersion 대조 → **RC REST reconcile**(jlpt와 동일: RC
  `/v1/subscribers/{id}` 조회 후 premium 동기화) → 재발급 `{token}`
- `GET /auth/status`(Bearer) → 현재 유저 정보+isPremium(신규, 가벼운 헬스체크/디버그용)
- `DELETE /auth/account`(Bearer) → 연관 데이터 cascade 삭제 → 204

**SessionController**(신규) — 클라이언트가 이미 만든 세션 UUID를 그대로 서버 PK로 재사용해 upsert하므로,
"세션 시작 시 즉시 push" 경로와 "오프라인 기록 후 나중에 일괄 sync" 경로가 같은 테이블에 충돌 없이
합류한다:
- `POST /sessions/start {id,platform,startedAt}`(Bearer), `POST /sessions/end {id,endedAt,
  durationSeconds,videosWatched,autoNextUsed,status}`(Bearer), `GET /sessions/today`, `GET /sessions/recent`

**StatsController**(신규):
- `POST /stats/sync {sessions: ViewingSession[]}`(Bearer) → `{synced:number}` — 오프라인 배치 동기화
  본선. 기존 `statsApi.pushSessions`(`/stats/sessions`)를 대체하는 이름 — 현재 미배선 상태라 프론트
  변경 리스크 없음.
- `GET /stats/daily?date=` / `GET /stats/weekly` — `daily_stats`(`total_minutes/total_videos/
  session_count/longest_session_seconds`) 조회.
- `GET /stats/insights` — `totalSessions/longestSessionSeconds/autoNextRatio` + **`platformBreakdown`**
  (앱별 사용 분(分), 로컬 `getTodayUsageByApp`과 동일 개념)까지 `viewing_session`에서 즉석 계산해 반환
  (별도 저장 테이블 없음).
- `GET /stats/session-end-reasons` — `{completed, dailyLimitReached, sleepTimerExpired, manualStop}`,
  로컬 `getSessionEndReasons`와 동일 개념, 즉석 계산.

**SettingsController**: `GET/PUT /settings`(Bearer) — `client.ts` 계약 유지 + `appShields`/`perApp`
(프론트 shape 그대로, 서버는 내용을 해석하지 않고 JSON 텍스트로 미러링) 추가.

**WebhookController** — jlpt `PaymentService`/`WebhookController` 로직 이식(가장 이식 가치가 큰 부분):
상수시간 인증(fail-closed) → 이벤트별 grant/revoke(CANCELLATION은 만료일까지 유지, EXPIRATION만 실제
박탈, 역전 이벤트 스킵, 익명ID는 aliases로 폴백) → `UserAccount.premium/premiumExpiresAt` 갱신 +
`subscription` upsert. 상세 정책은 위 "RevenueCat 백엔드 웹훅 계약" 섹션과 동일.

### jlpt-master 대비 개선 3가지
1. **Flyway** — `ddl-auto=validate` + `V1__init.sql`로 시작, 스키마 변경은 항상 새 마이그레이션 파일로.
2. **GlobalExceptionHandler**(`@RestControllerAdvice`) — 에러 응답을 `{success:false, message, code}`로
   통일. ⚠️ 성공 응답은 래핑하지 않음 — `client.ts`의 `request<T>()`가 `res.json()`을 그대로 `T`로
   캐스팅하므로 `AuthResult` 등은 top-level 필드 그대로 반환해야 기존 클라이언트가 안 깨진다.
3. **Bean Validation 적극 사용** — 모든 요청 DTO에 `@NotBlank`/`@Email`/`@Min`/`@Max` 등, jlpt는 2곳뿐.

### 구현 중 실제로 발견한 이슈 (2026-07-18 로컬 검증)
1. **springdoc-openapi 버전 호환성** — 처음 넣은 `2.8.17`은 Spring Framework 6.2+(Spring Boot 3.4+)를
   요구해 `LiteWebJarsResourceResolver` `ClassNotFoundException`으로 기동 자체가 실패했다. Spring Boot
   `3.2.5`(Spring Framework 6.1.6)와 맞는 `2.5.0`으로 낮춰서 해결 — OpenAPI 등 서브 의존성은 Boot 버전을
   먼저 고정한 뒤 그에 맞는 호환 버전을 찾아야 한다는 교훈.
2. **인증 실패 시 403이 아니라 401을 반환하도록 `RestAuthenticationEntryPoint` 추가** — Spring Security
   기본값은 토큰이 아예 없거나 유효하지 않을 때도 403을 준다. `client.ts:53-56`의 `unauthorizedHandler`는
   정확히 `res.status === 401`일 때만 자동 로그아웃을 트리거하므로, 403을 그대로 뒀다면 클라이언트가 만료된
   세션을 인지하지 못하는 실버그가 됐을 것 — curl 검증 중 직접 발견해 `SecurityConfig`에
   `exceptionHandling(...authenticationEntryPoint(...))`로 수정.

### 스코프 밖 (이번 구현엔 포함 안 함)
- Kakao/Naver 로그인, `/auth/bind/google`(게스트→소셜 전환), `/auth/reviewer-login` — 현재 프론트가
  google/apple/guest만 지원하고 리뷰어 화이트리스트는 이미 클라이언트 로직만으로 동작 중.
- `focus_score` 산출 공식 확정 — 컬럼만 만들고 NULL 허용.
- 프론트에서 `statsApi.pushSessions`/`settingsApi.*`/신규 SessionController를 실제로 호출하도록 배선.
- Railway 실배포/도메인/시크릿 발급(계정·과금 소요) — 로컬 `docker compose up`(MySQL 컨테이너)까지만.

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
| Service | `services/api/client.ts` | 🟡 부분 | 클라이언트 완료, 백엔드 스펙 확정(Java/Spring, 위 "백엔드 스택 확정" 섹션) — 서버 구현 진행 중, API_BASE_URL은 로컬 개발 서버 연결 전까지 자리표시자 |
| Backend | `backend/`(신설, Java/Spring Boot) | ✅ 로컬 검증 완료 | AuthController/SessionController/StatsController/SettingsController/WebhookController 5종 + Flyway V1 + GlobalExceptionHandler + RevenueCatServiceTest(8종, 전부 통과) 구현 완료. 이 개발 환경에 Docker/MySQL이 없어 **H2(MySQL 호환 모드)로 대체 기동**해 전 엔드포인트 curl 검증 — 실제 MySQL 대상 검증과 Railway 실배포는 아직 안 함(별도 승인 필요) |
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

## 실기기 검증 2차 — i18n 크래시 및 Metro 불안정 디버깅 (2026-07-17)

`services/i18n` 도입 직후 `pace_test` 에뮬레이터에서 `TypeError: Cannot read property
'useTranslation' of undefined`가 `(tabs)/_layout.tsx:6`에서 반복적으로 발생. 근본 원인은 서로
다른 두 개였고 둘 다 고쳐야 실제로 해결됐다 — 둘 중 하나만 고치면 증상이 형태만 바꿔서 재발한다.

### 원인 1 — `expo-localization` 네이티브 모듈이 APK에 링크되지 않음
- 실제 RedBox 에러는 `Cannot find native module 'ExpoLocalization'`. `services/i18n/index.ts`가
  최상단에서 `import * as Localization from 'expo-localization'`를 하는데, 이 모듈은 순수 JS가
  아니라 네이티브 코드를 포함한다 — `package.json`/`app.json`의 `plugins`에 이미 등록돼 있어도,
  **그 등록 이후에 네이티브 프로젝트를 다시 빌드하지 않으면 이미 설치된 dev-client APK에는
  포함되지 않는다.** JS만 Fast Refresh로 갱신되고 네이티브 바이너리는 그대로였던 것.
- 해결: `npx expo run:android -d <device>`로 재빌드 → autolinking(`expo-autolinking-settings`,
  Gradle configure 시점에 `node_modules`를 다시 스캔)이 새로 `expo-localization`을 포함시킴.
- **교훈**: 네이티브 코드가 있는 패키지(`expo-*`, RN 네이티브 모듈)를 새로 추가한 뒤에는 JS
  리로드만으로 부족하고 반드시 `expo run:android`/`run:ios` 재빌드가 필요하다 — 특히 이 프로젝트는
  `modules/pace-overlay` 커스텀 네이티브 모듈 때문에 Expo Go가 아니라 커스텀 dev-client를 쓰고
  있어서 이 문제가 더 자주 발생할 수 있다는 점을 항상 염두에 둘 것.

### 원인 2 — 장시간 떠있던 Metro 프로세스의 상태 손상 (멀티파트 번들 응답 손상)
- 원인 1을 고친 뒤에도 앱이 "Loading from 10.0.2.2:8081..."에서 무한정 멈췄다. `adb logcat
  --pid=<pid>`로 확인한 실제 예외:
  `okhttp3...ProtocolException: Expected leading [0-9a-fA-F] character but was 0x2d`
  (`BundleDownloader.processMultipartResponse` → `MultipartStreamReader.readAllParts`).
  RN dev-client는 번들 진행률 표시를 위해 Metro에 `Accept: multipart/mixed`로 요청하고 청크
  전송 인코딩 멀티파트 응답을 받는데, 그 청크 프레이밍이 깨져서 파싱에 실패한 것.
- `10.0.2.2`(에뮬레이터 가상 NAT)와 `adb reverse tcp:8081`(호스트로의 직접 ADB 터널) 양쪽 다
  동일하게 실패 — 즉 네트워크 경로 문제가 아니었다. 반면 host에서 `curl -H "Accept:
  multipart/mixed" localhost:8081/index.bundle...`은 완전히 정상 응답(29.5MB 전체 정상 파싱)을
  받았다 — Metro 서버 자체도, 요청 프로토콜 자체도 문제가 아니었다는 뜻.
- 최종 원인: **몇 시간째 떠 있던 그 Metro 프로세스 자체의 내부 상태 손상**(다수의 오래된
  `ESTABLISHED` 커넥션이 `netstat`에 누적돼 있었음 — 정확한 내부 버그는 특정하지 못했지만, 그
  프로세스를 `taskkill /F /PID`로 죽이고 `npx expo start --port 8081`로 완전히 새로 띄우자 같은
  기기·같은 `adb reverse` 설정에서 즉시 정상적으로 "Bundling 99%..." → 앱 정상 기동까지 이어졌다.
- **교훈**: 정체불명의 번들 다운로드/청크 인코딩 오류를 만나면 네트워크 경로(10.0.2.2 vs
  localhost/adb reverse)를 바꿔보기 전에, 먼저 **Metro 프로세스 자체를 완전히 재시작**해볼 것 —
  특히 하루 종일 켜둔 세션에서는 이게 훨씬 빠르고 확실한 1차 시도다.

### 실기기(USB) 연결 관련 참고
- 재검증 도중 실기기(`R3CN80S5GWW`, arm64-v8a)가 `adb devices`에서 갑자기 사라진 적이 있었다.
  Windows `Get-PnpDevice`로는 `SAMSUNG Android ADB Interface`가 `Status: OK`로 정상 인식되고
  있었고, 충돌하는 `adb.exe` 프로세스도 없었다 — 즉 드라이버/PC 쪽 문제가 아니라 **폰 쪽의 ADB
  데몬이 핸드셰이크를 완료하지 못한 상태**(화면 잠금, "USB 디버깅 허용" 팝업 대기, 케이블이
  충전 전용 모드 등)였을 가능성이 높다. `adb kill-server && adb start-server`로도 해결 안 되면
  폰 화면을 깨워 팝업을 직접 확인해야 한다 — PC/드라이버 쪽에서 더 팔 수 있는 부분이 없다.

### 검증 완료 항목 (i18n)
- `pace_test` 에뮬레이터에서 Home 탭 정상 렌더(게스트 세션, "60 min left" 등 영문 표기 확인).
- Settings → Language 칩에서 System/English/한국어 전환 정상 동작 확인. 한국어 전환 시 "Pace
  Premium Plus", "FREE", "Shield" 등은 영문 유지, 문장형 설명(`모든 고급 차단·Shield 기능과
  무제한 호흡 트리거를 이용해요` 등)과 탭 라벨(홈/통계/집중/설정)은 자연스러운 한국어로 전환됨
  — "짧은 기능명은 영문 유지, 문장은 자연스러운 한국어" 원칙이 실기기에서 의도대로 동작함을 확인.

### 하단 탭 바 아이콘 추가 (2026-07-17, 후속 수정)
- 위에서 발견한 "빈 사각형" 이슈 원인은 `(tabs)/_layout.tsx`에 `tabBarIcon`이 애초에 정의돼
  있지 않았던 것(회귀 아님, 처음부터 미구현). 웹 리서치로 2026년 모바일 탭바 아이콘 트렌드를
  확인한 뒤 반영: **아웃라인(비활성) → 채움(활성) + 색상 전환**이 현재 표준 패턴(Threads/
  Instagram/X 등에서도 쓰는 방식) — 별도 아이콘 폰트 추가 없이 이미 링크된
  `@expo/vector-icons`의 `Ionicons` outline/filled 쌍(`home`/`home-outline`,
  `stats-chart`/`stats-chart-outline`, `shield-checkmark`/`shield-checkmark-outline`,
  `settings`/`settings-outline`)으로 구현. `pace_test`에서 실기기 확인 완료(활성 탭만 채워진
  파란 아이콘으로 표시).

### i18n 번역 오류 수정 (2026-07-17, 후속 수정)
- `translations.ts`의 `settings.guestLabel`이 한국어에서 `'게스트'`로 번역돼 있었던 것을
  `'Guest'`로 수정 — "Guest"는 `Auto Next`/`Sleep Timer`처럼 굳어진 짧은 라벨이라 한국어 UI에서도
  영문 유지 원칙에 따라야 함(사용자가 실기기에서 직접 확인 후 지적). `auth.continueAsGuest`도
  같은 원칙으로 `'게스트로 계속하기'` → `'Guest로 계속하기'`로 수정(이미 확립된 `Shield` 같은
  영문-한글 혼용 문장 패턴과 동일). Settings/Home 양쪽 실기기 재확인 완료.
- 참고로 Home 탭 자체는 애초에 정상적으로 번역되고 있었다(모든 카드가 `useTranslation()` 사용
  중) — 최초 보고 당시 Home 탭을 재확인하지 않고 보고한 것이 혼선의 원인이었을 뿐, 실제 코드
  버그는 아니었음.

### 타이포그래피 실제 로드 + OS별 탭바 처리 (2026-07-17, 후속 수정)
사용자 요청: "박스 폰트가 최신 트렌드 맞는지, OS별 상하단 패딩·글래스모피즘을 웹에서 찾아 최적
적용하고 zen-master/jlpt-master 처리도 검토하라". 웹 리서치 + 두 자매 프로젝트 코드 조사 후 반영.

- **폰트 실제 로드**: `typography.displayFontFamily`/`monoFontFamily`가 그동안 `undefined`
  placeholder였던 것을 `@expo-google-fonts/plus-jakarta-sans` + `@expo-google-fonts/jetbrains-mono`
  로 실제 로드(`app/_layout.tsx`의 `useFonts` + `expo-splash-screen`으로 로드 전 스플래시 유지).
  2026 트렌드 리서치 결과 웰니스/미니멀 앱은 "Bouba grotesk"(둥근 그로테스크, Hanken Grotesk/
  General Sans 계열) 본문 + 모노스페이스 숫자 페어링이 주류 — Plus Jakarta Sans가 같은 계열이라
  원래 기획을 그대로 실사용, JetBrains Mono는 정확히 이 "grotesk+mono 페어링" 트렌드에 부합해
  타이머/통계 숫자 전용으로 채택. 큰 헤드라인(AppHeader 인사말)과 숫자 값(UsageHeroCard/
  StatsGridCard/WeeklyGraphCard)에만 적용 — 본문/라벨은 의도적으로 시스템 폰트 유지(가독성·
  성능, "커스텀 폰트는 히어로 모먼트에만" 컨벤션).
  - zen-master/jlpt-master는 커스텀 본문 폰트가 아예 없다(시스템 폰트 의존, CJK 렌더링
    보정용 `JP_FONT` 상수와 `iosW()` 플랫폼별 font-weight 헬퍼만 존재) — Pace는 애초
    기획서에 폰트 스택이 명시돼 있었으므로 두 프로젝트 패턴을 그대로 가져오지 않고 실제 로드로
    완성했다. `iosW()` 같은 플랫폼별 weight 분기는 현재 Pace 규모에서 불필요 판단, 도입 안 함.

- **iOS 탭바 = Liquid Glass 블러, Android = 기존 solid Material 유지**: `(tabs)/_layout.tsx`에
  `tabBarBackground`(iOS만 `BlurView tint="systemChromeMaterialLight"`) + `tabBarStyle:
  Platform.select(...)`(iOS는 `position:'absolute'`로 콘텐츠 위에 뜨는 형태, Android는 기존처럼
  일반 문서 흐름 + `elevation: 8`) 추가. 근거: (1) iOS 26부터 반투명 블러 캡슐형 탭바(Liquid
  Glass)가 시스템 기본값이라 네이티브 룩 일치가 목적, (2) zen-master/jlpt-master의
  `GlassSurface`/`GlassBlurLayer`도 정확히 이 패턴(iOS만 실제 `BlurView`, Android는 안드로이드
  블러가 텍스트까지 흐리게 만드는 문제로 flat 컬러 대체)이었고 그대로 승계, (3) 다만 두
  프로젝트는 이 블러를 카드/시트에만 썼고 탭바엔 안 썼다 — Pace가 탭바에 적용한 것은 네이티브
  OS 탭바 자체가 iOS 26에서 이미 이렇게 생겼기 때문(시스템 크롬 예외, "No Glassmorphism" 원칙은
  카드/콘텐츠에 대한 것이라 충돌 아님 — `theme.ts` 주석에도 명시).
  - iOS 탭바가 `position:'absolute'`가 되면서 화면 콘텐츠가 탭바 밑에 깔리는 문제가 생겨
    `constants/theme.ts`에 `layout.tabBarContentClearance`(iOS 96 / Android 24, `Platform.select`)
    를 추가해 4개 탭 화면의 `ScrollView contentContainerStyle paddingBottom`에 반영.
    jlpt-master가 화면마다 `Math.max(insets.bottom + N, floor)`를 개별 계산하던 방식 대신, Pace는
    탭 화면이 전부 동일한 여백이면 충분해 상수 하나로 단순화(과설계 방지).
  - **미검증**: 이 세션은 Windows 환경이라 iOS 시뮬레이터/실기기가 없어 블러 탭바를 실제로 본 적
    없음 — Android(`pace_test`)에서는 기존 solid 탭바가 회귀 없이 정상 렌더되는 것만 확인.
    iOS 빌드 시 반드시 육안 재확인 필요.

- **인사말 카피("오늘도 시간을 다정하게 써봐요") 트렌드 검토**: 웹 리서치 결과 2026년 웰니스 앱
  UX 라이팅 트렌드는 "맥락별 톤"(온보딩/인사 같은 감성적 접점은 따뜻하고 개인적인 문구,
  버튼/확인 같은 반복 상호작용은 간결하게) — 현재 홈 인사말이 정확히 이 패턴(따뜻한 인사 +
  "Start Shorts"/"60m Left" 같은 짧고 건조한 데이터 표기 공존)이라 트렌드에 부합, 수정 안 함.

### Android 네이티브 `WindowManager` 오버레이 실제 렌더 확인 (2026-07-17, 우연히 발견)
저시간 경고 토스트를 검증하려고 `/overlay` 화면 스크린샷을 여러 번 찍는 과정에서, 매번 동일한
위치에 작은 회색 알약("Pace ⏱ 60m Left", dot·AUTO 토글 없는 축약형)이 RN 오버레이 바 아래에
겹쳐 찍히는 게 반복적으로 보였다. 처음엔 `adb screencap`의 캡처 아티팩트(에뮬레이터 소프트웨어
렌더링 특유의 프레임 티어링)로 의심했으나, `uiautomator dump`로 접근성 트리를 직접 까보니
"Pace" 텍스트 노드가 **하나만** 존재 — RN 뷰 트리에는 없는 요소라는 뜻. `adb shell dumpsys
activity services com.pace.app`로 확인한 결과 **`expo.modules.paceoverlay.PaceOverlayService`가
`isForeground=true`로 실제 실행 중**이었다. 즉 이건 버그가 아니라 **실제 네이티브
`TYPE_APPLICATION_OVERLAY` 시스템 오버레이가 진짜로 화면에 렌더되고 있는 것**이었다 —
"실기기 검증 1차"에서 "권한 허용까지는 확인했지만 실제 렌더는 육안 미확인"으로 남겨뒀던 항목이
이번에 우연히, 하지만 확실하게 검증됨.
- 화면에 두 개의 "Pace" 알약이 동시에 보이는 건 정상 — 하나는 `/overlay` 화면 자체가 그리는
  RN 인앱 프리뷰(dev 시뮬레이터, 실기기 프로덕션에서는 존재 안 함), 다른 하나는 진짜 네이티브
  오버레이(프로덕션에서 실제로 남는 것). dev 화면에서 육안 검증 목적으로 의도적으로 겹쳐 보이는
  구조라 서로 간섭하지 않음.
- **후속 조치 필요**: 이 서비스가 여러 차례의 `force-stop`/재실행을 거치는 동안에도 계속 살아있던
  것으로 보아, `overlayService.endSession()`(→ `PaceOverlay.stop()`) 호출 없이 앱 프로세스가
  강제 종료되면 Foreground Service가 고아 상태로 남을 수 있다는 뜻 — 실제 세션 종료 경로(Stop
  버튼, 일일 한도 도달 등)에서는 `endSession()`이 정상 호출되므로 문제 없지만, 개발 중 강제
  종료로 남은 고아 서비스는 `adb shell am stopservice` 또는 실기기에서 알림 지우기로 수동
  정리해야 한다는 점을 향후 세션 디버깅 시 참고.

- **OS별 상하단 패딩(세이프에어리어) 일반 원칙**: zen-master/jlpt-master 조사 결과 두 프로젝트
  모두 `useSafeAreaInsets()`를 화면마다 raw로 읽어 `Math.max(insets.top/bottom + offset, floor)`
  가드를 직접 계산(공유 상수 모듈 없음), Android는 `expo-navigation-bar`로 제스처바 배경색까지
  별도 관리. Pace는 현재 각 탭 화면이 `SafeAreaView edges={['top']}`만 쓰고 하단은 탭 네비게이터가
  자체적으로 처리해 왔는데, 이번에 탭바 클리어런스 상수(`layout.tabBarContentClearance`)를 추가한
  것이 사실상 그 역할 — 화면마다 개별 계산이 필요할 만큼 화면 구조가 다양해지면 그때 jlpt-master
  식 `Math.max` 가드 패턴을 화면 단위로 도입 검토(현재는 상수 하나로 충분).

---

## 비주얼 아이덴티티 전면 개편 — healthy-shorts-assistant(2) 다크 리스킨 (2026-07-18)

사용자 명시적 지시("그대로 가져와, 니맘대로 바꿔서 퀄리티 떨어트리지 말고", "토씨 하나 틀리지
말고")에 따라 앱 전체를 healthy-shorts-assistant(2) 프로토타입의 다크 테마로 전면 교체. 기존
iOS 라이트 팔레트(#F2F2F7 배경 등)와 "No Gradients" 원칙은 이 리스킨 범위 내에서 **명시적으로
오버라이드**됐다 — `constants/theme.ts`의 `gradients` export가 그 승인된 그라데이션 목록.

### 완료된 것
- **`constants/theme.ts`**: 다크 팔레트(배경 #0B0C0F, 카드 #171A21, cardMuted #09090B, primary
  #5856D6 유지), 그라데이션 토큰, `sourceColors`(플랫폼별 강조색), `bottomSheetPadding()` 헬퍼
  (jlpt-master 패턴). **2026-07-18 2차 수정**: `background`가 처음엔 `#060709`로 잘못 이식됐었다 —
  이건 App.tsx:253의 "폰 목업을 감싸는 웹페이지 배경"(`<div className="min-h-screen bg-[#060709]">`)
  이고, 실제 앱 화면(폰 프레임) 배경은 App.tsx:261의 `bg-[#0B0C0F]`다. 픽셀 샘플링으로 렌더된
  배경이 정확히 `#0B0C0F`(R11 G12 B15)임을 검증 완료.
- **Home 화면**: `SessionHeroCard`(그라데이션 히어로, 펄스 애니메이션, 퍼센트 완료 배지),
  `PlatformPickerCard`(커버 이미지 + 좌→우 그라데이션 오버레이 + 펄스 상태줄, **세로 풀와이드
  스택** — 가로 그리드 아님), `QuickControlsGrid`(3타일 + 바텀시트), 3개 플랫폼 카드(YouTube/
  Instagram/TikTok, 전부 실제 `useSettingsStore`/`useStatsStore` 연결). "TAP TO START" 배지 포함.
- **AppHeader**: "PACE" 워드마크 + 인디고 점(animate-pulse) + 인사말이 **한 줄**로 나란히
  (`space-x-2`), 그 아래 "Active Session Guard" 서브타이틀. 헤더 전체는 `items-end` 정렬(우측
  아바타 블록이 좌측 텍스트 블록 하단에 맞춰짐), `px-6 pt-5 pb-3`(24/20/12px). **2026-07-18
  2차 수정**: 이전 버전은 점을 "PACE" 앞에 붙이고 인사말을 별도 줄로 내려서(`flex-start` 정렬)
  원본과 완전히 다른 레이아웃이었다 — Header.tsx:59-73 재확인 후 구조 전면 수정.
- **Home 탭 + Header는 번역을 아예 안 쓴다(하드코딩 영어 고정)**: App.tsx의 Home 탭 JSX
  (280-456줄)와 Header.tsx를 다시 정독해서 확인 — `t.xxx`/`translations` 참조가 단 한 번도 없다.
  "Today Session"/"Complete"/"Auto Next Ready"/"Choose Platform"/"Quick Controls"/플랫폼 상태
  문구/"Good Morning" 인사말/"Active Session Guard" 전부 locale 무관하게 항상 영어. 반대로
  Focus/Stats/Settings 탭은 실제로 `translations` 딕셔너리를 쓴다(SettingsSection.tsx/
  StatsTab.tsx/SettingsTab.tsx가 각각 import). 이전 버전은 Home 탭 전체를 한국어 UI에서 억지로
  번역했는데, 이러면 (a) 원본과 다르고 (b) 한국어 문자열이 영어보다 길어서 고정폭 카드/그리드를
  실제로 오버플로우시켰다(실기기 스크린샷으로 확인) — `SessionHeroCard`/`PlatformPickerCard`/
  `QuickControlsGrid`/`home.tsx`/`AppHeader`에서 `useTranslation` 제거하고 원본처럼 하드코딩
  영어로 고정. `translations.ts`의 `home.*`에서 이제 죽은 키(greeting*/headerSubtitle/
  todaySession/complete/autoNextReady 등) 전부 삭제 — `youtubeShorts`/`instagramReels`/
  `tiktokVideoLoop`/`minUnit`만 남음(Stats/Settings 탭이 실제로 재사용하는 브랜드명·단위 키).
- **Home 화면 여백/사이즈 전면 재보정**: 처음엔 카드들이 화면 좌우로 16px(`spacing.md`) 여백만
  있었는데, 원본은 최상위 wrapper가 `px-6`(24px) — 히어로 카드/플랫폼 스택/퀵 컨트롤 전부 24px로
  수정(섹션 헤더는 그 안에 `px-1` 추가 중첩이라 28px). `SessionHeroCard`의 큰 숫자(`0`)에
  `lineHeight`가 없어서 커스텀 디스플레이 폰트의 기본 줄간격이 원본의 `leading-none`보다 훨씬
  크게 렌더돼 카드 전체가 원본보다 눈에 띄게 컸다 — `lineHeight: fontSize`로 고정. 우상단 앰비언트
  글로우(`blur-2xl` 근사용 반투명 원)가 RN에는 진짜 블러가 없어 딱딱한 원으로 보이며 "0%
  COMPLETE" 배지와 겹쳐 부서져 보였다 — 크기/불투명도 축소(`0D` 알파)+카드 밖으로 오프셋. 사용자가
  실기기 스크린샷 비교 후 명시적으로 추가 축소 지시: 플랫폼 카드 100px→84px, Quick Control 타일
  패딩 14→12px, 히어로 카드 패딩 24→20px.
- **하단 탭 순서 버그**: App.tsx:539-576 재확인 결과 원본 탭 순서는 Home→Focus→Stats(Insights)→
  Settings인데, `(tabs)/_layout.tsx`는 Home→Stats→Focus→Settings로 등록돼 있었다(Tabs.Screen
  선언 순서가 실제 표시 순서 = 실버그, 단순 주석 오기 아님) — 등록 순서 수정.
- **Focus 화면**: Session Control Hero(그라데이션+Live Engine 배지) → Session Status →
  Android Guard Services(`Platform.OS==='android'` 조건부) → Pause/End 컨트롤 → Extend Time 칩
  → Interventions(Break Reminder/Healthy Pause 토글 + Demo 모달) → Session Stats 3그리드 →
  Finish Session 확인 모달. **실제 데이터 연결**: watched/remaining/sleepTimer는
  `useSettingsStore`+`useStatsStore`, Session Stats(videos/elapsed/avg)는 원본의 하드코딩
  18/37m/22s 대신 `todayVideosWatched`/`todayUsageMinutes`/`todayAverageDurationSeconds` 실사용.
- **Settings 화면**: Account/Session Defaults/Connected Apps/Platform Configuration/
  Notifications/Language(Pace 전용)/Support/Advanced(Reset) 구조. Session Defaults는 원본이
  세션과 무관한 로컬 데모 state였던 것을 실제 `useSettingsStore`에 직결(더 정확함 — 죽은 데모
  state 안 만듦). Connected Apps는 실제 `settings.appShields` 반영.
- **탭바**: lucide Home/Sliders/BarChart2/Settings ≈ Feather home/sliders/bar-chart-2/settings로
  1:1 매칭(이전엔 Ionicons outline/filled 스왑을 잘못 썼었음 — 원본은 필드 스왑이 아니라 색상
  변화만 줌).
- **오버레이 바**: Android 알약/iOS 프레임 다크 글래스 리스킨 + `GlassSurface` 컴포넌트(iOS 실제
  BlurView, Android는 zen-master/jlpt-master 전례대로 flat 반투명 폴백 — 텍스트 위 실블러로 인한
  가독성 저하 회피).
- **WeeklyGraphCard**: 다크 톤 자동 적용(theme 토큰 기반이라 재작성 불필요, 디바이더 컬러만 수정)
  + Home에서 Stats 탭으로 이동. **Platform Breakdown 신규**: `overlay/index.tsx`가 세션 시작 시
  `platform_app`을 실제로 기록하도록 고쳐서(이전엔 항상 `null`) 기존에 있었지만 죽어있던
  `getTodayUsageByApp()` 쿼리가 처음으로 실제 데이터를 반환하게 됨.
- **지원 앱**: TikTok을 Home 플랫폼 선택에 복원(사용자 지시로 앞서의 "MVP 2개 앱" 축소 결정을
  이 화면에 한해 오버라이드) — `constants/supportedApps.ts` + `ForegroundAppWatcher.kt`
  `SupportedApps.PACKAGES` 양쪽에 `com.zhiliaoapp.musically` 추가.
- **Android 실제 앱 실행**: 플랫폼 카드 탭 → `/overlay?platform=X` 이동 → `overlayService.startSession()`
  (기존) + `Linking.openURL(androidScheme)`(신규, 실패 시 `webFallback` 웹 URL로 폴백) — 이전엔
  플랫폼 카드가 전부 동일한 dead 버튼이었던 것을 실제 앱 실행까지 연결.

### 의도적으로 원본과 다르게 간 부분 (전부 "정확성 우선" 판단, 임의 축소 아님)
1. **Settings "Platform Configuration"의 안드로이드↔iOS 전환 버튼 제외** — 원본은 브라우저
   프리뷰에서 두 플랫폼을 다 보여주기 위한 데모 토글이었다. 실제 앱은 `Platform.OS`가 빌드 시점에
   고정되고 런타임에 전환할 대상이 없어(안드로이드 빌드에 iOS 시뮬레이션 화면을 넣는 건 무의미)
   토글 UI 없이 실제 OS에 맞는 정보만 표시.
2. **Focus "Session Active" 배지를 동적으로 변경** — 원본은 `t.autoNextStatus`("자동 넘김 ON")를
   `settings.autoNext` 값과 무관하게 항상 표시하는 것으로 보임(정적 데모 값). Pace는
   `settings.autoNext ? ON : OFF`로 실제 상태를 반영하도록 고쳤다.
3. **Stats 화면 전면 재구축(2026-07-18 2차) — 이전 버전은 원본과 완전히 다른 자체 구조였다.**
   `StatsTab.tsx` 원본을 처음부터 다시 정독해서(이전엔 요약/추측으로 지어냈던 것으로 추정) 실제
   섹션 순서(This Week Hero → Focus Score+Healthy Streak 2단 그리드 → Platform Breakdown(얇은
   가로 바) → Today's Behavior(3행 리스트) → Weekly Activity(요일별 바+목표선) → Best Day 카드)로
   전면 재작성. "Insights" 대형 타이틀, "웰니스 요약"/"연속 기록 & 성과" 섹션, "Wholesome Feed
   Breakdown" 카테고리 목록은 실제 소스에 존재하지 않는 이전 세션의 오구현이라 전부 삭제.
   구프로토타입(healthy-shorts-assistant 1세대)에서 가져온 `WeeklyGraphCard.tsx`(세로 막대그래프
   스타일)도 현재 소스의 실제 "Weekly Activity" 디자인(가로 바+목표선 리스트)과 달라 삭제하고
   `stats.tsx`에 원본 구조 그대로 인라인 구현.
   - **실제 데이터로 채운 것**: This Week 합계(`weeklyStats` 합산), Healthy Streak(기존
     `computeStreak` 로직), Platform Breakdown(`getTodayUsageByApp`, `sourceColors` 강조색),
     Today's Behavior의 Videos Watched/Average Duration(`todayVideosWatched`/
     `todayAverageDurationSeconds`) 및 **Longest Session**(`getWeeklyStats()`가 이미
     `longestSessionSeconds`를 리턴하고 있었는데 여태 UI에서 안 쓰고 있었음 — 오늘자 엔트리에서
     추출), Weekly Activity 요일별 바(실제 `weeklyStats` + 실제 `dailyLimitMinutes`를 목표선
     기준으로 사용, 목표선이 트랙의 60% 고정 위치를 가리키도록 `trackMax = dailyLimitMinutes/0.6`
     로 스케일 역산), Best Day(0보다 크고 한도 이하인 날 중 최댓값 실계산 — 없으면 카드 자체를
     숨김).
   - **"Focus Score"(82점) — 그대로 두지 않고 대체**: 채점 알고리즘이 정의돼 있지 않아 그 라벨/
     숫자를 포팅하지 않되, 2단 그리드 레이아웃 자체(원본의 핵심 시각 구조)는 사용자가 명시적으로
     요구해서 유지 — 같은 슬롯에 실제 "일일 평균"(`weeklyAvgMinutes`, 실계측) 데이터를 다른
     라벨로 표시.
   - **여전히 갭인 것(가짜 숫자로 채우지 않고 보류)**:
     - This Week Hero의 "18% 지난주 대비 감소" 트렌드 칩 — `getWeeklyStats()`는 최근 7일
       슬라이딩 윈도우만 반환하고 "그 이전 7일" 비교 쿼리가 없다. `getPreviousWeekStats()` 같은
       신규 리포지토리 함수 필요.
     - "Auto Next Impact"(31개 비디오 자동 넘김) 섹션 — 통째로 미포함. Auto Next로 자동
       스킵된 영상 수를 세는 카운터가 스키마에 없다(`viewing_sessions.videos_watched`는 전체
       시청 수일 뿐 auto-next로 넘어간 것과 수동 스와이프를 구분 못 함).
4. (해결됨 — 위 3번 참고) Stats "This Week Hero"/"Today's Behavior"/"Best Day" 재배치는 완료.
5. **`WeeklyGraphCard.tsx`를 실수로 삭제했다가 복원(2026-07-18 3차)** — StatsTab.tsx만 읽고
   "Stats 탭 = StatsTab.tsx 전체"라고 착각해서, 기존에 있던 `WeeklyGraphCard.tsx`를 "예전
   프로토타입에서 온 컴포넌트"로 오판, 삭제했다. 실제로는 App.tsx:32/498-508이 Stats 탭에서
   `<StatsTab>` **뒤에 별도로** `<WeeklyGraph>`(`components/WeeklyGraph.tsx`)를 "Weekly Usage
   Graph" 제목의 카드로 덧붙이고 있었다 — 진짜 실사용 컴포넌트였다. 사용자가 원본 스크린샷으로
   지적해서 발견, `WeeklyGraph.tsx` 원본 재확인 후 동일 구조로 복원(주간 평균 큰 숫자+Healthy
   배지, 일~토 막대그래프, 탭하면 툴팁, 하단 "Today (요일)"/"Goal: Under 60 min" 푸터) —
   데이터는 실제 `weeklyStats`를 일~토 7칸으로 0-채움해서 사용.
6. **하단 탭 라벨 오타**: Stats 탭의 실제 라벨은 `translations.ts`의 `t.insights`("Insights"/
   "분석")인데, Pace는 `tabs.stats`를 "Stats"/"통계"로 임의로 지어 썼었다 — "Insights"/"분석"으로
   수정.

### 미해결 / 다음 세션 확인 필요
- [ ] Stats 화면을 "This Week Hero + Focus/Streak 그리드 + Best Day" 레이아웃으로 재배치(값은
  기존 실계측 데이터 재사용, Focus Score 등 미정의 지표는 제외).
- [ ] iOS 실기기/시뮬레이터에서 전체 다크 리스킨 육안 확인(이 세션은 Windows라 불가) — 특히
  `GlassSurface`의 iOS `BlurView` 경로, `OverlayBar.ios.tsx`.
- [ ] `PlatformPickerCard`/`SessionHeroCard`의 pulse 애니메이션이 실기기에서 버벅이지 않는지
  확인(현재 `Animated.loop` 사용, 저사양 기기 성능 미검증).
- [ ] Focus/Settings 화면에 새로 추가된 알림 토글(5분 전 경고/한도 도달/휴식 알림)은 아직 로컬
  state일 뿐 실제 로컬 알림(expo-notifications) 발송과 연결 안 됨 — UI만 존재.

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
- [x] Android Overlay 네이티브 모듈 컴파일 성공 + `hasOverlayPermission`/`requestOverlayPermission`이 실제 Android 설정 화면을 여는 것까지 확인 + **`WindowManager` 실제 렌더 육안 확인 완료(2026-07-17)** — 아래 섹션 참고
- [x] i18n 시스템(jlpt-master `i18n`/`LangContext` 패턴 이식, `services/i18n`) + Settings 언어 선택 UI — `pace_test` 에뮬레이터 실기기 검증 완료(System/English/한국어 전환, 혼용 원칙 확인). "실기기 검증 2차" 섹션 참고
- [x] 스토어 심사관 화이트리스트(jlpt-master `reviewers.ts`/`PremiumContext` 패턴 이식, `constants/reviewers.ts` + `useSubscriptionStore.isReviewer`)
- [x] 결제 전 로그인 가드(jlpt-master `PremiumPaywallModal.blockIfNotSignedIn` 로직 이식, 시각 요소는 Pace 플랫 디자인 유지)
- [ ] RevenueCat 연동 실키 발급 및 실기기 검증 (현재는 `EXPO_PUBLIC_RC_*` 미설정 시 로컬 캐시 폴백만 동작)
- [ ] Google/Apple 로그인 실기기 검증 (실키 + `npx expo prebuild` + EAS Dev Client 빌드 필요, 코드 자체는 완료)
- [ ] 커스텀 백엔드 서버 자체 구현(현재 `API_BASE_URL`은 자리표시자, 실제 서버 없음)
- [ ] Android AccessibilityService(포그라운드 앱 감지 + Auto Next 감지), Bubbles(17+) 네이티브 모듈 — "제품 전략 피벗" 섹션 피벗으로 우선순위 상승
- [ ] iOS 네이티브 모듈(ActivityKit, FamilyControls) — 피벗 후 핵심 경로 아님, App Blocking 등 보조 기능용으로만 유효. EAS Dev Client 빌드 전제
- [ ] **[블로커] iOS Pace Player 콘텐츠 출처 확정** — "제품 전략 피벗" 섹션 참고. 결정 전까지 아래 iOS Player 관련 항목 전부 착수 불가
- [ ] Android App Picker 바텀시트 UI(Start 탭 시 YouTube/Instagram 선택) — 신규
- [ ] iOS 온보딩 시트 + Source 선택 시트 UI — 신규, 콘텐츠 출처 확정 후 착수
- [ ] iOS Pace Player 화면 + 재생 엔진 + `usePlayerStore` + `videos`/`playlist_sessions` DB 테이블 — 신규, 콘텐츠 출처 확정 후 착수
- [ ] MVP 지원 앱 축소 반영: `SUPPORTED_APPS` 상수(YouTube+Instagram만) 코드에 실제 적용 — 현재 미반영
- [x] 폰트 실제 로드(Plus Jakarta Sans/JetBrains Mono, `@expo-google-fonts` + `useFonts`) — "타이포그래피 실제 로드 + OS별 탭바 처리" 섹션 참고, Android 실기기 확인 완료
- [ ] iOS 탭바 Liquid Glass 블러(`BlurView`) 육안 확인 — Windows 개발 환경이라 iOS 시뮬레이터/실기기 없어 이번 세션엔 미검증, 코드는 완료
- [ ] "Wholesome Feed Breakdown" 카테고리 실계측(현재 정적 목업 비율)
- [ ] `REVIEWER_EMAILS`에 실제 스토어 제출용 테스트 계정 등록(현재 빈 배열 — 스토어 제출 전 필수)
- [x] 하단 탭 바 아이콘 연결(Ionicons outline/filled, 2026 트렌드 리서치 반영 — "하단 탭 바 아이콘 추가" 섹션 참고)
- [ ] 실기기(arm64) `expo run:android` 빌드/설치까지는 성공 확인, USB 연결 끊김으로 최종 설치·구동은 미완료 — 재시도 필요
