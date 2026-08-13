package expo.modules.paceoverlay

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
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
  private var currentForegroundPackage: String? = null
  // 2026-07-25 실기기 지적("앱 껐는데 왜 오버레이가 홈 화면에 떠있어") — 이 값은
  // accessibility_service_config.xml의 packageNames 필터 때문에 유튜브/인스타/틱톡 창일 때만
  // 갱신된다. 런처나 다른 앱으로 나가면 이벤트 자체가 안 와서 이 값이 "유튜브"인 채로 영원히
  // 멈춰있을 수 있다 — 아래 getCurrentForegroundPackage(maxAgeMs)가 이 시각을 같이 확인해서,
  // 너무 오래된 값은 "모른다"로 취급하고 폴백(UsageStatsManager)을 타게 한다.
  private var currentForegroundPackageAtMs = 0L
  private var lastKnownCurrentSec = -1
  // 2026-08-04 — 직전 영상 전환 시점의 영상 길이(초). "유튜브가 같은 영상을 반복 재생하는 것"과
  // "사용자가 다음 영상으로 넘긴 것"을 가르는 데 쓴다(아래 loopedBack 분기 주석 참고).
  private var lastAdvanceTotalSec = -1
  // 🔴 2026-08-12 실기기(틱톡) — 재생위치(timing)를 마지막으로 **읽어낸** 시각. "재생 중인가"가
  // 아니라 "이 앱을 우리가 관측할 수 있는가"를 나타낸다. 수면감지가 이 값에 의존한다: 아래
  // loopedBack 분기의 markUserActivity()(=손가락으로 직접 넘겼다는 **유일한** '깨어있음' 증거,
  // 2026-08-02 오탐 수정)가 timing을 읽을 수 있을 때만 발생하므로, 못 읽는 앱에서는 무입력
  // 시계를 리셋할 수단이 아예 없어 멀쩡히 보고 있어도 반드시 수면으로 오판된다.
  @Volatile private var lastTimingReadAtMs = 0L
  // 2026-08-12 — 재생위치가 없는 앱에서 "지금 영상"을 식별하는 지문(currentVideoFingerprint 참고).
  private var lastVideoFingerprint: String? = null
  private var lastRangeProbeLogAtMs = 0L
  // 2026-08-12 — 직전 폴링의 진행률(0~1). -1 = 아직 못 읽음.
  // 2026-08-13 — range 후보별 직전 진행률(키: 클래스:max). "값이 흐르는 바"를 가려내는 데 쓴다.
  private val rangeCandidateHistory = HashMap<String, Float>()
  // 2026-08-13 — 지금 영상을 보기 시작한 시각. 한 영상에 너무 오래 머무는 걸 끊는 데 쓴다.
  // 2026-08-13 — 직전 폴에서 광고가 떠 있었는지. 광고 복귀 시 시계를 한 번 리셋하기 위한 엣지 감지.
  private var adWasShowing = false
  private var videoStartedAtMs = 0L
  private var lastKnownFrac = -1f
  private var lastFracAtMs = 0L
  private var estimatedDurationMs = -1L
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
      // 2026-08-02 감사 지적 반영 — 이 루프는 500ms마다 유튜브 접근성 트리를 순회하며 화면에서 읽은
      // 임의의 문자열을 파싱한다(readCachedOrSearchTiming → parseTiming). 여기서 던져진 예외는
      // 메인 스레드로 그대로 올라가고, 안드로이드는 예외가 난 AccessibilityService를 죽인 뒤 다시
      // 바인딩해주지 않는다 — 오늘 tombstone으로 확인한 MediaPipe SIGSEGV와 결과가 완전히 동일하다
      // ("설정엔 켜져 있는데 손짓/자동넘김/블루투스가 전부 조용히 멈춤"). 유튜브 UI 문구는 앱 버전·
      // 로케일마다 바뀌는 우리 통제 밖의 입력이므로, 파싱 한 번 실패했다고 기능 전체가 영구 정지되면
      // 안 된다. 이번 틱만 버리고 다음 폴링을 계속 돌린다.
      try {
        if ((isWatching || isTrackingPlayback) && SupportedApps.PACKAGES.contains(pollTargetPackage())) {
          checkPlaybackAndMaybeSwipe()
        }
      } catch (e: Throwable) {
        Log.e("PaceAccessibility", "poll tick failed — skipping this tick, service stays alive", e)
      }
      handler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  // 🔴 2026-08-13 출시 검증(신규 설치 첫 세션)에서 잡은 무증상 고장 —
  //   위 폴링 게이트가 `currentForegroundPackage`(접근성 이벤트로만 갱신되는 값) **하나에만**
  //   의존하고 있었다. 그 이벤트를 한 번 놓치면 값이 영영 안 채워지고, 게이트가 세션 내내 닫혀
  //   **자동넘김·영상 카운트·수면감지 증거가 통째로 조용히 죽는다.** 로그조차 안 남아
  //   ("RANGE_INFO none"도 else 분기 안이라) 고장 사실 자체가 안 보인다.
  //   실측(신규 설치 → 첫 세션 → 유튜브):
  //     18:52:44  startWatching() -> polling started
  //     18:53~19:04  PaceAccessibility 로그 0줄, 같은 영상 12분 반복, 손스와이프도 미인식
  //     19:04  홈 나갔다 유튜브 재진입(=이벤트 도착) → 19:05:01 VIDEO_ADVANCE near-end 즉시 복구
  //   이미 312줄 canObserveWatchEvidence 주석이 "currentForegroundPackage가 이벤트 유실로 낡으면
  //   유튜브에서도 영원히 안 갱신된다"고 이 고장을 예견해뒀는데, 정작 폴링 게이트는 안 고쳐져 있었다.
  //
  // → 이벤트가 낡으면 **창 목록으로 직접 확인**한다. bestTrackedWindow()를 그대로 재사용하므로
  //   PIP 제외(화면폭 80% 미만 컷) 규칙이 동일하게 걸린다 — 런처 위에 떠 있는 유튜브 PIP를
  //   "전경"으로 오인해 사용시간을 깎는 일은 없다(실측 로그: pipFlag=true w=357/1080).
  //   ⚠️ 창 목록 조회는 500ms마다 하면 비싸므로, 이벤트 값이 못 쓸 때만 2초에 한 번 확인한다.
  //   찾았으면 정본 필드도 같이 복구해 둔다(다음 폴링부터는 폴백 없이 바로 통과).
  private var lastFgProbeAtMs = 0L
  private var fgProbedPackage: String? = null
  // 같은 near-end 구간에서 반복 발사를 막기 위한 마지막 발사 시각(checkPlaybackAndMaybeSwipe 참고).
  private var lastNearEndFireAtMs = 0L
  private fun pollTargetPackage(): String? {
    val fromEvent = currentForegroundPackage
    if (SupportedApps.PACKAGES.contains(fromEvent)) return fromEvent
    val now = SystemClock.elapsedRealtime()
    if (now - lastFgProbeAtMs < FG_PROBE_INTERVAL_MS) return fgProbedPackage
    lastFgProbeAtMs = now
    fgProbedPackage = runCatching { bestTrackedWindow()?.root?.packageName?.toString() }.getOrNull()
    if (fgProbedPackage != null) {
      currentForegroundPackage = fgProbedPackage
      currentForegroundPackageAtMs = now
      Log.i("PaceAccessibility", "포그라운드 이벤트 유실 복구 — 창 목록에서 $fgProbedPackage 확인, 폴링 재개")
    }
    return fgProbedPackage
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
    // 2026-08-12 — 진행바(RangeInfo) 기반 판정 임계값. 위 checkPlaybackAndMaybeSwipe 주석 참고.
    // 예측 발사 리드타임 — 남은 시간이 이 값 이하가 되면 넘긴다(접근성 갱신 지연 ~2.5초를 감안).
    // 플링 인식 임계를 넉넉히 넘기는 스트로크 시간 — performSwipeUp 주석 참고.
    // 진행바가 없는 영상(틱톡 짧은 클립)에서만 쓰는 시간 기반 폴백 간격.
    private const val NO_PROGRESSBAR_ADVANCE_MS = 20_000L
    // 포그라운드 이벤트가 낡았을 때 창 목록을 직접 확인하는 간격(pollTargetPackage 주석 참고).
    private const val FG_PROBE_INTERVAL_MS = 2_000L
    // 같은 near-end 구간에서 재발사를 막는 최소 간격(위 nearEndSuppressed 주석 참고).
    // 스와이프가 실제로 먹혀 다음 영상이 붙고 접근성 트리가 갱신되기까지 실측 ~2.5초가 걸리므로
    // 그보다 넉넉히 잡는다 — 이보다 짧으면 "안 먹힌 것"과 "아직 반영이 안 된 것"을 구분 못 한다.
    private const val NEAR_END_REFIRE_GAP_MS = 4_000L
    private const val SWIPE_FLING_MS = 120L
    // 한 영상에 머물 수 있는 최대 시간. 넘으면 진행률과 무관하게 넘긴다(위 over-stay 주석 참고).
    // 90초 — 일반 숏폼(15~60초)은 절대 중간에 안 끊기고 비정상적으로 긴 것만 잘린다.
    private const val MAX_SINGLE_VIDEO_MS = 90_000L
    private const val NEAR_END_LEAD_MS = 2_500L
    private const val NEAR_END_FRAC = 0.95f
    private const val LOOP_BACK_FRAC_DROP = 0.3f
    // 물리 볼륨 버튼 1회 입력의 반복 ACTION_DOWN을 하나로 묶는 불응 구간(onKeyEvent 참고).
    private const val VOLUME_KEY_DEBOUNCE_MS = 500L
    // 2026-08-02 — "우리가 방금 스와이프한 결과"와 "사용자가 직접 손으로 넘긴 것"을 가르는 최소 간격.
    // 우리 스와이프 직후의 재생위치 하락(loopedBack)까지 사용자 활동으로 오인하면 수면감지가 영원히
    // 리셋돼 무력화되므로, 우리 스와이프로부터 이 시간이 지난 뒤의 전환만 사용자 조작으로 인정한다.
    private const val MANUAL_SWIPE_MIN_GAP_MS = 3000L
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

    // 2026-08-02 실기기 근본원인 — isEnabled()는 "시스템 설정 목록에 등록돼 있나"만 본다. 그런데
    // 앱 프로세스가 죽으면(당일 확인된 MediaPipe SIGSEGV, 또는 향후 OOM/다른 크래시) 같은 프로세스에
    // 있는 이 서비스도 함께 죽고, 시스템은 이를 "Crashed services"로 표시한 채 다시 바인딩해주지
    // 않는다 — 그런데도 Settings.Secure 문자열에는 그대로 남아 있어 isEnabled()는 계속 true를 반환한다.
    // 그 결과 손짓·볼륨키·자동넘김이 전부 죽은 상태인데 앱은 "권한 정상"으로 판단해 경고 배너조차
    // 띄우지 않았고(사용자 지적 "손짓 토글되어 있는데 하나도 안 되"), 사용자는 원인을 알 방법이 없었다.
    // 실제로 살아 있는지는 onServiceConnected에서 세팅되는 instance로만 알 수 있다.
    //
    // ⚠️ 이 함수는 "지금 이 순간 붙어 있나"라는 **엄격한** 질문이다. 실제로 제스처를 쏘거나 창을
    // 조회해야 하는 내부 코드는 이 값을 써야 한다. 반대로 사용자에게 "권한이 없다"고 말하거나
    // 기능을 막을지 판단할 때는 아래 isAliveOrRebinding()을 써야 한다(그 주석 참고).
    /**
     * 🔴 2026-08-13 사장님 지적("블루투스 연결돼 있는데 집중에서 파란불이 안 들어온다, 동작도 하는데") —
     * getBluetoothState()가 **오디오 기기(A2DP/SCO)만** 보고 있었다. 리모컨/셔터는 HID 입력기기라
     * 오디오 목록에 영원히 안 잡힌다 — 그래서 실제로 눌러서 넘어가는데도 "연결 안 됨"이었다.
     * 어댑터를 직접 조회하려면 Android 12+에서 BLUETOOTH_CONNECT 런타임 권한이 필요해
     * 권한 프롬프트가 새로 생긴다. 대신 **이미 갖고 있는 증거**를 쓴다: 리모컨이 실제로 키를
     * 보낸 적이 있으면 그건 연결됐다는 가장 확실한 신호다(추정이 아니라 관측이다).
     */
    fun lastRemoteKeyAtMs(): Long = instance?.lastVolumeKeySwipeAtMs ?: 0L

    fun isAlive(): Boolean {
      if (instance == null) return false
      lastAliveAtMs = System.currentTimeMillis()
      return true
    }

    // 마지막으로 "살아 있음"이 확인된 시각. isAlive()가 true를 반환할 때마다 갱신된다 —
    // 알약 배지 갱신(applyAutoBadgeStyle)이 1초마다 이 경로를 타므로 서비스가 붙어 있는 동안은
    // 계속 최신값이 된다. onDestroy에서도 한 번 찍어 "방금 전까지는 살아 있었다"를 남긴다.
    @Volatile private var lastAliveAtMs = 0L

    // 2026-08-04 사장님 실기기 지적("권한 설정되어 있는데 블루투스 켜려고 하면 권한 설정하라고 설정으로
    // 가고, 이미 켜져 있어서 안 켜짐") — 접근성 서비스는 **정상 상황에서도 끊겼다 붙는다**(앱 업데이트,
    // 설정 재적용, OEM의 a11y 상태 갱신 등). 실기기에서 삼성(com.samsung.accessibility)이 설정을
    // 반복 재적용하며 4~7초마다 언바인드/리바인드하는 것을 확인했다(dumpsys accessibility →
    // Bound services:{} 인데 Enabled services에는 우리 서비스가 그대로, Crashed services는 비어 있음).
    // 그런데 권한 판정이 isAlive() 하나에 걸려 있어서, 그 짧은 공백에 걸리면:
    //   - 블루투스/손짓 토글이 "권한 없음"으로 막히고 사용자를 접근성 설정 화면으로 끌고 간다
    //     (가보면 이미 켜져 있어서 사용자는 할 수 있는 게 없다 — 무한 반복)
    //   - 알약 배지가 "권한 필요"로 깜빡인다
    // 재바인딩 공백을 고장으로 단정하지 않는다: 마지막으로 살아 있던 시각이 유예시간 안이면 정상으로
    // 본다. 이 체크를 넣은 원래 목적(프로세스가 죽어 서비스가 영영 안 붙는데 설정 문자열만 남은 상태를
    // 잡아내는 것)은 그대로 지켜진다 — 진짜로 죽었으면 유예시간이 지나는 순간 정확히 고장으로 잡힌다.
    private const val REBIND_GRACE_MS = 30_000L

    fun isAliveOrRebinding(): Boolean {
      if (isAlive()) return true
      // 한 번도 붙은 적이 없으면(=사용자가 애초에 안 켰다) 유예를 주지 않는다.
      if (lastAliveAtMs == 0L) return false
      return System.currentTimeMillis() - lastAliveAtMs < REBIND_GRACE_MS
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
      if (!service.isWatching) {
        service.isWatching = true
        service.lastKnownCurrentSec = -1
        service.lastSwipeAtMs = SystemClock.elapsedRealtime()
        service.ensurePollingScheduled()
        Log.d("PaceAccessibility", "startWatching() -> polling started (intervalMs=$intervalMs, 안전 타임아웃 폴백은 2026-08-03에 삭제돼 더 이상 쓰이지 않음)")
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

    /**
     * 🔴 2026-08-12 실기기(틱톡) — "이 앱에서 사용자가 깨어있다는 증거를 우리가 관측할 수 있는가".
     *
     * 수면감지의 무입력 시계(lastUserInputAtMs)를 리셋하는 경로는 사실상 세 개뿐이다:
     *   ① 손짓/핑거스냅  ② BT 리모컨 물리버튼  ③ loopedBack + totalSec 변화(= 손으로 직접 넘김)
     * 폰을 책상에 두고 손가락으로 넘겨 보는 **가장 흔한 사용 패턴**을 커버하는 건 ③뿐이고
     * (2026-08-02에 바로 이 오탐으로 고친 경로), ③은 재생위치 텍스트를 읽을 수 있어야 성립한다.
     *
     * 틱톡은 접근성 트리에 재생위치를 노출하지 않는다 → ③이 영원히 안 뜬다 → 사용자가 멀쩡히
     * 보고 있어도 무입력 시계가 10분을 채우고 5분 뒤 확정, 화면이 까맣게 덮인다.
     * 실측(2026-08-12): 08:01:19 SUSPECT noInputMs=628976 → 08:06:19 PROMPTED → 08:06:49 종료.
     *
     * 그래서 관측 불가 상태에서는 수면 확정을 **보류**한다. 잘못된 방향의 오차는
     * "자는 사람을 못 잡는 것"이어야지 "보고 있는 사람 화면을 끄는 것"이면 안 된다.
     */
    fun canObserveWatchEvidence(maxStaleMs: Long = 60_000L): Boolean {
      val service = instance ?: return false
      val at = service.lastTimingReadAtMs
      if (at != 0L && SystemClock.elapsedRealtime() - at <= maxStaleMs) return true
      // ⚠️ 신선도만 보면 안 된다 — 실기기 확인(2026-08-12 11:00): 재생위치 폴링은
      //   (isWatching || isTrackingPlayback) && 포그라운드가 감시 대상일 때만 돈다. FOCUS OFF이거나
      //   currentForegroundPackage가 이벤트 유실로 낡으면 유튜브에서도 이 값이 영원히 안 갱신돼
      //   observable=false → **수면감지가 통째로 죽는다**(오탐을 고치려다 기능을 없애는 셈).
      //   그래서 폴링과 무관하게 지금 직접 한 번 읽어본다. 이 함수는 SUSPECT 단계에서 1분에 한 번만
      //   불리므로 트리 탐색 비용을 매분 한 번 더 쓰는 정도다.
      return runCatching { service.readCachedOrSearchTiming() != null }.getOrDefault(false)
    }

    // null = 판단 불가(접근성 꺼짐/추적 미시작/아직 신호 한 번도 못 잡음) — 호출부는 이 경우 기존
    // 방식대로 항상 차감하는 쪽으로 안전하게 폴백해야 한다. true/false = 실제로 판단 가능한 경우의
    // 재생 여부(maxStaleMs 이내에 재생 위치가 실제로 늘어난 적이 있는지).
    fun isLikelyPlaying(maxStaleMs: Long = 5_000L): Boolean? {
      val service = instance ?: return null
      // 2026-08-01 — 감시 대상 앱 창이 지금 실제로 떠 있으면(PIP 포함) 재생시간 텍스트를 못 찾아도
      // (초소형 PIP 화면은 보통 그 텍스트 자체가 없음) "재생 중"으로 간주한다. 다른 판정보다 먼저
      // 체크 — 창이 화면에 떠 있다는 것 자체가 이미 강한 증거다.
      if (service.supportedAppWindowVisible()) return true
      // 🔴 2026-08-06 실측으로 확정 — 사장님 "다른 앱 보고 있는데 왜 '잠시 쉬어갈까요'가 계속 나와",
      //   "쇼츠를 안 보고 있는데도 시간이 흐르는 거야?". 실기기에서 포그라운드를 설정 앱으로 두고
      //   3분 20초를 관찰한 결과:
      //     supportedAppWindowVisible=false 210회   ← 창 게이트는 "유튜브 안 보임"을 정확히 알고 있었다
      //         (유튜브는 PIP w=357/1080로 정상 제외됨)
      //     tick remaining=2 → tick remaining=1     ← 그런데 시간은 그대로 깎였다
      //     "tick skipped decrement" 로그는 0줄
      //   즉 창 게이트가 false를 냈는데도 이 함수가 false를 반환하지 않았다.
      //   범인은 아래에 있던 currentForegroundPackage 검사였다. 그 필드는 TYPE_WINDOW_STATE_CHANGED
      //   **이벤트로만** 갱신되므로 낡을 수 있고(아래 2026-07-31 주석이 이미 그 취약성을 기록해뒀다),
      //   유튜브로 낡아 있으면 "지원 앱이 아님"에 안 걸려 그대로 통과 → 아래에서 null(판단 불가)을
      //   반환 → performTick의 "신호 없으면 안전하게 차감" 폴백에 걸려 매분 깎였다.
      //
      // → 창 조회(getWindows(), 이벤트가 아니라 "지금 이 순간"을 직접 묻는다)를 **양쪽 방향 모두**
      //   신뢰한다. 보이면 재생 중, 안 보이면 재생 중 아님. 이 신호를 긍정 판정에만 쓰고 부정 판정엔
      //   낡은 이벤트 필드를 쓰던 비대칭이 이 버그의 전부였다.
      //   (원래 있던 isTrackingPlayback/lastPlaybackAdvanceAtMs 기반 "일시정지 감지"는 위 264줄이
      //    먼저 true로 단락시키므로 감시 대상 앱이 떠 있는 동안엔 애초에 도달 불가능했다 —
      //    지우면서 잃는 동작이 없다. 재생위치 추적 자체는 videoAdvanceCount 통계용으로 계속 쓰인다.)
      // ⛔ 아래는 2026-08-06에 제거한 예전 판정이다(되살리지 말 것 — 위 실측이 그 이유):
      //   val fgPackage = service.currentForegroundPackage
      //   if (fgPackage != null && !SupportedApps.PACKAGES.contains(fgPackage)) return false
      //   if (!service.isTrackingPlayback) return null
      //   if (service.lastPlaybackAdvanceAtMs == 0L) return null
      //   return SystemClock.elapsedRealtime() - service.lastPlaybackAdvanceAtMs <= maxStaleMs
      // 2026-07-31에 두 번 고쳤던 자리인데(둘 다 currentForegroundPackage의 신선도를 어떻게 다룰지의
      // 문제였다), 근본 원인은 신선도 게이트가 아니라 **이벤트 기반 필드를 신뢰한 것 자체**였다.
      // getWindows()는 이벤트가 아니라 현재 상태를 직접 묻는 API라 이 문제가 구조적으로 없다.
      //
      // 🔴 2026-08-12 사장님 지시("틱톡 넣고 검증하라고") — 위 창 게이트만으로는 **틱톡에서 시간이
      //   한 번도 안 깎였다**. 실기기 로그:
      //     tick skipped decrement — playback not detected (paused/backgrounded)
      //     SLEEP CONFIRMED (timer) → SESSION END reason=sleep_detected
      //   틱톡은 접근성 트리에 창을 안 내주므로 supportedAppWindowVisible()이 **틱톡을 보고 있어도
      //   항상 false**다. 그래서 재생 감지가 죽고, 시간이 안 깎이고, 끝내 수면 감지가 세션을 끝냈다.
      //   → 창을 못 찾았을 때 **UsageStats에 지금 이 순간을 직접 물어본다.**
      //   ⚠️ 2026-08-06에 제거한 것은 `currentForegroundPackage`(**이벤트로만 갱신되는 낡은 필드**)이지
      //     UsageStats가 아니다. UsageStats는 getWindows()처럼 "지금"을 조회하는 API라 그 함정이 없다.
      //     그리고 감시 대상 앱이 아니면 여전히 false를 돌려주므로, "다른 앱 보는데 시간이 깎인다"는
      //     그때 그 버그는 그대로 막혀 있다.
      // 🔴 2026-08-13 밤 감사 — 여기서 getForegroundPackage()를 부르면 **커서를 전진시켜** 매초 도는
      //   정본 폴링(PaceOverlayService)이 그 사이의 앱 전환을 영영 못 본다. 이 경로는 "지금 뭐가
      //   앞이야?"만 알면 되므로 부작용 없는 peek을 쓴다(ForegroundAppWatcher.peekForegroundPackage
      //   주석 참고). 폴링이 죽어 값이 낡았으면 null이 와서 아래 false로 안전하게 떨어진다.
      val fg = runCatching { ForegroundAppWatcher.peekForegroundPackage() }.getOrNull()
      if (fg != null && SupportedApps.PACKAGES.contains(fg)) return true
      return false
    }

    // PaceOverlayService의 오버레이 알약 표시 여부 판정에 쓰는 직접 신호 노출(위 isLikelyPlaying과
    // 동일한 supportedAppWindowVisible() 재사용) — 접근성이 꺼져있으면(instance==null) false로 안전
    // 폴백, 기존 UsageStatsManager 기반 판정만 그대로 적용된다.
    fun isSupportedAppWindowVisible(): Boolean = instance?.supportedAppWindowVisible() ?: false

    // 위와 같지만 "접근성이 안 붙어 있어서 물어볼 수 없음"(null)과 "물어봤더니 없음"(false)을 구분한다.
    // 알약 표시 판정(PaceOverlayService.foregroundPollRunnable)이 이 구분을 필요로 한다 — 접근성이
    // 살아 있으면 이 신호 하나만 믿어야 하고(이벤트 신호는 낡아서 깜빡임을 만든다), 접근성이 꺼져
    // 있을 때만 예전 이벤트/UsageStats 기반 판정으로 폴백해야 하기 때문이다.
    fun supportedAppWindowVisibleOrNull(): Boolean? = instance?.supportedAppWindowVisible()

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
    // 2026-08-05 사장님 실기기 재현("Shorts with PACE를 눌러도 유튜브 앱 홈만 뜬다") — 시청 세션이
    // running이면 JS(home.tsx onSelectPlatform)가 **무조건** resumeThirdPartyApp으로 빠졌다. 그건
    // 런처 인텐트+REORDER_TO_FRONT라 "유튜브 태스크가 살아 있을 때 그 상태 그대로 복원"하는 용도인데,
    // 태스크가 이미 홈에 있거나 죽었으면 같은 인텐트가 새 태스크를 **홈 탭으로** 열어버린다. 그래서
    // 세션이 한 번 켜진 뒤로는 쇼츠 진입 코드(openShortsFeed)에 영영 도달하지 못했다 — "첫 영상이
    // 매번 같다"의 진짜 원인이기도 하다(시드를 뽑는 코드 자체가 실행되지 않았다).
    //
    // 재개가 옳은 경우는 딱 하나, 사용자가 PIP로 줄여둔 화면이 남아 있을 때다(2026-08-01 지시
    // "작아진 화면 다시 키워야지"). 그 창이 실제로 있는지만 읽어 호출부가 가르게 한다 — 추측 없음.
    // ⭐ PIP 창이 Pace로 전환한 뒤에도 windows 목록에 남는다는 건 이미 실기기로 확인된 사실이다
    //   (아래 supportedAppWindowVisible 주석 참고 — 거기선 그게 문제여서 제외했고, 여기선 그게 신호다).
    fun isPackageInPictureInPicture(packageName: String): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      val service = instance ?: return false
      return try {
        service.windows.any {
          it.isInPictureInPictureMode && it.root?.packageName?.toString() == packageName
        }
      } catch (e: Exception) {
        Log.w("PaceAccessibility", "isPackageInPictureInPicture 실패", e)
        false
      }
    }

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
    // 2026-08-01 사장님 지시("Add 누르면 리스트에 추가되면서 공유도 동시에 뜨게") — 공유시트가
    // 뜨는 동안(최대 8초) 사용자가 아무 반응 없이 기다리는 게 아니라, 접근성 트리에서 즉시 읽을 수
    // 있는 제목/채널로 먼저 "낙관적" 추가를 보여주고, 공유 결과(videoId/url)가 나오면 그 항목을
    // 갱신한다 — 콜백이 두 번 불린다: 1차(isFinal=false, videoId/url=null) 즉시, 2차(isFinal=true)
    // 공유 결과 도착 시. 공유 버튼 자체를 못 찾는 등 즉시 실패하는 경우엔 1차 없이 2차만 온다.
    /**
     * 2026-08-05 — 지금 화면에 보이는 영상의 (제목, 채널). 공유시트를 건드리지 않고 접근성 트리만 읽는다.
     * 안드로이드 즐겨찾기가 "클립보드에 복사된 링크 저장" 방식으로 바뀌면서, videoId는 클립보드에서 오고
     * 제목/채널만 여기서 채운다. 못 읽어도 저장은 진행된다(둘 다 null 가능).
     */
    fun readVisibleTitleChannel(): Pair<String?, String?>? {
      val service = instance ?: return null
      return try {
        val texts = mutableListOf<String>()
        service.collectContentDescriptions(service.trackedAppRootNode(), texts, depth = 0, budget = intArrayOf(400))
        val channelRaw = texts.firstOrNull { it.endsWith("채널로 이동") }
        val channel = channelRaw?.removeSuffix(" 채널로 이동")
        val title = texts.firstOrNull { candidate ->
          candidate.length > 8 &&
            candidate != channelRaw &&
            KNOWN_ACTION_KEYWORDS.none { candidate.contains(it) } &&
            !candidate.contains("구독합니다") &&
            extractYouTubeVideoId(candidate) == null
        }
        title to channel
      } catch (e: Exception) {
        Log.w("PaceAccessibility", "readVisibleTitleChannel 실패", e)
        null
      }
    }

    fun captureCurrentVideoInfo(callback: (title: String?, channel: String?, videoId: String?, url: String?, isFinal: Boolean) -> Unit) {
      val service = instance
      if (service == null) {
        callback(null, null, null, null, true)
        return
      }
      service.captureCurrentVideoInfoInternal(callback)
    }

    private const val CAPTURE_TIMEOUT_MS = 8000L
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

    // 2026-08-07 사장님 지시 — Favorite 리스트를 탭하면(Android) 그 리스트를 이어서 재생한다(iOS의
    // forcedListRef와 동일한 의도, PaceMenu→SavedVideoListOverlay 참고). Android는 실제 유튜브 앱을
    // 딥링크로 여는 구조라 iOS처럼 WebView 안에서 다음 영상을 대신 붙일 수 없다 — 대신 "지금 보이는
    // 영상이 바뀌었다"만 조용히 감지해서(readVisibleTitleChannel 재사용, 공유시트처럼 화면을 건드리지
    // 않음) 콜백을 부르고, 그 콜백(PaceOverlayService.showSavedFavoriteList)이 큐의 다음 videoId로
    // 새 딥링크를 직접 연다 — 전부 네이티브 안에서 끝난다(이 오버레이는 RN 브릿지가 살아있단 보장이
    // 없는 시점에도 떠야 해서 JS 이벤트 브릿지를 쓰지 않음). 설정 토글(favoriteAutoChain)이 꺼져
    // 있으면 이 watch 자체를 시작하지 않으므로 기존 단일 재생 동작에는 영향이 없다.
    private var chainWatchRunnable: Runnable? = null
    private var chainWatchLastTitle: String? = null
    private var chainWatchCallback: (() -> Unit)? = null
    private val chainWatchHandler = Handler(Looper.getMainLooper())
    private const val CHAIN_WATCH_INTERVAL_MS = 1500L
    // ⚠️ 2026-08-07 실기기 재현 — 콜백이 새 딥링크를 연 "직후"의 폴에서 아직 화면 전환이 덜 끝난
    // 과도기 제목을 그대로 기준(chainWatchLastTitle)으로 확정해버리면, 그 다음 폴이 "실제로 안정된
    // 새 영상 제목"을 또 다른 변화로 오인해 큐를 연달아 여러 칸 건너뛰었다(사용자가 스와이프 한
    // 번만 했는데 즐겨찾기 리스트가 통째로 순식간에 소진됨 — 위 startFavoriteChainWatch 최초 호출
    // 지연(PaceOverlayService.kt 1800ms)과 같은 종류의 버그가 "매 전환마다" 반복된 것). 콜백이
    // 발동한 뒤 일정 시간은 비교 자체를 쉬고, 그 유예가 끝난 첫 폴은 발동 없이 "기준만 다시 잡는"
    // 리싱크 폴로 처리해 항상 안정된 값과만 비교하게 한다.
    private var chainWatchGraceUntilMs = 0L
    private var chainWatchAwaitingResync = false
    private const val CHAIN_WATCH_SETTLE_MS = 1800L

    fun startFavoriteChainWatch(onTitleChanged: () -> Unit) {
      stopFavoriteChainWatch()
      chainWatchCallback = onTitleChanged
      chainWatchLastTitle = readVisibleTitleChannel()?.first
      chainWatchGraceUntilMs = 0L
      chainWatchAwaitingResync = false
      Log.i("PaceAccessibility", "CHAIN start baseline='$chainWatchLastTitle'")
      val runnable = object : Runnable {
        override fun run() {
          val now = SystemClock.elapsedRealtime()
          // 🔴 2026-08-10 실기기 logcat으로 확정(사장님 "광고가 뜨고 지나가버린다", 6회 시도 6회 재현,
          //   보상 0회) — 보상형 광고가 떠 있는 동안에도 이 폴링이 그대로 돌면서 광고 화면을
          //   "제목이 바뀐 유튜브"로 오인해 다음 쇼츠 딥링크를 열었다. 그러면 유튜브가 광고 위로
          //   올라오고 광고 태스크가 뒤로 밀려 finish된다 → 사용자는 광고를 못 보고 5분도 못 받는다.
          //     21:32:03.749 광고 표시 → 21:32:05.004 CHAIN fire → HOT chain advance → 광고 소멸
          //   광고 중에는 아무것도 판정하지 않고, 광고가 닫힌 뒤 화면이 안정되면(SETTLE) 그때
          //   "기준만 다시 잡는" 리싱크 폴로 복귀한다 — 돌아오자마자 한 칸 건너뛰는 것도 막힌다.
          if (PaceRewardedAdActivity.adShowing) {
            chainWatchGraceUntilMs = now + CHAIN_WATCH_SETTLE_MS
            chainWatchAwaitingResync = true
            chainWatchHandler.postDelayed(this, CHAIN_WATCH_INTERVAL_MS)
            return
          }
          if (now < chainWatchGraceUntilMs) {
            // 유예 구간 — 방금 연 딥링크가 아직 로드 중일 수 있어 지금 읽는 값은 못 믿는다.
            chainWatchHandler.postDelayed(this, CHAIN_WATCH_INTERVAL_MS)
            return
          }
          if (chainWatchAwaitingResync) {
            // 유예가 막 끝난 첫 폴 — 발동하지 않고 "지금 안정된 값"으로만 기준을 다시 잡는다.
            chainWatchLastTitle = readVisibleTitleChannel()?.first
            chainWatchAwaitingResync = false
            Log.i("PaceAccessibility", "CHAIN resync new baseline='$chainWatchLastTitle'")
            chainWatchHandler.postDelayed(this, CHAIN_WATCH_INTERVAL_MS)
            return
          }
          // 🔴 2026-08-10(2차) — 감시 대상 앱이 화면에 없으면 **아무 판정도 하지 않는다.**
          //   실기기에서 사용자가 홈 화면에 있는 동안 이어서재생이 발동해 유튜브를 다시 띄웠다
          //   (22:41:46 CHAIN fire → 22:41:48 usage=launcher). 이어서재생은 "보고 있던 목록을
          //   계속 이어서 본다"는 기능이지 **나간 사람을 끌고 들어오는** 기능이 아니다.
          //   위 trackedAppRootNode 폴백 수정만으로도 title=null이 되어 발동은 막히지만, 여기서
          //   명시적으로 끊고 리싱크로 넘겨야 돌아왔을 때 "그 사이 바뀐 제목"을 변화로 오인하지 않는다.
          if (!isSupportedAppWindowVisible()) {
            chainWatchAwaitingResync = true
            chainWatchHandler.postDelayed(this, CHAIN_WATCH_INTERVAL_MS)
            return
          }
          val title = readVisibleTitleChannel()?.first
          if (title != null && title != chainWatchLastTitle) {
            chainWatchLastTitle = title
            chainWatchGraceUntilMs = SystemClock.elapsedRealtime() + CHAIN_WATCH_SETTLE_MS
            chainWatchAwaitingResync = true
            Log.i("PaceAccessibility", "CHAIN fire callback")
            chainWatchCallback?.invoke()
          }
          // ⚠️ 2026-08-07 실기기 재현 — 큐 마지막 항목의 콜백이 이 run() 안에서 동기적으로
          // stopFavoriteChainWatch()를 부르면(favoriteChainQueue.isEmpty() 분기) chainWatchRunnable이
          // null로 비워지지만, 그 직후 무조건 실행되던 이 postDelayed가 'this'(=방금 stop된 바로 그
          // 러너블)를 다시 스스로 예약해버려 "정지"가 무력화되고 폴링이 영원히 되살아났다(콜백이
          // null이라 실제로 다음 영상을 열진 않지만, 접근성 트리를 1.5초마다 계속 읽는 낭비가 남음).
          // 이 인스턴스가 여전히 "현재 활성 러너블"일 때만 스스로 재예약한다.
          if (chainWatchRunnable === this) {
            chainWatchHandler.postDelayed(this, CHAIN_WATCH_INTERVAL_MS)
          }
        }
      }
      chainWatchRunnable = runnable
      chainWatchHandler.postDelayed(runnable, CHAIN_WATCH_INTERVAL_MS)
    }

    fun stopFavoriteChainWatch() {
      Log.i("PaceAccessibility", "CHAIN stop")
      chainWatchRunnable?.let { chainWatchHandler.removeCallbacks(it) }
      chainWatchRunnable = null
      chainWatchCallback = null
      chainWatchLastTitle = null
      chainWatchGraceUntilMs = 0L
      chainWatchAwaitingResync = false
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    Log.d("PaceAccessibility", "onServiceConnected — instance bound")
    // 세부 설정(canPerformGestures, packageNames, eventTypes)은 전부
    // res/xml/accessibility_service_config.xml에 선언 — 여기서 serviceInfo를 재조립하지 않는다.
    maybeReturnToPaceAfterAccessibilityGranted()
    resumeTrackingIfSessionAlive()
  }

  /**
   * 🔴 2026-08-13 사장님 지적("지금 자동재생도 안 되는데") — 실기기 로그가 원인을 그대로 보여줬다:
   *
   *   01:06:01 W startPlaybackTracking() called but instance is null — accessibility not bound yet
   *   01:06:01 W startWatching() called but instance is null — accessibility not bound yet, silently ignored
   *
   * 세션이 시작되는 순간 접근성 서비스가 **아직 안 붙어 있으면** 두 호출이 그냥 버려졌고, 그 뒤
   * 접근성이 붙어도 **아무도 다시 부르지 않아 폴링이 영영 안 돌았다**(RANGE_INFO 0줄 → 자동넘김
   * 완전 정지). 사용자 눈에는 원인이 안 보인다 — 알약도 멀쩡하고 시간도 깎이는데 넘어가지만 않는다.
   * 실사용에서 이 순서는 흔하다: 앱 업데이트 직후 첫 세션 / 프로세스가 죽었다 살아난 뒤 /
   * 접근성 재바인딩이 느린 기기.
   *
   * "조용히 무시"가 문제였다. 접근성이 붙는 이 시점에 **세션이 아직 살아 있으면 스스로 재개**한다.
   * 세션 여부·자동넘김 설정은 이미 prefs에 있으므로(네이티브가 진실원천) JS 왕복이 필요 없다.
   */
  private fun resumeTrackingIfSessionAlive() {
    val prefs = getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(PaceOverlayService.PREF_SESSION_ACTIVE, false)) return
    // 사용시간 정확도용 폴링은 자동넘김 여부와 무관하게 항상 켠다(startPlaybackTracking 주석 참고).
    startPlaybackTracking()
    // 45초는 다른 호출부(PaceOverlayService:1438/1636)와 같은 값 — 안전 타임아웃 폴백이 삭제된 뒤로
    // 이 값은 폴링 주기 로그에만 쓰인다.
    if (prefs.getBoolean(PaceOverlayService.PREF_AUTO_MODE, false)) startWatching(45_000L)
    Log.i("PaceAccessibility", "세션이 살아 있어 추적 재개 — 바인딩 전에 버려진 startWatching/startPlaybackTracking 복구")
  }

  // 2026-08-01 사용자 지시("설정하면 바로 PACE로 와야 한다고 말했을 텐데 계속 설정이잖아") — 위
  // PaceOverlayService.PREF_ACCESSIBILITY_REQUEST_AT_MS 선언부 참고. onServiceConnected는 재부팅/
  // 프로세스 재시작 등 사용자와 무관한 경우에도 불리므로, "우리가 방금 연 설정 화면에서 토글을
  // 막 켰다"고 볼 수 있는 좁은 시간창 안일 때만 자동 복귀시킨다. 소비형(1회) — 재사용 방지로 즉시 지운다.
  private fun maybeReturnToPaceAfterAccessibilityGranted() {
    val prefs = getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
    val requestedAtMs = prefs.getLong(PaceOverlayService.PREF_ACCESSIBILITY_REQUEST_AT_MS, 0L)
    if (requestedAtMs <= 0L) return
    prefs.edit().remove(PaceOverlayService.PREF_ACCESSIBILITY_REQUEST_AT_MS).apply()
    if (System.currentTimeMillis() - requestedAtMs > 3 * 60 * 1000L) return // 3분 지났으면 무관한 재연결로 간주
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("pace://home")).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      startActivity(intent)
    } catch (e: Exception) {
      Log.w("PaceAccessibility", "설정→Pace 자동 복귀 딥링크 실패, 기본 런치인텐트로 폴백", e)
      val fallback = packageManager.getLaunchIntentForPackage(packageName)
      fallback?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      fallback?.let { startActivity(it) }
    }
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
    // 2026-08-02 진단 — "블루투스 눌러도 볼륨만 조절됨"이 재현되는데 아래 어떤 로그도 안 찍혀서,
    // 이 콜백 자체가 호출되는지부터 확정해야 한다(호출은 되는데 게이트에서 걸리는 것인지 vs
    // OS가 애초에 이 콜백으로 볼륨키를 안 주는 것인지 — 대응이 완전히 달라짐).
    Log.i("PaceAccessibility", "onKeyEvent ENTRY keyCode=${event.keyCode} action=${event.action} deviceId=${event.deviceId} fg=$currentForegroundPackage winVisible=${supportedAppWindowVisible()} btSkip=$bluetoothVolumeKeySkipEnabled")
    if (event.keyCode != KeyEvent.KEYCODE_VOLUME_UP && event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
      return false
    }
    // 2026-07-27 사용자 지시 — 이 볼륨키 하이재킹은 카메라 제스처 Hands-Free(isWatching)와 별개의
    // 독립 토글이다(에어팟/블루투스 스피커를 순수 감상용으로만 쓰는 사용자를 위해 따로 끌 수 있어야
    // 함). isWatching 대신 bluetoothVolumeKeySkipEnabled로 게이팅 — 손짓/핑거스냅은 꺼둔 채 이것만
    // 켜두거나, 반대로 이것만 꺼둘 수 있다.
    // 2026-08-02 실기기 발견("블루투스 눌러도 볼륨만 조절됨") — 로그에 아래 device check 한 줄도 안
    // 찍혔다 = 여기서 매번 걸러지고 있었다. currentForegroundPackage는 TYPE_WINDOW_STATE_CHANGED
    // (화면 전환 이벤트)로만 갱신되는데, YouTube Shorts는 영상이 바뀌어도 같은 Activity 안에서
    // 콘텐츠만 바뀌지 화면 전환 자체가 없어서 이 값이 오래 갱신 안 되거나 null로 남는다 — 오버레이가
    // 사라지던 것과 완전히 같은 원인(PaceOverlayService.foregroundPollRunnable 주석 참고).
    // 그쪽은 이미 isSupportedAppWindowVisible()(getWindows() 기반, 이벤트가 아니라 "지금 이 순간"을
    // 직접 조회)로 보강했는데 이 볼륨키 경로만 낡은 신호를 그대로 쓰고 있었다. 동일하게 보강한다.
    if (!bluetoothVolumeKeySkipEnabled) return false
    if (!SupportedApps.PACKAGES.contains(currentForegroundPackage) && !supportedAppWindowVisible()) {
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
    // 2026-08-05 사장님 지시("에어팟 켜면 핸즈프리 블루투스가 켜져 있어도 에어팟으로 볼륨 조절되게")
    // — 맥 세션이 iOS에 넣은 "리모컨 입력 vs 이어폰 볼륨 입력" 구분을 Android에도 맞춘다.
    //
    // 위까지의 조건(isExternal + vendorId/productId)은 "외부 기기에서 온 신호인가"만 가른다. 그래서
    // 에어팟/버즈처럼 **소리를 듣는 기기**의 볼륨 조작까지 전부 넘김으로 삼켜, 이어폰을 끼고 있으면
    // 음량을 아예 못 바꿨다. 리모컨(다이소 BT 셔터 등)은 오디오를 스트리밍하지 않는 순수 HID 입력
    // 장치이고, 에어팟/버즈는 A2DP/SCO로 실제 오디오가 나가는 출력 장치다 — 이 차이로 가른다.
    //
    // 블루투스 오디오 출력이 연결돼 있으면 = 사용자가 그걸로 소리를 듣고 있다는 뜻이므로 볼륨키는
    // 볼륨 그대로 두고 통과시킨다(그때 넘김은 손짓/직접 스와이프로 하면 된다). 리모컨만 연결된
    // 경우에는 예전처럼 넘김 신호로 쓴다.
    // ⚠️ 이 판정은 "지금 이 순간" 오디오 기기가 붙어 있는지를 본다 — 이어폰을 빼면 곧바로 다시
    // 리모컨 모드로 돌아간다(연결 상태를 캐시하지 않는 이유).
    if (isBluetoothAudioOutputConnected()) {
      Log.i("PaceAccessibility", "volume-key passthrough — BT 오디오 기기 연결됨(에어팟/버즈 등), 볼륨 조절 우선")
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
    // 🔴 2026-08-13 — 리모컨 "연결됨" 표시의 근거(PaceOverlayModule.getBluetoothState 주석 참고).
    //   메모리에만 두면 접근성 서비스가 재시작될 때(앱 업데이트/프로세스 재시작) 사라져서, 실제로는
    //   계속 연결돼 있는데 점이 회색으로 돌아간다 — prefs에 남겨 재시작을 견디게 한다.
    //   벽시계(System.currentTimeMillis)를 쓴다: elapsedRealtime은 재부팅 시 0으로 돌아가 비교가 깨진다.
    runCatching {
      getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putLong(PaceOverlayService.PREF_LAST_REMOTE_KEY_AT, System.currentTimeMillis()).apply()
    }
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

  // 2026-08-05 — 블루투스 "오디오 출력"이 지금 연결돼 있는지. 에어팟/버즈/BT 스피커는 A2DP(음악) 또는
  // SCO(통화)로 잡히고, 순수 리모컨(HID)은 오디오 출력이 아니라 여기 안 잡힌다 — 이 차이가 곧
  // "소리를 듣는 기기 vs 조작만 하는 기기"의 구분이다(위 onKeyEvent 주석 참고).
  // BLUETOOTH_CONNECT 런타임 권한이 필요한 건 BluetoothAdapter 쪽 API이고, AudioManager로 출력
  // 라우팅만 보는 이 경로는 별도 권한 없이 동작한다(PaceOverlayModule의 같은 헬퍼와 동일한 방식).
  private fun isBluetoothAudioOutputConnected(): Boolean {
    return try {
      val audioManager = getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return false
      audioManager.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
          it.type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
      }
    } catch (e: Exception) {
      // 조회 실패 시 false — 예전 동작(넘김)을 유지해 리모컨 사용자가 갑자기 못 넘기게 되는 회귀를 막는다.
      Log.w("PaceAccessibility", "isBluetoothAudioOutputConnected 실패", e)
      false
    }
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    isWatching = false
    isTrackingPlayback = false
    pollingScheduled = false
    handler.removeCallbacks(pollRunnable)
    stopFavoriteChainWatch() // 서비스가 죽는데 watch만 계속 도는 걸 방지
    // 죽는 시각을 남긴다 — 재바인딩 유예(isAliveOrRebinding)의 기준점이 된다.
    if (instance === this) { lastAliveAtMs = System.currentTimeMillis(); instance = null }
    super.onDestroy()
  }

  // Tier 1(실제 재생 위치) → 못 찾으면 Tier 2(안전 타임아웃) 순서로 스와이프 여부를 판단한다.
  // 2026-07-19: 사용자가 "실제로 Tier 1이 발동하는지 Tier 2(타임아웃)만 도는 건 아닌지" 직접
  // 확인을 요청 — 매 스와이프마다 어느 조건으로 발동했는지 logcat에 남긴다(adb logcat -s
  // PaceAccessibility로 필터링).
  private fun checkPlaybackAndMaybeSwipe() {
    val now = SystemClock.elapsedRealtime()
    // 🔴 2026-08-13 사장님 지적("쇼츠를 보다 포커스 때문에 광고를 보고 오면 보던 쇼츠가 다 안 끝나고
    //   넘어가버리는 것 같은데") — 맞다. 이 함수의 시간 기반 판정은 전부 **경과 시간**을 보는데
    //   (진행바 없는 영상의 20초 폴백, 한 영상 90초 상한), 광고를 보는 30초~1분 동안에도 그 시계가
    //   계속 흘렀다. 그래서 광고를 닫고 돌아오면 **이미 임계를 넘긴 상태**라 복귀 즉시 스와이프했다 —
    //   보던 영상이 중간에 잘린 것처럼 보인다.
    //   → 광고가 떠 있는 동안은 판정 자체를 건너뛰고, 광고가 닫힌 직후 한 번 시계를 지금으로 리셋한다.
    //     (chain 워처는 2026-08-10에 이미 같은 이유로 adShowing을 보고 있다 — 같은 규칙을 여기에도 맞춘다.)
    if (PaceRewardedAdActivity.adShowing) {
      adWasShowing = true
      return
    }
    if (adWasShowing) {
      adWasShowing = false
      lastSwipeAtMs = now      // 20초 폴백이 광고 시간을 세지 않게
      videoStartedAtMs = now   // 90초 상한도 광고 시간을 세지 않게
      lastFracAtMs = now       // 길이 추정도 광고 구간을 빼고 다시 잡게
      Log.i("PaceAccessibility", "광고 복귀 — 자동넘김 시계 리셋(광고 보는 동안 흐른 시간은 시청으로 안 센다)")
    }
    val timing = readCachedOrSearchTiming()
    if (timing != null) {
      val (currentSec, totalSec) = timing
      // 관측 가능성 도장 — 위 lastTimingReadAtMs 주석 참고(수면감지 게이트가 이 신선도를 본다).
      lastTimingReadAtMs = now
      // 2026-08-02 출시 전 정리 — 여기 있던 "timing current=Xs total=Ys" 로그 제거. 재생위치 폴링이
      // 500ms마다 도는데 매 폴마다 찍혀서(시간당 7,200줄) logcat 링버퍼를 채우고, 정작 필요한
      // VIDEO_ADVANCE/스와이프/onKeyEvent 로그를 밀어내 실기기 디버깅을 반복적으로 방해했다.
      // 판정에 진짜 필요한 이벤트(VIDEO_ADVANCE, tier2 타임아웃)는 아래에서 계속 로깅한다.
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
      // 🔴 2026-08-13 밤 출시 검증에서 발견 — nearEnd 분기에는 **최소 간격 가드가 없었다.**
      //   nearEnd는 lastKnownCurrentSec과 무관하게 currentSec/totalSec만 보고 계산되는데, 아래에서
      //   lastKnownCurrentSec = -1로 리셋하고 return하므로 **다음 폴링(500ms 뒤)에도 그대로 참**이다.
      //   영상이 끝자락에 머물러 있는 동안(일시정지, 스와이프가 안 먹힘, 유튜브가 같은 자리에서 멈춤)
      //   0.5초마다 무한히 재발사된다. 실측: 같은 영상 65s/66s에서 count가 1→2→3으로 연속 증가,
      //   방치하니 287까지 올라갔다.
      //   · isWatching=true였다면 그건 **0.5초 간격 연속 스와이프**다 — 사장님이 예전에 신고하신
      //     "두 번씩 넘어감"과 같은 증상이 스와이프가 한 번 안 먹힐 때마다 재현된다.
      //   · isWatching=false여도 videoAdvanceCount가 부풀어 viewing_sessions.videos_watched에
      //     거짓 숫자가 기록된다(화면에는 안 나오지만 서버로 동기화된다).
      //   loopedBack에는 이미 MANUAL_SWIPE_MIN_GAP_MS 가드가 있는데(아래) nearEnd만 빠져 있었다.
      // → 같은 near-end 구간에서 한 번만 반응한다. 재생 위치가 실제로 뒤로 돌아가면(=영상이 바뀌면)
      //   아래 loopedBack 경로에서 해제되고, 못 잡고 지나가도 이 간격이 지나면 다시 열린다.
      val nearEndSuppressed = nearEnd && now - lastNearEndFireAtMs < NEAR_END_REFIRE_GAP_MS
      if (nearEndSuppressed) {
        lastKnownCurrentSec = currentSec
        return
      }
      if (nearEnd) lastNearEndFireAtMs = now
      if (nearEnd || loopedBack) {
        videoAdvanceCount++
        Log.d("PaceAccessibility", "VIDEO_ADVANCE reason=${if (nearEnd) "near-end" else "looped-back"} current=${currentSec}s total=${totalSec}s count=$videoAdvanceCount isWatching=$isWatching")
        // 2026-08-02 실기기 발견("3초 정도에 넘어갔다고 다 끝나기 전에") — loopedBack은 "영상이 이미
        // 바뀌었다"(자동넘김이 스와이프했든, 사용자가 직접 손으로 넘겼든)는 뒤늦은 확인 신호일 뿐이지,
        // "지금 스와이프해야 한다"는 신호가 아니다. 그런데도 예전엔 nearEnd와 똑같이 performSwipeUp()을
        // 또 호출해서 — 사용자가 직접 스와이프해 새 영상(재생 위치 0~수 초)에 막 도착한 순간 그 위치
        // 하락을 "루프백"으로 오인해 곧바로 한 번 더 스와이프, 방금 도착한 영상을 보기도 전에
        // 넘겨버렸다(2026-07-24 손짓 재무장 강화로 고친 "두 번씩 넘어감"과 겉증상은 같지만 원인은
        // 손짓이 아니라 이 폴링 로직 자체였음). nearEnd일 때만(Pace가 스스로 "곧 끝난다"고 판단해
        // 능동적으로 넘겨야 하는 유일한 경우) 실제로 스와이프한다 — loopedBack은 카운트/상태 갱신만.
        if (nearEnd && isWatching) {
          performSwipeUp()
          lastSwipeAtMs = now
        } else if (loopedBack && now - lastSwipeAtMs > MANUAL_SWIPE_MIN_GAP_MS && totalSec != lastAdvanceTotalSec) {
          // 2026-08-04 실기기 검증 중 발견 — 여기에 **제3의 주체**가 있었다: 유튜브가 스스로 같은
          // 영상을 무한 반복하는 경우다. 그때도 재생 위치가 0으로 떨어져 loopedBack이 뜨는데, 예전
          // 조건("우리가 방금 스와이프한 게 아니면 사용자가 넘긴 것")은 그걸 전부 "사용자가 직접
          // 넘김"으로 오인했다. 그 결과 새 수면감지의 무입력 시계가 22초마다 리셋돼 수면 판정이
          // 영원히 나지 않았다(실측 로그: noInputMs 118272 → 80658로 되돌아감).
          //   23:36:02 looped-back total=22s / 23:36:25 total=22s / 23:36:47 total=22s  ← 같은 영상
          // 하필 "자동넘김 OFF + 무한 루프"가 수면감지가 반드시 커버해야 하는 시나리오라 치명적이었다.
          //
          // 구분 기준은 **영상 길이(totalSec)**다 — 같은 영상이 반복되면 그대로고, 사용자가 다음
          // 영상으로 넘기면 대개 달라진다. 완벽한 식별자는 아니지만(길이가 같은 다른 영상이 연달아
          // 올 수 있음) 그 경우는 "사용자 입력으로 한 번 더 인정"하는 안전한 방향의 오차라, 자던
          // 사람을 깨우지 않는다.
          // 2026-08-02 실기기 근본원인("오버레이가 자꾸 사라짐" — prefs에 expire_reason=sleep_detected,
          // expired=true로 확인). 수면감지는 가속도계(폰의 물리적 움직임)만 보고, 깨어있음 증거로는
          // markUserActivity()(손짓/핑거스냅/BT 리모컨 경로)만 인정했다. 그런데 폰을 거치대나 책상에
          // 두고 손가락으로 직접 스와이프하며 보는 가장 흔한 사용 패턴에서는 폰이 전혀 안 움직이고
          // 핸즈프리 트리거도 안 타므로, 사용자가 멀쩡히 보고 있는데도 무진동 임계값이 차서 세션이
          // 수면으로 종료돼 버렸다(오늘 밤 오버레이가 반복해서 사라진 원인). 우리가 스와이프한 직후가
          // 아닌데 영상이 바뀌었다 = 사용자가 직접 손으로 넘긴 것 = 확실한 "깨어있음" 증거이므로
          // 무진동 시계를 리셋한다.
          PaceOverlayService.markUserActivity()
        }
        // 다음 loopedBack에서 "같은 영상 반복인지"를 비교할 기준. nearEnd(우리가 넘긴 경우)에도
        // 갱신해야, 우리가 넘긴 직후의 첫 loopedBack이 길이 비교로 잘못 걸리지 않는다.
        lastAdvanceTotalSec = totalSec
        lastKnownCurrentSec = -1
        return
      }
      lastKnownCurrentSec = currentSec
    } else {
      // 🔴 2026-08-12 — 재생위치 텍스트가 없는 앱(틱톡). 시간 문자열 말고 남은 두 경로를 여기서 쓴다.
      //   ① RangeInfo(진행바 상태값) — 있으면 유튜브와 동일하게 nearEnd 판정까지 갈 수 있다.
      //   ② 영상 지문(설명·작성자·사운드) 변화 — 길이는 못 얻지만 "영상이 바뀌었다"는 알 수 있어,
      //      2026-08-02에 세운 '손으로 넘김 = 깨어있음 증거' 규칙을 틱톡에서도 성립시킨다.
      val root = trackedAppRootNode()
      val rangeBudget = intArrayOf(3000)
      val frac = findProgressRange(root, budget = rangeBudget)
      // 진단 로그 — "진행바가 없다"와 "예산이 모자라 못 찾았다"를 구분하기 위해 방문 노드 수를 남긴다.
      if (frac == null && now - lastRangeProbeLogAtMs > 5_000L) {
        lastRangeProbeLogAtMs = now
        Log.d("PaceAccessibility", "RANGE_INFO none — visited=${3000 - rangeBudget[0]} rootPkg=${root?.packageName}")
      }
      // 🔴 2026-08-12 3차 실기기 — 틱톡은 **일부 영상에만 진행바를 그린다.** 짧은 영상(수달 클립)은
      //   SeekBar가 vis=false로만 존재해(490회 연속) 진행 신호가 아예 없고, 그대로 두면 같은 영상이
      //   영원히 루프한다(실측 5분). 진행바가 있는 영상은 위 예측 발사로 정확히 넘기고, 없는
      //   영상에만 시간 기반으로 넘긴다 — 진행바가 없는 건 대체로 짧은 영상이라 이 간격이면
      //   최소 한 번은 다 보고 넘어간다.
      // 🔴 2026-08-13 실기기 발견 — **`root == null`일 때도 발사하고 있었다.** root가 null이라는 건
      //   "감시 대상 앱의 창을 아예 못 찾았다" = 지금 그 앱이 화면에 없다는 뜻인데, 그 상태에서
      //   20초마다 화면 전체에 스와이프를 쐈다.
      //   실측: 유튜브에서 빠져나와 **Pace 홈 화면에 있는 동안** `AUTO_NEXT reason=no-progressbar`가
      //   20초 간격으로 4회 연속 찍혔고(`RANGE_INFO none — visited=0 rootPkg=null`과 같은 시각),
      //   사용자 입장에선 가만히 있는데 화면이 20초마다 제멋대로 스크롤된다.
      //   `frac == null`은 "진행바가 없는 영상"과 "앱이 아예 없음"을 구분하지 못한다 — 폴백을 만든
      //   의도는 전자(짧은 틱톡 영상)뿐이었다.
      // → 대상 앱 창을 실제로 찾았을 때만(root != null) 폴백을 쏜다.
      //   ⚠️ F10("대상 앱 밖에서는 자동넘김 안 함")이 문서엔 ✅였는데 실제로는 이 경로로 뚫려 있었다.
      // 🔴 2026-08-13 출시 전 실기기 검증에서 발견 — **유튜브에서도 이 폴백이 발사되고 있었다.**
      //   실측: 세션 시작 후 유튜브 진입 20초 시점에
      //     RANGE_INFO none — rootPkg=com.google.android.youtube
      //     AUTO_NEXT reason=no-progressbar elapsed=20073ms
      //     VIDEO_ADVANCE looped-back total=179s   ← 잘린 건 3분짜리 영상이었다
      //   이 else 분기는 "재생위치 텍스트를 못 읽었다"는 뜻인데, 유튜브에서 그건 **앱이 그 순간
      //   컨트롤을 안 그리고 있다**는 일시적 상태일 뿐이지 "진행바가 없는 짧은 클립"이 아니다.
      //   아래 1050~1062줄이 적어둔 대로, 바로 그 이유로 2026-08-03에 Tier 2(45초 강제 스와이프)를
      //   삭제했다("foundTiming=false가 상시로 나와 사장님이 보고 계신 영상을 중간에 끊었다").
      //   틱톡용으로 넣은 이 20초 폴백이 그걸 더 짧은 주기로 되살린 셈이다.
      //   ⚠️ 그렇다고 유튜브에서 폴백을 통째로 빼면 **반대쪽으로 부러진다** — 같은 날 실측에서
      //     폴백을 제거하자 `RANGE_INFO none`이 4분간 52회 찍히는 동안(진행 신호가 아예 없는
      //     쇼츠였다) 자동넘김이 한 번도 안 걸렸다. 그건 사장님이 신고하신 "포커스 온인데 계속 같은
      //     영상이 나와"와 정확히 같은 상태다.
      // → 폴백은 유지하되 **간격을 앱별로 나눈다.** 유튜브는 timing 경로가 정상 동작하는 앱이라
      //   "못 읽는 구간"은 대개 일시적이므로, 이미 승인된 한 영상 체류 상한(90초)을 그대로 쓴다 —
      //   일반적인 쇼츠(15~60초)는 절대 중간에 안 끊기고, 진행 신호를 90초째까지 못 읽는
      //   비정상 상태에서만 넘어간다. 틱톡은 애초에 재생위치 텍스트 경로가 없어 20초 그대로 둔다
      //   (진행바 없는 틱톡 클립은 짧다는 게 2026-08-12 실측 전제).
      val hasTimingTextPath = root?.packageName?.toString() == "com.google.android.youtube"
      val fallbackIntervalMs = if (hasTimingTextPath) MAX_SINGLE_VIDEO_MS else NO_PROGRESSBAR_ADVANCE_MS
      if (frac == null && root != null && isWatching && lastKnownFrac < 0f &&
          now - lastSwipeAtMs > fallbackIntervalMs) {
        Log.d("PaceAccessibility", "AUTO_NEXT reason=no-progressbar elapsed=${now - lastSwipeAtMs}ms pkg=${root.packageName}")
        performSwipeUp()
        lastSwipeAtMs = now
      }
      // 진행바가 있는 영상에서 없는 영상으로 넘어갔을 때 예전 값이 남아 폴백을 막지 않도록 초기화.
      if (frac == null) lastKnownFrac = -1f
      if (frac != null) {
        // 진행바가 실제로 있다 = 관측 가능. 수면감지 게이트가 이 시각을 본다.
        lastTimingReadAtMs = now
        // over-stay 상한의 기준점. 첫 관측에서 잡아둬야 **세션의 첫 영상이 긴 경우에도** 상한이
        // 걸린다(이걸 안 잡으면 한 번 넘어간 뒤에야 상한이 작동해서, 사장님이 겪은 "첫 영상이
        // 2분이라 세션 내내 그것만" 상황을 그대로 놓친다).
        if (videoStartedAtMs == 0L) videoStartedAtMs = now
        // 🔴 2026-08-12 사장님 지시로 찾아낸 경로 — 틱톡 SeekBar(max=10000)가 재생 진행을 그대로
        //   노출한다(실측 frac 0.724 → 0.787). 유튜브의 currentSec/totalSec 자리에 이 값을 넣으면
        //   nearEnd/looped-back 판정이 그대로 성립한다.
        //   ⚠️ 접근성 노드 갱신이 폴링(500ms)보다 느려 실측상 ~2.5초 간격으로 값이 튄다. 임계값을
        //     0.99처럼 빡빡하게 잡으면 짧은 영상에서 갱신 한 번을 통째로 건너뛰어 놓친다.
        val prev = lastKnownFrac
        if (prev >= 0f && frac < prev - LOOP_BACK_FRAC_DROP) {
          // 진행률이 확 떨어졌다 = 영상이 끝나 반복됐거나 사용자가 넘겼다.
          videoAdvanceCount++
          if (now - lastSwipeAtMs > MANUAL_SWIPE_MIN_GAP_MS) {
            Log.d("PaceAccessibility", "VIDEO_ADVANCE reason=frac-loop prev=$prev now=$frac count=$videoAdvanceCount")
            PaceOverlayService.markUserActivity()
          }
          estimatedDurationMs = -1L // 새 영상 — 길이 추정을 처음부터 다시 한다
          videoStartedAtMs = now  // over-stay 상한도 새 영상 기준으로 리셋
        } else if (prev >= 0f && frac > prev) {
          // 🔴 2026-08-12 실측 — 임계값(frac >= 0.95)만으로는 못 잡는다. 접근성 노드 갱신이 폴링보다
          //   느려(~2.5초) 마지막 샘플이 0.9472였고 다음 샘플은 이미 0.0076(루프 후)이었다.
          //   그래서 **진행률 증가 속도로 영상 길이를 역산**해, 남은 시간이 임박하면 미리 넘긴다.
          //     길이 ≈ 경과시간 / 진행률증가분,  남은시간 ≈ (1 - 진행률) × 길이
          val dtMs = now - lastFracAtMs
          if (lastFracAtMs > 0L && dtMs > 0L) {
            val est = (dtMs / (frac - prev)).toLong()
            // 이상치 방어 — 숏폼 길이 범위(3초~10분) 밖 추정은 버린다.
            if (est in 3_000L..600_000L) {
              estimatedDurationMs = if (estimatedDurationMs <= 0L) est else (estimatedDurationMs * 2 + est) / 3
            }
          }
          val remainMs = if (estimatedDurationMs > 0L) ((1f - frac) * estimatedDurationMs).toLong() else Long.MAX_VALUE
          // 🔴 2026-08-13 사장님 지적("포커스 온인데 계속 같은 영상이 나와") — 실측으로 확정된 원인:
          //   그 영상이 **117초짜리**였다. 진행률은 리셋 없이 단조 증가했고(0.004→0.284→0.564→0.983)
          //   자동넘김은 "끝나기 2.5초 전"에만 발사되므로 2분 내내 그대로 뒀다. 포커스 세션이
          //   10분인데 영상 하나가 2분을 먹으면 "계속 같은 영상"으로 느껴지는 게 당연하다.
          //   코드 주석이 전제한 건 "숏폼 15~60초"인데(SAFETY_TIMEOUT_MS 주석) 지금 틱톡은 추천 피드에
          //   **최대 10분짜리**를 섞어 서빙한다. 10분짜리가 걸리면 10분을 기다린다 —
          //   "쇼트폼 총 시청시간 줄이기"라는 제품 목적과 정반대로 동작하는 구간이다.
          //   → 한 영상에 머무는 시간에 상한을 둔다. 상한에 걸리면 진행률과 무관하게 넘긴다.
          //   ⚠️ 상한은 넉넉히(90초) 잡는다 — 일반적인 숏폼(15~60초)은 절대 중간에 안 끊기고,
          //     비정상적으로 긴 것만 잘린다. 짧은 영상을 끊는 건 기본 동작을 해치는 것이라 피한다.
          val stuckOnSameVideoMs = if (videoStartedAtMs > 0L) now - videoStartedAtMs else 0L
          val overStay = stuckOnSameVideoMs >= MAX_SINGLE_VIDEO_MS
          if (isWatching && (remainMs <= NEAR_END_LEAD_MS || overStay) && now - lastSwipeAtMs > MANUAL_SWIPE_MIN_GAP_MS) {
            val why = if (overStay) "over-stay(${stuckOnSameVideoMs}ms)" else "frac-predict"
            Log.d("PaceAccessibility", "AUTO_NEXT reason=$why frac=$frac est=${estimatedDurationMs}ms remain=${remainMs}ms")
            performSwipeUp()
            lastSwipeAtMs = now
            videoStartedAtMs = now
          }
        }
        if (frac != prev) lastFracAtMs = now
        lastKnownFrac = frac
      }
      val fp = currentVideoFingerprint(root)
      if (fp != null) {
        lastTimingReadAtMs = now // 지문을 읽었다는 것 자체가 "이 앱을 관측할 수 있다"는 뜻
        if (lastVideoFingerprint != null && fp != lastVideoFingerprint) {
          videoAdvanceCount++
          if (now - lastSwipeAtMs > MANUAL_SWIPE_MIN_GAP_MS) {
            // 우리가 넘긴 직후가 아닌데 영상이 바뀌었다 = 사용자가 손으로 넘겼다 = 깨어있음.
            Log.d("PaceAccessibility", "VIDEO_ADVANCE reason=fingerprint count=$videoAdvanceCount (manual)")
            PaceOverlayService.markUserActivity()
          }
        }
        lastVideoFingerprint = fp
      }
    }
    // 2026-08-03 사장님 지시("1번 없애고") — Tier 2(재생 위치 신호를 못 찾으면 safetyTimeoutMs마다
    // 무조건 강제 스와이프)를 삭제한다.
    //
    // 원래 의도는 "광고 화면·노드 구조 변경·다른 로케일 때문에 재생 위치를 못 읽어도 자동넘김이
    // 멈추지 않게" 하는 안전망이었다. 그런데 실기기에서 확인된 실제 동작은 정반대였다: 유튜브에서
    // foundTiming=false가 상시로 나와(Tier 1이 사실상 죽어 있음) "영상이 끝나면 넘긴다"는 기능은
    // 한 번도 작동하지 않고, 45초 타이머만 계속 돌며 사장님이 보고 계신 영상을 중간에 끊었다
    // ("지금 나 손짓 안 하는데 왜 넘어가는데" — 실측 count=16까지 누적).
    //
    // 즉 이 폴백은 안전망이 아니라 오작동의 유일한 원인이었다. 넘김 수단은 손짓·블루투스·직접
    // 스와이프가 이미 있고, 그 어느 것도 이 타이머에 의존하지 않는다. iOS에는 애초에 자동넘김
    // 자체가 없어(autoNextService.ios.ts는 빈 스텁) 이 삭제로 플랫폼 동작도 오히려 일치한다.
    // 재생 위치를 읽었을 때의 정상 경로(nearEnd → performSwipeUp)는 위에 그대로 살아 있다.
  }

  // 2026-07-21 밤 감사 발견 — rootInActiveWindow는 "지금 입력 포커스를 가진 창"만 반환한다.
  // 스플릿스크린/멀티윈도우에서 감시 대상 앱(YouTube 등)이 화면엔 보이지만 포커스가 다른 창에
  // 있으면(예: 사용자가 방금 반대편 창을 탭함) 이 값이 대상 앱이 아닌 다른 창의 루트를 반환해
  // 재생 위치 텍스트를 영원히 못 찾는다 — Tier 1이 조용히 죽고 Tier 2(45초 타임아웃)만 도는 것과
  // 같은 부류의 버그(activeAppWindowBounds와 동일 원인). windows 목록에서 대상 패키지의 창을 직접
  // 찾아 그 루트를 우선 쓰고, 못 찾으면(단일 창 등 기존과 동일한 상황) rootInActiveWindow로 폴백.
  /**
   * 🔴 2026-08-13 사장님 질문("유튜브와 틱톡이 둘 다 떠 있을 땐 어떻게 해?" →
   *   "전체 창에 영상 시간으로 하고 오버레이나 스와이프도 다 전체 창인 애한테 연결해야 하지 않아?") —
   *   지적하신 그대로가 맞고, 실제로 그렇게 안 돼 있었다.
   *
   * trackedAppRootNode / activeAppWindowBounds가 `windows`를 훑다 **처음 만난** 감시 대상 앱 창을
   * 그냥 썼다 = **창 목록 순서에 의존**. 유튜브가 PIP(작은 창)로 남고 사용자가 틱톡을 보고 있으면
   * 유튜브 창을 잡아 **그쪽 진행률을 읽고** 스와이프는 화면 전체에 쐈다. 사장님이 본
   * "유튜브가 작은 창 갔다 큰 창으로 왔다"가 이 증상이다.
   *
   * supportedAppWindowVisible()은 이미 같은 함정을 겪고 **창 크기로 PIP를 거르는** 로직을 갖고
   * 있었는데(그 함수 위 주석의 One UI 오탐 이력) 이 두 함수엔 없었다. 선택 규칙을 여기 한 곳으로 모은다:
   *   ① 진짜 PIP(화면 폭의 80% 미만)는 후보에서 제외 — "전체 창인 애"만 남긴다
   *   ② 지금 보고 있는 앱(PaceOverlayService가 매초 기록)을 최우선
   *   ③ 그래도 여럿이면 가장 넓은 창
   * 이 하나를 진행률·스와이프 좌표 양쪽이 함께 쓰므로 "읽는 창과 쏘는 창이 다른" 상황이 없어진다.
   */
  private fun bestTrackedWindow(): android.view.accessibility.AccessibilityWindowInfo? {
    val screenWidth = resources.displayMetrics.widthPixels
    val focused = PaceOverlayService.currentTrackedPackage()
    var best: android.view.accessibility.AccessibilityWindowInfo? = null
    var bestScore = Long.MIN_VALUE
    val bounds = Rect()
    for (window in windows) {
      val pkg = window.root?.packageName?.toString() ?: continue
      if (!SupportedApps.PACKAGES.contains(pkg)) continue
      window.getBoundsInScreen(bounds)
      if (screenWidth > 0 && bounds.width() < screenWidth * 0.8) continue // ① 전체 창만
      val area = bounds.width().toLong() * bounds.height().toLong()
      val score = (if (pkg == focused) 1_000_000_000L else 0L) + area // ②③
      if (score > bestScore) { bestScore = score; best = window }
    }
    return best
  }

  private fun trackedAppRootNode(): AccessibilityNodeInfo? {
    try {
      bestTrackedWindow()?.root?.let { return it }
    } catch (e: Exception) {
      Log.w("PaceAccessibility", "trackedAppRootNode lookup failed, falling back to rootInActiveWindow", e)
    }
    // 🔴 2026-08-10 — 이 폴백이 "감시 대상 앱 창을 못 찾았을 때 지금 활성 창이라도 쓴다"는 뜻인데,
    //   **우리 앱 자신의 창까지 유튜브인 양 돌려주고 있었다.** 보상형 광고가 유튜브를 덮으면
    //   (실기기: supportedAppWindowVisible=false n=2, 남은 창이 전부 com.strides7.pace) 여기서
    //   광고 화면이 돌아가고, readVisibleTitleChannel이 광고 문구를 "새 영상 제목"으로 읽어
    //   이어서재생이 다음 쇼츠를 열어버렸다 — 광고가 지나가버리던 원인의 절반이 이 한 줄이다.
    //   감시 대상 앱이 아닌 우리 화면은 "읽을 것이 없음"(null)이 정직한 답이다 — 호출부
    //   (readVisibleTitleChannel / 재생시간 폴링 / 즐겨찾기 캡처)는 전부 null을 견디게 돼 있다.
    //
    // 🔴 2026-08-10(2차) 실기기 로그로 확정 — 우리 앱만 막은 건 절반짜리였다. 사용자가 홈으로
    //   나가 있는 동안 이 폴백이 **런처 창**을 돌려줬고, 이어서재생이 그 위젯 글자를 "새 영상
    //   제목"으로 읽어 홈 화면에 있던 사용자를 유튜브로 끌고 들어갔다:
    //     22:41:46 CHAIN fire → HOT chain advance
    //     22:41:48 pill HIDE ... usage=com.sec.android.app.launcher
    //     22:41:50 CHAIN resync new baseline='날씨. 이동하려면 두 번 누른 후 움직이세요.'
    //   이 함수의 계약은 이름 그대로 "**감시 대상 앱의** 루트"다. 대상 앱이 화면에 없으면
    //   아무 창이나 대신 내주는 건 계약 위반이고, 위 두 사고의 공통 원인이다.
    //   → 폴백도 감시 대상 앱일 때만 인정한다(단일 창 등 windows가 비는 상황을 위해 폴백 자체는 유지).
    val fallback = rootInActiveWindow ?: return null
    val fallbackPkg = fallback.packageName?.toString()
    if (fallbackPkg != null && SupportedApps.PACKAGES.contains(fallbackPkg)) return fallback
    return null
  }

  // 2026-08-01 실기기 재현(사용자: "지금도 오버레이가 또 없어") — 처음엔 PIP만 의심했으나(위 커밋
  // 참고), 실기기 진단(dumpsys usagestats)으로 훨씬 더 흔한 진짜 원인을 확정: YouTube Shorts는 영상이
  // 바뀌어도 같은 Activity 안에서 콘텐츠만 바뀌지 새 화면 전환 자체가 없다 — 그래서 한 화면에 5분
  // (ForegroundAppWatcher.STALENESS_MS) 넘게 머물면 UsageStatsManager의 lastTimeUsed도, 접근성
  // TYPE_WINDOW_STATE_CHANGED 이벤트도 똑같이 "새 전환 없음=조용함"에 빠진다 — 실기기에서 YouTube의
  // lastTimeUsed가 7분 넘게 안 갱신되는데도 실제로는 계속 포그라운드였음을 직접 확인. 반면
  // getWindows()는 이벤트가 아니라 "그 순간을 직접 묻는" 쿼리라 이 문제 자체가 없다 — 같은 기간 동안
  // 재생시간 텍스트 폴링(trackedAppRootNode, 아래)은 한 번도 안 끊기고 정상 작동했다(로그로 확인,
  // 그래서 시간 차감 자체는 이 버그와 무관하게 항상 정확했다 — 사라지는 건 알약 표시뿐이었음).
  // 그래서 오버레이 표시 여부도 이 신뢰할 수 있는 신호로 직접 확인한다 — PIP 여부와 무관하게
  // "감시 대상 앱 창이 화면에 지금 실제로 떠 있는가"만 본다(PIP도 이 창 목록에 잡히므로 자동으로
  // 포함됨, 별도 분기 불필요).
  // 2026-08-01 실기기 재현(사장님: "Open App 눌러도 다시 쇼츠로 옴") — 원래 PIP도 자동으로 이
  // 목록에 잡히게 뒀는데, 그게 정확히 문제였다. 유튜브가 PIP로 떠 있으면(자동진입 방지 플래그가
  // 안 먹는 경우 포함) 그 작은 창이 Pace로 전환한 뒤에도 화면 위에 계속 남아있고, getWindows()는
  // 이 PIP 창도 여전히 "유튜브 창 있음"으로 잡아서 shouldShow가 계속 true로 고정돼버렸다 — 알약/
  // 패널이 Pace 위에 계속 뜨고, 사용자 눈엔 "안 나가고 다시 쇼츠로 온 것"처럼 보였다. PIP 창은
  // 이 판정에서 제외한다(TYPE_PICTURE_IN_PICTURE, API 26+) — PIP는 없어도 감시 대상 앱을 못 찾는
  // 문제(장시간 무전환) 자체가 없으므로 이 신호가 굳이 필요하지 않다.
  // 🔴 2026-08-05 실기기로 근본원인 확정 — 사장님 "지금은 또 왜 손짓이 아예 안 되나".
  // 손짓은 정상 감지됐는데(WAVE detected ×3) triggerNext()가 여기서 false를 받아 전부 막혔다.
  // 창을 전수 덤프해보니:
  //     {id=14111 type=1 pipFlag=true pkg=com.google.android.youtube}
  // 같은 순간 ActivityManager는 `mode=fullscreen visible=true`에 topResumedActivity였고 화면에도
  // 전체화면으로 그려지고 있었다. 즉 **AccessibilityWindowInfo.isInPictureInPictureMode()가
  // 유튜브가 PIP에서 전체화면으로 돌아온 뒤에도 true로 남는다**(이 기기/One UI에서 재현).
  // 그 잘못된 플래그 하나 때문에 위 PIP 제외 로직이 유튜브 창을 통째로 걸러냈고, 이 함수를 쓰는
  // 모든 경로 — 손짓·볼륨키·블루투스 리모컨·오버레이 알약 표시 — 가 한꺼번에 죽었다.
  // (2026-08-02에 넣었던 "triggerNext() aborted" 진단 로그가 아니었으면 또 감지기 임계값을
  //  의심하며 시간을 버렸을 것이다.)
  //
  // → 플래그를 믿지 않고 **창 크기**로 판정한다. 진짜 PIP는 화면 한구석의 작은 썸네일이라 폭이
  //   화면의 절반도 안 되고, 전체화면 창은 화면 폭을 그대로 덮는다. 8/1에 PIP를 제외한 원래
  //   목적("Open App 눌러도 다시 쇼츠로 옴" — 작은 PIP 창이 남아 알약이 Pace 위에 계속 뜨던 문제)은
  //   진짜 PIP일 때 그대로 유지되고, 전체화면인데 플래그만 남은 이번 경우만 정상 통과한다.
  // 실패했을 때만 한 줄 남긴다(성공 시엔 안 찍으므로 정상 사용 중 로그 스팸 없음).
  private fun supportedAppWindowVisible(): Boolean {
    try {
      val screenWidth = resources.displayMetrics.widthPixels
      val dump = StringBuilder()
      var hit = false
      val bounds = Rect()
      for (window in windows) {
        val pkg = window.root?.packageName?.toString()
        window.getBoundsInScreen(bounds)
        // 진짜 PIP인지는 **플래그가 아니라 창 크기**로 판정한다(위 주석 참고). 진짜 PIP 창은 화면
        // 한구석의 작은 썸네일이고, 전체화면 창은 화면 폭을 그대로 덮는다.
        val small = screenWidth > 0 && bounds.width() < screenWidth * 0.8
        val pipFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && window.isInPictureInPictureMode
        dump.append("{id=").append(window.id)
          .append(" type=").append(window.type)
          .append(" pipFlag=").append(pipFlag)
          .append(" w=").append(bounds.width()).append('/').append(screenWidth)
          .append(" pkg=").append(pkg ?: "NULL")
          .append("} ")
        if ((pipFlag && small) || pkg == null) continue
        if (pkg in SupportedApps.PACKAGES) hit = true
      }
      if (hit) return true
      Log.w("PaceAccessibility", "supportedAppWindowVisible=false n=${windows.size} active=${rootInActiveWindow?.packageName} $dump")
    } catch (e: Exception) {
      Log.w("PaceAccessibility", "supportedAppWindowVisible lookup failed", e)
    }
    return false
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

  /**
   * 🔴 2026-08-12 사장님 지시("접근성으로 하단 진행바 상태값 읽기 다 확인해봤어?") —
   * 재생위치를 **텍스트가 아니라 노드의 RangeInfo**로 읽는 두 번째 경로.
   *
   * SeekBar/ProgressBar 계열 노드는 시간 문자열이 없어도 AccessibilityNodeInfo.RangeInfo로
   * (min, max, current)를 노출할 수 있다. uiautomator XML에는 이 값이 안 찍혀서 덤프만 봐서는
   * 있는지 없는지 알 수 없다 — 그래서 여기서 직접 조회한다.
   *
   * 반환: 진행률 0.0~1.0. 없으면 null.
   */
  private fun collectRanges(node: AccessibilityNodeInfo?, out: MutableList<RangeHit>, depth: Int = 0, budget: IntArray = intArrayOf(3000)) {
    if (node == null || depth > 40 || budget[0] <= 0) return
    budget[0]--
    val range = node.rangeInfo
    if (range != null) {
      val span = range.max - range.min
      if (span > 0f) {
        out.add(RangeHit(node.className?.toString() ?: "?", (range.current - range.min) / span, range.max, node.isVisibleToUser))
      }
    }
    for (i in 0 until node.childCount) collectRanges(node.getChild(i), out, depth + 1, budget)
  }

  private fun findProgressRange(node: AccessibilityNodeInfo?, depth: Int = 0, budget: IntArray = intArrayOf(3000)): Float? {
    val found = mutableListOf<RangeHit>()
    collectRanges(node, found, depth, budget)
    if (found.isEmpty()) return null
    // ⚠️ 첫 번째 노드를 그냥 쓰면 안 된다 — 실기기(2026-08-12): 틱톡 트리의 첫 rangeInfo는
    //   max=1167084, cur=0으로 고정된 **버퍼/로딩 바**였고, 정작 재생 진행을 나타내는 SeekBar를
    //   가려버렸다. 재생바로 쓸 수 있는 건 SeekBar 계열이므로 그것을 우선한다.
    // 🔴 2026-08-12 2차 실기기 — SeekBar를 고르는 것만으로는 부족했다. ViewPager가 **인접 페이지를
    //   미리 붙여두기 때문에** SeekBar가 여러 개 잡히고(로그 n=2), 재생 중이 아닌 이웃 페이지의
    //   바는 항상 frac=0이다. 그걸 집으면 진행률이 영원히 0으로 보인다(피드/상세 양쪽에서 0 고정).
    //   → 화면에 실제로 보이는(isVisibleToUser) 것만 후보로 두고, 그중 가장 앞선 값을 쓴다.
    //   ⚠️ 안 보이는 바로 폴백하지 않는다 — 그건 항상 0이라 "진행률 0"으로 착각하게 만든다.
    //     못 찾으면 null(=진행 신호 없음)을 돌려주고, 호출부가 시간 기반 폴백으로 넘어가게 한다.
    // 🔴 2026-08-13 3차 실기기 (사장님: "포커스 온인데 계속 같은 영상이 나와") — 클래스 이름으로
    //   고르는 것 자체가 틀렸다. 그날 틱톡은 SeekBar가 아니라 **ProgressBar로 재생 진행률을 줬다**:
    //     RANGE_INFO n=1 ProgressBar(max=60075.0, frac=0.063, vis=true)   ← 60초 영상의 3.8초 지점
    //   그런데 SeekBar만 찾다 보니 null이 나가고("RANGE_INFO none") 자동넘김이 통째로 멈췄다.
    //   앞서 배제했던 버퍼 바(max=1167084, frac이 0에서 안 변함)와 이건 클래스가 같아 이름으로는
    //   구분이 안 된다. **구분되는 유일한 성질은 "값이 실제로 흐르는가"다.**
    //   → 보이는 후보들의 직전 값을 기억해두고, 이번에 **증가한 것**을 재생바로 채택한다.
    //     아직 판단이 안 서는 첫 폴링에서는 종전대로 SeekBar를 우선하고, 그것도 없으면
    //     보이는 후보 중 하나를 잠정 채택해 다음 폴링에서 흐르는지 본다.
    Log.d("PaceAccessibility", "RANGE_INFO n=${found.size} " + found.joinToString(" ") { "${it.cls.substringAfterLast('.')}(max=${it.max},frac=${"%.3f".format(it.frac)},vis=${it.visible})" })
    val visible = found.filter { it.visible }
    if (visible.isEmpty()) return null
    val advancing = visible.filter { hit ->
      val key = "${hit.cls}:${hit.max}"
      val prev = rangeCandidateHistory[key]
      rangeCandidateHistory[key] = hit.frac
      prev != null && hit.frac > prev + 0.0005f // 잡음 방지용 최소 증가폭
    }
    val picked = advancing.maxByOrNull { it.frac }
      ?: visible.firstOrNull { it.cls.contains("SeekBar") }
      ?: visible.first()
    return picked.frac
  }

  private data class RangeHit(val cls: String, val frac: Float, val max: Float, val visible: Boolean)

  /**
   * 🔴 2026-08-12 — 틱톡처럼 재생위치를 안 주는 앱에서 "지금 보고 있는 영상"을 식별하는 지문.
   *
   * 실기기 트리 덤프(181노드)로 확인된 것: 틱톡은 진행바는 안 주지만 **영상 설명·작성자·사운드는
   * content-desc/text로 준다.** 이 조합이 바뀌면 = 영상이 바뀐 것이고, 우리가 스와이프한 게
   * 아니라면 = **사용자가 손으로 넘긴 것**(= 확실한 '깨어있음' 증거)이다.
   * 유튜브에서 totalSec 변화로 하던 판정(2026-08-02)을 트리 텍스트로 옮긴 것뿐이다.
   */
  private fun currentVideoFingerprint(node: AccessibilityNodeInfo?, depth: Int = 0, budget: IntArray = intArrayOf(3000), sb: StringBuilder = StringBuilder()): String? {
    if (node == null || depth > 40 || budget[0] <= 0) return if (sb.isEmpty()) null else sb.toString()
    budget[0]--
    val desc = node.contentDescription?.toString()
    // 프로필/사운드/설명만 고른다 — 좋아요·댓글 수는 실시간으로 계속 바뀌어 지문으로 못 쓴다.
    if (!desc.isNullOrEmpty() && (desc.startsWith("사운드:") || desc.endsWith("님의 프로필"))) sb.append(desc).append('|')
    for (i in 0 until node.childCount) currentVideoFingerprint(node.getChild(i), depth + 1, budget, sb)
    return if (sb.isEmpty()) null else sb.toString()
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
      // 2026-08-02 감사 지적 반영 — 정규식의 (\d+)에는 자릿수 상한이 없어서, 유튜브 화면의 어떤
      // 노드가 아주 긴 숫자를 담고 있으면 toInt()가 NumberFormatException을 던진다. 이 함수는
      // 500ms 폴링 루프 안에서 불리므로 한 번만 터져도 서비스가 죽는다(위 pollRunnable 주석 참고).
      // toIntOrNull로 바꿔 "파싱 실패 = 이 문자열은 재생시간이 아니다"로 조용히 처리한다 — 실제로
      // 그게 맞는 해석이다(우리가 찾는 건 분/초라 int 범위를 넘길 리 없다).
      val tm = korean.group(1)?.toIntOrNull()
      val ts = korean.group(2)?.toIntOrNull()
      val cm = korean.group(3)?.toIntOrNull()
      val cs = korean.group(4)?.toIntOrNull()
      if (tm != null && ts != null && cm != null && cs != null) {
        return (cm * 60 + cs) to (tm * 60 + ts)
      }
      return null
    }
    val colon = COLON_TIME_PATTERN.matcher(text)
    if (colon.find()) {
      val cm = colon.group(1)?.toIntOrNull()
      val cs = colon.group(2)?.toIntOrNull()
      val tm = colon.group(3)?.toIntOrNull()
      val ts = colon.group(4)?.toIntOrNull()
      if (tm != null && ts != null && cm != null && cs != null) {
        return (cm * 60 + cs) to (tm * 60 + ts)
      }
      return null
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
      // 🔴 2026-08-13 — 진행률을 **읽는 창**과 스와이프를 **쏘는 창**이 반드시 같아야 한다
      //   (bestTrackedWindow 주석 참고). 예전엔 각자 "첫 supported 창"을 따로 골라서,
      //   PIP 유튜브의 진행률을 읽고 전체화면 틱톡에 스와이프를 쏘는 조합이 가능했다.
      bestTrackedWindow()?.let { w ->
        w.getBoundsInScreen(rect)
        if (!rect.isEmpty) return rect
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
    // 🔴 2026-08-12 — 웹 조사(XDA/Appium 제스처 문서) + 실기기 결과로 조정. 숏폼 피드는 ViewPager2
    //   계열이라 **드래그가 아니라 플링(fling)** 으로 인식돼야 자기 스냅 애니메이션을 태우고,
    //   그래야 전환이 앱 자체 스와이프와 같아진다(느린 드래그는 중간에 걸린 듯 보이거나 되돌아간다).
    //   최소 플링 속도를 넉넉히 넘기도록 **더 짧은 거리를 더 빠르게** 긋는다.
    //     이전: 0.75h→0.25h / 250ms (≈4,600px/s)   지금: 0.70h→0.40h / 120ms (≈5,800px/s)
    //   시작점도 0.70h로 올렸다 — 0.75h는 설명/댓글 입력 영역에 걸려 피드가 아니라 그쪽이 먹는
    //   경우가 있었다(실기기에서 댓글창이 열린 채로 발견).
    val path = Path().apply {
      moveTo(bounds.centerX().toFloat(), bounds.top + bounds.height() * 0.70f)
      lineTo(bounds.centerX().toFloat(), bounds.top + bounds.height() * 0.40f)
    }
    dispatchSwipe(path, SWIPE_FLING_MS)
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


  private fun dispatchSwipe(path: Path, durationMs: Long = SWIPE_FLING_MS) {
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
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

  private fun captureCurrentVideoInfoInternal(callback: (String?, String?, String?, String?, Boolean) -> Unit) {
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
        callback(title, channel, null, null, true)
        return
      }

      // 1차: 공유 결과를 기다리지 않고 지금 바로 아는 것(제목/채널)만으로 낙관적 콜백 — 호출부가
      // 리스트에 즉시 추가해 보여준다. videoId/url은 아직 모르므로 null.
      callback(title, channel, null, null, false)

      var completed = false
      val timeoutRunnable = Runnable {
        if (!completed) {
          completed = true
          PaceShareCaptureActivity.pendingCallback = null
          Log.w("PaceAccessibility", "captureCurrentVideoInfo: 공유 결과 대기 타임아웃")
          // "Pace"를 못 찾아 폴링이 끝까지 실패한 경우, 시스템 공유시트가 화면에 뜬 채로 남아
          // 사용자가 직접 닫아야 하는 상태가 된다 — 뒤로가기로 우리가 대신 닫아준다.
          performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
          callback(title, channel, null, null, true)
        }
      }
      PaceShareCaptureActivity.pendingCallback = { sharedText ->
        if (!completed) {
          completed = true
          handler.removeCallbacks(timeoutRunnable)
          val videoId = extractYouTubeVideoId(sharedText)
          callback(title, channel, videoId, sharedText, true)
        }
      }
      handler.postDelayed(timeoutRunnable, CAPTURE_TIMEOUT_MS)

      val clicked = shareNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      if (!clicked) {
        completed = true
        handler.removeCallbacks(timeoutRunnable)
        PaceShareCaptureActivity.pendingCallback = null
        Log.w("PaceAccessibility", "captureCurrentVideoInfo: 공유 버튼 클릭 실패")
        callback(title, channel, null, null, true)
        return
      }
      pollForShareTarget(attemptsLeft = 12)
    } catch (e: Exception) {
      // 방어적 전체 캐치 — 이 기능은 부가 기능이라 실패해도 앱이 죽으면 안 됨(사장님 지시:
      // "예외처리도 다 적용해가면서").
      Log.e("PaceAccessibility", "captureCurrentVideoInfo 예외", e)
      callback(null, null, null, null, true)
    }
  }

  // 공유시트가 뜨는 데 기기/OEM별로 지연이 있어 300ms 간격으로 재시도.
  // 못 찾으면 위 CAPTURE_TIMEOUT_MS 시점에 timeoutRunnable이 정리한다.
  //
  // 2026-07-31 실기기 발견 — Pace는 "최근 사용한 공유 대상"이 아니라서 삼성 공유시트의 앱 아이콘
  // 줄(고정 5개, 마지막이 "더보기") 첫 화면에 안 뜬다. 이 줄 자체는 스크롤 가능한 목록이 아니라
  // "더보기"를 눌러야 전체 앱 목록(별도 그리드/리스트)이 펼쳐지고 거기서 Pace를 찾을 수 있다
  // (uiautomator dump가 이 기기에서 계속 실패해 실제 위젯 구조 대신 스크린샷으로 확인함).
  // "더보기"를 한 번 클릭한 뒤에는 펼쳐진 목록이 RecyclerView일 수 있어 스크롤 폴백도 유지한다.
  // ⭐ 2026-08-05 실기기 진단으로 확정 — `rootInActiveWindow` 하나만 보면 공유창의 아랫부분이 안 보인다.
  //   폴백 시점에 트리를 통째로 덤프해보니 이것뿐이었다:
  //     D:Gmail | D:메시지 | D:블루투스 | D:메시지 | D:Samsung Notes | D:드래그 핸들
  //   화면에는 분명히 있는 "링크 복사"/"Quick Share"가 **트리에 아예 없다** = 그 부분이 **다른 창**에
  //   그려져 있다는 뜻이다(활성 창의 루트에 포함되지 않는다). 그래서 지금까지 Pace든 더보기든 링크
  //   복사든 무엇을 찾아도 못 찾고 매번 타임아웃했다 — 찾는 방법이 아니라 **보는 범위**가 문제였다.
  //   `windows`의 모든 루트를 뒤진다(이 서비스는 이미 supportedAppWindowVisible에서 같은 API를 쓴다).
  private fun forEachWindowRoot(action: (AccessibilityNodeInfo) -> Boolean) {
    rootInActiveWindow?.let { if (action(it)) return }
    try {
      for (w in windows) {
        val r = w.root ?: continue
        if (action(r)) return
      }
    } catch (e: Exception) {
      Log.w("PaceAccessibility", "windows 순회 실패", e)
    }
  }

  private fun findInAnyWindow(finder: (AccessibilityNodeInfo) -> AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    var found: AccessibilityNodeInfo? = null
    forEachWindowRoot { root -> finder(root)?.also { found = it } != null }
    return found
  }

  private fun pollForShareTarget(attemptsLeft: Int, totalAttempts: Int = 20, expanded: Boolean = false) {
    if (attemptsLeft <= 0) return
    val root = rootInActiveWindow
    val target = findInAnyWindow { findNodeByExactText(it, "Pace") }
    if (target != null) {
      val clickable = generateSequence(target) { it.parent }.firstOrNull { it.isClickable } ?: target
      clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      return
    }
    if (!expanded) {
      val more = findNodeByExactText(root, "더보기") ?: findNodeByExactText(root, "More")
      if (more != null) {
        val clickableMore = generateSequence(more) { it.parent }.firstOrNull { it.isClickable } ?: more
        clickableMore.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        handler.postDelayed({ pollForShareTarget(attemptsLeft - 1, totalAttempts, expanded = true) }, 400L)
        return
      }
    } else if (attemptsLeft <= totalAttempts / 2) {
      findScrollableNode(root)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
    }
    // ⭐ 2026-08-05 실기기 A/B — 유튜브 쇼츠의 공유 버튼은 **시스템 공유창을 안 띄운다.** 유튜브 자체
    //   UI이고 내용물은 다이렉트공유 아이콘 5개 + "링크 복사" + "Quick Share"가 전부다. **앱 목록도
    //   "더보기"도 없어** 위의 Pace 탐색/더보기/스크롤이 전부 헛돌고 매번 타임아웃했다(로그: "공유 결과
    //   대기 타임아웃"). 대조군으로 같은 기기에 시스템 ACTION_SEND를 직접 쏘면 android/…ResolverActivity가
    //   앱 그리드를 정상으로 보여준다 — 둘은 완전히 다른 화면이다. Pace 등록 자체는 정상
    //   (`cmd package query-activities`에 nonLocalizedLabel=Pace로 잡힘).
    //
    //   그래서 그 창에 **실제로 있는** "링크 복사"를 대신 누른다. URL이 클립보드에 들어가면
    //   PaceShareCaptureActivity를 EXTRA_READ_CLIPBOARD로 띄워 읽는다(Android 10+는 포커스를 가진 앱만
    //   클립보드를 읽을 수 있어 접근성 서비스에서 직접은 불가 — 그 액티비티가 필요한 이유).
    //   ⚠️ Pace 탐색을 먼저 시도한 뒤의 **폴백**으로 둔다. 나중에 유튜브가 시스템 공유창으로 되돌리거나
    //     다른 기기/OEM에서 앱 목록이 나오면 기존 경로가 그대로 먹히기 때문이다(회귀 방지).
    if (attemptsLeft <= totalAttempts / 2) {
      // 진단(2026-08-05) — "링크 복사"를 못 찾는 원인을 추측하지 않기 위해, 폴백 시도 시점에 공유창의
      // 실제 텍스트/contentDesc를 한 번만 덤프한다. uiautomator dump가 이 기기에서 계속 실패해
      // 외부 도구로는 확인할 수 없어 서비스 자신이 남기는 게 유일한 방법이다.
      if (attemptsLeft == totalAttempts / 2) {
        val texts = mutableListOf<String>()
        forEachWindowRoot { r -> collectVisibleTexts(r, texts, 0, intArrayOf(600)); false }
        Log.i("PaceAccessibility", "SHARE-SHEET texts=${texts.take(40).joinToString(" | ")}")
      }
      val copy = findInAnyWindow { findNodeByExactText(it, "링크 복사") }
        ?: findInAnyWindow { findNodeByExactText(it, "Copy link") }
        ?: findInAnyWindow { findNodeByTextContains(it, "링크 복사") }
        ?: findInAnyWindow { findNodeByTextContains(it, "Copy link") }
      if (copy != null) {
        val clickableCopy = generateSequence(copy) { it.parent }.firstOrNull { it.isClickable } ?: copy
        if (clickableCopy.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
          Log.i("PaceAccessibility", "공유시트에 앱 목록이 없어 '링크 복사'로 폴백")
          // 복사 반영에 약간의 지연이 있어 잠깐 기다렸다 읽는다.
          handler.postDelayed({
            try {
              startActivity(
                Intent(this, PaceShareCaptureActivity::class.java)
                  .putExtra(PaceShareCaptureActivity.EXTRA_READ_CLIPBOARD, true)
                  .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
              )
            } catch (e: Exception) {
              Log.w("PaceAccessibility", "클립보드 읽기 액티비티 실행 실패", e)
            }
          }, 350L)
          return
        }
      }
    }
    handler.postDelayed({ pollForShareTarget(attemptsLeft - 1, totalAttempts, expanded) }, 300L)
  }

  // 시트 안에서 자식이 가장 많은 스크롤 가능 노드를 고른다 — 앱 아이콘 목록(RecyclerView)이 대개
  // 드래그 핸들/배경 같은 다른 스크롤 가능 컨테이너보다 자식이 훨씬 많다.
  private fun findScrollableNode(node: AccessibilityNodeInfo?, depth: Int = 0, budget: IntArray = intArrayOf(400)): AccessibilityNodeInfo? {
    if (node == null || depth > 40 || budget[0] <= 0) return null
    budget[0]--
    var best: AccessibilityNodeInfo? = if (node.isScrollable) node else null
    for (i in 0 until node.childCount) {
      val candidate = findScrollableNode(node.getChild(i), depth + 1, budget)
      if (candidate != null && (best == null || candidate.childCount > best!!.childCount)) {
        best = candidate
      }
    }
    return best
  }

  // 진단용 — 화면의 text/contentDescription을 모두 모은다(위 SHARE-SHEET 로그).
  private fun collectVisibleTexts(node: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int, budget: IntArray) {
    if (node == null || depth > 40 || budget[0] <= 0) return
    budget[0]--
    node.text?.toString()?.takeIf { it.isNotBlank() }?.let { out.add("T:$it") }
    node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { out.add("D:$it") }
    for (i in 0 until node.childCount) collectVisibleTexts(node.getChild(i), out, depth + 1, budget)
  }

  // "링크 복사"가 정확일치로 안 잡히는 경우(앞뒤 공백/부가 문구)를 위한 부분일치 탐색.
  private fun findNodeByTextContains(node: AccessibilityNodeInfo?, needle: String, depth: Int = 0, budget: IntArray = intArrayOf(600)): AccessibilityNodeInfo? {
    if (node == null || depth > 40 || budget[0] <= 0) return null
    budget[0]--
    val t = node.text?.toString()
    val d = node.contentDescription?.toString()
    if ((t != null && t.contains(needle)) || (d != null && d.contains(needle))) return node
    for (i in 0 until node.childCount) {
      findNodeByTextContains(node.getChild(i), needle, depth + 1, budget)?.let { return it }
    }
    return null
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
