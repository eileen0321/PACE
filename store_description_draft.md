PACE는 무의식적으로 흘려보내는 스크롤 시간을 줄이고, 원래 하려던 일에 더 집중하도록 돕습니다.

집중 세션
화면에 진행 상황이 또렷이 보이는 타이머 기반 집중 세션을 시작하세요. 네이티브 타이머와 알림이 백그라운드에서도 흐름을 지켜줍니다.

내 사용 시간 보기
사용 시간을 기록하고 하루 단위 통계로 한눈에 확인하세요. 보이지 않던 시간이 보이면, 바꾸기도 쉬워집니다.

플립 모드(Flip Mode)
폰을 엎어두면 화면 없는 휴식이 시작됩니다. PACE가 조용히 그 시간을 재고, 쉼을 보상합니다.

Pace Feed
쉬고 싶을 땐 앱을 벗어나지 않고 Pace 안에서 바로 YouTube Shorts를 볼 수 있어요. 일일 한도·휴식 알림·집중 세션 같은 Pace의 관리 기능이 시청 내내 그대로 함께 작동합니다.

핸즈프리
집중 세션 중에는 화면에 손대지 않아도 돼요 — 전면 카메라 위 손짓 또는 블루투스 리모컨/이어폰 볼륨 버튼으로 흐름을 유지하세요. 카메라 신호는 전부 기기 안에서만 처리되며 절대 녹화·업로드되지 않습니다.

PACE 프리미엄
선택형 구독으로 더 나아가세요:
• 모든 광고 제거
• 집중 세션 시간 자유 설정(무료는 10분 고정)
• 고급 취침모드 — 무진동 감지 민감도 직접 설정

Apple이용약관(EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
이용약관(EULA): https://mini-gull-13a.notion.site/PACE-3ad2e806c9c780c5b3c5ec62b55f5aa9?pvs=73
개인정보처리방침: https://mini-gull-13a.notion.site/PACE-3ad2e806c9c7804fa5dbdadc88dd56f3

---

PACE helps you cut down on the scrolling you don't even remember doing, so you can get back to what you meant to do.

Focus Session
Start a timer-based focus session with clear on-screen progress. A native timer and notifications keep track even in the background.

See Your Screen Time
Log your usage and see it at a glance with daily stats. Once the hidden hours become visible, they're easier to change.

Flip Mode
Turn your phone face down to start a screen-free break. Pace quietly times it — and rewards the rest.

Pace Feed
Want to unwind? Watch YouTube Shorts right inside Pace without leaving the app — your daily limit, break reminders, and focus session controls keep working the whole time you watch.

Hands-Free
Keep your hands off the screen during a Focus Session — advance with a hand wave over the front camera, or a Bluetooth remote/headphone volume button. Camera signals are processed entirely on-device and are never recorded or uploaded.

PACE Premium
Go further with an optional subscription:
• Remove all ads
• Set your own Focus Session length (free tier is fixed at 10 minutes)
• Advanced Sleep Mode — adjust motionless-detection sensitivity yourself

Apple EULA: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Terms of Use (EULA): https://mini-gull-13a.notion.site/PACE-3ad2e806c9c780c5b3c5ec62b55f5aa9?pvs=73
Privacy Policy: https://mini-gull-13a.notion.site/PACE-3ad2e806c9c7804fa5dbdadc88dd56f3

---
---

# 🔴 Google Play 전용 설명 (2026-08-21 정책 거부 대응)

> **거부 사유**: "Play 스토어의 앱 설명에 AccessibilityService API 사용이 반영되어 있지 않으므로
> 앱을 승인할 수 없습니다." → 아래 **접근성 서비스 사용 안내** 문단이 그 대응이다.
>
> ⚠️ 이 버전은 **Android 전용**이다. 위 공용 초안과 두 가지가 다르다:
>   1. 접근성 고지 문단이 추가됨(필수)
>   2. **Pace Feed 문단을 뺐다** — `focus.tsx`가 `capabilities.supportsPaceFeed`(iOS 전용)로
>      게이팅하고 있어 **Android에는 존재하지 않는 기능**이다(§2-B B2 참고). 없는 기능을 설명에
>      적어두는 것 자체가 등록정보 정확성 위반 소지이고, 이번 심사에서 같이 지적될 수 있다.
>   3. Apple EULA 링크 제거(Android 무관)
>
> ⚠️ **설명만으로는 부족하다.** 메일이 함께 요구한 것:
>   "새로운 앱 제출 시 AccessibilityService API를 사용하는 핵심 기능을 보여주는 **업데이트된
>    동영상의 링크를 Play Console에 제공해 주세요**"
>   → Play Console > 앱 콘텐츠 > 민감한 권한 및 API 액세스 > 접근성 API 항목에 시연 영상 링크
>     (YouTube 미등록/비공개 가능) 필수. **사장님이 직접 촬영·업로드해야 하는 단계다.**
>     영상에 반드시 담아야 할 것: ① 접근성 권한을 켜는 화면 ② 그 권한으로 동작하는 핵심 기능
>     (집중 세션 중 손짓/리모컨으로 다음 영상 넘김, 시청 시간 기록·한도 알림)
>
> ⚠️ `isAccessibilityTool` 플래그는 **쓰면 안 된다**(현재 미설정, 올바름). 장애인 직접 지원이
>   핵심 기능인 앱만 해당하며, Pace가 이걸 켜면 더 큰 위반이 된다.

## 한국어 (Play 상세 설명)

PACE는 무의식적으로 흘려보내는 스크롤 시간을 줄이고, 원래 하려던 일에 더 집중하도록 돕습니다.

집중 세션
화면에 진행 상황이 또렷이 보이는 타이머 기반 집중 세션을 시작하세요. 네이티브 타이머와 알림이 백그라운드에서도 흐름을 지켜줍니다.

내 사용 시간 보기
사용 시간을 기록하고 하루 단위 통계로 한눈에 확인하세요. 보이지 않던 시간이 보이면, 바꾸기도 쉬워집니다.

플립 모드(Flip Mode)
폰을 엎어두면 화면 없는 휴식이 시작됩니다. PACE가 조용히 그 시간을 재고, 쉼을 보상합니다.

핸즈프리
집중 세션 중에는 화면에 손대지 않아도 돼요 — 전면 카메라 위 손짓 또는 블루투스 리모컨/이어폰 볼륨 버튼으로 흐름을 유지하세요. 카메라 영상은 전부 기기 안에서만 처리되며 절대 녹화·업로드되지 않습니다.

■ 접근성 서비스(AccessibilityService) 사용 안내

PACE는 Android 접근성 서비스를 사용합니다. 사용 목적은 다음뿐입니다.

1) 지원하는 영상 앱이 지금 화면에 떠 있는지, 영상이 재생 중인지 확인합니다 — 시청 시간을 기록하고 설정하신 하루 한도와 휴식 시점을 알려드리기 위해서입니다.
2) 집중 세션 중 "다음 영상으로 넘기기"를 대신 수행합니다(화면 쓸어올리기). 손짓·블루투스 리모컨·자동 넘김이 모두 이 동작을 사용합니다.
3) 블루투스 리모컨이나 이어폰의 볼륨 버튼 입력을 받아 다음/이전 영상 넘김 신호로 사용합니다.
4) 사용자가 직접 "즐겨찾기 추가"를 누른 경우에만, 현재 영상의 제목·채널명·링크를 읽어 기기에 저장합니다.

접근성 서비스는 사용자가 시스템 설정에서 직접 켜야 하며, 언제든 끌 수 있습니다. PACE는 이 기능으로 화면 내용을 촬영·녹화하지 않고, 위 4번의 즐겨찾기 정보를 제외한 어떤 화면 정보도 저장하거나 외부로 전송하지 않습니다. 즐겨찾기 정보도 기기 안에만 저장됩니다. 자세한 내용은 개인정보처리방침을 확인해 주세요.

PACE 프리미엄
선택형 구독으로 더 나아가세요:
• 모든 광고 제거
• 집중 세션 시간 자유 설정(무료는 10분 고정)
• 고급 취침모드 — 무진동 감지 민감도 직접 설정

이용약관(EULA): https://mini-gull-13a.notion.site/PACE-3ad2e806c9c780c5b3c5ec62b55f5aa9?pvs=73
개인정보처리방침: https://mini-gull-13a.notion.site/PACE-3ad2e806c9c7804fa5dbdadc88dd56f3

## English (Play full description)

PACE helps you cut down on the scrolling you don't even remember doing, so you can get back to what you meant to do.

Focus Session
Start a timer-based focus session with clear on-screen progress. A native timer and notifications keep track even in the background.

See Your Screen Time
Log your usage and see it at a glance with daily stats. Once the hidden hours become visible, they're easier to change.

Flip Mode
Turn your phone face down to start a screen-free break. Pace quietly times it — and rewards the rest.

Hands-Free
Keep your hands off the screen during a Focus Session — advance with a hand wave over the front camera, or a Bluetooth remote/headphone volume button. Camera frames are processed entirely on-device and are never recorded or uploaded.

■ Accessibility Service disclosure

PACE uses the Android AccessibilityService API. It is used only for the following:

1) To detect whether a supported video app is currently on screen and whether a video is playing — so PACE can log your watch time and tell you when you have reached your daily limit or a break point.
2) To perform the "go to next video" action for you during a Focus Session (a swipe-up gesture). Hand-wave, Bluetooth remote, and auto-advance all rely on this.
3) To receive volume-button input from a Bluetooth remote or headphones and use it as a next/previous signal.
4) Only when you explicitly tap "Add to favorites", to read the current video's title, channel name, and link and save them on your device.

You must turn the accessibility service on yourself in system settings, and you can turn it off at any time. PACE does not capture or record screen content with this API, and does not store or transmit any screen information other than the favorites data described in (4) — which stays on your device. See our Privacy Policy for details.

PACE Premium
Go further with an optional subscription:
• Remove all ads
• Set your own Focus Session length (free tier is fixed at 10 minutes)
• Advanced Sleep Mode — adjust motionless-detection sensitivity yourself

Terms of Use (EULA): https://mini-gull-13a.notion.site/PACE-3ad2e806c9c780c5b3c5ec62b55f5aa9?pvs=73
Privacy Policy: https://mini-gull-13a.notion.site/PACE-3ad2e806c9c7804fa5dbdadc88dd56f3
