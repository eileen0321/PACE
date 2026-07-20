# PACE — iOS Pace Feed(YouTube 임베드) 밤샘 구현·검증 (2026-07-20)

> iOS Pace Feed를 "합법 임베드(iframe)"로 되돌리고 iOS 시뮬레이터(iPhone 17 Pro / iOS 26.5)에서
> 실제 동작을 검증한 기록. 다른 AI(Android 담당) + 사람이 이어받을 수 있게 결론과 근거를 남긴다.
> 검증 방식: `expo run:ios` 디버그 빌드 + Metro 로그(`[iOS-YT]` 계측) + WebView `<video>` DOM 폴링.
> ⚠️ 이 환경은 **시뮬레이터에 합성 탭이 라우팅되지 않아**(접근성 미허용) 탭 기반 상호작용은 불가.

---

## ‼️ 2026-07-20 최종 정정 (아래 초기 결론 일부를 뒤집음 — 이걸 먼저 읽을 것)

**초기 결론("합법 임베드는 iOS에서 재생 불가 → Pexels로 전환")은 틀렸다.** 원인은 내 구현이
잘못됐던 것: (a) `new YT.Player`를 `loadHTMLString`으로 심으니 WKWebView가 origin을 opaque로 잡아
error 152, (b) `/embed` URI를 직접 로드하니 WKWebView가 Referer를 안 보내(WebKit #169846) YouTube가
스트림 거부(readyState 0). nocookie/Referer 헤더로도 안 됨.

**해법(구현·검증·커밋 완료, `d92c24e`)**: `react-native-youtube-iframe` 라이브러리 사용. 이 라이브러리는
플레이어 HTML을 **실제 호스팅 URL에서 로드**해 origin/Referer를 확보 → Referer 문제를 우회한다.
- ✅ **iOS 시뮬에서 YouTube 영상이 로드·표시되고 `onReady` 정상 수신**(error 152 없음). 즉 **합법
  임베드로 iOS에서 YouTube가 뜬다** — 사용자가 원하던 "iframe으로 유튜브" 가 iOS에서 성립함.
- ⚠️ **단, iOS는 제스처 없는 (무음)자동재생을 차단**해서 `play=true`여도 영상이 "재생버튼" 상태로 멈춘다
  (플랫폼 한계, 라이브러리/코드 문제 아님 — `onReady playing=true` 확인). **사용자가 영상을 한 번
  탭하면 재생**되고, 같은 WebView에서 `loadVideoById`로 다음 영상을 이어재생하므로 **첫 탭 이후
  auto-next는 hands-free 가능성이 높다**(무탭 시뮬에선 첫 탭 이후 동작을 검증 못 함 → 실기기 확인 필요).
- ⚠️ **VEVO/일부 뮤비(dQw4w9WgXcQ 등)는 "다음에서 보기: YouTube" 오버레이로 인라인 재생 불가** — 실제
  Shorts는 대부분 인라인 임베드 가능하나, 소스에서 임베드 불가 영상은 걸러야 함. dev 폴백을 인라인
  가능 영상(Big Buck Bunny 등)으로 교체함.

**따라서 아래 §1·§2의 "Pexels로 전환" 권고는 철회.** iframe(공식 임베드, 라이브러리) 경로로 iOS를
간다. 남은 실기기 확인 항목: (1) 첫 탭 후 auto-next 연속 재생, (2) 무음/유음 정책, (3) 실제 Shorts
소스(프록시)에서 임베드 불가 영상 필터링.

---

## 0. 무엇을 했나
- 기존 `YouTubeShortsPlayer.tsx`(2026-07-20 재작성분)는 **`youtube.com/shorts/{id}` 원본 페이지를
  그대로 WebView에 로드**하는 방식(= PACE_ARCHITECTURE.md의 "원안 ①"). 이는 YouTube 약관 +
  Apple 심사(4.2/5.2.5) 위반 리스크가 있어 iOS 스토어 경로에 못 쓴다.
- iOS는 **공식 임베드로 분리**: `src/components/feed/YouTubeShortsPlayer.ios.tsx` 신규 추가.
  Metro가 iOS=`.ios.tsx`, Android=`.tsx`를 자동 선택 → Android 원본페이지 경로와 **충돌 없이 공존**.
  (커밋 `1640e37`)

## 1. 핵심 결론 (요약)
| 항목 | 결과 |
|---|---|
| iframe이 iOS에서 원천 차단되나? | **아니오.** IFrame Player API `onReady` 정상 수신 — Android을 막던 WebView Media Integrity(Google Play 정책)는 iOS에 없음 |
| IFrame Player API를 html-string으로 심기(d75c544) | ❌ `error 152`(임베드 거부). WKWebView `loadHTMLString`이 baseUrl을 줘도 origin을 opaque(null)로 잡는 알려진 제약 |
| 진짜 URL `youtube.com/embed/{id}` 로드 | ✅ error 152 사라짐, `<video>` 엘리먼트 정상 생성(paused:false, muted:true) |
| **그 `<video>`가 실제로 재생되나?** | ❌ **readyState 0(HAVE_NOTHING)에서 못 벗어남** — YouTube가 임베드 스트림 src를 끝내 안 붙임 |
| 시뮬레이터 자체의 영상 재생 능력 | ✅ 동일 WebView에 **일반 mp4를 물리면 readyState 4로 정상 자동재생** → 코덱/시뮬 문제 아님, YouTube가 임베드를 막는 것 |
| **원본 페이지(`/shorts/{id}`, Android 방식)를 iOS에서 로드하면?** | ✅ **iOS 시뮬에서 실제로 재생됨**(2026-07-20 스크린샷 증거: "Rick Astley - Never Gonna Give You Up"이 자막까지 나오며 재생, 전체 YouTube UI 노출). 즉 iOS WebView가 YouTube를 못 트는 게 아니라, **"임베드"만 막히고 "원본 페이지"는 된다** — 그런데 원본 페이지는 ToS/심사 위반 |
| **최종 결론** | iOS에서 YouTube는 **"합법(임베드)이면 재생 안 되고, 재생되면(원본페이지) 위반"** = 출시 가능한 조합이 없음. ⇒ iOS Pace Feed는 **아키텍처 문서 Plan B(Pexels/Pixabay 라이선스 세로 숏폼)로 전환**하는 것이 유일하게 합법이면서 재생·자동넘김이 자유로운 길. (실기기에서 임베드가 될 가능성은 낮음 — 임베드 차단은 서버측 정책이라 기기 무관) |

### 재현 로그(발췌)
```
[iOS-YT] {"type":"ready"}                 ← IFrame API 자체는 iOS에서 동작
[iOS-YT] {"type":"error","code":152}      ← html-string 방식(opaque origin)일 때
...
[iOS-YT] {"type":"diag","vids":1,"ifr":0,"rs":0,"paused":false,"muted":true,"dur":null}  ← /embed URI: video 있음, 재생 안 됨(rs 0)
[iOS-YT] {"type":"diag","vids":1,"rs":4,"dur":5}   ← 같은 WebView에 일반 mp4: 정상 재생
```

## 2. 왜 이게 중요한가 (제품 판단 필요)
- 사용자 방향은 "합법 iframe으로 iOS Pace Feed"였다. **합법 임베드로는 재생이 안 붙는다**(위 표).
  "되는" 유일한 경로는 Android가 쓰는 **원본 페이지 로드(원안 ①)뿐인데 그건 위반**이다.
- 즉 iOS에서 "YouTube Shorts를 자체 피드로 정주행"은 **합법·기술 양립이 어려운 영역**임이 실측으로
  재확인됐다(문서의 기존 리스크 판정과 일치).
- **권고(강함): iOS Pace Feed를 Pexels/Pixabay 라이선스 세로 숏폼으로 전환**. 근거: (1) 임베드는
  재생이 안 붙고(readyState 0), 이 차단은 YouTube **서버측 정책**이라 실기기여도 결과가 같을
  가능성이 큼 → "(A) 실기기서 임베드 재검증"은 기대값 낮음. (2) 원본페이지는 재생되지만 위반이라
  스토어 제출 불가. (3) 아키텍처 문서가 이미 정한 Plan B이고, `EXPO_PUBLIC_PEXELS_KEY`가 `.env`에
  이미 있으며 `usePlayerStore`/Pexels(`services/api/pexels.ts`) 경로가 코드에 폴백으로 남아 있어
  전환 비용이 작다. 자체 `<Video>`(expo-video)라 재생·자동넘김·UI 100% 자유(위반 없음).
- ⚠️ 이 전환은 `feed/index.tsx`(공유)와 큐 스토어를 건드리고 Android(YouTube 유지)와 겹치므로,
  **Android 담당과 조율 후** iOS 소스만 Pexels로 가르는 게 안전(플랫폼 분기). 무단 대량 수정은 보류함.

## 3. 검증 중 발견한 실제 버그 (Feed 파이프라인)

**[High] 스크래핑이 videoId를 0개 반환 → 프로덕션 EMPTY_FEED**
- `src/services/api/youtube.ts` `fetchShortsViaScrape`
- `m.youtube.com/results` HTML에서 `"videoId":"..."` 정규식이 **현재 구조와 안 맞아 0개** 추출(curl로
  확인: 200 OK, 550KB, 매치 0). 프록시/키 미설정 시(현재 `.env`가 그 상태) 프로덕션은 빈 피드가 된다.
- 조치: 서버 프록시(`api/youtube-shorts.ts`) 경로를 프로덕션 기본으로 강제하거나, 스크래핑 파서를
  현행 HTML(ytInitialData JSON) 기준으로 갱신.

**[High] dev 폴백 영상이 임베드 불가라 iframe에서 즉시 error**
- `src/services/api/youtube.ts` `DEV_FALLBACK_SHORTS` = `dQw4w9WgXcQ`(Rick Astley) 등.
- Rick Astley 공식 뮤비는 **임베드 비허용**이라 iframe에서 재생 불가(원본페이지 방식에선 되던 것).
  iframe 경로 검증용 dev 폴백은 **임베드 허용된 영상**이어야 한다.
- 조치: 폴백을 임베드 허용 영상으로 교체(또는 실제 Shorts는 대체로 임베드 허용이므로 프록시 소스로 검증).

**[Med] watched 누적으로 dev에서 피드가 영구히 빈다**
- `src/store/useShortsQueueStore.ts` — `advance()`가 스킵/에러까지 watched로 영속(`pace_watched_shorts`).
  dev 폴백은 3개뿐이라 한 번씩 지나가면(에러 스킵 포함) 그 뒤로 `dedupeAppend`가 다 걸러 **EMPTY_FEED
  고정**(앱 재설치 전까지 회복 불가). 실측: 재설치로 watched 비우면 큐 3개 복구됨.
- 조치: 폴백/소스가 고갈되면 watched를 순환(가장 오래된 것부터 비우기)하거나, 재요청이 계속 빈 결과면
  watched를 무시하고 재노출. `MAX_WATCHED`(500) 상한은 있으나 dev 3개 풀에선 무의미.

**[Med] `.ios.tsx` stall 처리 추가됨(참고)** — YouTube가 재생을 안 붙이면(readyState 0, 8초) `stalled`를
  올려 부모가 `onError(-2)`로 다음 영상 스킵하도록 구현. 다만 소스가 전부 임베드 불가면 전부 스킵→빈 피드.

## 4. 검증 중 발견한 iOS 런타임 이슈 (Feed 외)

**[Med] react-native-track-player Sleep Timer 메서드가 iOS 네이티브에 미구현**
- Metro 경고(매 실행): `getSleepTimerProgress` / `setSleepTimer` / `sleepWhenActiveTrackReachesEnd`
  / `clearSleepTimer` 의 "Objective-C method signature can not be found ... will not be available".
- JS에서 이 메서드를 호출하면 iOS에서 실패한다 → Sleep Timer 기능이 iOS에서 깨질 수 있음. 네이티브
  구현 추가 또는 iOS는 JS 타이머 폴백 필요.

**[Med] expo-notifications 매 실행 시 에러**
- `ERROR [expo-notifications] Error reading persisted server registration info: getRegistrationInfoAsync
  failed → ERR_NOTIFICATIONS_KEYCHAIN_ACCESS (ServerRegistrationModule.swift:161)`.
- 콜드 실행마다 빨간 LogBox 에러 배너가 전 화면에 상시. 시뮬레이터 키체인 제약일 수 있으므로 **실기기
  재현 우선 확인**. 재현되면 알림 초기화에 try/catch + 조건부 처리.

## 5. 참고(버그 아님)
- 매 실행 시 뜨는 "'Pace'에서 열겠습니까?" 다이얼로그 = expo dev-client가 `com.pace.app://
  expo-development-client/?url=...`로 앱을 여는 **디버그 빌드 아티팩트**(빌드 로그로 확인). 릴리스엔 없음.
- 알림 권한 요청 다이얼로그("알림을 보내고자 합니다")는 정상 동작(단, 시뮬 무탭 환경에선 이게 화면
  중앙을 가려 Feed 스크린샷 확인을 방해함 — 검증 한계).

## 6. 다음 작업 제안(우선순위)
1. **[결정]** iOS Pace Feed 방향: `/embed` 실기기 재생 검증 → 실패 시 Pexels 라이선스 피드로 전환.
2. Feed 소스 신뢰성: 프록시 경로 강제 + 스크래핑 파서 갱신(#3-1), dev 폴백 임베드 허용 영상으로(#3-2).
3. watched 고갈 복구 로직(#3-3).
4. track-player iOS Sleep Timer 네이티브/폴백(#4-1), expo-notifications 에러 가드(#4-2) — 실기기 재현 후.
