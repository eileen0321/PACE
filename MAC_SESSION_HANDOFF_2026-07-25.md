# PACE — Mac 세션 인수인계 (2026-07-25)

> 07-24 핸드오프(`MAC_SESSION_HANDOFF_2026-07-24.md`, 번들ID 변경) 이후 Windows 세션에서 추가로
> 한 작업 정리. 스플래시 중앙정렬은 두 세션이 거의 동시에 같은 수정을 했어서(커밋 `963085b`) 이미
> 해결된 채 pull 받았음 — 아래는 그 외 항목만.

---

## 1. RevenueCat SDK 공개키 — `.env`에 추가 필요

`useSubscriptionStore.ts`가 `EXPO_PUBLIC_RC_ANDROID_KEY`/`EXPO_PUBLIC_RC_IOS_KEY`가 비어있으면
`Purchases.configure()` 자체를 스킵하도록 되어있어서, 결제가 지금까지 완전히 비활성 상태였음.
사장님이 RevenueCat 대시보드(API keys → SDK API keys)에서 직접 발급받은 값:

```
EXPO_PUBLIC_RC_ANDROID_KEY=goog_jWJgxcRyNFIieGvcyigYvAXBJag
EXPO_PUBLIC_RC_IOS_KEY=appl_XXEGQCLYicODnWDWOaAsEioAIgm
```

⚠️ **Secret key 아님** — RevenueCat의 "Public API Key"는 앱 번들에 그대로 실리도록 설계된 값이라
문서/git에 남겨도 보안 문제 없음(Secret API key와는 다름, 그건 절대 커밋 금지).
`.env`는 gitignore 대상이라 이 파일로만 전달 가능 — **맥 세션 로컬 `.env`에도 위 두 줄 추가할 것.**
(참고: App Store Connect에 올린 `SubscriptionKey_2TCHTR7ZLH.p8`/Key ID `2TCHTR7ZLH`는 이것과
별개— 그건 RevenueCat 서버가 Apple 서버 검증할 때 쓰는 키, 이건 앱이 RevenueCat SDK 초기화할
때 쓰는 키.)

## 2. Android 스플래시 아이콘 잘림 + 하단 내비게이션바 흰색 — 원인/수정 (Android 전용, iOS 무관)

- **아이콘 잘림 원인**: `assets/splash-icon.png`가 여백 없이 캔버스 가장자리까지 꽉 차 있어서,
  Android 12+ 네이티브 SplashScreen이 원형으로 마스킹할 때 잘려 보였음. **수정**: `app.json`의
  `expo-splash-screen` 플러그인에 `android.image`를 `assets/android-icon-foreground.png`(이미
  안전여백 확보된 어댑티브 아이콘용 이미지)로 오버라이드 — **이건 app.json에 있어서 커밋/git으로
  전달됨, 맥 세션 pull하면 자동 반영.**
- **하단 내비바 흰색 원인**: `android/app/src/main/res/values/styles.xml`의 `Theme.App.SplashScreen`에
  `android:navigationBarColor`/`statusBarColor`가 없어서 스플래시 뜨는 동안만 기본값(흰색)으로
  보였음(포스트-스플래시 `AppTheme`에는 이미 transparent 설정돼 있었음, 07-25 THEME-1 수정).
  **⚠️ 이건 `android/`가 gitignore라 git으로 전달 안 됨 — 지금은 로컬에서 생성된 파일에 직접
  patch한 상태라 다음에 누구든 `expo prebuild --clean`(또는 EAS 클라우드 빌드)을 돌리면 이 수정이
  사라짐.** 영구 반영하려면 `withAndroidStyles` config plugin을 만들어 app.json에 등록해야 함 —
  아직 안 만들었음, 다음 세션 작업 필요 (Android 전용이라 맥 세션 우선순위는 아니지만 EAS 빌드 시
  재발할 것이므로 기록해둠).

## 3. Android Kotlin/AdMob 버전 충돌 — 해결 (Android 전용)

`react-native-google-mobile-ads@16.4.0`이 요구하는 `play-services-ads:25.4.0`이 Kotlin 2.3.0
메타데이터로 컴파일돼 있어서, 프로젝트 기본 Kotlin(2.1.0)과 충돌해 `react-native-purchases`/
`react-native-webview`/`react-native-safe-area-context`/`expo-modules-core` 컴파일이 전부 깨졌음
(제가 처음 만든 문제 아니라 이전부터 있던 pending 이슈였음). Kotlin 버전을 올리는 대신
**`react-native-google-mobile-ads`를 16.0.3으로 다운그레이드**(이 버전은 `play-services-ads:24.9.0`
사용, Kotlin 2.1과 호환)해서 해결. `package.json`에 반영됨(커밋/git 전달됨).

## 4. 스플래시 브랜딩 애니메이션 2.4초 → 0.6초 단축

`AnimatedSplash.tsx`의 `DURATION_MS`(고정 노출시간)가 2400이라 로딩이 다 끝나도 무조건 2.4초를
채우고 나서야 홈으로 넘어갔음. 사장님 지시로 600으로 줄이고, 내부 페이드인/딜레이 타이밍도
비례해서 압축(안 하면 텍스트가 뜨다 만 것처럼 잘려 보임). release 빌드 실측: 전체 스플래시
약 1초로 확인.

---

## 검증 방법 (Android 실기기, Galaxy Note20)
1. `.env`에 RC 키 추가 → Metro 재시작 → 앱 재실행 → `Purchases.configure()` 정상 호출 확인
2. `npx expo run:android --variant release` → 스플래시 잘림/흰바 없는지, 총 소요시간 ~1초인지 확인
   (release 빌드가 아니면 폰트/JS 번들을 Metro에서 그때그때 받아오느라 5~10초 걸리는 게 정상이니
   dev 빌드로 체감속도 판단하지 말 것)
