# PACE 출시 체크리스트 (2026-07-27 정리)

> `PACE_PROJECT_MANAGEMENT.md` §1/2/5 + QA/HANDOFF 문서 + 코드 스캔을 교차 확인해 남은 출시 항목만
> 하나로 모은 실행 큐. 원본 상세는 각 항목의 링크 문서 참고. **완료된 D1~D10 등은 여기서 생략**(=이미 초록불).

담당 표기: 🧑‍💼사장님(계정/외부) · 🍎Mac(iOS) · 🪟Windows(Android) · 💻코드(세션 무관)

---

## P0 — 진짜 출시 블로커 (이게 안 되면 제출 자체가 무의미)

- [ ] **🧑‍💼 구독 판매 활성화 (D11)** — Google Payments **판매자 계정**(Merchant Account: 사업자등록/세금/신원)
      완료 → Android 구독 상품 생성 → RevenueCat Offering("current")에 attach. *은행 소액입금 확인(=결제
      프로필)은 끝났지만 판매자 계정은 별개 단계.* 미완료 시 페이월이 빈 목록 + `ConfigurationError`.
- [ ] **🧑‍💼🍎 iOS 구독 상품 등록** — App Store Connect에 구독 상품 등록(아직 **미착수**) + 동일 RC Offering에 attach.
- [ ] **🧑‍💼 구독 상품 iOS↔Android 일치** — 상품 ID/가격/기간을 양 스토어 동일하게, RC 대시보드에서 하나의 Offering으로.
      앱 코드엔 하드코딩 ID 없음 → 대시보드/스토어 설정만 맞추면 됨.
- [ ] **🪟 안드로이드 일일한도 매 세션 리셋 (BLOCKER #1)** — YouTube 실행 후 Home 복귀 시 `SUM(duration)=0`
      반환 → remaining 무한 리셋, 한도 우회. §6 2026-07-27 밤 로그. Android 오버레이 도메인.

---

## P1 — 제출 빌드 전 필수 (💻 코드, 지금 할 수 있음)

- [ ] **진단 로그 제거** — 제출 빌드에 남으면 안 됨. 실제 대상 파일(라이브러리 노이즈 제외):
  - `src/components/feed/YouTubeShortsPlayer.ios.tsx` — `send({type:'domlog', ...})` (VEV/MUTEBLOCKS/MUTEICON/UNMUTE) — **production에서도 발화**. (`console.log/warn`은 `__DEV__` 가드라 안전)
  - `modules/pace-gesture/ios/PaceGestureModule.swift` — `NSLog("PACEWAVE ...")`, `NSLog("PACEWV ...")`, `NSLog("PACEBT ...")`, `[pace-wave]` 로그
  - `modules/pace-overlay/android/.../PaceOverlayService.kt` — 진단 로그
  - ⚠️ 손짓 튜닝이 아직 진행 중이면 Swift `onDiag`/`PACEWAVE`는 **마지막에** 제거(실기기 로그가 튜닝에 필요).
- [ ] **Swift 손짓 스윙 감지 커밋** — 작업 트리의 `PaceGestureModule.swift` 미커밋 변경. `countReversals`
      헬퍼 누락으로 **빌드가 깨져 있던 것 → 2026-07-27 구현해 넣어 컴파일 복구.** 단 스윙 로직 실기기 검증 후 커밋.
- [ ] **버전/빌드번호 확정** — `app.json` version `1.0.1`, iOS `CFBundleVersion=1`. 첫 제출 기준 OK,
      재제출 시마다 빌드번호 증가 확인.

---

## P2 — 실기기 검증 (빌드 후 반드시, 시뮬레이터로 못 잡음)

### 🍎 iOS
- [ ] 손짓(스윙/성장)·핑거스냅 감지 실제 동작 (C3 관련, 방금 수정한 스윙 포함)
- [ ] 구독 결제 실결제 플로우 (D1 키 배선됨, Metro 재시작 후)
- [ ] 구글 로그인 (D7 `iosUrlScheme`는 다음 prebuild부터 반영 — 실기기 미검증)
- [ ] AdMob 실광고 배너 노출 (활성화까지 최대 1h)
- [ ] Live Activity/다이나믹아일랜드 + 취침감지 블랙아웃 (C3, 기기 필요)
- [ ] 위젯 익스텐션 첫 서명 빌드 (C4)
- [ ] Feed safe-area — 비디오 컨테이너 `paddingTop: insets.top` 폴백 없음(topBar는 `max(…,47)`).
      Dynamic Island 없는 기기/회전 시 어긋남 재발 가능 (HANDOFF 2026-07-25). → `Math.max(insets.top, 47)` 통일 권장.

### 🪟 Android
- [ ] D8 수면 임계값(5~20분) Kotlin 변경 — **gradle 빌드/실기기 미검증** (소스 레벨만)
- [ ] AdMob 실광고, 재부팅 후 활성 세션 복구(B3), 재설치 후 접근성 서비스 재확인(§5 -1번)

---

## P3 — 심사 반려 리스크 (제출 전 판단)

- [ ] **🍎 C2 — Sign in with Apple 공식 버튼 아님**(커스텀 텍스트 버튼) → HIG 4.8 반려 리스크. 공식 `AppleAuthenticationButton`으로 교체 검토.
- [ ] **🍎 C5 — iOS "Bluetooth Hands-Free" 가짜 UI** — 전역 `bluetoothService.ios.ts`가 no-op 스텁인데
      "Enable" 누르면 토스트만. **"동작하는 척" 정직성 이슈** → 심사/평판 리스크. UI 숨기거나 실제 배선.
      (Feed 안 볼륨키 리모컨 `useFeedRemoteControl.ios.ts`는 실동작 — 이것과 별개 죽은 경로)
- [ ] **🍎 C1 — iOS Sleep Timer 네이티브 미구현** — 매 실행 Metro 경고, 호출 시 실패.
- [ ] **App Review Notes** — `APP_REVIEW_NOTES.md` 영문 준비됨. 제출 시 App Store Connect Notes에 붙여넣기.
- [ ] **스크린샷/설명에 YouTube 로고·이름 노출 금지** (앱이 "유튜브 클라이언트"로 안 보이게 — 5.2.2 방어).
- [ ] **피드를 첫 화면으로 두지 말 것** (집중 세션이 메인, 피드는 부가기능 포지셔닝).

---

## ✅ 이미 초록불 (참고)
- `tsc --noEmit` 에러 0 · `eas.json` production 실광고 플래그 격리(테스트기기 이중 안전장치)
- 백엔드 Railway 실배포(D2) · RC SDK 키 배선(D1) · AdMob 실ID(D10) · 구글 OAuth 3종 발급(D7)
- 심사 리뷰어 계정(D4) · 지원 이메일 실주소(D5) · iOS Screen Time 죽은코드 삭제(D3)
- 고급취침모드 프리미엄 게이팅(D8) · `ITSAppUsesNonExemptEncryption=false`
- ⚠️ **D9 정정**: iOS 손짓/핸즈프리 감지는 프리미엄 게이팅이 **다시 무료로 번복됨**(`feed/index.tsx:189`,
  `handsFreeDetectActive = isAutoMode`). Focus Session만 켜지면 무료도 작동 = 의도된 최신 결정.
- ✅ **iOS 제스처 네이티브 배선 검증 완료(2026-07-27)**: PaceGesture/PaceVolumeKey/PaceFlip/PaceLiveActivity/
  PaceSleep 5개 모두 오토링크(Podfile.lock) + config/`Name()`/JS `requireNativeModule` 이름 일치.
  Swift 컴파일 클린(브레이스 155/155, 3감지기 start/stop, emit 이벤트 5개 전부 선언). **실기기 런타임만 미검증**.
