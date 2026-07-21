# App Store 심사 제출 노트 (App Review Notes)

제출 시 **App Store Connect → 앱 버전 → "App Review Information" → Notes** 칸에 아래 **영문**을 그대로 붙여넣으세요.
목적: 유튜브 콘텐츠 표시 관련 5.2.2/5.2.3 선제 소명 + 최소기능(4.2) 방어.

---

## ✅ 붙여넣을 영문 (App Review Notes)

```
Pace is a screen-time and focus app that helps users reduce mindless scrolling.

CORE FUNCTIONALITY IS NATIVE (not a web wrapper):
- Focus sessions with native timers and local notifications
- Usage insights and statistics (on-device, SQLite)
- Screen Time integration via Apple Family Controls
- Onboarding, settings, and subscription management
All built with native iOS APIs and custom native modules.

THE "PACE FEED" (secondary, optional feature):
As a calmer alternative to endless social feeds, Pace can show publicly
available YouTube Shorts from curated wellbeing categories (nature, ASMR,
crafts, etc.) inside an in-app web view using YouTube's own web player.

Regarding third-party content, please note the app:
- Does NOT download, save, convert, or export any media (no offline or
  audio-only functionality of any kind).
- Does NOT play audio in the background.
- Preserves YouTube's native player, advertising, and branding — nothing is
  stripped, blocked, or hidden.
- Only displays content for viewing within YouTube's own player.

HOW TO REACH THE FEED (for review):
Focus tab -> "Open Pace Feed". (It may also appear after onboarding.)

No login is required to review the app. Please reach out with any questions —
we're happy to clarify or adjust.
```

---

## 🇰🇷 형이 알아야 할 것 (한글)

**이 노트가 하는 일**: 심사자가 "유튜브 콘텐츠 왜 씀?"(5.2.2/5.2.3) 물어보기 전에, 우리가 **다운로드/백그라운드/오디오추출을 안 하고 광고·브랜딩을 유지**한다는 걸 먼저 알려서 반려 확률을 낮춰요. 그리고 "네이티브 기능이 메인"임을 강조해 최소기능(4.2)도 방어.

**정직성 (중요)**: 이 노트엔 **거짓이 없어요.**
- "유튜브 허가 받았다"는 **허위 주장을 일부러 안 넣었어요** — 우린 실제 허가가 없고, 거짓 주장은 발각 시 계정 정지까지 갈 수 있어 더 위험.
- 노트에 안 적은 것: UA 위조로 웹뷰 차단을 우회하는 부분. 이건 "모든 구현 세부를 자진 신고할 의무는 없음"의 영역이라 **거짓말은 아니지만**, 심사자가 트래픽을 뜯어보거나 유튜브가 문제 삼으면 남는 리스크예요.

**즉 이 노트는 반려 확률을 "관리 가능한 수준"으로 낮추는 거지, 0으로 만드는 마법은 아니에요.**

**추가로 반려 확률 더 낮추려면** (선택):
1. 스크린샷/설명에 **YouTube 로고·이름 노출 금지** (앱이 "유튜브 클라이언트"로 안 보이게).
2. 피드를 **첫 화면으로 두지 말 것** — "집중 세션"이 메인으로 보이게 (부가기능 포지셔닝).
3. 만약 첫 제출에서 5.2.2로 반려되면 → **Resolution Center에서 위 노트 요지로 회신** + "official YouTube embed terms 준수, 다운로드 없음" 재차 소명. 한 번에 안 되면 재소명으로 풀리는 경우 많음.

**최후 보루**: 그래도 계속 반려되면 UA 위조 빼고 공식 iframe(16:9)로 폴백하는 옵션이 코드에 남아있음(git 히스토리 react-native-youtube-iframe 버전).
