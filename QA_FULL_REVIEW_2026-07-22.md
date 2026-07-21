# 전체 검수 리포트 (2026-07-22, 출시 전 launch-blocking)

4개 영역 병렬 코드리뷰(feed/native · UI화면 · 스토어/DB · config) 결과. **A=이미 수정(커밋됨),
B=형 결정·키 필요(코드로 못 고침), C=실기기/Android 조율 필요.**

---

## ✅ A. 이미 수정·커밋 완료 (a1c9176 등)

| # | 심각도 | 문제 | 수정 |
|---|---|---|---|
| A1 | 🔴 BLOCKER | **타임존 일일제한 버그** — `date(started_at)`가 UTC, `date('now','localtime')`가 로컬이라 어긋나 **한국 등 non-UTC 사용자는 오늘 사용량 과소집계 → 일일제한 미발동** + 주간통계 오류 | statsRepository 전 쿼리 `date(started_at,'localtime')`로 통일 |
| A2 | 🔴 BLOCKER | **iOS YouTube 카드 → 가짜 "DEV SIMULATOR" 목업**(심사 반려 2.2/4.3) + "그냥 열기" 카드 iOS 무동작(죽은버튼) | iOS는 실제 인앱 `/feed`로 라우팅(Android는 그대로) |
| A3 | 🟠 HIGH | **iOS 피드 무음 재생** — injected JS `v.muted=true` 후 unmute 없음 → 스냅AEC/볼륨키 전제(영상소리) 무너짐 | 첫 사용자 탭(제스처)에 unmute |
| A4 | 🟡 MED | 피드 **empty 플래시** — 스킵>refill로 큐 순간 빔 → "로드실패" 번쩍 | isRefilling 중엔 스피너 유지 |
| A5 | 🟡 MED | `useSettingsStore.load` **손상 JSON에 reject → 부팅실패** | parse만 try/catch로 감싸 DEFAULT 폴백 |
| — | (야간) | 까만화면 근원(Metro 캐시+settings 크래시), WebView 예외처리 강화, death-spiral 가드, 아이콘 흰테두리, 스플래시, 볼륨키 훅 연결, 스냅 AEC | 커밋됨 |

**검수로 CLEAN 확인**: 아이콘/스플래시(알파없음 iOS적합), i18n(전 키 resolve, 폴백 있음), 네이티브모듈 플랫폼분리·가드, import↔deps, `.env*` gitignore(Google 키 노출 아님).

---

## 🔴 B. 형 결정·계정·키 필요 (제가 코드로 못 고침 — **출시 전 반드시**)

| # | 문제 | 필요한 것 |
|---|---|---|
| B1 | **iOS Family Controls entitlement 없음** → 일일제한/Shield(핵심 차단기능) **iOS에서 죽어있음**. entitlement는 **Apple 별도 승인제**(즉시 안 됨) + DeviceActivityMonitor 확장 타깃도 필요 | 이번 주 iOS 차단기능 낼지 결정. 낼거면 entitlement 신청+승인, 안 낼거면 그 기능 iOS에서 숨기기 |
| B2 | **프로덕션 `EXPO_PUBLIC_API_BASE_URL` 비어있음** → 릴리스에서 **Google/Apple 로그인 전부 실패**(심사 2.1 반려). 게스트만 됨 | 배포된 백엔드 URL을 빌드 env에 넣거나, 소셜 로그인 버튼 숨기기 |
| B3 | **RevenueCat 키 없음**(`EXPO_PUBLIC_RC_IOS_KEY`) → **결제/구독 무동작**(심사 2.1/3.1.1 반려) | RevenueCat iOS 키를 빌드 env에 |
| B4 | **리뷰어 whitelist 비어있음**(`REVIEWER_EMAILS=[]`) → 심사자가 프리미엄 기능 접근 불가 → 반려 | 제출용 심사 테스트 계정 이메일 추가 |
| B5 | **지원 이메일 placeholder**(`support@pace.app`) | 실제 수신 가능한 메일함으로 교체 |

> **B1~B4는 App Store 반려 직결**이에요. 코드가 아니라 **키/URL/entitlement/이메일**을 넣어야 하는 거라 형만 할 수 있어요.

---

## 🟡 C. 실기기 검증 / Android 조율 필요

- **스냅 오디오세션 충돌**(PaceGestureModule.swift) — 스냅 감지가 `.playAndRecord`+voiceProcessing으로 WebView 재생 오디오를 ducking/reroute할 수 있고, `stop()`의 `setActive(false)`가 재생을 끊을 수 있음. + 볼륨키 모듈과 세션 category 다툼. → **오디오세션이라 잘못 고치면 되던 게 깨져서 실기기 테스트하며 신중히 해야 함**(임의로 안 건드림).
- **볼륨키 "다음" 몇 번 후 소멸**(PaceVolumeKeyModule.swift) — `MPVolumeView` 슬라이더로 시스템 볼륨 복원이 최신 iOS에서 불안정. 볼륨이 max 고정되면 KVO 이벤트 안 옴. → 실기기 검증 필요.
- **오버레이 start/unmount 레이스**(overlay/index.tsx) — 세션 누수 가능. **근데 iOS는 이제 /feed로 라우팅해서 /overlay는 Android 전용** → Android 도메인.

---

## 실기기 상태
- **CLI로 폰에 서명·빌드·설치 성공**(com.pace.app.eunhee) — 새 아이콘·스플래시·스냅·WebView강화 다 포함. 근데 실행 시점에 **폰 연결이 끊겨**(출근) 실행 검증은 못 함. 폰 연결되면 재개.
- 야간 확인: 폰에서 WebView 피드가 실제로 재생됨(loadEnd→m.youtube→**msg ended**) — 까만화면 아님.
