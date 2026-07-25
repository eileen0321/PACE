package expo.modules.paceoverlay

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.InputDevice
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.regex.Pattern

// Auto Next 실제 스와이프(사용자 대신 화면을 넘겨 다음 숏폼으로 이동). 2026-07-18 결정.
//
// ⚠️ Play 스토어 정책 리스크(PACE_ARCHITECTURE.md "Android AccessibilityService 최적화 원칙" 참고):
// AccessibilityService로 "사용자 대신 스와이프"하는 건 "접근성 목적이 아닌 남용"으로 심사에서
// 리젝될 수 있다는 지적이 있었다. 사용자 결정: "구현은 해놓고 출시 전에 정책을 결정" — 코드는
// 완성해두되, 실제 스토어 제출 빌드에서 이 기능을 노출할지는 EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드
// 플래그로 별도 게이팅한다(services/platform/autoNextService.android.ts, 기본값 OFF).
//
// 2026-07-19 감지 방식 전면 교체: 예전엔 "감시 대상 앱이 포그라운드인 동안 고정 간격(8초)으로
// 무조건 스와이프"였다 — 15~60초짜리 숏폼 대부분을 8초에 잘라먹는 명백한 버그(사용자 지적으로
// 발견). 실기기 `adb shell uiautomator dump`로 YouTube Shorts 화면을 직접 까본 결과, 진행바
// (class="android.widget.SeekBar")의 content-desc가 "0분 5초 중 0분 2초"(한국어 로케일 — "현재
// 중 전체") 형식으로 실시간 재생 위치를 그대로 노출하고 있었다(2초 뒤 재확인 시 값이 실제로
// 갱신되는 것도 확인). 이 신호를 우선 사용해 "영상이 실제로 끝나는 순간"에만 스와이프하고, 이
// 신호를 못 찾을 때만(광고 화면, 노드 구조 변경, 다른 로케일 등) SAFETY_TIMEOUT_MS 후 강제로 한
// 번 스와이프하는 폴백으로 격하시켰다 — 예전의 "고정 간격"이 이제는 최후의 안전장치일 뿐 주
// 로직이 아니다. MediaSession PlaybackState(알림 리스너 특수 권한 필요)는 이번에도 스코프 밖으로
// 남겨둔다 — 위 두 단계만으로 이미 실기기에서 검증된 정확한 신호를 확보했고, 별도 런타임 권한을
// 추가로 요구하는 건 그 대가에 비해 이득이 작다.
class PaceAccessibilityService : AccessibilityService() {

  private val handler = Handler(Looper.getMainLooper())
  private var isWatching = false
  private var safetyTimeoutMs = DEFAULT_SAFETY_TIMEOUT_MS
  private var currentForegroundPackage: String? = null
  // 2026-07-25 실기기 지적("앱 껐는데 왜 오버레이가 홈 화면에 떠있어") — 이 값은
  // accessibility_service_config.xml의 packageNames 필터 때문에 유튜브/인스타/틱톡 창일 때만
  // 갱신된다. 런처나 다른 앱으로 나가면 이벤트 자체가 안 와서 이 값이 "유튜브"인 채로 영원히
  // 멈춰있을 수 있다 — 아래 getCurrentForegroundPackage(maxAgeMs)가 이 시각을 같이 확인해서,
  // 너무 오래된 값은 "모른다"로 취급하고 폴백(UsageStatsManager)을 타게 한다.
  private var currentForegroundPackageAtMs = 0L
  private var lastKnownCurrentSec = -1
  private var lastSwipeAtMs = 0L
  private var lastVolumeKeySwipeAtMs = 0L
  // 2026-07-19: 매 폴링(500ms)마다 rootInActiveWindow부터 트리 전체를 다시 훑으면 실제 YouTube
  // 재생 화면에 부하가 걸릴 수 있다는 지적 — 한 번 찾은 SeekBar 노드를 캐싱해서, 다음 폴링부터는
  // node.refresh()로 그 노드 하나만 저렴하게 재검증(유효하면 재사용, 무효화됐으면 그때만 전체
  // 재탐색). Shorts는 스크롤할 때마다 뷰가 리사이클되므로 무효화 자체는 자연스럽게 발생 — 캐시가
  // 없어도 동작은 똑같이 맞지만, 있으면 트리 워크 빈도가 크게 줄어든다.
  private var cachedTimingNode: AccessibilityNodeInfo? = null

  private val pollRunnable = object : Runnable {
    override fun run() {
      if (isWatching && SupportedApps.PACKAGES.contains(currentForegroundPackage)) {
        checkPlaybackAndMaybeSwipe()
      }
      handler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  companion object {
    // 재생 위치를 얼마나 자주 확인할지(스와이프 자체의 간격이 아니라 폴링 주기) — 초 단위 텍스트라
    // 이보다 훨씬 잦은 폴링은 정확도 이득이 없다.
    private const val POLL_INTERVAL_MS = 500L
    // Tier 2(안전 타임아웃): 재생 위치 신호를 못 찾을 때만 쓰는 최후 폴백. 예전 "고정 간격"의
    // 후신이지만 이제 주 로직이 아니다. 8초는 대부분의 숏폼을 중간에 잘라먹는 값이라 45초로 올림 —
    // 실시간 감지가 정상 동작하는 한 이 값이 실제로 발동하는 일은 드물다.
    private const val DEFAULT_SAFETY_TIMEOUT_MS = 45_000L
    // 물리 볼륨 버튼 1회 입력의 반복 ACTION_DOWN을 하나로 묶는 불응 구간(onKeyEvent 참고).
    private const val VOLUME_KEY_DEBOUNCE_MS = 500L
    // 한국어 로케일 실측: "0분 5초 중 0분 2초"(현재 중 전체). 콜론 포맷("0:05 / 0:15")도 방어적으로
    // 같이 시도 — YouTube 앱 버전/기기 로케일이 다르면 문구가 바뀔 수 있다.
    private val KOREAN_TIME_PATTERN = Pattern.compile("(\\d+)분\\s*(\\d+)초\\s*중\\s*(\\d+)분\\s*(\\d+)초")
    private val COLON_TIME_PATTERN = Pattern.compile("(\\d+):(\\d+)\\s*/\\s*(\\d+):(\\d+)")
    private var instance: PaceAccessibilityService? = null

    // 시스템 설정에 "활성화된 접근성 서비스" 목록으로 등록돼 있는지 확인 — 오버레이 권한과 달리
    // 별도 런타임 API가 없어 Settings.Secure를 직접 파싱해야 한다(표준 Android 패턴).
    fun isEnabled(context: Context): Boolean {
      val enabledServices = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: return false
      val expected = "${context.packageName}/${PaceAccessibilityService::class.java.name}"
      return enabledServices.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    // intervalMs 파라미터는 예전엔 "고정 스와이프 간격"이었지만 이제 "안전 타임아웃"으로 의미가
    // 바뀌었다 — JS↔네이티브 브릿지 시그니처(PaceOverlayModule.startAutoNextWatching)는 그대로 두고
    // 값의 의미만 재정의(호출부: autoNextService.android.ts, PaceOverlayService.setAutoMode).
    fun startWatching(intervalMs: Long) {
      val service = instance
      if (service == null) {
        // 2026-07-19 실기기 검증 중 발견: JS는 AUTO ON 배지를 켰는데 실제 스와이프 로그가 전혀
        // 안 남는 케이스 재현 중 — instance가 이 시점에 null이면 여기서 조용히 무시되고 있었다.
        // 원래 주석은 "권한이 꺼진 정상 케이스"만 가정했는데, 접근성을 방금 껐다 켠 직후(APK
        // 재설치 등으로) 서비스가 아직 시스템에 바인딩되기 전에 호출되는 레이스도 같은 경로를
        // 타서 구분이 안 됐다 — 최소한 로그로는 남겨서 둘을 구분할 수 있게 한다.
        Log.w("PaceAccessibility", "startWatching() called but instance is null — accessibility not bound yet, silently ignored")
        return
      }
      service.safetyTimeoutMs = intervalMs
      if (!service.isWatching) {
        service.isWatching = true
        service.lastKnownCurrentSec = -1
        service.lastSwipeAtMs = SystemClock.elapsedRealtime()
        service.handler.post(service.pollRunnable)
        Log.d("PaceAccessibility", "startWatching() -> polling started, safetyTimeoutMs=$intervalMs")
      }
    }

    fun stopWatching() {
      instance?.let { service ->
        service.isWatching = false
        service.handler.removeCallbacks(service.pollRunnable)
      }
    }

    // 2026-07-19: Bluetooth Hands-Free Next/Previous — 위 interval 기반 Auto Next 루프와 별개로,
    // 리모컨 버튼 1회 입력에 스와이프 1회로 즉시 응답하는 단발성 트리거. 감시 대상 앱이 포그라운드가
    // 아니어도(예: 사용자가 Pace 쪽을 보고 있어도) 그냥 시도한다 — 리모컨을 눌렀다는 것 자체가 이미
    // 숏폼을 보고 있다는 강한 신호라 startWatching()의 포그라운드 패키지 체크만큼 보수적일 필요가 없음.
    fun swipeOnce(up: Boolean) {
      instance?.let { service -> if (up) service.performSwipeUp() else service.performSwipeDown() }
    }

    // 2026-07-19 Hard Block Mode(Settings에서 사용자가 직접 켜야만 호출됨, 기본 OFF) — 한도 도달 시
    // YouTube 자체를 홈으로 강제 이동. performGlobalAction은 이미 확보된 gesture 접근성 권한 범위
    // 안이라 추가 권한이 필요 없다. instance가 null(접근성 꺼짐)이면 조용히 무시 —
    // PaceOverlayService의 전체화면 차단(showBlockOverlay)이 항상 별도로 뜨므로 이게 실패해도
    // "아무 일도 안 일어남" 상태는 아니다.
    fun goHome() {
      instance?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
    }

    // 2026-07-23 수면 감지(스펙 §1-B "화면 암전 + 밝기 0% → OS 슬립 진입") — GLOBAL_ACTION_LOCK_SCREEN
    // (API 28+)은 접근성 서비스가 실제로 화면을 잠글 수 있는 유일한 표준 방법. iOS의
    // UIScreen.main.brightness는 애플이 "OS가 임의 시점에 원래 밝기로 되돌린다"고 명시해 최선노력일
    // 뿐이지만(PACE_FEATURE_SPEC_2026-07-22.md §4-B), 이건 실제로 화면을 끄고 잠근다 — Android가 이
    // 지점에서 iOS보다 확실한 구현이 가능한 드문 경우. API<28이거나 접근성이 꺼져있으면(instance==null)
    // 조용히 무시 — PaceOverlayService의 순수 암전 오버레이(showBlockOverlay reason=sleep_detected)가
    // 항상 별도로 뜨므로 이게 실패해도 "아무 일도 안 일어남" 상태는 아니다.
    fun lockScreen() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        instance?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
      }
    }

    // 2026-07-20 실기기 검증 중 발견(사용자 지적 — 알약이 "됐다 안됐다" 함): PaceOverlayService의
    // 알약 표시/숨김이 UsageStatsManager 1초 폴링(ForegroundAppWatcher)에만 의존했는데, 이 API는
    // 구글 공식 문서 기준으로도 실시간 정확도를 보장하지 않는다 — 이벤트 기반인 이 서비스가 이미
    // TYPE_WINDOW_STATE_CHANGED로 foreground 패키지를 즉시(폴링 지연 없이) 추적하고 있으므로
    // (onAccessibilityEvent 참고) 접근성이 켜져 있으면 이 값을 우선 쓰게 노출한다. 접근성이
    // 꺼져있으면(instance==null) null을 반환해 호출부가 기존 UsageStatsManager로 폴백하게 한다.
    //
    // 2026-07-25 실기기 지적("앱 껐는데 홈 화면에 오버레이가 떠있다") — packageNames 필터
    // (유튜브/인스타/틱톡만) 때문에 사용자가 런처나 다른 앱으로 나가면 이 값이 갱신 자체가 안 되고
    // "유튜브"인 채로 멈춰있다. maxAgeMs 안에 실제로 갱신된 값만 신뢰하고, 그보다 오래됐으면 null을
    // 반환해 호출부가 UsageStatsManager 폴백을 타게 한다 — "떠나면 오래지 않아 반드시 숨겨진다"를
    // 보장하는 안전장치.
    fun getCurrentForegroundPackage(maxAgeMs: Long = 3000L): String? {
      val service = instance ?: return null
      val age = SystemClock.elapsedRealtime() - service.currentForegroundPackageAtMs
      if (service.currentForegroundPackageAtMs == 0L || age > maxAgeMs) return null
      return service.currentForegroundPackage
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    Log.d("PaceAccessibility", "onServiceConnected — instance bound")
    // 세부 설정(canPerformGestures, packageNames, eventTypes)은 전부
    // res/xml/accessibility_service_config.xml에 선언 — 여기서 serviceInfo를 재조립하지 않는다.
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      currentForegroundPackage = event.packageName?.toString()
      currentForegroundPackageAtMs = SystemClock.elapsedRealtime()
    }
  }

  // 2026-07-23 — "블루투스는 볼륨받아서 다음재생으로 넘기기로 했잖아" 대응. 실제 블루투스 리모컨
  // 미디어 버튼은 재생 중인 YouTube가 오디오 포커스를 쥐고 있는 한 OS가 Pace로 절대 전달하지
  // 않는다(B22, 이미 확정된 한계) — iOS PaceVolumeKeyModule.swift와 동일하게 "물리 볼륨 버튼"을
  // 대리 신호로 쓴다. accessibility_service_config.xml에 flagRequestFilterKeyEvents를 추가해야
  // 이 콜백이 온다.
  //
  // ⚠️ 사용자 지적(2026-07-23) — 이 접근성 서비스의 스토어 심사용 명분은 "수면감지"(누운자세 감지 후
  // 수면 상태 감지하여 앱 종료)다. 같은 서비스로 볼륨키까지 가로채면 심사관이 보기엔 서비스 목적이
  // 하나가 아니게 돼 "접근성 목적이 아닌 남용"으로 리젝될 위험이 커진다 — 위 Auto Next 스와이프와
  // 정확히 같은 리스크(37번째 줄 주석 참고). 그래서 이 기능도 같은 완화 전략을 그대로 적용한다:
  // isWatching(=EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드 플래그로 게이팅된 "Hands-Free" 토글, 참고
  // autoNextService.android.ts)이 꺼져 있으면 무조건 false를 반환해 시스템 기본 볼륨 동작을 그대로
  // 통과시킨다 — 즉 실제 스토어 제출 빌드에서는 이 코드가 있어도 하이재킹이 발동하지 않는다.
  // 켜져 있어도 감시 대상 앱(SupportedApps.PACKAGES)이 포그라운드일 때만 소비하므로, 전화/음악 등
  // 무관한 앱에서는 볼륨 버튼이 평소와 똑같이 동작한다. 마지막으로, 감시 대상 앱이 켜져 있어도
  // 이벤트를 낸 입력 장치가 폰 자체 내장 버튼이면(InputDevice.isExternal()==false) 역시 통과시킨다
  // — 그래야 세션 중에도 사용자가 폰 본체 볼륨 버튼으로 실제 음량을 조절할 수 있다. 오직 외부
  // (블루투스 리모컨/이어폰) 장치에서 온 볼륨 이벤트만 다음넘김 대리 신호로 소비한다.
  override fun onKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode != KeyEvent.KEYCODE_VOLUME_UP && event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
      return false
    }
    if (!isWatching || !SupportedApps.PACKAGES.contains(currentForegroundPackage)) {
      return false
    }
    // 2026-07-23 사용자 지적 — "사용자가 실제 볼륨을 올리거나 내리고 싶을 땐?" 폰 자체 물리
    // 볼륨 버튼까지 이걸로 삼키면 세션 중엔 진짜 음량 조절 수단이 아예 없어진다. InputDevice.
    // isExternal()로 이벤트를 낸 입력 장치가 내장 버튼인지 외부(블루투스 리모컨/이어폰) 장치인지
    // 구분해서, 외부 장치에서 온 볼륨 이벤트만 "다음넘김" 대리 신호로 취급한다 — 폰 자체 볼륨
    // 버튼은 여기서 바로 return false로 통과시켜 평소와 똑같이 실제 음량을 조절한다.
    val device = InputDevice.getDevice(event.deviceId)
    if (device == null || !device.isExternal) {
      return false
    }
    // ACTION_DOWN에서만 처리 — ACTION_UP까지 같이 소비하면 한 번의 물리 입력이 두 번 카운트될 위험.
    if (event.action != KeyEvent.ACTION_DOWN) {
      return true // DOWN에서 이미 소비하기로 했으니 대응하는 UP도 시스템에 전달되지 않게 계속 삼킴.
    }
    val now = SystemClock.elapsedRealtime()
    // 물리 버튼 한 번 누름이 안드로이드 볼륨 스텝 특성상 반복 ACTION_DOWN을 짧은 간격으로 여러 번
    // 낼 수 있어(길게 누르고 있을 때 특히) 최소 500ms 불응 구간을 둔다 — 위 pollRunnable의
    // POLL_INTERVAL_MS와 동일한 감으로 잡은 값.
    if (now - lastVolumeKeySwipeAtMs < VOLUME_KEY_DEBOUNCE_MS) {
      return true
    }
    lastVolumeKeySwipeAtMs = now
    Log.i("PaceAccessibility", "onKeyEvent volume-key-next keyCode=${event.keyCode} pkg=$currentForegroundPackage")
    // 방향 구분 없이 둘 다 "다음"으로 취급 — 사용자가 명시한 요구가 "볼륨받아서 다음재생으로
    // 넘기기"였지 별도 이전/다음 구분이 아니었다. 오디오 자체는 iOS 쪽과 동일하게 실제로 변하지
    // 않아야 하므로(return true로 시스템 볼륨 변경 자체를 여기서 막음) 영상 시청 중 볼륨이 실수로
    // 튀는 부작용도 없다.
    performSwipeUp()
    return true
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    isWatching = false
    handler.removeCallbacks(pollRunnable)
    if (instance === this) instance = null
    super.onDestroy()
  }

  // Tier 1(실제 재생 위치) → 못 찾으면 Tier 2(안전 타임아웃) 순서로 스와이프 여부를 판단한다.
  // 2026-07-19: 사용자가 "실제로 Tier 1이 발동하는지 Tier 2(타임아웃)만 도는 건 아닌지" 직접
  // 확인을 요청 — 매 스와이프마다 어느 조건으로 발동했는지 logcat에 남긴다(adb logcat -s
  // PaceAccessibility로 필터링).
  private fun checkPlaybackAndMaybeSwipe() {
    val now = SystemClock.elapsedRealtime()
    val timing = readCachedOrSearchTiming()
    if (timing != null) {
      val (currentSec, totalSec) = timing
      Log.d("PaceAccessibility", "timing current=${currentSec}s total=${totalSec}s")
      val nearEnd = totalSec > 0 && currentSec >= totalSec - 1
      // 영상이 끝나고 다음(또는 반복) 영상으로 넘어가 재생 위치가 이전보다 확 줄어든 경우 —
      // 폴링 간격(500ms) 사이에 "끝나는 순간"을 놓쳤더라도 이걸로 뒤늦게 잡아낸다.
      val loopedBack = lastKnownCurrentSec > 0 && currentSec < lastKnownCurrentSec - 1
      if (nearEnd || loopedBack) {
        Log.d("PaceAccessibility", "SWIPE tier=1 reason=${if (nearEnd) "near-end" else "looped-back"} current=${currentSec}s total=${totalSec}s")
        performSwipeUp()
        lastSwipeAtMs = now
        lastKnownCurrentSec = -1
        return
      }
      lastKnownCurrentSec = currentSec
    }
    // Tier 2: 재생 위치 신호를 아예 못 찾았거나(광고, 노드 구조 변경, 다른 로케일), 신호는 있지만
    // 비정상적으로 오래 안 끝나는 경우 — 둘 다 이 안전 타임아웃 하나로 커버된다.
    if (now - lastSwipeAtMs >= safetyTimeoutMs) {
      Log.d("PaceAccessibility", "SWIPE tier=2 reason=safety-timeout foundTiming=${timing != null} elapsedMs=${now - lastSwipeAtMs}")
      performSwipeUp()
      lastSwipeAtMs = now
      lastKnownCurrentSec = -1
    }
  }

  // 2026-07-21 밤 감사 발견 — rootInActiveWindow는 "지금 입력 포커스를 가진 창"만 반환한다.
  // 스플릿스크린/멀티윈도우에서 감시 대상 앱(YouTube 등)이 화면엔 보이지만 포커스가 다른 창에
  // 있으면(예: 사용자가 방금 반대편 창을 탭함) 이 값이 대상 앱이 아닌 다른 창의 루트를 반환해
  // 재생 위치 텍스트를 영원히 못 찾는다 — Tier 1이 조용히 죽고 Tier 2(45초 타임아웃)만 도는 것과
  // 같은 부류의 버그(activeAppWindowBounds와 동일 원인). windows 목록에서 대상 패키지의 창을 직접
  // 찾아 그 루트를 우선 쓰고, 못 찾으면(단일 창 등 기존과 동일한 상황) rootInActiveWindow로 폴백.
  private fun trackedAppRootNode(): AccessibilityNodeInfo? {
    try {
      for (window in windows) {
        val root = window.root ?: continue
        val pkg = root.packageName?.toString()
        if (pkg != null && SupportedApps.PACKAGES.contains(pkg)) return root
      }
    } catch (e: Exception) {
      Log.w("PaceAccessibility", "trackedAppRootNode lookup failed, falling back to rootInActiveWindow", e)
    }
    return rootInActiveWindow
  }

  // 캐시된 노드가 있으면 refresh()로 그 하나만 저렴하게 재검증(트리 워크 없음) — 유효하면 바로
  // 파싱해서 반환. 캐시가 없거나 무효화됐을 때만 전체 트리를 재탐색하고, 찾으면 다시 캐싱한다.
  private fun readCachedOrSearchTiming(): Pair<Int, Int>? {
    val cached = cachedTimingNode
    if (cached != null) {
      if (cached.refresh()) {
        val desc = cached.contentDescription?.toString()
        if (!desc.isNullOrEmpty()) {
          parseTiming(desc)?.let { return it }
        }
      }
      cachedTimingNode = null // 새 영상으로 넘어가 뷰가 리사이클되는 등 무효화된 캐시는 버림
    }
    val found = findPlaybackTimingNode(trackedAppRootNode()) ?: return null
    cachedTimingNode = found
    val desc = found.contentDescription?.toString() ?: return null
    return parseTiming(desc)
  }

  // 화면 트리를 재귀 순회해 재생 위치 텍스트(SeekBar의 content-desc 등)를 가진 노드를 찾는다.
  // depth/budget으로 트리가 비정상적으로 크거나 깊어도 폴링 주기 안에서 ANR 위험 없이 끝나게 방어.
  // 캐시가 무효화됐을 때만 호출되므로(readCachedOrSearchTiming 참고) 실제 발동 빈도는 낮다.
  private fun findPlaybackTimingNode(node: AccessibilityNodeInfo?, depth: Int = 0, budget: IntArray = intArrayOf(400)): AccessibilityNodeInfo? {
    if (node == null || depth > 40 || budget[0] <= 0) return null
    budget[0]--
    val desc = node.contentDescription?.toString()
    if (!desc.isNullOrEmpty() && parseTiming(desc) != null) return node
    for (i in 0 until node.childCount) {
      findPlaybackTimingNode(node.getChild(i), depth + 1, budget)?.let { return it }
    }
    return null
  }

  private fun parseTiming(text: String): Pair<Int, Int>? {
    val korean = KOREAN_TIME_PATTERN.matcher(text)
    if (korean.find()) {
      // ⚠️ 실기기 검증 중 발견해 고친 버그: 처음엔 "N분 M초 중 N분 M초"를 [현재] 중 [전체]로
      // 잘못 가정했다. 실제로는 [전체] 중 [현재] 순서다 — 같은 5초짜리 영상을 1초 간격으로 5번
      // 연속 덤프해서 확인: 앞쪽 숫자(5초)는 고정, 뒤쪽 숫자만 0→2→0→3→1로 계속 바뀌었다(영상이
      // 반복 재생되며 0으로 되돌아가는 것까지 포함). 순서를 반대로 두면 "현재>=전체-1"이 거의 항상
      // 참이 돼 폴링마다 즉시 스와이프하는, 예전 8초 버그보다 더 심한 회귀가 될 뻔했다.
      val totalSec = korean.group(1)!!.toInt() * 60 + korean.group(2)!!.toInt()
      val currentSec = korean.group(3)!!.toInt() * 60 + korean.group(4)!!.toInt()
      return currentSec to totalSec
    }
    val colon = COLON_TIME_PATTERN.matcher(text)
    if (colon.find()) {
      val currentSec = colon.group(1)!!.toInt() * 60 + colon.group(2)!!.toInt()
      val totalSec = colon.group(3)!!.toInt() * 60 + colon.group(4)!!.toInt()
      return currentSec to totalSec
    }
    return null
  }

  // 2026-07-21 밤 사용자 지적("유튭 화면 작아졌을 때") — 이전엔 resources.displayMetrics(기기
  // 전체 화면 크기)로 스와이프 좌표를 계산해서, 대상 앱이 항상 전체화면이라고 가정하고 있었다.
  // 스플릿스크린/멀티윈도우/PIP처럼 실제 창이 화면 일부만 차지하면 좌표가 창 밖으로 나가거나
  // (허공에 스와이프, 아무 반응 없음) 스플릿스크린의 옆 앱을 잘못 건드릴 수 있었다 — 실기기
  // 재현은 아직(스플릿스크린을 직접 만들어 로그로 검증 필요) 코드 리뷰로 발견. windows 목록에서
  // 감시 대상 앱(SupportedApps.PACKAGES)이 실제로 차지한 창 경계를 찾아 그 안에서만 좌표를
  // 계산하도록 수정 — 못 찾으면(단일 창 전체화면 등 기존과 동일한 상황) 기존처럼 전체 화면
  // 크기로 안전하게 폴백한다.
  private fun activeAppWindowBounds(): Rect {
    val rect = Rect()
    try {
      for (window in windows) {
        val root = window.root ?: continue
        val pkg = root.packageName?.toString()
        if (pkg != null && SupportedApps.PACKAGES.contains(pkg)) {
          window.getBoundsInScreen(rect)
          if (!rect.isEmpty) return rect
        }
      }
    } catch (e: Exception) {
      Log.w("PaceAccessibility", "activeAppWindowBounds lookup failed, falling back to full screen", e)
    }
    val metrics = resources.displayMetrics
    rect.set(0, 0, metrics.widthPixels, metrics.heightPixels)
    return rect
  }

  private fun performSwipeUp() {
    // dispatchGesture는 API 24(N)+ 전용. accessibility_service_config.xml의 canPerformGestures도
    // API 24+에서만 의미가 있다 — 앱 전체 minSdk가 그보다 낮으면 이 경로는 자연히 no-op.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val bounds = activeAppWindowBounds()
    // 숏폼 피드 표준 제스처: 창 하단 3/4 지점에서 위쪽 1/4 지점으로 빠르게 스와이프(다음 영상).
    val path = Path().apply {
      moveTo(bounds.centerX().toFloat(), bounds.top + bounds.height() * 0.75f)
      lineTo(bounds.centerX().toFloat(), bounds.top + bounds.height() * 0.25f)
    }
    dispatchSwipe(path)
  }

  // Bluetooth Previous 전용(2026-07-19) — performSwipeUp의 역방향(창 상단→하단, 이전 영상).
  private fun performSwipeDown() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val bounds = activeAppWindowBounds()
    val path = Path().apply {
      moveTo(bounds.centerX().toFloat(), bounds.top + bounds.height() * 0.25f)
      lineTo(bounds.centerX().toFloat(), bounds.top + bounds.height() * 0.75f)
    }
    dispatchSwipe(path)
  }

  private fun dispatchSwipe(path: Path) {
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
      .build()
    // TEMP 진단용(작업 끝나면 정리) — dispatchGesture의 리턴값/완료 콜백을 지금까지 아예 안 보고
    // 있었다. 사용자가 "Next Short 힌트만 뜨고 안 넘어간다"고 보고한 원인 후보(제스처가 시스템에
    // 실제로 접수됐는지, 접수됐다면 끝까지 완료됐는지)를 실기기 로그로 직접 확인한다.
    val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
      override fun onCompleted(gestureDescription: GestureDescription?) {
        Log.i("PaceAccessibility", "gesture onCompleted")
      }
      override fun onCancelled(gestureDescription: GestureDescription?) {
        Log.w("PaceAccessibility", "gesture onCancelled")
      }
    }, null)
    Log.i("PaceAccessibility", "dispatchGesture accepted=$dispatched")
  }
}
