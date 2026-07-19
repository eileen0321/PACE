package expo.modules.paceoverlay

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
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
  private var lastKnownCurrentSec = -1
  private var lastSwipeAtMs = 0L
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
      instance?.let { service ->
        service.safetyTimeoutMs = intervalMs
        if (!service.isWatching) {
          service.isWatching = true
          service.lastKnownCurrentSec = -1
          service.lastSwipeAtMs = SystemClock.elapsedRealtime()
          service.handler.post(service.pollRunnable)
        }
      }
      // instance가 아직 null이면(서비스가 시스템에 의해 아직 바인딩되지 않음) 사용자가 설정에서
      // 권한을 켜지 않은 상태 — JS 쪽(autoNextService.android.ts)이 hasAccessibilityPermission()으로
      // 먼저 확인하므로 여기서는 조용히 무시한다.
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
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    // 세부 설정(canPerformGestures, packageNames, eventTypes)은 전부
    // res/xml/accessibility_service_config.xml에 선언 — 여기서 serviceInfo를 재조립하지 않는다.
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      currentForegroundPackage = event.packageName?.toString()
    }
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    isWatching = false
    handler.removeCallbacks(pollRunnable)
    if (instance === this) instance = null
    super.onDestroy()
  }

  // Tier 1(실제 재생 위치) → 못 찾으면 Tier 2(안전 타임아웃) 순서로 스와이프 여부를 판단한다.
  private fun checkPlaybackAndMaybeSwipe() {
    val now = SystemClock.elapsedRealtime()
    val timing = readCachedOrSearchTiming()
    if (timing != null) {
      val (currentSec, totalSec) = timing
      val nearEnd = totalSec > 0 && currentSec >= totalSec - 1
      // 영상이 끝나고 다음(또는 반복) 영상으로 넘어가 재생 위치가 이전보다 확 줄어든 경우 —
      // 폴링 간격(500ms) 사이에 "끝나는 순간"을 놓쳤더라도 이걸로 뒤늦게 잡아낸다.
      val loopedBack = lastKnownCurrentSec > 0 && currentSec < lastKnownCurrentSec - 1
      if (nearEnd || loopedBack) {
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
      performSwipeUp()
      lastSwipeAtMs = now
      lastKnownCurrentSec = -1
    }
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
    val found = findPlaybackTimingNode(rootInActiveWindow) ?: return null
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

  private fun performSwipeUp() {
    // dispatchGesture는 API 24(N)+ 전용. accessibility_service_config.xml의 canPerformGestures도
    // API 24+에서만 의미가 있다 — 앱 전체 minSdk가 그보다 낮으면 이 경로는 자연히 no-op.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val metrics = resources.displayMetrics
    val width = metrics.widthPixels
    val height = metrics.heightPixels
    // 숏폼 피드 표준 제스처: 화면 하단 3/4 지점에서 위쪽 1/4 지점으로 빠르게 스와이프(다음 영상).
    val path = Path().apply {
      moveTo(width / 2f, height * 0.75f)
      lineTo(width / 2f, height * 0.25f)
    }
    dispatchSwipe(path)
  }

  // Bluetooth Previous 전용(2026-07-19) — performSwipeUp의 역방향(화면 상단→하단, 이전 영상).
  private fun performSwipeDown() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val metrics = resources.displayMetrics
    val width = metrics.widthPixels
    val height = metrics.heightPixels
    val path = Path().apply {
      moveTo(width / 2f, height * 0.25f)
      lineTo(width / 2f, height * 0.75f)
    }
    dispatchSwipe(path)
  }

  private fun dispatchSwipe(path: Path) {
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
      .build()
    dispatchGesture(gesture, null, null)
  }
}
