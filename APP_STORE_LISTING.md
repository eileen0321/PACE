# App Store Connect 리스팅 자료 (붙여넣기용) — Pace

> 코드 수정과 별개로 **ASC "배포" 페이지를 채우기 위한 텍스트/설정 모음**. 각 항목의 ASC 위치를 옆에 표기.
> 지원 언어 = **영어(기본) + 한국어**. 두 언어 다 채워야 함(ASC에서 언어별 탭).
> 사실 근거: 코드 감사(2026-07-27) — 광고 비추적/비개인화, 로그인 Apple·Google·게스트, 통계 온디바이스+백엔드 동기화.

---

## 0. 먼저 결정할 것
- [ ] **버전 번호 일치**: ASC="1.0" ↔ `app.json`="1.0.1". 빌드가 이 버전에 붙으려면 같아야 함 → **app.json을 `1.0`으로** 권장.
- [ ] **앱 이름 정리**: ASC 표시명 "Pace Pro" ↔ 앱 내부 "Pace". 스토어에 "Pace Pro"로 낼지 "Pace"로 낼지 확정. (아래 카피는 "Pace" 기준 — Pro로 가면 치환)
- [ ] **개인정보처리방침 URL**: `PRIVACY_POLICY.md`를 어딘가 호스팅(GitHub Pages/Notion 공개페이지 등) → 그 URL을 아래 "지원/개인정보 URL"에 사용.

---

## 1. 앱 정보 (App Information) — [앱 정보] 탭
- **이름(Name, 30자)**: 사장님이 최종 결정 (짧은 "Pace"는 선점됨 → 유니크한 이름 필요). ⚠️ **"Screen Time" 넣지 말 것**(애플 기능명 + D3에서 삭제한 기능). 예시안: `Pace: Focus & Digital Detox`, `Pace: Beat Mindless Scrolling`, `PACE now`
- **부제(Subtitle, 30자)**:
  - EN: `Less scrolling, more focus` (26)
  - KO: `덜 스크롤, 더 집중` (10)
- **카테고리**:
  - 기본(Primary): **Health & Fitness** *(디지털 웰빙 포지셔닝 — 4.2/5.2.2 심사 방어에 유리, "유튜브 클라이언트" 인상 회피)*
  - 보조(Secondary): **Productivity**
- **개인정보처리방침 URL**: `(호스팅한 PRIVACY_POLICY URL)`

## 2. 버전 정보 (Version Information) — [버전 정보] 탭

### 프로모션 텍스트 (Promotional Text, 170자 — 심사 없이 수시 변경 가능)
- **EN**: `Take back your attention. Focus Sessions, screen-time insights, and a calmer feed to break the mindless-scrolling loop — one small, deliberate pace at a time.`
- **KO**: `무의식적 스크롤을 끊는 가장 조용한 방법. 집중 세션, 사용 시간 통계, 그리고 나를 위한 차분한 피드로 스마트폰 사용을 내 속도(Pace)대로 되찾으세요.`

### 설명 (Description)
**EN**
```
Pace helps you spend less time mindlessly scrolling — and more time on what you actually meant to do.

FOCUS SESSIONS
Start a timed Focus Session with clear on-screen progress and gentle reminders. Native timers and local notifications keep you on track, even in the background.

SEE YOUR USAGE
Track your own usage and see clear daily insights and statistics — so the invisible hours become visible, and easier to change.

FLIP MODE
Place your phone face down to start screen-free rest. Pace quietly measures the time you spend away from the screen, and rewards the break.

A CALMER FEED
When you do want to unwind, the optional Pace Feed offers short, calming videos from curated wellbeing categories — a slower, more deliberate alternative to endless social feeds. No infinite outrage, no algorithmic rabbit holes.

HANDS-FREE
During a Focus Session you can move to the next Short hands-free — with a simple hand wave over the front camera or your headphone volume buttons. The camera signal is processed entirely on your device and is never recorded or uploaded.

PACE PREMIUM
Go further with an optional subscription:
• Remove all ads
• Custom Focus Session length (free is fixed at 10 minutes)
• Advanced Sleep Mode with customizable stillness sensitivity

Your attention is yours. Pace just helps you keep it.
```

**KO**
```
Pace는 무의식적으로 흘려보내는 스크롤 시간을 줄이고, 원래 하려던 일에 더 집중하도록 돕습니다.

집중 세션
화면에 진행 상황이 또렷이 보이는 타이머 기반 집중 세션을 시작하세요. 네이티브 타이머와 알림이 백그라운드에서도 흐름을 지켜줍니다.

내 사용 시간 보기
사용 시간을 기록하고 하루 단위 통계로 한눈에 확인하세요. 보이지 않던 시간이 보이면, 바꾸기도 쉬워집니다.

플립 모드(Flip Mode)
폰을 엎어두면 화면 없는 휴식이 시작됩니다. Pace가 조용히 그 시간을 재고, 쉼을 보상합니다.

차분한 피드
쉬고 싶을 땐, 선택형 Pace Feed가 엄선된 웰빙 카테고리의 짧고 차분한 영상을 보여줍니다. 끝없는 소셜 피드 대신, 조금 더 느리고 의도적인 대안입니다.

핸즈프리
집중 세션 중에는 손대지 않고 다음 영상으로 넘길 수 있어요 — 전면 카메라 위 손짓 또는 이어폰 볼륨 버튼으로. 카메라 신호는 전부 기기 안에서만 처리되며 절대 녹화·업로드되지 않습니다.

Pace 프리미엄
선택형 구독으로 더 나아가세요:
• 모든 광고 제거
• 집중 세션 시간 자유 설정(무료는 10분 고정)
• 고급 취침모드 — 무진동 감지 민감도 직접 설정

당신의 주의력은 당신 것입니다. Pace는 그걸 지키도록 도울 뿐입니다.
```

### 키워드 (Keywords, 100자 — 쉼표 구분, 공백 없이)
- **EN**: `focus,usage tracker,digital wellbeing,scrolling,detox,productivity,timer,habit,mindful,break,sleep,attention`
- **KO**: `집중,사용시간,디지털디톡스,스크롤,생산성,타이머,습관,휴식,수면,절제,도파민,주의력`

### 지원 URL / 마케팅 URL
- 지원(Support) URL: `(개인정보처리방침과 같은 사이트의 문의/지원 페이지, 또는 mailto가 아닌 웹페이지)` — 없으면 GitHub Pages 한 장이라도 필요
- 마케팅(Marketing) URL: (선택)

### 저작권(Copyright)
- `2026 (법적 이름 또는 상호)`

### 이번 버전의 새로운 기능(What's New) — 1.0
- `첫 출시입니다. / Initial release.`

## 3. 앱 심사 정보 (App Review Information) — [앱 심사] 탭
- **로그인 필요 없음** 체크 (게스트로 전체 리뷰 가능)
- **연락처**: 이름 / 전화 / `comfortstride7@gmail.com`
- **메모(Notes)**: **`APP_REVIEW_NOTES.md`의 영문 블록 그대로 붙여넣기** *(YouTube 콘텐츠 5.2.2 선제 소명 + 네이티브 최소기능 4.2 방어)*

## 4. 연령 등급 (Age Rating) — ⚠️ 신중히
- Pace Feed가 **제3자(YouTube) 영상**을 웹뷰 플레이어로 보여줌 → 질문지의 다음 항목을 정직하게:
  - "무제한 웹 액세스(Unrestricted Web Access)" → 플레이어가 YouTube 임베드에 한정(임의 웹서핑 불가)이면 **아니오**. (임의 URL 접근 가능하면 예 → 17+)
  - 사용자 생성 콘텐츠 노출 가능성 고려 → 대략 **12+** 예상. 최종 등급은 답변 결과대로.

## 5. 앱이 수집하는 개인정보 (App Privacy / Privacy "Nutrition" Label) — [앱이 수집하는 개인정보] 탭
> 코드 기준 정직한 답안. ⚠️는 판단 필요.

| 데이터 유형 | 수집? | 신원 연결? | 추적(ATT)? | 용도 |
|---|---|---|---|---|
| **이메일 주소** | 예(로그인 시) | 예 | 아니오 | 앱 기능(계정) — Apple/Google 로그인. 게스트는 미수집 |
| **사용자 ID / 기기 ID** | 예 | 예 | 아니오 | 앱 기능(계정·동기화) |
| **사용 데이터(시청 세션/일일 통계)** | 예(로그인 시 백엔드 동기화) | 예 | 아니오 | 앱 기능(통계 표시). 게스트는 온디바이스만 |
| **구매(구독 상태)** | 예 | 예 | 아니오 | 앱 기능(프리미엄) — RevenueCat |
| **카메라·모션(손짓·플립모드)** | **아니오** | — | — | 전적으로 온디바이스 처리, 녹화·업로드 없음 → "수집" 아님. (핑거스냅 제거로 마이크 미사용) |
| **광고 관련(AdMob)** | ⚠️ 예 가능 | 아니오 권장 | **아니오** | 비개인화 광고. 기기 식별자/기초 사용데이터가 "제3자 광고"로 분류될 수 있음 — AdMob 문서 기준으로 정직하게. **NSPrivacyTracking=false**(ATT 미사용)와 정합 |

**요점**: "**데이터를 추적(Track)에 사용하지 않음**"으로 답할 수 있음(ATT 미사용, 비개인화 광고). 단 AdMob은 "수집" 쪽에서 최소 항목 신고가 필요할 수 있으니 AdMob의 App Privacy 가이드 한 번 대조.

## 6. 스크린샷 계획 — [미리보기 및 스크린샷] (6.5" 필수)
> 필요 규격: **1290×2796** 또는 1242×2688(6.5"). 실기기/시뮬 캡처.
> ⚠️ **YouTube 로고·이름·플레이어가 보이는 컷은 넣지 말 것** (5.2.2). Feed 컷을 쓸 거면 로고 없는 프레임으로.

권장 5~6장 + 캡션(EN/KO):
1. **집중 세션 진행 화면** — "Focus, one deliberate pace at a time" / "무의식적 스크롤을 끊는 집중 세션"
2. **사용 시간 통계** — "See the hours you couldn't see" / "보이지 않던 시간을 한눈에"
3. **플립 모드** — "Flip to rest. Screen-free, measured." / "엎어두면 시작되는 화면 없는 휴식"
4. **핸즈프리 손짓** — "Next, hands-free. On-device only." / "손대지 않고 넘기기 — 전부 기기 안에서"
5. **홈/온보딩(브랜드 무드)** — "Take back your attention" / "내 주의력, 내 속도로"
6. (선택) 프리미엄 혜택 — "Go ad-free, go further"

---

## 채우기 순서 (권장)
1. `PRIVACY_POLICY` 호스팅 → URL 확보 (앱 정보 저장의 실제 병목)
2. 앱 정보(이름/부제/카테고리/개인정보 URL) → 저장
3. 앱이 수집하는 개인정보(라벨) → 완료 표시 필요
4. 버전 정보(설명/키워드/프로모션/저작권)
5. 앱 심사 정보(리뷰 노트 붙여넣기)
6. 스크린샷 6.5"
7. 연령 등급 질문지
8. (외부 대기) 구독 상품 등록 + 유료 계약 → 빌드 업로드 → 제출
