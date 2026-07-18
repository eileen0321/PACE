package expo.modules.paceoverlay

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

// Auto Next 실제 스와이프(사용자 대신 화면을 넘겨 다음 숏폼으로 이동). 2026-07-18 결정.
//
// ⚠️ Play 스토어 정책 리스크(PACE_ARCHITECTURE.md "Android AccessibilityService 최적화 원칙" 참고):
// AccessibilityService로 "사용자 대신 스와이프"하는 건 "접근성 목적이 아닌 남용"으로 심사에서
// 리젝될 수 있다는 지적이 있었다. 사용자 결정: "구현은 해놓고 출시 전에 정책을 결정" — 코드는
// 완성해두되, 실제 스토어 제출 빌드에서 이 기능을 노출할지는 EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드
// 플래그로 별도 게이팅한다(services/platform/autoNextService.android.ts, 기본값 OFF).
//
// 감지 방식: 문서 초안엔 "MediaSession PlaybackState 우선, Accessibility 이벤트 폴백"이라 적혀
// 있었지만 MediaSession 감지는 알림 리스너(별도 특수 권한)가 추가로 필요해 스코프가 커진다 — 1단계
// 구현은 "감시 대상 앱이 포그라운드인 동안 고정 간격으로 스와이프"하는 단순 타이머 방식만 구현한다
// (영상 길이를 정확히 아는 게 아니라 근사치 간격 — 정밀한 영상 경계 감지는 후속 과제).
class PaceAccessibilityService : AccessibilityService() {

  private val handler = Handler(Looper.getMainLooper())
  private var isWatching = false
  private var intervalMs = DEFAULT_INTERVAL_MS
  private var currentForegroundPackage: String? = null

  private val swipeRunnable = object : Runnable {
    override fun run() {
      if (isWatching && SupportedApps.PACKAGES.contains(currentForegroundPackage)) {
        performSwipeUp()
      }
      handler.postDelayed(this, intervalMs)
    }
  }

  companion object {
    private const val DEFAULT_INTERVAL_MS = 8_000L
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

    fun startWatching(intervalMs: Long) {
      instance?.let { service ->
        service.intervalMs = intervalMs
        if (!service.isWatching) {
          service.isWatching = true
          service.handler.post(service.swipeRunnable)
        }
      }
      // instance가 아직 null이면(서비스가 시스템에 의해 아직 바인딩되지 않음) 사용자가 설정에서
      // 권한을 켜지 않은 상태 — JS 쪽(autoNextService.android.ts)이 hasAccessibilityPermission()으로
      // 먼저 확인하므로 여기서는 조용히 무시한다.
    }

    fun stopWatching() {
      instance?.let { service ->
        service.isWatching = false
        service.handler.removeCallbacks(service.swipeRunnable)
      }
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
    handler.removeCallbacks(swipeRunnable)
    if (instance === this) instance = null
    super.onDestroy()
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
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
      .build()
    dispatchGesture(gesture, null, null)
  }
}
