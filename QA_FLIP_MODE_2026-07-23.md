# PACE Flip Mode — 예외케이스 전수 감사 & 릴리스 준비 (2026-07-23)

> 스펙 §4-A "내려놓은 시간(쉬는 시간) 측정". 이번 주 출시 목표. 사장님 지시("예외 케이스부터 전수
> 다 확인해")로 **병렬 3개 적대적 리뷰(Swift 네이티브 / 스토어·훅 상태머신 / 통합·릴리스)** 를 돌려
> 전수 감사하고, 발견된 버그를 전부 수정했다. 이 문서는 감사 결과·수정·남은 한계·릴리스 체크리스트.

## 1. 아키텍처(2026-07-23 기준, iOS+Android 공용)

| 레이어 | 파일 | 역할 |
|---|---|---|
| iOS 네이티브 | `modules/pace-flip/ios/PaceFlipModule.swift` | `CMMotionManager` gravity.z, 디바운스 상태머신 |
| Android 네이티브 | `modules/pace-flip/android/.../PaceFlipModule.kt` | `SensorManager` TYPE_GRAVITY + 선형가속도 게이트(오탐 완화) |
| JS 인터페이스 | `modules/pace-flip/index.ts` | 옵셔널 로드 타입 |
| 스토어(공용) | `src/store/useFlipStore.ts` | 누적/크레딧/영속/날짜 스코프/kill 복구/상한 |
| 훅(공용) | `src/hooks/useFlipMode.ts` | native onFlip + AppState → 스토어, background 브리징 |
| 배선 | `src/app/_layout.tsx` | `useFlipMode({enabled:true})` 전역 |
| 표시 | `src/app/(tabs)/stats.tsx` | "쉬는 시간" 카드(오늘 시간+크레딧, i18n) |

네이티브 계약(양쪽 동일): `start()`, `stop()`, `isFaceDown()`, `physicalFaceDown()→bool|null`, `onFlip{faceDown}`.

## 2. 정상/비정상 예외케이스 매트릭스 (전수)

| # | 케이스 | 처리 | 상태 |
|---|---|---|---|
| N1 | 엎기(2s 유지)→집기(1s 유지) | 디바운스 상태머신 onFlip | ✅ |
| N2 | 히스테리시스(0.5~0.8 데드존) | 임계값 분리, 흔들림 candidateSince 리셋 | ✅ |
| A1 | **화면 꺼진 채 엎어둔 진짜 쉬는시간** | background 정산 안 하고 flipStartMs 유지, 복귀 시 브리징 | ✅ |
| A2 | 자동잠금 전 화면off(=inactive) 짧은 쉼 | inactive에서도 captureRestStart | ✅ |
| A3 | 디바운스 확정 전 화면off 레이스 | background/inactive 진입 시 physicalFaceDown=true면 즉시 시작 | ✅ |
| A4 | 복귀 시 그 사이 집어듦 | 재조율 재시도[500/1200/2500ms], false면 정산 | ✅ (C3) |
| A5 | 복귀 후 샘플 안 옴(센서 이상) | 마지막 재시도까지 null이면 안전 정산(stuck 방지) | ✅ (C3) |
| A6 | 앱 강제종료(OOM/스와이프) 중 쉼 | flipStartMs 영속 → 콜드스타트 정산 | ✅ |
| A7 | **전날 이월된 flipStartMs로 콜드스타트** | 같은 날만 정산, 전날이면 폐기(가짜 4h 방지) | ✅ (C2) |
| A8 | 방치/밤샘(엎어둔 채 잊음) | 정산 경과 4h 상한 | ✅ |
| A9 | **로컬 자정 리셋** | getFullYear/Month/Date 기반(UTC 아님) | ✅ (C1) |
| A10 | 열린 채 자정 넘김 | active 복귀 시 rollDateIfNeeded + onFaceDown date 정규화 | ✅ (H2) |
| A11 | load가 진행 중 쉼을 덮음(런치/포커스 레이스) | load active-guard(메모리 활성 쉼 보존) | ✅ (H1/H3) |
| A12 | 알림 배너/제어센터(face-up inactive) | physicalFaceDown 게이트로 쉼 시작 안 함 | ✅ |
| A13 | AsyncStorage 쓰기 순서 뒤바뀜 | writeChain 직렬화 | ✅ (M4) |
| A14 | 중복 start()/재진입 | started 플래그 + 네이티브 isDeviceMotionActive/isDeviceMotion 가드 | ✅ (M2) |
| A15 | 모션 콜백↔JS 스레드 상태 레이스(iOS) | NSLock 전 상태 직렬화 + 직렬 OperationQueue | ✅ (C1/H1) |
| A16 | 이벤트 스레드(iOS) | sendEvent 메인 스레드 발신 | ✅ (H3) |
| A17 | 모듈 파괴 시 센서 누수(iOS) | OnDestroy로 stopDeviceMotionUpdates | ✅ (M1) |
| A18 | 미링크(Expo Go/OTA/시뮬) import 크래시 | requireOptionalNativeModule + 훅 try/catch | ✅ (C2) |
| A19 | 센서 없는 기기(시뮬/에뮬) | isDeviceMotionAvailable / getDefaultSensor null → graceful | ✅ |
| A20 | 차량/주머니 오탐(Android) | 선형가속도 크기 게이트(거의 정지일 때만) | ✅ (Android) |

## 3. 감사에서 발견→수정한 버그 (심각도순)

- **[CRITICAL] iOS 스레드 데이터 레이스**(모션 백그라운드 큐 ↔ JS 스레드가 faceDown/lastZ 등 무동기 접근) → NSLock 직렬화 + 직렬 큐.
- **[CRITICAL] index.ts import 시점 requireNativeModule throw** → 옵셔널 로드.
- **[CRITICAL] UTC 날짜 버킷팅** → KST 오전 9시 리셋 버그 → 로컬 자정.
- **[CRITICAL] kill 복구가 전날/오래된 시작시각으로 가짜 4h 적립** → 같은 날만 정산.
- **[CRITICAL] 복귀 재조율 single-shot null → isFaceDown 영구 stuck** → 재시도 + 안전 정산.
- **[HIGH] 피드 상태바 남은시간이 iOS에서 죽은 값**(useTimerStore 미시작) → 피드 Focus Session 바인딩.
- **[HIGH] load가 진행 중 쉼 클로버 / 자정 롤오버 미처리** → active-guard + rollDateIfNeeded.
- **[MEDIUM] Stats 카드 하드코딩 한국어** → i18n(en/ko). **AsyncStorage 쓰기 레이스** → 직렬화.
  **inactive에서 reconcile 타이머 미정리** → 정리. **stop() 후 physicalFaceDown stale** → hasSample 리셋.
- **[LOW]** 프로덕션 console.log → `__DEV__` 게이팅. `?? 0`. OnDestroy 누수.

## 4. 남은 한계 (정직 고지)

1. **시뮬레이터엔 모션 센서가 없다** — face-down 감지 "동작 자체"는 실기기에서만 검증 가능(빌드/링크/JS 경로는 시뮬로 검증).
2. **background 중 "집어들었다 다시 엎기"** 같은 앱이 못 본 전이는 원리상 관측 불가 → 복귀 시점 상태로 근사(상한으로 방어).
3. **진짜 24시간 백그라운드 상시 측정**은 무음 오디오 세션 트릭이 필요하나 App Store 회색지대라 미채택(포그라운드+복귀 브리징 유지).
4. **크레딧은 일 단위 표시값**(자정 리셋). 누적 리워드 뱅크로 쓰려면 자정 전 harvest 로직 별도 필요(현재 소비처 없음).

## 5. 릴리스 체크리스트

- [ ] **`npx expo prebuild --clean` 후 릴리스 빌드**(EAS 권장) — 그래야 `app.json`의 `NSMotionUsageDescription`이
  생성 Info.plist에 반영된다. 현재 로컬 `ios/Pace/Info.plist`엔 아직 없음(stale). 단 raw CMMotionManager는
  이 키가 없어도 크래시/프롬프트 없음(App Store 반려 위험 LOW) — 그래도 넣는 게 정석.
- [ ] Android 실기기 flip 검증(선형가속도 게이트 민감도 포함) — co-session 몫.
- [ ] iOS 실기기 flip 검증(엎기→쉬는시간 적립→Stats 반영, 슬립 경로 포함).
- [x] tsc 통과, iOS 시뮬 빌드/링크(하드닝 반영).
- [x] 미링크/센서없음 graceful, App Store CoreMotion 권한 분석(권한 불필요 확인).

## 6. 검증 상태

- **자동 검증됨:** tsc, iOS 시뮬 빌드(Swift 컴파일/링크), 앱 부팅 크래시 없음, 미링크 graceful.
- **실기기 필요:** 실제 face-down 감지 동작(모션 센서). iOS는 iPhone 14 Pro 설치·실행까지 완료, 물리 flip 사용자 검증 진행 중.
