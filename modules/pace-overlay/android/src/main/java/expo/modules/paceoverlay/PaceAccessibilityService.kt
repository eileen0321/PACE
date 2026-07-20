package expo.modules.paceoverlay

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent

// Hands-Free Next 실제 스와이프. 2026-07-18 결정, 2026-07-20 Focus Session 리디자인으로 범위 축소.
//
// ⚠️ 2026-07-20 결정(PACE_ARCHITECTURE.md "Focus Session 리디자인" 참고): 이 서비스는 예전에
// "영상 재생 위치를 스스로 폴링하다 끝나는 순간을 감지해 자율적으로 스와이프"하는 startWatching()
// 루프도 갖고 있었다 — Google Play 정책의 "자율적 판단·실행 자동화 금지" 조항에 정면으로 걸리는
// 패턴이라 전면 삭제했다(재생 위치 폴링/파싱 로직 전부 제거, git 히스토리에서 필요하면 복원 가능).
// 이제 남은 건 swipeOnce() 하나뿐 — 알약 탭/Bluetooth 버튼/핑거스냅처럼 **사람이 그 순간 직접
// 트리거한 단발성 스와이프**만 수행한다("If Trigger X occurs, perform Action Y" — 허용되는 결정적
// 자동화). "언제 넘길지"를 판단하는 주체는 이제 100% 사용자다.
class PaceAccessibilityService : AccessibilityService() {

  companion object {
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

    // 알약 탭/Bluetooth 버튼/핑거스냅 전부 이 단발성 트리거 하나로 수렴한다 — 입력 소스만 다르고
    // "사람이 지금 직접 요청했다"는 성격은 동일.
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
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    Log.d("PaceAccessibility", "onServiceConnected — instance bound")
    // 세부 설정(canPerformGestures, packageNames, eventTypes)은 전부
    // res/xml/accessibility_service_config.xml에 선언 — 여기서 serviceInfo를 재조립하지 않는다.
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}

  override fun onDestroy() {
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
