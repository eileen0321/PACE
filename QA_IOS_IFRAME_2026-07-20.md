# PACE — iOS Pace Feed(YouTube 임베드) 밤샘 구현·검증 (2026-07-20)

> iOS Pace Feed를 "합법 임베드(iframe)"로 되돌리고 iOS 시뮬레이터(iPhone 17 Pro / iOS 26.5)에서
> 실제 동작을 검증한 기록. 다른 AI(Android 담당) + 사람이 이어받을 수 있게 결론과 근거를 남긴다.
> 검증 방식: `expo run:ios` 디버그 빌드 + Metro 로그(`[iOS-YT]` 계측) + WebView `<video>` DOM 폴링.
> ⚠️ 이 환경은 **시뮬레이터에 합성 탭이 라우팅되지 않아**(접근성 미허용) 탭 기반 상호작용은 불가.

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
| **최종** | iOS 시뮬레이터에서는 YouTube 임베드 **실제 재생 검증 불가**. 실기기(FairPlay/실사용자 세션) 검증 필요. 실기기서도 안 되면 iOS Pace Feed는 대안(라이선스 콘텐츠)로 가야 함 |

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
- **결정 필요**: (A) 실기기에서 `/embed` 재생을 한번 더 검증(FairPlay/로그인 세션에서 붙을 여지) →
  되면 진행, (B) 안 되면 iOS Pace Feed를 아키텍처 문서의 대안인 **Pexels/Pixabay 라이선스 세로
  숏폼**(자체 `<Video>`, 재생·자동넘김 100% 자유)으로 전환. 코드에 `EXPO_PUBLIC_PEXELS_KEY`는
  이미 있고 `usePlayerStore`/Pexels 경로가 폴백으로 남아 있음.

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
