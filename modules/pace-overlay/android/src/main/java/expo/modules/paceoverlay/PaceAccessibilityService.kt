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
  // 2026-07-26 추가 — currentSec가 이전 폴링보다 실제로 늘어난(=재생 중이라는 강한 증거) 마지막
  // 시각. companion의 isLikelyPlaying()이 이 값의 신선도로 "지금 실제로 재생 중인가"를 판단해
  // PaceOverlayService.performTick()의 사용시간 차감을 게이팅한다.
  private var lastPlaybackAdvanceAtMs = 0L
  // 2026-07-26 사용자 지시("몇 편 봤는지 카운트") — 자동넘김 스와이프든 사용자가 직접 손으로 넘긴
  // 것이든 checkPlaybackAndMaybeSwipe()가 "영상이 바뀌었다"고 판단할 때마다 1씩 증가. 세션 시작
  // (startPlaybackTracking)마다 0으로 리셋 — companion getVideoCount()로 JS가 읽는다.
  private var videoAdvanceCount = 0
  private var lastSwipeAtMs = 0L
  private var lastVolumeKeySwipeAtMs = 0L
  // 2026-07-19: 매 폴링(500ms)마다 rootInActiveWindow부터 트리 전체를 다시 훑으면 실제 YouTube
  // 재생 화면에 부하가 걸릴 수 있다는 지적 — 한 번 찾은 SeekBar 노드를 캐싱해서, 다음 폴링부터는
  // node.refresh()로 그 노드 하나만 저렴하게 재검증(유효하면 재사용, 무효화됐으면 그때만 전체
  // 재탐색). Shorts는 스크롤할 때마다 뷰가 리사이클되므로 무효화 자체는 자연스럽게 발생 — 캐시가
  // 없어도 동작은 똑같이 맞지만, 있으면 트리 워크 빈도가 크게 줄어든다.
  private var cachedTimingNode: AccessibilityNodeInfo? = null

  // 2026-07-26 사용자 지시("유튜브 시청 시간을 측정할 방법 없어?" → "실제 재생 중일 때만 차감") —
  // 기존엔 isWatching(=Focus Session/자동넘김 ON)일 때만 이 폴링이 돌아서, Focus Session을 안 켠
  // "YouTube with PACE" 세션에서는 재생위치 신호 자체가 전혀 안 잡혔다. 사용시간 정확도는 Focus
  // Session 여부와 무관하게 필요하므로, 폴링 자체는 세션이 살아있는 동안(isTrackingPlayback) 항상
  // 돌게 분리하고, 실제 스와이프(자동넘김)만 기존대로 isWatching으로 게이팅한다(checkPlaybackAndMaybeSwipe
  // 내부에서 처리).
  private var isTrackingPlayback = false
  private var pollingScheduled = false
  // Focus Session(isWatching)이 꺼져 있어도 순수 사용시간 추적(isTrackingPlayback)만으로 폴링이
  // 돌아야 하므로 둘 중 하나라도 켜져 있으면 실행 — 실제 스와이프 여부는
  // checkPlaybackAndMaybeSwipe 내부에서 isWatching으로 별도 게이팅한다.
  private val pollRunnable = object : Runnable {
    override fun run() {
      if ((isWatching || isTrackingPlayback) && SupportedApps.PACKAGES.contains(currentForegroundPackage)) {
        checkPlaybackAndMaybeSwipe()
      }
      handler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  private fun ensurePollingScheduled() {
    if (!pollingScheduled) {
      pollingScheduled = true
      handler.post(pollRunnable)
    }
  }

  private fun maybeStopPolling() {
    if (!isWatching && !isTrackingPlayback && pollingScheduled) {
      pollingScheduled = false
      handler.removeCallbacks(pollRunnable)
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
    // 2026-07-27 사용자 지시 — 블루투스 볼륨키로 다음/이전 넘기기 on/off. 카메라 제스처(isWatching,
    // 인스턴스 필드) Hands-Free 토글과 독립적이라 companion 레벨에 둔다(둘 다 세션 시작 시
    // PaceOverlayService.onStartCommand에서 값을 넣어준다) — 인스턴스 생명주기와 무관하게 세션
    // 설정값이라 여기 있어야 세션 재시작/프로세스 복구에도 값이 유지된다.
    var bluetoothVolumeKeySkipEnabled = true

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
        service.ensurePollingScheduled()
        Log.d("PaceAccessibility", "startWatching() -> polling started, safetyTimeoutMs=$intervalMs")
      }
    }

    fun stopWatching() {
      instance?.let { service ->
        service.isWatching = false
        service.maybeStopPolling()
      }
    }

    // 2026-07-26 사용자 지시("실제 재생 중일 때만 차감") — Focus Session(자동넘김) 여부와 무관하게,
    // 가드된 세션이 시작되면(PaceOverlayService.startSession) 항상 재생 위치 폴링만 켠다. 실제
    // 스와이프는 하지 않는다(isWatching이 별도로 꺼져 있으면 checkPlaybackAndMaybeSwipe가 swipe를
    // 건너뜀) — 순수 사용시간 추적 전용 세션에서 원치 않는 자동넘김이 발생하면 안 되므로.
    fun startPlaybackTracking() {
      val service = instance
      if (service == null) {
        Log.w("PaceAccessibility", "startPlaybackTracking() called but instance is null — accessibility not bound yet, usage-time will fall back to always-decrement")
        return
      }
      if (!service.isTrackingPlayback) {
        service.isTrackingPlayback = true
        service.lastKnownCurrentSec = -1
        service.lastPlaybackAdvanceAtMs = 0L
        service.videoAdvanceCount = 0
        service.ensurePollingScheduled()
        Log.d("PaceAccessibility", "startPlaybackTracking() -> polling started (usage-time accuracy only)")
      }
    }

    // 2026-07-26 — 이번 세션(startPlaybackTracking()~지금)에서 실제로 넘어간 영상 편수. 접근성이
    // 꺼져있으면(instance==null) 0 — 이 경우 JS 쪽은 videosWatched=0으로 정직하게 기록한다(예전에
    // 가짜 videoIndex를 썼다가 고쳤던 것과 같은 원칙).
    fun getVideoCount(): Int = instance?.videoAdvanceCount ?: 0

    fun stopPlaybackTracking() {
      instance?.let { service ->
        service.isTrackingPlayback = false
        service.lastPlaybackAdvanceAtMs = 0L
        service.maybeStopPolling()
      }
    }

    // null = 판단 불가(접근성 꺼짐/추적 미시작/아직 신호 한 번도 못 잡음) — 호출부는 이 경우 기존
    // 방식대로 항상 차감하는 쪽으로 안전하게 폴백해야 한다. true/false = 실제로 판단 가능한 경우의
    // 재생 여부(maxStaleMs 이내에 재생 위치가 실제로 늘어난 적이 있는지).
    fun isLikelyPlaying(maxStaleMs: Long = 5_000L): Boolean? {
      val service = instance ?: return null
      if (!service.isTrackingPlayback) return null
      if (service.lastPlaybackAdvanceAtMs == 0L) return null
      return SystemClock.elapsedRealtime() - service.lastPlaybackAdvanceAtMs <= maxStaleMs
    }

    // 2026-07-19: Bluetooth Hands-Free Next/Previous — 위 interval 기반 Auto Next 루프와 별개로,
    // 리모컨 버튼 1회 입력에 스와이프 1회로 즉시 응답하는 단발성 트리거. 감시 대상 앱이 포그라운드가
    // 아니어도(예: 사용자가 Pace 쪽을 보고 있어도) 그냥 시도한다 — 리모컨을 눌렀다는 것 자체가 이미
    // 숏폼을 보고 있다는 강한 신호라 startWatching()의 포그라운드 패키지 체크만큼 보수적일 필요가 없음.
    fun swipeOnce(up: Boolean) {
      // 2026-07-26 사용자 지시 — 핑거스냅/손짓/블루투스 리모컨은 전부 이 함수를 거치는 "사람이 직접
      // 낸 신호" 공용 경로다. 자동 재생위치 스와이프(checkPlaybackAndMaybeSwipe)와 구분해 여기서만
      // 수면감지 무진동 시계를 리셋한다(PaceOverlayService.markUserActivity 참고).
      PaceOverlayService.markUserActivity()
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

    // 2026-07-31 사장님 지시(Favorite/Capture) — 유튜브 Shorts 몰입형 플레이어에서 현재 영상 정보를
    // 읽어온다. 제목/채널은 접근성 트리 content-desc에서 즉시 읽고(실기기 확인, PACE_PROJECT_
    // MANAGEMENT.md 2026-07-31 참고), videoId/url은 "동영상 공유" 버튼을 눌러 시스템 공유시트를
    // 띄운 뒤 그 목록에서 우리 앱("Pace")을 찾아 클릭 — PaceShareCaptureActivity가 받는 진짜 공유
    // 텍스트에서 파싱한다. 실패해도(공유 버튼을 못 찾음/공유시트에 Pace가 안 보임/타임아웃) 최소한
    // 제목/채널은 넘겨준다 — videoId=null이면 호출부(JS)가 썸네일 없이 저장한다.
    fun captureCurrentVideoInfo(callback: (title: String?, channel: String?, videoId: String?, url: String?) -> Unit) {
      val service = instance
      if (service == null) {
        callback(null, null, null, null)
        return
      }
      service.captureCurrentVideoInfoInternal(callback)
    }

    private const val CAPTURE_TIMEOUT_MS = 6000L
    private val YOUTUBE_VIDEO_ID_PATTERN = Pattern.compile("(?:youtu\\.be/|shorts/|[?&]v=)([a-zA-Z0-9_-]{11})")
    // 실기기 확인된 유튜브 Shorts 액션 레일 content-desc들 — 제목 텍스트를 이 목록과 혼동하지
    // 않기 위한 제외 키워드(로케일이 다르면 이 휴리스틱이 안 먹혀 title=null로 폴백될 수 있음,
    // 치명적이지 않음 — 그래도 channel/videoId/url은 별도 경로라 영향 없음).
    private val KNOWN_ACTION_KEYWORDS = listOf(
      "채널로 이동", "구독", "좋아요", "댓글", "공유", "리믹스", "사운드", "일시중지", "다음 동영상",
      "검색", "더보기", "만들기", "드래그 핸들"
    )

    fun extractYouTubeVideoId(text: String?): String? {
      if (text.isNullOrEmpty()) return null
      val m = YOUTUBE_VIDEO_ID_PATTERN.matcher(text)
      return if (m.find()) m.group(1) else null
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
    // 2026-07-27 사용자 지시 — 이 볼륨키 하이재킹은 카메라 제스처 Hands-Free(isWatching)와 별개의
    // 독립 토글이다(에어팟/블루투스 스피커를 순수 감상용으로만 쓰는 사용자를 위해 따로 끌 수 있어야
    // 함). isWatching 대신 bluetoothVolumeKeySkipEnabled로 게이팅 — 손짓/핑거스냅은 꺼둔 채 이것만
    // 켜두거나, 반대로 이것만 꺼둘 수 있다.
    if (!bluetoothVolumeKeySkipEnabled || !SupportedApps.PACKAGES.contains(currentForegroundPackage)) {
      return false
    }
    // 2026-07-23 사용자 지적 — "사용자가 실제 볼륨을 올리거나 내리고 싶을 땐?" 폰 자체 물리
    // 볼륨 버튼까지 이걸로 삼키면 세션 중엔 진짜 음량 조절 수단이 아예 없어진다. InputDevice.
    // isExternal()로 이벤트를 낸 입력 장치가 내장 버튼인지 외부(블루투스 리모컨/이어폰) 장치인지
    // 구분해서, 외부 장치에서 온 볼륨 이벤트만 "다음넘김" 대리 신호로 취급한다 — 폰 자체 볼륨
    // 버튼은 여기서 바로 return false로 통과시켜 평소와 똑같이 실제 음량을 조절한다.
    val device = InputDevice.getDevice(event.deviceId)
    // 2026-07-27 사용자 실기기 지적("폰 자체 볼륨키에도 넘어감, 블루투스 연결돼 있어도 폰 버튼으로는
    // 넘어가면 안 되지") — 이 실기기(삼성)에서 InputDevice.isExternal() 하나만으로는 내장 볼륨버튼과
    // 진짜 블루투스 기기를 못 미더울 정도로 확실히 구분 못 할 가능성이 있다(일부 삼성 기기가 내장
    // 버튼을 별도 입력 서브시스템으로 노출해 isExternal()을 오탐시키는 알려진 특성). 신호 하나를
    // 더 겹친다 — 내장 버튼은 거의 항상 vendorId/productId가 0으로 잡히고(플랫폼 내부 경로), 진짜
    // 페어링된 외부 기기는 실제 vendor/product ID를 갖는다. isExternal() + vendorId/productId 둘
    // 다 0이 아님 + 지금 실제로 블루투스 오디오 기기가 연결돼 있음, 이 세 조건을 전부 만족해야만
    // "진짜 블루투스 리모컨에서 온 신호"로 인정한다 — 셋 중 하나라도 아니면 폰 버튼으로 간주해
    // 시스템 기본 볼륨 동작을 그대로 통과시킨다.
    // ⚠️ 미검증: 이 휴리스틱(vendorId/productId)이 이 특정 기기에서 실제로 내장 버튼을 걸러내는지는
    // 아직 실기기로 재현 확인 못 했다 — 아래 로그(device.name/vendorId/productId/isExternal)로
    // 다음에 재현될 때 바로 진단 가능하게 남겨둔다.
    if (device != null) {
      Log.d("PaceAccessibility", "volume-key device check: name=${device.name} vendorId=${device.vendorId} productId=${device.productId} isExternal=${device.isExternal}")
    }
    // 2026-07-28 사장님 실기기 지적("블루투스 누르면 왜 소리만 조절되냐") — isBluetoothAudioConnected()
    // 는 A2DP/SCO(오디오 스트리밍) 프로필만 확인하는데, 순수 리모컨/셔터형 블루투스 기기(예: 다이소
    // BT 리모컨)는 오디오를 전혀 스트리밍하지 않는 HID 입력 장치라 이 조건을 영원히 만족 못 했다 —
    // 이 게이트 자체가 항상 false를 반환해 볼륨키가 매번 그냥 시스템 볼륨으로 새고 있었다(실제
    // 재현·확인됨). 오디오 연결 여부는 "진짜 외부 기기인가"와 무관한 별개 신호라 제거 — isExternal()
    // + vendorId/productId만으로 판별한다.
    if (device == null || !device.isExternal || (device.vendorId == 0 && device.productId == 0)) {
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
    Log.i("PaceAccessibility", "onKeyEvent volume-key-swipe keyCode=${event.keyCode} pkg=$currentForegroundPackage")
    // 2026-07-26 사용자 지시 — 외부 블루투스 리모컨의 실제 물리 버튼 입력이므로 swipeOnce와 동일하게
    // "사람이 직접 낸 신호"다 — 수면감지 무진동 시계 리셋.
    PaceOverlayService.markUserActivity()
    // 2026-07-27 — iOS(Mac 세션)와 동일하게 방향 구분 적용: 볼륨업=다음, 볼륨다운=이전(기존엔 방향
    // 무관하게 둘 다 "다음"으로 취급했었음). 오디오 자체는 실제로 변하지 않아야 하므로(return true로
    // 시스템 볼륨 변경 자체를 여기서 막음) 영상 시청 중 볼륨이 실수로 튀는 부작용도 없다.
    if (event.keyCode == KeyEvent.KEYCODE_VOLUME_UP) performSwipeUp() else performSwipeDown()
    return true
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    isWatching = false
    isTrackingPlayback = false
    pollingScheduled = false
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
      // 2026-07-26 — currentSec가 이전 폴링보다 실제로 늘었다는 건 스와이프 여부(isWatching)와
      // 무관하게 "지금 영상이 실제로 재생 중"이라는 강한 증거. isLikelyPlaying()이 이 시각의
      // 신선도로 PaceOverlayService의 사용시간 차감을 게이팅한다.
      if (lastKnownCurrentSec >= 0 && currentSec > lastKnownCurrentSec) {
        lastPlaybackAdvanceAtMs = now
      }
      val nearEnd = totalSec > 0 && currentSec >= totalSec - 1
      // 영상이 끝나고 다음(또는 반복) 영상으로 넘어가 재생 위치가 이전보다 확 줄어든 경우 —
      // 폴링 간격(500ms) 사이에 "끝나는 순간"을 놓쳤더라도 이걸로 뒤늦게 잡아낸다. 이 신호는
      // 자동넘김이 스와이프를 했든 사용자가 직접 손으로 넘겼든 똑같이 "영상이 바뀌었다"는 뜻이라
      // isWatching과 무관하게 항상 체크한다 — 2026-07-26 "몇 편 봤는지 세기"(videoAdvanceCount)가
      // 바로 이 지점에 걸린다.
      val loopedBack = lastKnownCurrentSec > 0 && currentSec < lastKnownCurrentSec - 1
      if (nearEnd || loopedBack) {
        videoAdvanceCount++
        Log.d("PaceAccessibility", "VIDEO_ADVANCE reason=${if (nearEnd) "near-end" else "looped-back"} current=${currentSec}s total=${totalSec}s count=$videoAdvanceCount isWatching=$isWatching")
        // 자동넘김(isWatching)이 꺼져 있으면(순수 사용시간 추적 전용 세션) 영상 전환 카운트는 계속
        // 세되 스와이프는 절대 하지 않는다 — Focus Session을 안 켠 사용자에게 원치 않는 자동넘김이
        // 발생하면 안 되므로.
        if (isWatching) {
          performSwipeUp()
          lastSwipeAtMs = now
        }
        lastKnownCurrentSec = -1
        return
      }
      lastKnownCurrentSec = currentSec
    }
    if (!isWatching) return
    // Tier 2: 재생 위치 신호를 아예 못 찾았거나(광고, 노드 구조 변경, 다른 로케일), 신호는 있지만
    // 비정상적으로 오래 안 끝나는 경우 — 둘 다 이 안전 타임아웃 하나로 커버된다. isWatching이 꺼져
    // 있으면 위에서 이미 return했으므로 여긴 항상 자동넘김이 실제로 스와이프하는 경로.
    if (now - lastSwipeAtMs >= safetyTimeoutMs) {
      videoAdvanceCount++
      Log.d("PaceAccessibility", "SWIPE tier=2 reason=safety-timeout foundTiming=${timing != null} elapsedMs=${now - lastSwipeAtMs} count=$videoAdvanceCount")
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

  // ── Favorite/Capture: 현재 영상 정보 캡처(2026-07-31) ──

  private fun captureCurrentVideoInfoInternal(callback: (String?, String?, String?, String?) -> Unit) {
    try {
      val root = trackedAppRootNode()
      val texts = mutableListOf<String>()
      collectContentDescriptions(root, texts, depth = 0, budget = intArrayOf(400))

      val channelRaw = texts.firstOrNull { it.endsWith("채널로 이동") }
      val channel = channelRaw?.removeSuffix(" 채널로 이동")
      val title = texts.firstOrNull { candidate ->
        candidate.length > 8 &&
          candidate != channelRaw &&
          KNOWN_ACTION_KEYWORDS.none { candidate.contains(it) } &&
          !candidate.contains("구독합니다") &&
          extractYouTubeVideoId(candidate) == null // 시간 표시 등 숫자 위주 문자열 방어적 제외는 아래 별도 처리
      }

      val shareNode = findNodeByContentDesc(root, "공유")
      if (shareNode == null) {
        Log.w("PaceAccessibility", "captureCurrentVideoInfo: 공유 버튼을 못 찾음")
        callback(title, channel, null, null)
        return
      }

      var completed = false
      val timeoutRunnable = Runnable {
        if (!completed) {
          completed = true
          PaceShareCaptureActivity.pendingCallback = null
          Log.w("PaceAccessibility", "captureCurrentVideoInfo: 공유 결과 대기 타임아웃")
          callback(title, channel, null, null)
        }
      }
      PaceShareCaptureActivity.pendingCallback = { sharedText ->
        if (!completed) {
          completed = true
          handler.removeCallbacks(timeoutRunnable)
          val videoId = extractYouTubeVideoId(sharedText)
          callback(title, channel, videoId, sharedText)
        }
      }
      handler.postDelayed(timeoutRunnable, CAPTURE_TIMEOUT_MS)

      val clicked = shareNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      if (!clicked) {
        completed = true
        handler.removeCallbacks(timeoutRunnable)
        PaceShareCaptureActivity.pendingCallback = null
        Log.w("PaceAccessibility", "captureCurrentVideoInfo: 공유 버튼 클릭 실패")
        callback(title, channel, null, null)
        return
      }
      pollForShareTarget(attemptsLeft = 12)
    } catch (e: Exception) {
      // 방어적 전체 캐치 — 이 기능은 부가 기능이라 실패해도 앱이 죽으면 안 됨(사장님 지시:
      // "예외처리도 다 적용해가면서").
      Log.e("PaceAccessibility", "captureCurrentVideoInfo 예외", e)
      callback(null, null, null, null)
    }
  }

  // 공유시트가 뜨는 데 기기/OEM별로 지연이 있어 300ms 간격으로 최대 12회(=3.6초) 재시도.
  // 못 찾으면 위 CAPTURE_TIMEOUT_MS(6초) 시점에 timeoutRunnable이 정리한다.
  private fun pollForShareTarget(attemptsLeft: Int) {
    if (attemptsLeft <= 0) return
    val target = findNodeByExactText(rootInActiveWindow, "Pace")
    if (target != null) {
      val clickable = generateSequence(target) { it.parent }.firstOrNull { it.isClickable } ?: target
      clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      return
    }
    handler.postDelayed({ pollForShareTarget(attemptsLeft - 1) }, 300L)
  }

  private fun collectContentDescriptions(node: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int, budget: IntArray) {
    if (node == null || depth > 40 || budget[0] <= 0) return
    budget[0]--
    val desc = node.contentDescription?.toString()
    if (!desc.isNullOrEmpty()) out.add(desc)
    for (i in 0 until node.childCount) {
      collectContentDescriptions(node.getChild(i), out, depth + 1, budget)
    }
  }

  private fun findNodeByContentDesc(node: AccessibilityNodeInfo?, substring: String, depth: Int = 0, budget: IntArray = intArrayOf(400)): AccessibilityNodeInfo? {
    if (node == null || depth > 40 || budget[0] <= 0) return null
    budget[0]--
    val desc = node.contentDescription?.toString()
    if (!desc.isNullOrEmpty() && desc.contains(substring) && node.isClickable) return node
    for (i in 0 until node.childCount) {
      findNodeByContentDesc(node.getChild(i), substring, depth + 1, budget)?.let { return it }
    }
    return null
  }

  private fun findNodeByExactText(node: AccessibilityNodeInfo?, text: String, depth: Int = 0, budget: IntArray = intArrayOf(600)): AccessibilityNodeInfo? {
    if (node == null || depth > 50 || budget[0] <= 0) return null
    budget[0]--
    if (node.text?.toString() == text) return node
    for (i in 0 until node.childCount) {
      findNodeByExactText(node.getChild(i), text, depth + 1, budget)?.let { return it }
    }
    return null
  }
}
