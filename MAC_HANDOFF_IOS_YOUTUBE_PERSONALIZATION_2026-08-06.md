# iOS 쇼츠 개인화 조사 — "로그인 안 돼 있어도 안드로이드처럼 하면 되잖아"

**작성**: 2026-08-06 Windows 세션
**대상**: Mac 세션 (iOS 실기기 검증 필요)
**발단**: 사장님 지적 — "첫 영상은 유튜브에서 받고 다음도 유튜브가 잇기로 했는데 아직도 영어 영상이
나온다", 이어서 "iOS에서 유튜브 로그인이 안 되어 있어도 안드로이드처럼 하면 되잖아"

---

## 0. 결론 먼저

| 질문 | 답 |
|---|---|
| "첫 영상만 받고 다음은 유튜브가 잇는다"가 iOS에서 안 되는 건가? | **아니다. 이미 그렇게 동작하고 있었다.** |
| 그럼 왜 영어가 나왔나? | **그 유튜브 세션의 언어가 `en`으로 고정돼 있었다.** (수정 완료) |
| 안드로이드처럼 "로그인 없이" 개인 알고리즘을 탈 수 있나? | **없다.** 안드로이드가 개인화되는 이유는 로그인 자체가 아니라 **실제 유튜브 앱**을 쓰기 때문이다. |
| 그럼 iOS도 유튜브 앱을 열면 되지 않나? | **열 수는 있다. 다만 그 순간 Pace의 기능이 전부 죽는다.** |
| 앱 안에서 유튜브에 로그인시키면? | 구현은 해뒀지만 **구글이 2023-07-24부터 임베디드 WebView 로그인을 차단**한다. 실기기 확인 필요, 막힐 가능성이 높다. |

**요약**: iOS에서 "Pace 기능 유지 + 개인 알고리즘"은 현재 기술적으로 막혀 있다. 지금 할 수 있는
최선은 **언어·지역을 맞춘 한국 인기 쇼츠**(구현 완료)다.

---

## 1. 먼저 — "다음 영상을 유튜브가 잇는다"는 이미 되고 있었다

사장님이 의심하신 부분인데, 코드상 이미 설계대로다.

`src/components/feed/YouTubeShortsPlayer.ios.tsx`
```ts
const NAV_MODE = 'swipe' as NavMode;      // 'reload'(우리 큐) 아님
export const SWIPE_NAV = NAV_MODE === 'swipe';
...
const firstVideoIdRef = useRef(videoId);  // 첫 영상만 고정
const navVideoId = NAV_MODE === 'swipe' ? firstVideoIdRef.current : videoId;
...
advance: () => { webRef.current?.injectJavaScript('window.paceAdvance&&window.paceAdvance();true;'); }
```

`src/app/feed/index.tsx` — `goNext()`
```ts
if (SWIPE_NAV) { playerRef.current?.advance(); }  // 우리 큐를 밀지 않는다
else { advance(); }
```

즉 **첫 영상만 우리가 주고(시드), 그 뒤로는 유튜브 페이지 안에서 스크롤을 주입해 유튜브가 스스로
다음을 고른다.** 큐를 쓰지 않으므로 "우리 목록이 계속 나오는" 구조가 아니다.

→ **문제는 "이어가느냐"가 아니라 "누구의 알고리즘으로 이어가느냐"였다.**

---

## 2. 영어가 나온 진짜 원인 — 세션 언어가 `en`으로 박혀 있었다

WebView가 유튜브에 보내던 동의(consent) 쿠키를 디코딩했다.

```
SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOS4wMV9wMBoCZW4gACgB

base64 디코딩 →
08 02 | 12 35 | 08 03 | 12 2B "boq_identityfrontend_20240109.01_p0" | 1A 02 "en" | 20 00 | 28 01
                                                                       ^^^^^^^^^^
                                                                       필드3 = 언어 = "en"
```

여기에 더해 여는 URL도 `https://www.youtube.com/shorts/<ID>` 로 **`hl`/`gl`이 전혀 없었다.**

즉 우리는 매 요청마다 유튜브에 **"이 세션의 언어는 영어"** 라고 알려주고 있었다. 익명 세션의 다음
쇼츠는 개인화가 아니라 언어·지역 인기로 결정되므로, 첫 영상(한국어 시드) 이후로는 영어권 인기
쇼츠로 흘렀다.

### 서버는 정상이었다 (확인함)
프록시를 직접 호출해 확인 — gl/hl 없이도 IP 지오로 한국 결과가 온다.
```
GET https://pace-strides7.vercel.app/api/youtube-shorts?query=%23shorts
→ "요리 초보들 사이에서 난리난 질긴 스테이크 해결하는 방법"
  "위험한 발언에 리액션 고장난 아이돌 TOP4"
```
`api/youtube-shorts.ts`는 `gl`/`hl` 쿼리 → `x-vercel-ip-country` 헤더 → `FALLBACK_GL='US'` 순으로
결정한다. 한국 IP면 KR이 채워지므로 서버 원인이 아니었다.

### 수정 내용 (커밋 완료)
익명 세션의 언어·지역 판단 경로 **3개를 모두** 맞췄다. 하나만 맞추면 나머지가 영어로 남아 도로
영어권으로 끌려간다.

| 경로 | 수정 전 | 수정 후 |
|---|---|---|
| SOCS 동의 쿠키 언어 필드 | `en` 고정 | 기기 언어로 생성 (`SOCS_BY_LANG`) |
| PREF 쿠키 | 없음 | `PREF=hl=<언어>&gl=<지역>` 추가 |
| URL 쿼리 | 없음 | `?hl=&gl=&persist_hl=1&persist_gl=1` |
| Accept-Language 헤더 | 이미 있었음(8-05) | 유지 |

> **앞선 주석 정정**: 같은 파일에 *"URL 형태는 절대 안 건드린다 — `/shorts/<ID>`가 Shorts 탭으로
> 가는 유일하게 검증된 형태"* 라는 주석이 있었는데, **그 근거는 iOS에 해당하지 않는다.** 그 표
> (`services/shortsEntry.ts` 상단)는 *안드로이드에서 유튜브 앱으로 딥링크를 던질 때* 앱이 어느 탭으로
> 라우팅되는지에 대한 것이다. iOS는 앱으로 던지는 게 아니라 **WebView 안에서 웹페이지를 여는 것**이라
> 그 라우팅 규칙이 적용되지 않는다. `hl`/`gl`은 유튜브 표준 쿼리 파라미터다.
> **안드로이드 딥링크 URL은 그 주석대로 그대로 뒀다.**

---

## 3. "안드로이드처럼 하면 되잖아" — 왜 안 되는가

### 안드로이드가 개인화되는 진짜 이유
로그인 때문이 아니라 **재생 주체가 실제 유튜브 앱**이기 때문이다. 사용자 폰의 유튜브 앱은 이미 그
사람 계정으로 로그인돼 있고, Pace는 그 위에 **얹혀서** 동작한다.

```
[안드로이드]
  Pace → 딥링크 → 유튜브 앱(사용자 계정) → 개인 알고리즘
   └ 그 위에 얹힘: 알약 오버레이(SYSTEM_ALERT_WINDOW)
                   자동넘김(접근성 dispatchGesture)
                   시청시간 카운트(포그라운드 서비스 + UsageStats)
```

### iOS에서 같은 걸 하면 무엇이 죽는가
iOS도 딥링크로 유튜브 앱을 열 수는 있다. 문제는 **얹힐 자리가 없다**는 것이다.

| 기능 | 안드로이드 | iOS에서 유튜브 앱을 열면 |
|---|---|---|
| 알약 오버레이 | ✅ `SYSTEM_ALERT_WINDOW` | ❌ 다른 앱 위에 그리는 API 자체가 없음 |
| 자동넘김 | ✅ 접근성 `dispatchGesture` | ❌ 그런 API 없음 |
| 시청시간 카운트 | ✅ 포그라운드 서비스가 앱 밖에서도 카운트 | ❌ 백그라운드에서 남의 앱 사용시간을 볼 수 없음 |
| 하루 한도 집행 | ✅ | ❌ |
| 수면 감지 / Sleep Timer | ✅ | ❌ |

> Screen Time(FamilyControls/DeviceActivity) API를 쓰면 일부 가능하지만, **별도 Apple 승인이 필요하고
> 이미 심사 리스크로 제거한 경로다**(기존 결정).

**그래서 iOS는 시청 자체를 앱 안(WebView)으로 가져왔다. 그 대가가 익명 세션이다.**

---

## 4. 그럼 앱 안에서 로그인시키면? — 구현했지만 막힐 가능성이 높다

### 구현한 것
`src/components/feed/YouTubeLoginSheet.tsx` (신규) + 피드 P메뉴에 **"유튜브 로그인"**(iOS 전용).
- 로그인 성공(`youtube.com`으로 복귀) 감지 → 시트 닫고 `ytSessionNonce`로 플레이어 리마운트 →
  새 쿠키(계정)로 재접속
- 플레이어와 **동일한 사파리 UA** 사용 (UA가 다르면 다른 브라우저 세션으로 취급된다)
- `sharedCookiesEnabled`가 이미 켜져 있어 한 번 로그인하면 쿠키가 앱 쿠키 저장소에 남는다

### 🔴 그런데 구글이 이걸 막는다
[Google Developers Blog — Upcoming security changes to Google's OAuth 2.0 authorization endpoint in embedded webviews](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)

> **2023년 7월 24일부터** 임베디드 WebView에서 구글 계정 로그인을 시도하면 `disallowed_useragent`로
> 차단된다. 정책이 명시적으로 지목하는 대상에 **iOS의 `WKWebView`가 포함**된다.
> 이유는 임베디드 WebView가 고도로 커스터마이즈 가능해 로그인 페이지가 중간자 공격에 노출될 수 있기
> 때문이며, 구글 정책상 **브라우저만** 인증 요청을 할 수 있다.

우리는 깨끗한 사파리 UA를 쓰기 때문에 통과할 여지가 있지만(구글의 판정이 UA에만 의존하지는 않는다),
**실기기로 확인하기 전에는 미확정이고, 막힐 가능성이 더 높다고 본다.**

### 우회가 되지 않는 이유 (중요)
"그럼 사파리로 로그인시키면 되지 않나?" — **안 된다.**
- iOS 앱 샌드박스상 우리 WKWebView는 **사파리의 쿠키도, 유튜브 앱의 쿠키도 읽을 수 없다.**
- `ASWebAuthenticationSession`은 사파리 쿠키를 공유하지만, 거기서 얻은 세션 역시 **우리 WKWebView로
  넘어오지 않는다.**
- 즉 우리 WebView가 로그인 상태가 되려면 **그 WebView 안에서 직접 로그인하는 수밖에 없고**, 그 경로를
  구글이 막고 있다.

---

## 5. 선택지 정리 (제품 결정 필요)

| 안 | 개인 알고리즘 | Pace 기능 | 상태 |
|---|---|---|---|
| **A. 언어·지역 최적화** (현재 적용) | ❌ (한국 인기 쇼츠) | ✅ 전부 유지 | **구현 완료** |
| **B. 유튜브 앱으로 내보내기** | ✅ | ❌ 전부 죽음 (Pace가 실행기로 전락) | 미구현 |
| **C. 인앱 유튜브 로그인** | ✅ (되면) | ✅ 전부 유지 | 구현했으나 **구글 차단 가능성 높음** |

**권고**: A를 기본으로 유지하고, C는 Mac 실기기 검증 결과에 따라 유지/제거를 결정한다.
C가 막히면 P메뉴의 "유튜브 로그인" 항목은 **제거해야 한다** — 눌렀는데 구글 오류 페이지가 뜨는 건
없는 것만 못하다.

B는 권하지 않는다. 유튜브 앱으로 나가는 순간 시청시간 추적·하루 한도·수면 감지가 전부 무의미해져
앱의 존재 이유가 사라진다.

---

## 6. 🍎 Mac 세션 검증 체크리스트

### (1) 최우선 — 유튜브 로그인 시트가 구글에 막히는가
1. iOS 실기기에서 피드 진입 → **P 메뉴 → "유튜브 로그인"**
2. 구글 로그인 화면이 정상적으로 뜨는가?
   - ❌ `disallowed_useragent` / "이 브라우저 또는 앱은 안전하지 않을 수 있습니다" → **C안 폐기**,
     P메뉴 항목 제거 (`PaceMenu.tsx`의 `showYouTubeLogin`, `YouTubeLoginSheet.tsx`)
   - ✅ 로그인 완료되면 → 아래 (2)로
3. 로그인 후 피드가 자동 리마운트되고, **다음 영상이 내 추천으로 바뀌는지** 확인
4. 앱을 완전히 껐다 켠 뒤에도 로그인이 유지되는지 (`sharedCookiesEnabled` 검증)

### (2) 언어·지역 수정 검증 (로그인과 무관하게)
5. 한국어 기기에서 피드 진입 → 첫 영상 이후 **2~3회 넘겨도 한국어 영상이 나오는지**
6. WebView가 여는 URL에 `?hl=ko&gl=KR&persist_hl=1&persist_gl=1`이 붙는지
7. (선택) 기기 언어를 영어로 바꾸면 영어권 쇼츠가 나오는지 — 로케일 연동이 실제로 먹는지 확인

### (3) 회귀 확인 — URL에 쿼리를 붙인 영향
8. `/shorts/<ID>?hl=...` 형태로도 **쇼츠가 정상 재생되는지**(세로 풀스크린, 스와이프 정상)
9. `window.paceAdvance()` 스와이프 주입이 그대로 동작하는지
10. 비로그인 상태에서 "앱에서 보기" 인터스티셜이 늘지 않았는지

---

## 7. 참고 파일

| 파일 | 역할 |
|---|---|
| `src/components/feed/YouTubeShortsPlayer.ios.tsx` | 언어·지역 수정(`SOCS_BY_LANG`, `youtubeLocale`, `consentCookie`), swipe 전환 |
| `src/components/feed/YouTubeLoginSheet.tsx` | 유튜브 로그인 시트(신규, iOS 전용) |
| `src/components/overlays/PaceMenu.tsx` | `showYouTubeLogin` prop |
| `src/app/feed/index.tsx` | P메뉴 배선, `ytSessionNonce` 리마운트 |
| `src/services/shortsEntry.ts` | 시드(첫 영상) 정책 — 서버가 정책만 주고 기기가 시작점을 고른다 |
| `api/youtube-shorts.ts` | 프록시 — `gl`/`hl` 처리 (정상 확인됨) |

## 8. 출처

- [Google Developers Blog — OAuth 2.0 embedded webviews 보안 변경](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)
- [Auth0 Community — 403 disallowed_useragent for web login from embedded browsers](https://community.auth0.com/t/403-disallowed-useragent-for-web-login-from-embedded-browsers/55074)
- [OAuth "Sign In With Google" in a WKWebView — cnr.sh](https://cnr.sh/posts/2021-10-11-google-oauth-wkwebview/)
