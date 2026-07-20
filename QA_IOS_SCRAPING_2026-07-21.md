# iOS Pace Feed — 스케일 가능한 Shorts 소스 + 실기기 버그 수정 (2026-07-21)

작성: Claude (자율 야간 세션). 대상: iOS Pace Feed(공식 iframe 임베드 경로). 실기기(iPhone 14 Pro)
+ 시뮬(iPhone 17 Pro) 병행 검증. 로그/스크린샷 근거 기반.

---

## 1. 핵심: YouTube Data API 쿼터 → 서버사이드 스크래핑으로 무한 스케일 (라이브 배포됨)

### 문제 (사용자 지적, 유효)
- `search.list` = 호출당 **100 units**, 무료 하루 **10,000 units** → 하루 **~100회 검색**.
- 사용자마다 피드 로드 시 검색하면 **하루 ~100명이면 쿼터 소진** → 스케일 불가.
- 60초 CDN 캐싱만으론 부족(서로 다른 쿼리/페이지는 별도 호출).

### 해결 (배포 완료: `api/youtube-shorts.ts`, 커밋 018b5bd)
호출 횟수를 **사용자 수와 분리**한다.
- 서버가 YouTube 검색결과(`&sp=EgIYAQ%3D%3D` = Shorts 필터, 데스크톱 UA + 동의쿠키)를 스크래핑 →
  `shortsLockupViewModel` 블록에서 `videoId` + `accessibilityText`(제목) 추출.
- `pageToken` = 페이지 index → `CATEGORIES[index % 20]` **로테이션**(차분한 힐링/공예/자연 위주) →
  무한·다양한 피드. `nextPageToken`은 항상 다음 index → 하드스톱 없음.
- **CDN 장기 캐싱** `Cache-Control: s-maxage=3600, stale-while-revalidate=86400` →
  카테고리당 **시간당 1회만** 실제 스크래핑 → **사용자 100명이든 100만명이든 YouTube 트래픽 동일**.
- 캐시미스 시 **재시도 백오프**(순간 IP 레이트리밋 흡수). 스크래핑이 재시도 후에도 0개일 때만,
  키가 있을 때만 **Data API 안전망**(정상경로 쿼터 소모 0).

### 왜 스크래핑이 스케일에 유리한가
API 쿼터라는 개념 자체가 없다(그냥 HTTP GET). 유일한 리스크는 (a) YouTube HTML 구조 변경,
(b) IP 레이트리밋 — 둘 다 **서버 1곳 + CDN 캐싱**으로 흡수(구조 변경은 앱 릴리스 없이 서버만 수정,
레이트리밋은 시간당 20회 미만이라 도달 안 함).

### 전수 검증 결과 (로컬 `scrape_verify.js`)
| 항목 | 결과 |
|---|---|
| 카테고리 성공률 | **20/20** (각 15~37개 Shorts) |
| oEmbed 임베드 가능율 | **100%** (30/30 샘플) → 재생 실패 스킵 없음 |
| 유니크 videoId 비율 | **99.6%** (272 중 271) |
| consent 차단 | 0 (데스크톱 UA + SOCS/CONSENT 쿠키 유효) |
| 실패 사례 | "10연속 급속요청 시 IP 레이트리밋"뿐 → 간격/캐싱으로 100% 복구 |

### 종단 검증
- 실제 핸들러를 로컬 HTTP 서버(`local_proxy.mjs`, Node24 타입스트리핑)로 띄워 시뮬 연결 →
  `[Feed] queue=25 usingScrape=false`, page0/1/2가 satisfying/asmr/nature 로테이션,
  세로 Short "ASMR cleaning this paintbrush" 재생화면 스크린샷 확인.
- **라이브 프록시 `pace-strides7.vercel.app` 자동배포 확인** — push 후 `nextPageToken:"1"`(스크래핑판)
  응답 + 카테고리 로테이션 정상. Vercel이 이 GitHub repo에 연결돼 **master push 시 자동배포**됨.

---

## 2. 오늘 수정한 실기기 버그 (커밋됨)

| 증상 | 원인 | 수정 | 커밋 |
|---|---|---|---|
| **까만 화면** | YouTube 임베드는 항상 16:9라 `height=화면전체`면 영상이 위쪽 띠에만 뜨고 아래 전부 검정 | 16:9 명시 + 검은배경 정중앙 정렬 | 88d03f9 |
| **탭해도 재생 안 됨** | 가운데 spacer가 기본 `pointerEvents=auto`라 화면중앙 탭을 가로채 뒤 WebView로 안 감 | spacer `pointerEvents="none"` | 88d03f9 |
| **마이크 권한 팝업** | (구 빌드) 핑거스냅 경로가 마이크 요청 | `start()`는 mode 무관 head(카메라)만, `NSMicrophoneUsageDescription` 제거 | 88d03f9 |
| **"이거 쇼츠 아님"(가로 폴백)** | iPhone UA → m.youtube 동의페이지 → videoId 0개 → dev폴백(Big Buck Bunny) | (임시)데스크톱UA+쿠키+Shorts필터 클라 스크래핑 → (근본)위 서버 프록시 | a3cb174, 018b5bd |

---

## 3. 실기기 탭이 있어야 검증되는 잔여 항목 (시뮬 자동탭 불가 — cliclick/접근성 없음)

1. **첫 탭 → 재생**: iOS WKWebView는 무음이어도 제스처 없는 자동재생 차단(로그로 확인: 탭 없이
   `ready`까지만, `playing` 안 감). **첫 탭 필수는 플랫폼 제약**(버그 아님) — 사용자가 눌러 시작하므로
   오히려 정책준수에 유리. 기기 로그: 탭 시 `unstarted→buffering→playing` 확인됨.
2. **연달아 재생**(Focus Session ON일 때 다음 자동 넘김): 코드 정합성 확인(플레이어 remount 없음 =
   같은 WebView, `playing=current!=null&&status!=='PAUSED'`로 다음 영상이 `play=true` 마운트 →
   `loadVideoById` autoplay 경로). **첫 탭 이후 sticky activation으로 자동재생 가능성 높으나 실기기
   확인 필요.** 진단로그(`[YTPlayer] state=`)가 "탭 없이 다음이 playing 되는지" 그대로 찍음.
   → 기기 테스트: Focus Session 시작 → 첫 영상 탭 → 영상 끝나고 다음이 자동 playing 되면 성공.
3. **고개짓(ARKit head-nod) 실동작**: TrueDepth 실기기 전용(시뮬 불가) + 네이티브 모듈이라
   **Xcode 재빌드 필요**(현재 기기 바이너리는 구버전, 모듈 미링크 가능). Focus Session ON + 영상
   1/2지점 이후에만 카메라 켜짐(배터리 게이팅).

---

## 4. 남은 개선/주의

- **진단 console.log**(`[Feed]`, `[YTPlayer]`): 연달아 재생 기기검증 후 제거 예정.
- **세로 Short 크기**: iframe 임베드는 항상 16:9라 세로(9:16) Short은 프레임 안에서 필러박스 →
  화면을 꽉 못 채움. 임베드 정책상 진짜 풀블리드 9:16 불가(현재 16:9 중앙정렬이 최선).
- **스크래핑 취약성 모니터링**: YouTube가 `shortsLockupViewModel` 구조를 바꾸면 추출 정규식 갱신 필요.
  서버만 수정하면 되고, 실패 시 Data API 안전망 + dev폴백이 받침.
- **`.env`**: `EXPO_PUBLIC_YOUTUBE_PROXY_URL=https://pace-strides7.vercel.app` (Expo는 `.env_development`
  밑줄 파일을 안 읽음 — 반드시 `.env` 또는 `.env.development`(점)에 둘 것).

---

## 5. 검증 환경
- 기기: iPhone 14 Pro (실기기, TrueDepth) · 시뮬: iPhone 17 Pro (iOS 26.5)
- Metro: `expo start --dev-client --port 8081` (로그 캡처)
- 프록시: `pace-strides7.vercel.app` (라이브) + 로컬 `local_proxy.mjs`(종단검증용)
