package expo.modules.paceoverlay

import android.app.*
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.io.File
import java.net.URL
import kotlin.math.sqrt

// Android=떠 있는 알약(pill) 오버레이(PACE_ARCHITECTURE.md "Android=floating pill / iOS=frame 차분"과
// 일치시킨 네이티브 구현). TYPE_APPLICATION_OVERLAY 레거시 방식 — Android 17+ Bubbles API 우선 전략은
// 별도 PaceBubbleService로 분리 예정(문서 "최신 플랫폼 트렌드 반영" 참고, 이 파일은 폴백 경로).
//
// ⚠️ POC 단계: 실제 RN 컴포넌트(OverlayBar.android.tsx)를 그대로 이 창에 렌더링하는 것이 이상적이지만,
// 별도 윈도우에 React 트리를 브릿지하는 건 훨씬 복잡한 작업(두 번째 ReactRootView 인스턴스 필요)이라
// 순수 네이티브 View로 그린다. 색상 값은 constants/theme.ts의 colors.primary(#5856D6) 등을
// 하드코딩(Kotlin이 JS 상수를 읽을 수 없음 — 값이 바뀌면 양쪽 다 갱신 필요).
// 2026-07-19: healthy-shorts-assistant(3)의 Android 컴팩트 알약 시각 스타일(dark glass, pulsing
// dot, AUTO ON/OFF 배지)을 이식(showOverlay 참고) — 원본의 펼침형 어시스턴트 패널은 이식 범위 밖
// (여전히 두 번째 ReactRootView가 필요한 스케일이라 위와 같은 이유로 보류).
class PaceOverlayService : Service() {
  private var windowManager: WindowManager? = null
  private var overlayView: LinearLayout? = null
  private var remainingLabel: TextView? = null
  private var autoBadge: TextView? = null
  // 2026-07-31 사장님 지시(오버레이 P 메뉴) — "화면이 작아지는" 문제(P를 누르면 곧장 앱으로
  // 전환돼 유튜브가 백그라운드로 밀림)를 해결하기 위해, P를 누르면 앱 전환 없이 이 작은 드롭다운
  // 메뉴(별도 오버레이 창)가 먼저 뜬다. "앱으로"만 실제로 앱을 전경으로 가져오고, Saved/Favorite은
  // pace://quick-list 딥링크로 그 화면에 곧장 진입(app/quick-list.tsx), Shorts HOT은 백엔드가
  // 아직 없어(PACE_PROJECT_MANAGEMENT.md 2026-07-31) 토스트로 정직하게 "곧 만나요" 안내.
  private var paceMenuView: LinearLayout? = null
  // 2026-07-31 사장님 지시 — Saved/Favorite 리스트도 quick-list.tsx(별도 액티비티) 대신 이 창처럼
  // 네이티브 오버레이로 그 자리에서 뜬다(유튜브를 벗어나면 자동 PIP가 걸리는 문제 자체를 원천 차단,
  // showSavedFavoriteList 참고).
  private var savedListView: FrameLayout? = null
  // 2026-08-01 사장님 지시 — Shorts HOT도 같은 이유로 네이티브 오버레이(showShortsHotList 참고).
  private var shortsHotListView: FrameLayout? = null
  // 2026-07-25 사용자 지시 — iOS Pace Feed 글래스모피즘 리디자인(feat(feed) 커밋들)과 동일한 톤으로
  // 맞춘다: Focus Session이 켜져 있을 때만 보이는 작은 보라 링 글래스 원(⚡). iOS의 focusDot과 동일한
  // 역할(비클릭, 순수 상태표시) — applyAutoBadgeStyle()이 autoBadge와 함께 이 가시성도 갱신한다.
  private var zapBadge: View? = null
  // 2026-07-19: 한도/Sleep Timer 만료 시 뜨는 전체화면 차단 화면 — 작은 알약(overlayView)과 별개
  // View. 알림 권한과 무관하게 항상 뜬다(SYSTEM_ALERT_WINDOW는 세션 시작 때 이미 확인된 별개 권한).
  private var blockOverlayView: View? = null
  // start()가 세션 시작 시 넘겨준 값으로 초기화되고, 이후엔 배지 탭(아래 showOverlay)이 유일한
  // 갱신 경로 — JS 쪽에서 세션 도중 Auto Next를 토글해도 이 배지엔 실시간 반영 안 됨(overlayService.
  // android.ts에 updateRemaining같은 별도 업데이트 액션이 없음). 배지 자체가 토글의 소스오브트루스가
  // 되게 설계해 이 비대칭을 우회.
  private var autoNextEnabled = false

  // 2026-07-28 사장님 실기기 지적("자꾸 오버레이 없어짐") — 1차 시도(updateViewLayout()이 던지는지로
  // 판별)를 실기기에 올려 재현했더니 실패로 확인됨: `dumpsys window`로 직접 보면 창이
  // `mHasSurface=false`(화면에 전혀 렌더링 안 되는 유령 상태)인데도 `updateViewLayout()`은 예외 없이
  // 조용히 성공한다 — addView 자체가 처음부터 서피스를 못 만들고도 예외를 안 던지는 것과 같은 부류의
  // 문제(원 주석에 이미 "addView 실패가 예외 없이 삼켜지는 케이스"로 예견돼 있었음). 즉 "정상/유령"을
  // 안정적으로 구분할 공개 API 신호가 없다 — mHasSurface는 dumpsys 전용 내부 필드라 앱 코드에서 못 봄.
  // 그래서 감지를 포기하고 무조건 주기적으로 강제 재생성한다(REFRESH_INTERVAL_MS마다, shouldShow일
  // 때만) — 매번 새로 addView하면 설령 이전 창이 유령이었어도 다음 주기 안에 반드시 복구된다. 기존에
  // "add/removeView churn을 피한다"던 설계 원칙보다 "화면에 실제로 보이는 것"이 더 중요하다는 판단.
  private var lastOverlayRefreshAtMs = 0L
  private fun refreshOverlayIfDue(remainingMinutesForRecreate: Int) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastOverlayRefreshAtMs < REFRESH_INTERVAL_MS) return
    lastOverlayRefreshAtMs = now
    // 2026-08-02 실기기 발견("영상 넘어갈 때 화면 위쪽이 까맣게 됨, 3개 이상 연속") — 이 4초 강제
    // 재생성이 원인으로 의심된다. 예전엔 removeView(구창) → showOverlay(새창) 순서라 그 사이에
    // Pace 오버레이 창이 WindowManager에서 완전히 사라지는 짧은 순간이 항상 있었는데, 이 시점이
    // 유튜브의 영상 SurfaceView 전환(다음 Shorts로 넘어가는 순간)과 겹치면 화면 합성이 꼬여
    // 영상 서피스가 그 프레임에서 검게 나오는 것으로 추정(WindowManager가 오버레이 레이어 유무가
    // 바뀔 때마다 전체 컴포지션을 다시 계산하는 비용 때문). 순서를 뒤집어 새 창을 먼저 추가하고
    // 그 다음에 구 창을 지운다 — "Pace 오버레이 창이 0개인 순간" 자체를 없애 이 창구를 닫는다.
    val oldView = overlayView
    overlayView = null
    showOverlay(remainingMinutesForRecreate)
    oldView?.let { try { windowManager?.removeView(it) } catch (e: Exception) {} }
  }

  // 포그라운드 앱 감지 폴링 — SupportedApps.PACKAGES(YouTube/Instagram)에 있을 때만 오버레이를
  // 보이게 하고, 그 외(카카오톡/런처/Pace 자신 등)에서는 숨긴다(ForegroundAppWatcher.kt 참고,
  // UsageStatsManager 기반). 2026-07-28 — 원래 "뷰를 매번 add/removeView하지 않고 visibility만
  // 토글" 원칙이었는데, 유령 창 문제로 위 refreshOverlayIfDue()가 주기적으로 강제 재생성한다.
  private val foregroundPollHandler = Handler(Looper.getMainLooper())
  private var isPolling = false
  private val foregroundPollRunnable = object : Runnable {
    override fun run() {
      // 2026-07-19 사용자 지적 반영: UsageStatsManager 호출에 예외처리가 전혀 없었다 — 권한이
      // 세션 도중 회수되거나(사용자가 설정에서 끔) OEM 스킨의 이상 동작으로 여기서 던지면, 메인
      // 스레드 Handler 콜백이라 앱 프로세스 전체가 죽는다. try/catch로 감싸 이번 폴은 실패해도
      // 폴링 루프 자체(다음 postDelayed)는 계속 살아있게 한다.
      try {
        // 2026-07-20 실기기 검증 중 발견(알약이 "됐다 안됐다") — UsageStatsManager는 실시간 정확도를
        // 보장 안 하는 폴링 API라 놓치는 경우가 있었다. 접근성이 켜져 있으면 이벤트 기반(즉시 반영,
        // PaceAccessibilityService.getCurrentForegroundPackage)을 우선 쓰고, 꺼져있을 때만 기존
        // UsageStatsManager로 폴백한다.
        val accessibilityForeground = PaceAccessibilityService.getCurrentForegroundPackage()
        // 2026-07-24 사용자 실기기 지적 — 최근앱(멀티태스킹)/작은 화면 갔다가 유튜브로 돌아오면
        // 오버레이가 계속 안 뜨는 경우 확인. accessibility_service_config.xml의 packageNames 필터
        // 때문에 유튜브/인스타/틱톡 외 창(systemui 최근앱 화면 등)으로는 TYPE_WINDOW_STATE_CHANGED
        // 자체가 안 오므로 currentForegroundPackage가 최근앱 화면을 거치는 동안 갱신이 안 될 수
        // 있다 — 이론상 유튜브로 복귀할 때 새 이벤트가 와야 하지만, 실기기에서 어긋나는 경우가
        // 실제로 재현됐다. accessibility 쪽이 "여기 없음"이라고 할 때는 그 값을 바로 믿지 않고
        // UsageStatsManager(실시간 조회, 캐시 아님)로 한 번 더 확인해서 오탐으로 인한 오버레이
        // 실종을 막는다 — accessibility가 "여기 있음"이라고 할 때는 기존대로 즉시 신뢰한다.
        val usageStatsForeground = ForegroundAppWatcher.getForegroundPackage(applicationContext)
        val foregroundPackage = if (accessibilityForeground != null && SupportedApps.PACKAGES.contains(accessibilityForeground)) {
          accessibilityForeground
        } else {
          usageStatsForeground ?: accessibilityForeground
        }
        // 2026-08-01 실기기 재현(사용자: "지금도 오버레이가 또 없어") — dumpsys usagestats로 실기기에서
        // 직접 확인: YouTube Shorts는 영상이 바뀌어도 같은 Activity 안에서 콘텐츠만 바뀌지 새 화면
        // 전환 자체가 없다. 그래서 한 화면에 5분(STALENESS_MS) 넘게 머물면 위 두 신호(접근성 이벤트/
        // UsageStatsManager) 다 "전환 이벤트 기반"이라 똑같이 조용해진다 — 실기기에서 YouTube의
        // lastTimeUsed가 7분 넘게 안 갱신되는데도 실제로는 계속 포그라운드였음을 확인(PIP는 이 문제의
        // 일부일 뿐, 더 흔한 원인은 이 "장시간 무전환" 케이스였다). PaceAccessibilityService.
        // isSupportedAppWindowVisible()은 이벤트가 아니라 그 순간을 직접 묻는 getWindows() 기반이라
        // 이 문제 자체가 없다(같은 API로 도는 재생시간 폴링이 이 기간 내내 안 끊기고 정상 작동한 걸로
        // 이미 확인됨) — 최후 순위로 덧붙여 위 두 신호가 놓쳐도 알약이 계속 보이게 한다.
        val windowVisible = PaceAccessibilityService.isSupportedAppWindowVisible()
        val shouldShow = (foregroundPackage != null && SupportedApps.PACKAGES.contains(foregroundPackage)) || windowVisible
        // 2026-08-02 — 여기 있던 fgPoll 진단 로그 제거. POLL_INTERVAL_MS=1000이라 세션 내내 초당 1회
        // 문자열 보간+logcat 기록이 일어나 1시간에 3,600줄씩 쌓였고, 정작 필요한 로그가 링버퍼에서
        // 밀려나 디버깅을 방해했다(실기기 조사 중 반복 확인). 오버레이 표시 로직 자체는 무변경.
        if (foregroundPackage != null && SupportedApps.PACKAGES.contains(foregroundPackage)) {
          getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(PREF_LAST_TRACKED_APP_PACKAGE, foregroundPackage).apply()
        }
        if (shouldShow) refreshOverlayIfDue(remainingMinutes)
        overlayView?.visibility = if (shouldShow) View.VISIBLE else View.GONE
        // 2026-08-01 사용자 실기기 지적("크게 나오던 오버레이" — 최근 앱/멀티태스킹 화면으로 가도
        // P메뉴/Saved/Shorts HOT 리스트 창이 원래 크기 그대로 그 위에 떠서 화면이 깨져 보임) —
        // 이 창들은 SYSTEM_ALERT_WINDOW라 다른 앱 창과 달리 Recents가 축소 썸네일로 캡처하지 않고
        // 항상 실제 화면 크기로 최상단에 렌더링된다. 세션 종료(removeOverlay) 때만 정리되고 있어서,
        // 세션이 계속 켜진 채로 YouTube를 벗어나면(Recents 포함) 계속 떠 있었다 — 알약과 동일한
        // "지금 감시 대상 앱을 보고 있는가" 신호에 묶어 벗어나면 즉시 닫는다.
        if (!shouldShow) {
          hidePaceMenu()
          hideSavedFavoriteList()
          hideShortsHotList()
        }
      } catch (e: Exception) {
        Log.w("PaceOverlay", "foregroundPollRunnable failed, will retry next poll", e)
      }
      foregroundPollHandler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  // ⚠️ 실기기 검증 중 발견한 핵심 버그(2026-07-18): 남은시간 카운트다운을 원래 JS 쪽
  // (useTimerStore.tickMinute, setInterval)이 담당했는데, 사용자가 YouTube로 나가서 앱이
  // 백그라운드로 가면 이 JS setInterval 콜백이 아예 실행을 멈춘다(Bridgeless/Fabric 아키텍처에서
  // 백그라운드 JS 타이머가 억제되는 것으로 추정). 그래서 카운트다운의 "권한"을 이 서비스로 옮겼다.
  //
  // 2026-07-19 2차 보강(사용자 지적 — "Sleep 등 예외처리"): Handler.postDelayed 자체도 Doze
  // 유지보수 윈도우 밖에서는 지연되거나, 프로세스가 OEM 배터리 관리자에 의해 죽으면 완전히
  // 멈춘다(START_NOT_STICKY라 자동 재시작도 안 됐음). 두 가지로 보강:
  //  1. AlarmManager.setAndAllowWhileIdle()(PaceTickReceiver 경유)로 틱 스케줄을 옮겨 Doze에서도
  //     결국 깨어나게 한다 — 이 알람은 시스템에 등록되므로 우리 프로세스가 죽어도 살아남는다.
  //  2. 매 틱마다(그리고 시작 시) 카운트다운 상태를 SharedPreferences에 저장 — 프로세스가 죽었다가
  //     알람으로 다시 살아나도(onCreate부터 재시작) 마지막 상태를 복구해서 이어갈 수 있다.
  private var remainingMinutes = 0
  private var sleepTimerRemainingMinutes = -1
  private var breakIntervalMinutes = 0
  private var nextBreakInMinutes = 0
  private var notifyRemaining = true
  private var notifyLimit = true
  private var notifyBreak = true
  // 2026-07-19 사용자 제품 결정: 한도 도달 시 기본은 전체화면 Overlay 차단(항상 ON, 알림 권한과
  // 무관). GLOBAL_ACTION_HOME으로 YouTube 자체를 강제 종료하는 건 침해감이 훨씬 크다고 판단해
  // 사용자가 Settings에서 직접 켜야만 동작하는 별도 옵션으로 분리 — 기본값 false.
  private var hardBlockMode = false
  // 2026-07-26 사장님 결정(D8, "고급 취침모드") — 무진동 수면감지 임계값(분). 무료는 항상 10
  // (companion object 상수와 동일값), 프리미엄만 JS Settings에서 5~20 사이로 넘겨줌. 아래
  // performTick()에서 SLEEP_STILLNESS_MS 대신 이 값(분→ms 환산)을 사용.
  private var sleepStillnessMinutes = 10
  // 2026-07-27 사용자 지시 — 블루투스 스피커/이어폰을 순수 감상용으로 쓰는 사람도 있어, 볼륨키를
  // 다음/이전 넘기기 신호로 쓸지 여부를 Settings에서 별도로 끌 수 있게 한다(PaceAccessibilityService.
  // bluetoothVolumeKeySkipEnabled로 그대로 전달 — 실제 게이팅은 그 클래스의 onKeyEvent에서 함).
  private var bluetoothVolumeKeySkipEnabled = true
  // 이 프로세스 인스턴스에서 인프라(오버레이 창/폴링/미디어세션/포그라운드 알림)를 이미 세팅했는지 —
  // ACTION_TICK이 "정상 진행 중 틱"인지 "프로세스가 죽었다 알람으로 되살아난 첫 틱"인지 구분하는 용도.
  private var infraReady = false
  // 2026-08-01 실기기 재현(사용자: "P에서 앱으로 눌렀는데 세션이 왜 꺼짐") — openApp()의 pace://home
  // 딥링크로 Pace가 다시 포그라운드로 오면, JS의 "화면만 전환, 세션은 유지" 가드(overlay/index.tsx의
  // keepSessionAliveOnUnmountRef)가 AppState 'active' 리스너로 세워지는데, 이게 Expo Router의 자체
  // 딥링크 URL 처리(별도 이벤트 스트림)보다 늦게 도착하는 경합이 실기기에서 실제로 재현됨(로그로
  // 확인: openApp() 딥링크 발사 170ms 뒤 ACTION_STOP 수신) — 가드가 세워지기 전에 화면이 언마운트돼
  // "진짜 종료"로 오판했다. JS 쪽 정확한 경합 지점을 특정해 고치는 대신, 더 확실한 네이티브 쪽
  // 최후 방어선을 둔다: openApp() 직후 짧은 유예시간 안에 들어오는 STOP은 "방금 내가 유발한 화면
  // 전환의 부작용"으로 간주해 무시한다(진짜로 세션을 끝내고 싶으면 이 유예시간 이후 다시 시도하면
  // 되고, 앱으로 이동 직후 3초 안에 실제로 세션 종료 버튼까지 누르는 경우는 실사용상 사실상 없다).
  private var lastOpenAppAtMs = 0L

  // 수면 감지 강제 종료 파이프라인(스펙 §1-B/§4-B, 2026-07-23) — "누운 자세로 보다가 잠듦"을
  // "무진동 N분 지속"으로 근사. 실제 수면감지 앱(Sleep as Android 등) 공개 자료 기준 순수 무진동
  // 3분은 오탐 위험이 높다는 리서치 결론에 따라 10분(완화)을 기본값으로 채택. Flip Mode
  // (PaceFlipModule.kt)와 같은 리서치 근거로 TYPE_LINEAR_ACCELERATION 크기를 감시 —
  // "중력 성분이 이미 제거된" 값이라 기기 방향(누워서 보든 세워서 보든)과 무관하게 순수 움직임만
  // 잡아낼 수 있어 Flip Mode의 orientation 게이트보다 이 용도에 더 적합하다(방향 무관하게 "안 움직임"
  // 자체가 신호).
  private var sensorManager: SensorManager? = null
  private var stillnessListener: SensorEventListener? = null
  private var lastMotionAtMs = 0L // elapsedRealtime 기준 — 마지막으로 유의미한 움직임이 감지된 시각
  // 블루투스 이어폰 탈착은 스펙에서 "보조 신호(타이머 단축)로만, 단독 트리거로는 안 씀"이라 명시—
  // 통화 중 잠깐 빼는 경우와 "진짜로 자면서 빠짐"을 구분 못 하기 때문. 탈착이 감지되면 이번 무진동
  // 구간에 한해 더 짧은 임계값을 적용(단, 여전히 그 짧은 시간만큼은 실제로 안 움직여야 함 — 탈착
  // 자체가 즉시 트리거가 되는 게 아니다).
  private var btWasConnectedThisSession = false
  private var btDisconnectedDuringStillness = false
  // 2026-07-26 사용자 지시(외부 AI 조언 반영, "저장하고 있다가 다시 노티") — 접근성 권한이 삼성 One UI
  // 배터리 최적화로 세션 중 조용히 꺼지는 걸 이번 세션 내내 실제로 겪었다. "이전엔 켜져 있었는데
  // 지금은 꺼져 있다"는 전이를 잡아 JS가 재활성화 안내(notifyAccessibilityNeeded)를 띄울 수 있게
  // 1회성 신호를 세운다 — consumeExpired()와 동일 패턴.
  private var accessibilityRevokedPending = false

  // 한도 도달 UI 3단계화(2026-07-23, 사용자 지적 — "TAKE YOUR PACE" 3단계 시스템이 LimitReachedOverlay.tsx
  // (JS)에만 구현돼 있었는데, 그건 activeSessionPlatform===null(=홈 탭을 직접 보고 있을 때)에만 뜨는
  // 조건이 걸려 있어 실제 시청 중 한도 도달(=네이티브 showBlockOverlay 경로) 때는 전혀 안 쓰이고
  // 예전 단일 다이얼로그 문구가 그대로 나가고 있었다 — 여기 네이티브 쪽에 3단계를 새로 이식).
  // 하루 스코프 히트카운트(useLimitHitStore.ts와 동일 개념, 자정 지나면 리셋) — 1차=정확히 한도
  // 도달, 2차=+5분 한 번 더 다 씀, 3차 이상=계속 그럼(단, 3차부터는 차단이 아니라 안내만, 아래 참고).
  private var dailyLimitHitCount = 0
  // 오늘 최초로 도달했을 때의 한도(분) — 이후 "+5분" 연장을 아무리 눌러도 안 바뀜. tier1 문구
  // "{N}분 시청 완료"와 tier3+ 문구의 usageMinutes 계산(= 이 값 + (hitCount-1)*EXTEND_MINUTES) 둘 다
  // 이 값을 기준으로 삼는다 — 매 확장 사이클이 정확히 EXTEND_MINUTES만큼만 추가되는 구조라 실제
  // 오늘 시청한 총량과 정확히 일치한다.
  private var dailyLimitOriginalMinutes = 0

  private fun todayDateStr(): String =
    java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())

  // ACTION_START에서 매번 호출 — 날짜가 바뀌었으면 히트카운트/원래한도 둘 다 리셋(자정 롤오버).
  // 같은 날 안에서 세션이 여러 번 시작/종료돼도(수동 종료 후 재시작 등) 히트카운트는 유지된다 —
  // "오늘 몇 번째 도달인지"가 세션 단위가 아니라 날짜 단위 개념이기 때문.
  private fun loadDailyLimitHitState() {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val storedDate = prefs.getString(PREF_DAILY_LIMIT_HIT_DATE, null)
    val today = todayDateStr()
    if (storedDate != today) {
      dailyLimitHitCount = 0
      dailyLimitOriginalMinutes = 0
    } else {
      dailyLimitHitCount = prefs.getInt(PREF_DAILY_LIMIT_HIT_COUNT, 0)
      dailyLimitOriginalMinutes = prefs.getInt(PREF_DAILY_LIMIT_ORIGINAL_MINUTES, 0)
    }
  }

  private fun persistDailyLimitHitState() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putString(PREF_DAILY_LIMIT_HIT_DATE, todayDateStr())
      .putInt(PREF_DAILY_LIMIT_HIT_COUNT, dailyLimitHitCount)
      .putInt(PREF_DAILY_LIMIT_ORIGINAL_MINUTES, dailyLimitOriginalMinutes)
      .apply()
  }

  // ⚠️ lastMotionAtMs는 여기서 초기화하지 않는다 — ACTION_START(신규 세션)는 onStartCommand가 이미
  // "지금"으로 세팅해두고, ACTION_TICK/null 복구 경로는 restoreStateFromPrefs()가 영속값을 먼저
  // 복원해둔다(둘 다 ensureInfraReady() 호출 전에 끝남). 여기서 다시 now로 덮으면 프로세스가 죽었다
  // 살아날 때마다 무진동 시계가 리셋되는 버그가 된다.
  private fun registerStillnessSensor() {
    if (sensorManager != null) return // 중복 등록 방지
    val sm = getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
    val sensor = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) ?: return
    // companion의 isBluetoothAudioConnected(context)(2026-07-23 핑거스냅용으로 이미 추가돼 있던
    // 것)를 그대로 재사용 — 같은 조회를 중복 구현하지 않는다.
    btWasConnectedThisSession = isBluetoothAudioConnected(this)
    btDisconnectedDuringStillness = false
    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val x = event.values[0]; val y = event.values[1]; val z = event.values[2]
        val magnitude = sqrt(x * x + y * y + z * z)
        if (magnitude > STILLNESS_WAKE_EPSILON) {
          lastMotionAtMs = SystemClock.elapsedRealtime()
          btDisconnectedDuringStillness = false // 다시 움직였으니 "이번 무진동 구간"은 리셋
        }
      }
      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }
    sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, STILLNESS_REPORT_LATENCY_US)
    sensorManager = sm
    stillnessListener = listener
  }

  private fun unregisterStillnessSensor() {
    val sm = sensorManager ?: return
    stillnessListener?.let { sm.unregisterListener(it) }
    sensorManager = null
    stillnessListener = null
  }

  // 2026-07-19: Bluetooth Hands-Free Control — 사용자 지시(Copilot 스펙 정리) 반영. 새 네이티브
  // 의존성(react-native-track-player 등) 없이 Android SDK 표준 android.media.session.MediaSession
  // 하나로 구현 — 이미 검증된 이 서비스(포그라운드, 세션 생명주기와 일치) 안에서 세션을 열고 닫는다.
  // ⚠️ 실기기 검증 중 발견(2026-07-19): MediaSession만 active=true로 만들어도 부족했다 —
  // `adb shell dumpsys media_session`으로 직접 확인한 결과, YouTube가 실제로 오디오를 재생 중이면
  // 시스템의 "Media button session"(하드웨어 버튼이 실제로 라우팅되는 대상)이 YouTube 쪽에 그대로
  // 남아있었다. Android는 미디어 버튼을 "활성 세션"이 아니라 "오디오 포커스를 쥔 쪽"에 우선
  // 라우팅한다 — Pace는 자체 오디오를 전혀 재생 안 해서 포커스를 요청한 적이 없었던 게 원인.
  // 고침: AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK으로 짧게 포커스를 요청 — YouTube 재생을 멈추게 하지
  // 않고(다른 앱이 STOP당하는 GAIN이 아니라 TRANSIENT) 살짝 더킹만 허용하면서 미디어 버튼 라우팅
  // 우선권을 가져온다. 이게 표준 Android 패턴(재생은 안 하지만 버튼은 받고 싶은 앱들이 쓰는 방식).
  private var mediaSession: MediaSession? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private val audioFocusHandler = Handler(Looper.getMainLooper())
  // 2026-07-19 3차 보강(실기기 재검증): TRANSIENT_MAY_DUCK 요청은 세션 시작 시 딱 1번뿐이었다 —
  // YouTube가 곧이어 자기 영상 재생을 위해 AUDIOFOCUS_GAIN(완전 점유)을 요청하면 Pace의 임시
  // 포커스가 그 즉시 밀려나고, 그 뒤로 재요청 로직이 없어 세션 끝날 때까지 버튼이 계속 YouTube로
  // 갔다(`dumpsys media_session`으로 반복 재현 확인). OnAudioFocusChangeListener로 LOSS 콜백을
  // 받을 때마다 짧은 지연 후 재요청 — YouTube가 재생을 시작할 때마다 뺏겼다 곧바로 되찾는 식으로
  // "핑퐁"하되, 최종적으로 Pace가 하드웨어 버튼 콜백은 계속 받을 수 있게 한다.
  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    Log.d("PaceOverlay", "audioFocus changed: $focusChange (mediaSession=${if (mediaSession != null) "alive" else "null"})")
    if (mediaSession == null) return@OnAudioFocusChangeListener
    when (focusChange) {
      AudioManager.AUDIOFOCUS_LOSS,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        audioFocusHandler.postDelayed({ if (mediaSession != null) requestAudioFocusForMediaButtons() }, 400)
      }
      else -> {}
    }
  }

  private fun setupMediaSession() {
    if (mediaSession != null) return
    val session = MediaSession(this, "PaceSession")
    session.setCallback(object : MediaSession.Callback() {
      // 2026-07-31 실기기 발견 — 이 콜백이 bluetoothVolumeKeySkipEnabled를 전혀 확인하지 않아서, Focus
      // 탭에서 "블루투스 리모컨" 토글을 꺼도 실제 블루투스 기기가 미디어 next/previous 신호를 보내면
      // (의도치 않은 터치/노이즈 포함) 항상 스와이프+"Next Short" 토스트가 떴다(사용자 지적: "블루투스
      // 손짓 다 꺼져있었는데"). 다른 진입 경로(볼륨키)와 동일하게 이 플래그로 게이팅한다.
      override fun onSkipToNext() { if (bluetoothVolumeKeySkipEnabled) triggerNext(applicationContext) }
      override fun onSkipToPrevious() { if (bluetoothVolumeKeySkipEnabled) triggerPrevious(applicationContext) }
      override fun onPlay() { setAutoMode(applicationContext, true) }
      override fun onPause() { setAutoMode(applicationContext, false) }
    })
    session.isActive = true
    mediaSession = session
    updateMediaSessionPlaybackState(playing = true)
    requestAudioFocusForMediaButtons()
  }

  private fun teardownMediaSession() {
    audioFocusHandler.removeCallbacksAndMessages(null)
    abandonAudioFocus()
    mediaSession?.release()
    mediaSession = null
  }

  // 2026-07-23 실험 2건 완료(둘 다 제거됨) — B22(YouTube 실제 재생 중 미디어 버튼 라우팅 불가) 재검증:
  //  #1 무음 AudioTrack 실제 재생 + 기존 GAIN_TRANSIENT_MAY_DUCK: state=PLAYING(3)로 진짜 재생
  //     확인됐지만 Media button session은 계속 YouTube.
  //  #2 완전 독점 AUDIOFOCUS_GAIN + 무음 재생: 처음엔 포커스를 얻었지만(result=1) YouTube가 자기
  //     재생을 위해 곧바로 재요청해 2.3초 만에 우리가 AUDIOFOCUS_LOSS로 밀려남(그 사이 YouTube
  //     오디오가 실제로 끊기거나 덕킹됐을 가능성 높음 — 이게 이 방식의 실제 대가) — 그런데도
  //     Media button session은 여전히 YouTube. 웹 리서치로 근본 원인도 확인: 블루투스 AVRCP
  //     커맨드는 진짜 볼륨키(evdev 이벤트 → AccessibilityInputFilter)와 완전히 다른 경로로 들어옴
  //     (com.android.bluetooth → AudioService → MediaSessionService, 시스템 내부 Binder IPC라
  //     AccessibilityService.onKeyEvent가 원천적으로 못 봄). 새 리스너 API들(OnMediaKeyEventDispatched
  //     Listener 등)도 MEDIA_CONTENT_CONTROL(시스템 서명 전용) 권한 필요해 스토어 앱은 접근 불가.
  //     최종 결론: Android 플랫폼 레벨 제약, 어떤 서드파티 라이브러리(react-native-track-player 등)로
  //     바꿔도 동일 — B22 최종 확정, 더 이상 이 방향 시도 안 함.

  private fun requestAudioFocusForMediaButtons() {
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_UNKNOWN)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener(audioFocusListener, audioFocusHandler)
        .build()
      val result = audioManager.requestAudioFocus(request)
      audioFocusRequest = request
      Log.d("PaceOverlay", "requestAudioFocus result=$result (1=GRANTED,0=FAILED,2=DELAYED)")
    } else {
      @Suppress("DEPRECATION")
      val result = audioManager.requestAudioFocus(audioFocusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      Log.d("PaceOverlay", "requestAudioFocus(legacy) result=$result")
    }
  }

  private fun abandonAudioFocus() {
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(audioFocusListener)
    }
  }

  private fun updateMediaSessionPlaybackState(playing: Boolean) {
    val state = PlaybackState.Builder()
      .setActions(
        PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE
      )
      .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, 0, 1f)
      .build()
    mediaSession?.setPlaybackState(state)
  }

  private fun markExpired(reason: String) {
    val editor = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putBoolean(PREF_EXPIRED, true)
      .putString(PREF_EXPIRE_REASON, reason)
    // sleep_detected일 때만 "마지막 실제 움직임" 시각을 벽시계로 환산해 같이 남긴다 — elapsedRealtime은
    // 부팅 후 경과시간이라 그 자체로는 JS에 의미가 없으므로, 지금(currentTimeMillis)에서 무진동 경과분을
    // 빼 "그 순간의 실제 시각"으로 변환한다.
    if (reason == "sleep_detected") {
      val stillnessElapsedMs = SystemClock.elapsedRealtime() - lastMotionAtMs
      editor.putLong(PREF_SLEEP_ONSET_AT_MS, System.currentTimeMillis() - stillnessElapsedMs)
    }
    editor.apply()
  }

  // 2026-07-27 감사 발견(크리티컬) — 이 서비스가 띄우는 알림/전체화면차단/토스트 문구가 전부
  // 한국어로 하드코딩돼 있었다. 이건 JS의 src/services/i18n을 안 거치는 순수 네이티브 코드라,
  // 기기 언어가 영어여도 이 문구들만 한국어로 보이는 상태였다(JS 쪽 LimitReachedOverlay.tsx 등
  // 같은 화면의 JS 사본은 이미 정상적으로 영문 대응돼 있었음 — 네이티브 사본만 놓친 것).
  // 한국어(ko) 기기에서만 한국어, 그 외(영어 포함 전부)는 영어로 — JS i18n의 폴백 방향(미지원
  // 로케일→영어)과 동일한 원칙.
  private fun isKoreanLocale(): Boolean = resources.configuration.locales[0].language == "ko"

  // Daily Limit 알림(notifyLimit)/저시간 경고(notifyRemaining)/Break Reminder(notifyBreak) 전부
  // 이 헬퍼로 통일 — expo-notifications(JS)와 별개의 네이티브 채널을 쓴다. JS 쪽 'pace-session'
  // 채널은 JS 코드가 실행돼야(ensureAndroidChannel) 생성되는데, 이 서비스는 JS 없이도(백그라운드에서)
  // 독립적으로 동작해야 하므로 채널 생성 자체도 네이티브에서 자기 완결적으로 처리한다.
  private fun ensureAlertChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(ALERT_CHANNEL_ID, "Pace Alerts", NotificationManager.IMPORTANCE_HIGH)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun sendAlertNotification(id: Int, title: String, body: String) {
    try {
      ensureAlertChannel()
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, ALERT_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION") Notification.Builder(this)
      }
      val notification = builder
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(android.R.drawable.ic_menu_recent_history)
        .setAutoCancel(true)
        .build()
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, notification)
    } catch (e: Exception) {
      Log.w("PaceOverlay", "sendAlertNotification failed (id=$id)", e)
    }
  }

  // ── 상태 영속화(2026-07-19) ── 프로세스가 죽었다가 PaceTickReceiver의 알람으로 되살아나도
  // 카운트다운을 이어갈 수 있도록, 매 틱/시작 시점의 상태를 SharedPreferences에 남긴다.
  private fun persistState() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putBoolean(PREF_SESSION_ACTIVE, true)
      .putInt(PREF_REMAINING, remainingMinutes)
      .putInt(PREF_SLEEP_TIMER, sleepTimerRemainingMinutes)
      .putInt(PREF_BREAK_INTERVAL, breakIntervalMinutes)
      .putInt(PREF_NEXT_BREAK_IN, nextBreakInMinutes)
      .putBoolean(PREF_NOTIFY_REMAINING, notifyRemaining)
      .putBoolean(PREF_NOTIFY_LIMIT, notifyLimit)
      .putBoolean(PREF_NOTIFY_BREAK, notifyBreak)
      .putBoolean(PREF_AUTO_NEXT_SESSION, autoNextEnabled)
      .putBoolean(PREF_HARD_BLOCK_MODE, hardBlockMode)
      .putLong(PREF_LAST_MOTION_AT_MS, lastMotionAtMs)
      .putInt(PREF_SLEEP_STILLNESS_MINUTES, sleepStillnessMinutes)
      .putBoolean(PREF_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED, bluetoothVolumeKeySkipEnabled)
      .apply()
  }

  private fun restoreStateFromPrefs(): Boolean {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(PREF_SESSION_ACTIVE, false)) return false
    remainingMinutes = prefs.getInt(PREF_REMAINING, 0)
    sleepTimerRemainingMinutes = prefs.getInt(PREF_SLEEP_TIMER, -1)
    breakIntervalMinutes = prefs.getInt(PREF_BREAK_INTERVAL, 0)
    nextBreakInMinutes = prefs.getInt(PREF_NEXT_BREAK_IN, 0)
    notifyRemaining = prefs.getBoolean(PREF_NOTIFY_REMAINING, true)
    notifyLimit = prefs.getBoolean(PREF_NOTIFY_LIMIT, true)
    notifyBreak = prefs.getBoolean(PREF_NOTIFY_BREAK, true)
    autoNextEnabled = prefs.getBoolean(PREF_AUTO_NEXT_SESSION, false)
    hardBlockMode = prefs.getBoolean(PREF_HARD_BLOCK_MODE, false)
    // 프로세스 재시작(kill+알람 복구)이어도 무진동 시계가 "지금부터 다시 10분"으로 리셋되지 않게
    // 마지막 움직임 시각을 복원 — 없으면(구버전 상태/최초) 안전하게 지금으로(즉시 만료 방지).
    lastMotionAtMs = prefs.getLong(PREF_LAST_MOTION_AT_MS, SystemClock.elapsedRealtime())
    sleepStillnessMinutes = prefs.getInt(PREF_SLEEP_STILLNESS_MINUTES, 10)
    bluetoothVolumeKeySkipEnabled = prefs.getBoolean(PREF_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED, true)
    PaceAccessibilityService.bluetoothVolumeKeySkipEnabled = bluetoothVolumeKeySkipEnabled
    // 한도 도달 히트카운트도 같은 이유로 복원 — 안 하면 프로세스가 죽었다 살아날 때마다 오늘 몇 번째
    // 도달인지가 0으로 리셋돼 tier가 항상 1로 되돌아가는 버그가 된다(날짜가 바뀌었으면 여기서 그냥
    // 이전 날짜 값을 그대로 들고 오지만, 다음 도달 시점에 performTick이 부르는 게 아니라 ACTION_START
    // 때만 loadDailyLimitHitState()로 날짜 검사를 하므로 — 세션이 자정을 넘겨 계속 살아있는 드문
    // 케이스는 여기서 완벽히 커버 안 됨, 알려진 한계로 남김).
    loadDailyLimitHitState()
    return true
  }

  private fun clearSessionActive() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putBoolean(PREF_SESSION_ACTIVE, false)
      .apply()
  }

  // 2026-07-26 — "이전엔 켜져 있었는데 지금은 꺼져 있다"는 전이만 잡는다(단순히 "지금 꺼져 있다"가
  // 아니라 — 애초에 한 번도 켠 적 없는 사용자에게 꺼졌다고 알리면 안 되므로). PREF_A11Y_WAS_ENABLED는
  // performTick()이 60초마다 살아있는 세션 동안만 갱신 — 세션이 없을 때의 회수는 이 경로로 못 잡지만,
  // 가장 disruptive한 "세션 도중 회수"는 확실히 잡는다.
  private fun checkAccessibilityRevoked() {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val nowEnabled = PaceAccessibilityService.isEnabled(this)
    val wasEnabled = prefs.getBoolean(PREF_A11Y_WAS_ENABLED, false)
    if (nowEnabled) {
      if (!wasEnabled) prefs.edit().putBoolean(PREF_A11Y_WAS_ENABLED, true).apply()
    } else if (wasEnabled) {
      accessibilityRevokedPending = true
      prefs.edit().putBoolean(PREF_A11Y_WAS_ENABLED, false).apply()
      Log.w("PaceOverlay", "ACCESSIBILITY_REVOKED — was enabled, now disabled (likely OEM background optimization)")
    }
  }

  // 오버레이 창/포그라운드 알림/포그라운드 폴링/미디어세션 세팅 — ACTION_START(정상 시작)와
  // ACTION_TICK(프로세스가 죽었다 알람으로 되살아난 경우, infraReady==false)이 공유하는 초기화
  // 경로. 이미 세팅돼 있으면(같은 프로세스에서 이미 돌고 있던 정상 틱) 아무 것도 안 한다.
  private fun ensureInfraReady() {
    if (infraReady) return
    startForeground(NOTIFICATION_ID, buildNotification(remainingMinutes))
    showOverlay(remainingMinutes)
    startForegroundAppPolling()
    setupMediaSession()
    registerStillnessSensor()
    // 2026-07-26 — ACTION_TICK 프로세스-재시작 복구 경로도 커버: 이 서비스 프로세스는 죽었다 살아나도
    // PaceAccessibilityService(별도 OS 바인딩 서비스)의 isTrackingPlayback 상태가 이미 살아있으면
    // 아무 것도 안 하지만(내부에서 idempotent), 혹시 그쪽도 같이 재시작됐다면 여기서 다시 켜준다.
    PaceAccessibilityService.startPlaybackTracking()
    // 2026-08-01 실기기 감사 발견 — Focus Session(bt_auto_mode) 10분 타이머도 같은 클래스의 버그였다
    // (위 restoreFocusSessionTimerIfNeeded 선언부 참고): 인메모리 Handler 예약이라 프로세스 복구
    // 시점에 같이 다시 걸어주지 않으면 영영 안 꺼진다.
    restoreFocusSessionTimerIfNeeded(this)
    infraReady = true
  }

  // ACTION_TICK과 intent==null(시스템 START_STICKY 재시작) 둘 다 "이 프로세스 인스턴스에서 아직
  // 인프라를 안 세팅했으면 SharedPreferences에서 복구부터 하라"는 같은 요구를 가진다 — 중복 방지용
  // 공통 헬퍼. 세션이 이미 끝난 뒤의 낡은 트리거면 false(호출부가 stopSelf 처리).
  private fun restoreIfNeeded(): Boolean {
    if (infraReady) return true
    if (!restoreStateFromPrefs()) return false
    ensureInfraReady()
    return true
  }

  companion object {
    private const val POLL_INTERVAL_MS = 1000L
    // 2026-07-28 — 오버레이 유령 창(mHasSurface=false) 대응 강제 재생성 주기. 너무 짧으면 매번
    // add/removeView 오버헤드+깜빡임, 너무 길면 복구 체감이 느림 — 4초로 절충.
    private const val REFRESH_INTERVAL_MS = 4000L
    private const val TICK_INTERVAL_MS = 60_000L
    private const val CHANNEL_ID = "pace_overlay_channel"
    private const val NOTIFICATION_ID = 4201
    private const val ACTION_START = "expo.modules.paceoverlay.START"
    private const val ACTION_UPDATE = "expo.modules.paceoverlay.UPDATE"
    private const val ACTION_STOP = "expo.modules.paceoverlay.STOP"
    // openApp() 직후 이 시간 안에 들어오는 STOP은 무시 — 위 lastOpenAppAtMs 필드 주석 참고.
    private const val OPEN_APP_STOP_GRACE_MS = 3_000L
    const val ACTION_TICK = "expo.modules.paceoverlay.TICK"
    private const val EXTRA_REMAINING = "remainingMinutes"
    private const val EXTRA_AUTO_NEXT = "autoNextEnabled"
    private const val EXTRA_SLEEP_TIMER_MINUTES = "sleepTimerMinutes"
    private const val EXTRA_BREAK_INTERVAL_MINUTES = "breakIntervalMinutes"
    private const val EXTRA_NOTIFY_REMAINING = "notifyRemaining"
    private const val EXTRA_NOTIFY_LIMIT = "notifyLimit"
    private const val EXTRA_NOTIFY_BREAK = "notifyBreak"
    private const val EXTRA_HARD_BLOCK_MODE = "hardBlockMode"
    private const val EXTEND_MINUTES = 5
    private const val ALERT_CHANNEL_ID = "pace_overlay_alerts"
    private const val NOTIFICATION_ID_LOW_TIME = 4202
    private const val NOTIFICATION_ID_LIMIT_REACHED = 4203
    private const val NOTIFICATION_ID_BREAK_REMINDER = 4204
    private const val TICK_ALARM_REQUEST_CODE = 4210
    // 2026-07-26 — 수면감지 암전 화면에서 상태바/내비바까지 완전히 숨기기 위한 플래그 조합
    // (View.setSystemUiVisibility, API 30 이후 deprecated지만 여전히 동작). STICKY라 스와이프로
    // 잠깐 드러나도 위 setOnSystemUiVisibilityChangeListener가 즉시 재적용한다.
    @Suppress("DEPRECATION")
    private const val SLEEP_BLACKOUT_IMMERSIVE_FLAGS = (
      View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
      View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
      View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
      View.SYSTEM_UI_FLAG_FULLSCREEN or
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    )

    // 수면 감지(스펙 §1-B/§4-B) — 리서치 근거는 Flip Mode(PaceFlipModule.kt)와 공유: 실제 수면감지
    // 앱들(Sleep as Android 등) 공개 자료 기준 순수 무진동 3분(사용자 원 스펙)은 오탐 위험이 높다고
    // 명시돼 있어 10분으로 완화(기본 임계값은 이제 인스턴스 필드 sleepStillnessMinutes, 2026-07-26
    // D8 프리미엄 조절 기능 참고). 블루투스 탈착이 겹치면(보조 신호) 6분으로 단축 — 그래도 여전히
    // "탈착 이후로도 그만큼 안 움직여야" 하므로 탈착 자체가 즉시 트리거가 되지 않는다.
    private const val SLEEP_STILLNESS_SHORT_MS = 6 * 60 * 1000L
    // 2026-07-26 사용자 지적 — "가만히 있으면 무조건 수면으로 판단"이 낮 시간대(거치대에 세워두고
    // 안 만지는 등)에 오탐을 낸다. 순수 무진동 시간만으로는 "진짜 잠"과 "낮에 가만히 두고 봄"을
    // 구분할 수 없으므로(움직임 신호 하나로는 원천적 한계), 실제 취침이 몰리는 시간대에만 이 판정
    // 자체를 적용하는 2차 게이트를 추가한다 — useFlipStore.ts의 QUIET_HOURS(00~06시, 크레딧 제외용)
    // 보다 넓게 잡음: 이건 "혹시 수면 중일 수도 있는 시간"을 판정 대상으로 아예 좁히는 것이라, 너무
    // 좁히면 늦게 자거나 늦잠 자는 사용자를 놓친다 — 밤 10시~아침 9시로 넉넉히 잡아 자정을 걸친다.
    private const val SLEEP_WINDOW_START_HOUR = 22 // 22:00
    private const val SLEEP_WINDOW_END_HOUR = 9 // 09:00 (다음날)
    // Flip Mode의 LINEAR_ACCEL_EPSILON(1.2)보다 살짝 낮게 — 여긴 "완전히 멈췄다"를 원하므로
    // Flip Mode(오탐 완화용 보조 게이트)보다 더 엄격하게 잡아도 무방.
    private const val STILLNESS_WAKE_EPSILON = 1.0f
    // 수면감지는 몇 분 단위 판정이라 초 단위 정밀도가 필요 없음 — 배터리를 위해 배칭 지연을 여유있게.
    private const val STILLNESS_REPORT_LATENCY_US = 5_000_000 // 5s
    private const val PREF_LAST_MOTION_AT_MS = "session_last_motion_at_ms"
    // 2026-07-26 사장님 결정(D8, "고급 취침모드") — 무진동 수면감지 임계값(분), 프리미엄 전용 조절.
    private const val PREF_SLEEP_STILLNESS_MINUTES = "sleep_stillness_minutes"
    private const val EXTRA_SLEEP_STILLNESS_MINUTES = "sleepStillnessMinutes"
    // 2026-07-27 사용자 지시 — 블루투스 볼륨키로 영상 넘기기 on/off.
    private const val PREF_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED = "bluetooth_volume_key_skip_enabled"
    private const val EXTRA_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED = "bluetoothVolumeKeySkipEnabled"
    // 한도 도달 3단계 히트카운트 영속 키(날짜 스코프) — 위 PREF_LAST_MOTION_AT_MS와 마찬가지로
    // PREFS_NAME 안에 같이 저장(별도 파일 불필요).
    private const val PREF_DAILY_LIMIT_HIT_DATE = "daily_limit_hit_date"
    private const val PREF_DAILY_LIMIT_HIT_COUNT = "daily_limit_hit_count"
    private const val PREF_DAILY_LIMIT_ORIGINAL_MINUTES = "daily_limit_original_minutes"
    // 2026-07-26 — "접근성이 이전에 켜져 있었다" 기억용(checkAccessibilityRevoked 참고).
    private const val PREF_A11Y_WAS_ENABLED = "a11y_was_enabled"
    // 2026-08-01 사용자 지시("설정하면 바로 PACE로 와야 한다고 말했을 텐데 계속 설정이잖아") —
    // 뒤로가기로 Pace 태스크에 복귀하는 것(PaceOverlayModule.requestAccessibilityPermission,
    // currentActivity 수정)만으론 부족했다: 사용자가 토글을 켠 "그 즉시" 자동으로 Pace로 돌아와야
    // 한다는 요구. PaceAccessibilityService.onServiceConnected()가 정확히 "토글이 켜진 순간"
    // 호출되므로 거기서 Pace를 앞으로 가져오면 되는데, 이 콜백은 재부팅/프로세스 재시작 등 사용자
    // 액션과 무관한 경우에도 똑같이 불려서 아무 때나 Pace를 강제로 띄우면 안 된다. requestAccessibilityPermission()
    // 호출 직전 시각을 저장해두고, onServiceConnected가 그 시각으로부터 일정 시간 안에 왔을 때만
    // "방금 설정에서 직접 켠 것"으로 간주해 자동 복귀시킨다(PaceOverlayModule 참고).
    const val PREF_ACCESSIBILITY_REQUEST_AT_MS = "accessibility_request_at_ms"

    // PaceOverlayModule.consumeExpired()가 읽는 "네이티브가 시간을 다 써서 스스로 세션을
    // 차단했다" 플래그 + 사유 — JS가 다음에 Pace로 돌아왔을 때 한 번만 소비(읽고 즉시 리셋)한다.
    const val PREFS_NAME = "pace_overlay"
    const val PREF_EXPIRED = "expired"
    const val PREF_EXPIRE_REASON = "expire_reason"
    // 2026-07-31 — Saved/Favorite 네이티브 오버레이가 saved_videos에 쓸 때 필요한 user_id 캐시(위
    // PaceOverlayModule.cacheUserId 참고).
    const val PREF_CACHED_USER_ID = "cached_user_id"
    // 2026-08-01 — Shorts HOT 네이티브 오버레이가 백엔드 REST를 직접 호출할 때 필요(위
    // PaceOverlayModule.cacheApiBaseUrl/cacheAuthToken 참고, client.ts가 값 변경마다 채워줌).
    const val PREF_CACHED_API_BASE_URL = "cached_api_base_url"
    const val PREF_CACHED_AUTH_TOKEN = "cached_auth_token"
    // 2026-08-01 사장님 지적 — 보상형 광고로 Focus Session 5분 연장해도 유튜브로 자동 복귀가 안 됨
    // (사용자가 Pace 홈 화면에 남겨져서 직접 다시 스와이프해 돌아가야 했음). foregroundPollRunnable이
    // 감시 대상 앱을 감지할 때마다 여기 저장해두고, extendFocusSession()에서 이 패키지를 다시 전경으로
    // 불러온다 — 광고 보러 Pace로 오기 직전에 뭘 보고 있었는지는 폴링 결과로만 알 수 있다.
    private const val PREF_LAST_TRACKED_APP_PACKAGE = "last_tracked_app_package"
    // 2026-07-26 사용자 지적 — "1시 3분에 잠들었는데 실제로는 10분 전(무진동 시작 시점)이 진짜
    // 잠든 시각에 더 가깝지 않냐" — markExpired() 호출 시각(=무진동 임계값을 넘긴 시각)은 실제
    // 마지막 움직임(lastMotionAtMs)보다 stillnessThresholdMs만큼 항상 늦다. sleep_detected일 때만
    // 마지막 움직임의 벽시계 시각(epoch ms)을 같이 저장해, JS가 세션 ended_at을 "감지된 시각"이
    // 아니라 "마지막으로 움직인 시각"으로 정확히 기록하게 한다(consumeExpired 참고).
    const val PREF_SLEEP_ONSET_AT_MS = "sleep_onset_at_ms"
    const val PREF_AUTO_MODE = "bt_auto_mode"
    // 2026-08-01 실기기 감사 발견 — focusSessionAutoStop 타이머는 setAutoMode(true)가 호출될 때만
    // focusSessionHandler(인메모리, 프로세스 종료 시 소실)에 예약된다. 그런데 PREF_AUTO_MODE는
    // SharedPreferences라 프로세스가 강제종료/OOM kill로 죽었다 살아나도 true로 남아있어서, 알약은
    // "FOCUS ON"으로 계속 보이는데 10분 자동종료 타이머는 다시는 안 걸리는 버그가 있었다(무료
    // 사용자가 광고 게이트를 영영 안 만나고 무제한 자동넘김을 쓸 수 있었음). 벽시계 기준 마감 시각을
    // 같이 저장해뒀다가 restoreFocusSessionTimerIfNeeded()가 프로세스 복구 시 남은 시간만큼 다시
    // 예약(이미 지났으면 즉시 타임아웃 처리)한다.
    private const val PREF_FOCUS_SESSION_DEADLINE_AT_MS = "focus_session_deadline_at_ms"
    // 2026-07-27 사용자 지시("왜 손짓을 빼니" — 마스터와 독립적으로 손짓만 따로 끄고 켤 수 있어야 함) —
    // 기존엔 setAutoMode(enable)의 enable 하나가 손짓 감지 시작/중지까지 같이 묶어버렸다. 블루투스
    // 볼륨키 스킵과 동일한 원칙으로, 손짓도 마스터(Focus Session)와 별개인 자체 on/off를 갖는다.
    private const val PREF_HANDSFREE_GESTURE_ENABLED = "handsfree_gesture_enabled"
    // 2026-08-01 사용자 지시("포커스 다 쓰면 오버레이 Focus off로 띄우고 누르면 광고 보고 시간
    // 주면 되잖아") — "FOCUS OFF" 배지(아래 appBtn 옆 autoBadge)는 이미 있었고 탭도 되지만,
    // 탭하면 무조건 setAutoMode(true)로 바로 재활성화돼서 무료 사용자도 광고 한 번 없이 계속
    // 무한정 10분씩 다시 켤 수 있었다(보상형 광고로 시간 늘려주기로 한 설계와 모순). 네이티브는
    // 구독 상태를 모르므로 JS가 isPremium이 바뀔 때마다 이 값을 여기로 밀어준다
    // (PaceOverlayModule.setIsPremium, _layout.tsx).
    private const val PREF_IS_PREMIUM = "is_premium"
    // 2026-08-02 — 위 setAvailableCredits/consumePendingCreditSpend 참고(FOCUS OFF 선택 팝업용).
    private const val PREF_AVAILABLE_CREDITS = "available_credits"
    private const val PREF_PENDING_CREDIT_SPEND = "pending_credit_spend"
    // 2026-07-19: 카운트다운 상태 영속화 키(프로세스 재생성 복구용) — 위 PREF_AUTO_MODE(블루투스
    // Auto Mode 스위치)와는 별개 개념이라 이름을 분리했다.
    private const val PREF_SESSION_ACTIVE = "session_active"
    private const val PREF_REMAINING = "session_remaining_minutes"
    private const val PREF_SLEEP_TIMER = "session_sleep_timer_remaining"
    private const val PREF_BREAK_INTERVAL = "session_break_interval_minutes"
    private const val PREF_NEXT_BREAK_IN = "session_next_break_in_minutes"
    private const val PREF_NOTIFY_REMAINING = "session_notify_remaining"
    private const val PREF_NOTIFY_LIMIT = "session_notify_limit"
    private const val PREF_NOTIFY_BREAK = "session_notify_break"
    private const val PREF_AUTO_NEXT_SESSION = "session_auto_next_enabled"
    private const val PREF_HARD_BLOCK_MODE = "session_hard_block_mode"

    // Bluetooth Hands-Free(2026-07-19) — MediaSession 콜백(하드웨어 리모컨)과 PaceOverlayModule의
    // JS 바인딩(Focus 탭 인앱 버튼 탭) 둘 다 이 companion 함수를 호출한다 — 입력 소스만 다르고 실제
    // 동작(스와이프/토글/토스트/카운터)은 하나로 통일. instance는 활성 세션이 있을 때만 재생상태를
    // MediaSession에 반영하는 용도라, 세션 없이 호출돼도(instance==null) 스와이프/토스트/카운터
    // 자체는 정상 동작한다.
    private var instance: PaceOverlayService? = null

    // 2026-07-26 사용자 지시 — 수면감지 무진동 타이머는 가속도계(폰 물리적 움직임)만 보는데, Focus
    // Session의 핵심은 "폰을 안 만지고 손짓/스냅/블루투스 리모컨으로만 조작"이다. 그래서 정상적으로
    // 핸즈프리를 쓰기만 해도 폰 자체는 안 움직이니 결국 잠들었다고 오판하는 문제가 실기기에서
    // 확인됐다(SESSION END reason=sleep_detected, 실제로는 계속 스와이프하며 시청 중이었음). 자동
    // 재생위치 기반 스와이프(checkPlaybackAndMaybeSwipe, PaceAccessibilityService)는 사람 개입이
    // 전혀 없어 "깨어있음" 증거가 될 수 없지만, 사람이 직접 낸 신호(핑거스냅/손짓/블루투스 리모컨
    // 버튼)는 진짜 의식적 행동이므로 이걸 감지하면 무진동 시계를 리셋한다 — swipeOnce(핑거스냅/손짓/
    // 블루투스 미디어버튼 공용 경로)와 볼륨키 리모컨 경로 양쪽에서 호출(PaceAccessibilityService 참고).
    fun markUserActivity() {
      instance?.lastMotionAtMs = SystemClock.elapsedRealtime()
    }

    // 2026-08-01 사용자 실기기 지적("숏츠 보는 중도 아닌데 왜 Next Short 토스트가 뜨냐") — 원래
    // "블루투스/미디어 next 신호 자체가 이미 숏폼을 보고 있다는 강한 증거"라는 가정으로 포그라운드
    // 확인 없이 무조건 스와이프+토스트를 냈다(onSkipToNext 주석 참고). 그 가정이 깨지는 경우(연결된
    // 기기의 의도치 않은 신호, 세션은 켜져 있지만 사용자가 Pace 홈 등 다른 화면을 보는 중 등)엔 실제로
    // 아무것도 넘길 게 없는데 토스트만 떠서 혼란을 준다 — 오늘 오버레이 표시 여부 수정에 쓴 것과 같은
    // 신뢰할 수 있는 신호(isSupportedAppWindowVisible, getWindows() 기반)로 실제로 감시 대상 앱을
    // 보고 있을 때만 동작하도록 게이팅한다.
    fun triggerNext(context: Context) {
      // 2026-08-02 진단 로그 — 사용자 실기기 보고("핸즈프리 다 켜져있는데 손짓이 아예 안 됨").
      // PaceHandWaveDetector 쪽은 WAVE detected 로그가 실제로 찍히는 걸 확인했는데, 그 다음
      // triggerNext()가 조용히 return하는지(swipeOnce까지 못 가는지) 로그가 전혀 없어 구분이
      // 안 됐다 — 어느 쪽에서 끊기는지 확정하려고 추가.
      if (!PaceAccessibilityService.isSupportedAppWindowVisible()) {
        Log.w("PaceOverlayService", "triggerNext() aborted — isSupportedAppWindowVisible()=false")
        return
      }
      Log.i("PaceOverlayService", "triggerNext() -> swipeOnce(up=true)")
      PaceAccessibilityService.swipeOnce(up = true)
      bumpBluetoothCounter(context, "bt_next_count")
      showToast(context, "⏭ Next Short")
    }

    fun triggerPrevious(context: Context) {
      if (!PaceAccessibilityService.isSupportedAppWindowVisible()) return
      PaceAccessibilityService.swipeOnce(up = false)
      bumpBluetoothCounter(context, "bt_previous_count")
      showToast(context, "⏮ Previous Short")
    }

    // 2026-07-20 Focus Session 리디자인(PACE_ARCHITECTURE.md 참고): "자동재생"을 무기한으로 도는
    // 워처가 아니라, 사용자가 켠 시점부터 정해진 시간으로 제한한다 — Google Play 정책의 "자율적
    // 판단·실행 자동화 금지" 조항은 무기한 자율 동작을 문제 삼는 것이지, 사용자가 명시적으로 켠 뒤
    // 정해진 시간 동안만 도는 것까지 금지하지 않는다("If Trigger X(세션 켜짐) occurs, perform
    // Action Y(N분간 자동 진행)" — 결정적 규칙, N은 상수든 사용자가 고른 값이든 무방).
    // 시간이 다 되면 네이티브가 스스로 꺼서 재확인 없이 무기한 지속되는 일이 없게 한다.
    // ⚠️ 사용자 지시(2026-07-20): 10분을 하드코딩 상수로 박아두지 말고 사용자가 직접 시간을 고를 수
    // 있게 — SharedPreferences에 저장된 값을 읽어 쓰고, 기본값만 10분(설정 안 한 최초 상태 대비).
    private const val DEFAULT_FOCUS_SESSION_MINUTES = 10
    const val PREF_FOCUS_SESSION_MINUTES = "focus_session_duration_minutes"
    private val focusSessionHandler = Handler(Looper.getMainLooper())
    // 2026-07-26 사용자 지시("무료일땐 10분 고정, 보상광고 보면 늘려줘") — 이 Runnable이 실행됐다는
    // 것 자체가 "시간이 다 돼서 자동으로 꺼짐"이라는 뜻(사용자가 직접 끈 경우는 이 경로를 안 탐) —
    // JS가 이 신호를 소비해서 보상형 광고 유도 모달을 띄운다(consumeExpired와 동일한 1회성 패턴).
    private var focusSessionTimedOutPending = false
    private val focusSessionAutoStop = Runnable {
      focusSessionTimedOutPending = true
      instance?.let {
        setAutoMode(it.applicationContext, false)
        // 2026-08-01 (번복) 사용자 지시 — "무료여도 시간 만료 시 쇼츠를 막지 않는다, 그냥 추적만
        // 되는 거다. 홈으로 강제로 보내지 말고 쇼츠에 그대로 머물게 하고, 사용자가 FOCUS ON 배지를
        // 직접 눌렀을 때만 광고를 보여준다." — 바로 위 주석에 있던 "타임아웃되면 자동으로 홈 복귀"
        // 결정을 다시 뒤집는다. Free/Premium 둘 다 이제 이 시점엔 openApp()을 호출하지 않고 쇼츠에
        // 그대로 머문다(Premium은 원래도 그랬음) — "FOCUS OFF" 배지만 갱신되고, 사용자가 그 배지를
        // 직접 탭할 때(아래 autoBadge의 setOnClickListener, hasPendingFocusSessionTimeout() 참고)만
        // free 사용자는 openApp()→광고/크레딧 모달 게이트를 타고, premium은 게이트 없이 즉시 재활성화.
      }
    }

    fun consumeFocusSessionTimedOut(): Boolean {
      if (focusSessionTimedOutPending) {
        focusSessionTimedOutPending = false
        return true
      }
      return false
    }

    // 2026-08-01 — 배지 탭 핸들러가 "지금 껴진 이유가 타임아웃인지"를 소비 없이 미리 봐야 한다
    // (실제 소비는 JS의 checkTimedOut()이 앱 포그라운드 시 그대로 담당 — 여기서 먼저 소비해버리면
    // 앱을 열어도 JS가 이미 늦어 광고 모달을 못 띄운다).
    fun hasPendingFocusSessionTimeout(): Boolean = focusSessionTimedOutPending

    // 2026-08-01 실기기 감사 발견(위 PREF_FOCUS_SESSION_DEADLINE_AT_MS 선언부 참고) — 서비스
    // 프로세스가 죽었다 살아날 때(ensureInfraReady, ACTION_TICK/START_STICKY 복구 경로) 호출한다.
    // bt_auto_mode가 꺼져 있으면 할 일 없음. 켜져 있는데 저장된 마감 시각이 이미 지났으면(그 사이
    // 프로세스가 죽어있던 동안 시간이 다 됨) 그 자리에서 바로 타임아웃 처리, 아직 안 지났으면 남은
    // 시간만큼만 다시 예약 — "지금부터 다시 10분"으로 리셋되지 않는다.
    fun restoreFocusSessionTimerIfNeeded(context: Context) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      if (!prefs.getBoolean(PREF_AUTO_MODE, false)) return
      focusSessionHandler.removeCallbacks(focusSessionAutoStop)
      val deadlineAtMs = prefs.getLong(PREF_FOCUS_SESSION_DEADLINE_AT_MS, 0L)
      val remainingMs = deadlineAtMs - System.currentTimeMillis()
      if (deadlineAtMs <= 0L || remainingMs <= 0L) {
        focusSessionAutoStop.run()
        return
      }
      focusSessionHandler.postDelayed(focusSessionAutoStop, remainingMs)
      // 2026-08-02 실기기 발견("핸즈프리 다 온인데 손짓이 아예 안 됨") — 타이머와 똑같은 병이었다:
      // 손짓/핑거스냅 감지기는 setAutoMode(true)의 enable 분기에서만 시작되는데, 그 분기는 프로세스
      // 복구 경로(ensureInfraReady)에선 절대 안 불린다. 즉 bt_auto_mode=true가 SharedPreferences에
      // 남아있어 배지는 계속 "FOCUS ON"으로 보이는데, 프로세스가 재시작되는 순간(재설치·OOM kill
      // 등) 카메라 기반 감지기 자체는 다시는 안 켜져 있었다 — PaceHandWaveDetector.start()가 아예
      // 호출된 적이 없어서 카메라를 잡지도 않는 상태(사용자가 손짓해도 아무 반응 없음, 로그도 전혀
      // 안 남음). setAutoMode(true)의 감지기 시작 부분과 동일하게 여기서도 다시 켠다.
      PaceAccessibilityService.startWatching(45_000L)
      if (context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(PREF_HANDSFREE_GESTURE_ENABLED, false)) {
        PaceHandWaveDetector.start(context) { triggerNext(context) }
      }
    }

    // JS(useSubscriptionStore)가 구독 상태 바뀔 때마다 밀어주는 값 — 네이티브는 자체적으로
    // 구독 상태를 모른다.
    // 2026-08-02 사장님 지시("focus off 누르면 광고 볼래/크레딧 쓸래 팝업 뜨고 광고 고르면 광고") —
    // 그 선택 팝업을 쇼츠 위 네이티브 오버레이로 띄우려면 네이티브가 "지금 크레딧이 몇 개인지"를
    // 알아야 하는데, 크레딧은 JS 스토어(useFlipStore + useAttendanceStore)에만 있다. isPremium과
    // 똑같은 방식으로 JS가 값이 바뀔 때마다 여기로 밀어준다.
    fun setAvailableCredits(context: Context, credits: Int) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putInt(PREF_AVAILABLE_CREDITS, credits).apply()
    }

    private fun availableCredits(context: Context): Int =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getInt(PREF_AVAILABLE_CREDITS, 0)

    // 네이티브에서 크레딧으로 연장했을 때, 실제 잔액 차감은 JS 스토어가 진실원천이므로 여기서
    // "얼마를 썼는지"만 누적해두고 JS가 다음 포그라운드 때 1회성으로 소비해 차감한다
    // (consumeExpired/consumeFocusSessionTimedOut과 동일한 1회성 소비 패턴).
    fun consumePendingCreditSpend(context: Context): Int {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val pending = prefs.getInt(PREF_PENDING_CREDIT_SPEND, 0)
      if (pending > 0) prefs.edit().putInt(PREF_PENDING_CREDIT_SPEND, 0).apply()
      return pending
    }

    // 2026-08-02 — 알약 배지에 표시할 Focus Session 잔여 분(올림). 마감 시각은 프로세스 재시작에도
    // 살아남도록 이미 저장해두고 있으므로(PREF_FOCUS_SESSION_DEADLINE_AT_MS) 그걸 그대로 쓴다.
    // 저장된 마감이 없거나(구버전 상태) 이미 지났으면 null → 호출부가 "FOCUS ON"/"FOCUS OFF"로 폴백.
    fun focusSessionRemainingMinutes(context: Context): Int? {
      val deadline = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getLong(PREF_FOCUS_SESSION_DEADLINE_AT_MS, 0L)
      if (deadline <= 0L) return null
      val remainMs = deadline - System.currentTimeMillis()
      if (remainMs <= 0L) return null
      return Math.ceil(remainMs / 60000.0).toInt()
    }

    fun setIsPremium(context: Context, isPremium: Boolean) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(PREF_IS_PREMIUM, isPremium).apply()
    }

    private fun isPremium(context: Context): Boolean =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(PREF_IS_PREMIUM, false)

    // 보상형 광고 시청 완료 후 호출 — 이미 타임아웃으로 꺼져 있으면 워처를 다시 켜고, extraMinutes
    // 뒤에 다시 자동 종료되도록 예약(원래 설정값(PREF_FOCUS_SESSION_MINUTES)이 아니라 이 값을 씀).
    fun extendFocusSession(context: Context, extraMinutes: Int) {
      if (!isBuildAutoNextEnabled(context)) return
      val wasActive = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(PREF_AUTO_MODE, false)
      if (!wasActive) {
        setAutoMode(context, true) // 워처 재시작 — 내부에서 PREF 기반 시간으로 일단 스케줄되지만 바로 아래서 덮어씀.
      }
      focusSessionHandler.removeCallbacks(focusSessionAutoStop)
      val extraMs = extraMinutes.coerceAtLeast(1) * 60 * 1000L
      focusSessionHandler.postDelayed(focusSessionAutoStop, extraMs)
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putLong(PREF_FOCUS_SESSION_DEADLINE_AT_MS, System.currentTimeMillis() + extraMs).apply()
      showToast(context, "🎯 Focus Session +${extraMinutes}m")
      returnToLastTrackedApp(context)
    }

    // 2026-08-01 사장님 지적 — 보상형 광고/크레딧으로 연장한 목적 자체가 "쇼츠 계속 보기"인데, 연장
    // 후에도 사용자가 Pace 화면에 남겨져 직접 다시 스와이프해 돌아가야 했다. 광고를 보러 오기 전
    // 마지막으로 감시 중이던 앱(foregroundPollRunnable이 매 폴마다 저장)을 다시 전경으로 불러온다 —
    // REORDER_TO_FRONT라 기존 태스크를 그대로 살려서 보던 화면 그대로 이어진다(새로 앱 시작 아님).
    private fun returnToLastTrackedApp(context: Context) {
      val pkg = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREF_LAST_TRACKED_APP_PACKAGE, null) ?: return
      try {
        val intent = context.packageManager.getLaunchIntentForPackage(pkg) ?: return
        intent.addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            Intent.FLAG_ACTIVITY_NO_USER_ACTION
        )
        context.startActivity(intent)
      } catch (e: Exception) {
        Log.w("PaceOverlayService", "returnToLastTrackedApp 실패: pkg=$pkg", e)
      }
    }

    fun setFocusSessionDurationMinutes(context: Context, minutes: Int) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_FOCUS_SESSION_MINUTES, minutes.coerceAtLeast(1)).apply()
    }

    fun getFocusSessionDurationMinutes(context: Context): Int =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getInt(PREF_FOCUS_SESSION_MINUTES, DEFAULT_FOCUS_SESSION_MINUTES)

    // 2026-07-27 감사 발견 — 프리미엄→무료 다운그레이드 시 focusSessionDurationMinutes는 여기 위
    // setFocusSessionDurationMinutes로 네이티브에 push되는데, sleepStillnessMinutes(D8, 무진동
    // 수면감지 임계값)는 그 경로가 없어서 이미 도는 중인 세션은 다운그레이드 이후에도 계속 프리미엄
    // 시절 임계값(최대 20분)으로 동작했다. sleepStillnessMinutes는 performTick()이 매 틱마다 인스턴스
    // 필드를 다시 읽는 "라이브" 값(setHandsFreeGestureEnabled와 같은 패턴)이라, 다음 세션까지 기다릴
    // 필요 없이 지금 도는 세션에도 즉시 반영 가능 — instance가 있으면 바로 갱신한다.
    fun setSleepStillnessMinutes(context: Context, minutes: Int) {
      val clamped = minutes.coerceIn(5, 20)
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_SLEEP_STILLNESS_MINUTES, clamped).apply()
      instance?.sleepStillnessMinutes = clamped
    }

    // 2026-07-21 밤 감사 발견 — EXPO_PUBLIC_ENABLE_AUTO_NEXT(스토어 제출용 킬스위치)는 JS 전용
    // 빌드타임 플래그라 JS의 startAutoNextWatching()/stopAutoNextWatching() 호출부만 막았다. 그런데
    // 알약 탭(triggerNext/triggerPrevious → setAutoMode)과 블루투스 하드웨어 리모컨(MediaSession
    // 콜백 → 이 함수)은 JS를 전혀 거치지 않고 코틀린에서 직접 setAutoMode(true)를 부른다 — 즉
    // "스토어 빌드에선 자동 스와이프 꺼짐"이 실제로는 보장되지 않았다. 앱 부팅 시 JS가 같은 env var
    // 값으로 이 플래그를 한 번 설정(PaceOverlayModule.setBuildAutoNextEnabled)하면, 그 이후 어떤
    // 경로로 setAutoMode(true)가 불려도 여기서 실제로 막는다 — 단일 진입점이라 모든 경로를 커버.
    // 기본값은 안전한 쪽(false)으로 — JS가 아직 값을 안 넣은 극초반 레이스에도 자동 스와이프가
    // 조용히 켜지는 일이 없게 한다.
    private const val PREF_BUILD_AUTO_NEXT_ENABLED = "build_auto_next_enabled"

    fun setBuildAutoNextEnabled(context: Context, enabled: Boolean) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putBoolean(PREF_BUILD_AUTO_NEXT_ENABLED, enabled).apply()
    }

    fun isBuildAutoNextEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getBoolean(PREF_BUILD_AUTO_NEXT_ENABLED, false)

    // 2026-07-23: 원래 "핑거스냅과 블루투스 리모컨이 같은 오디오 세션을 두고 충돌할 수 있다"는
    // QA 지적(C섹션)을 근거로 핑거스냅 자체를 여기서 게이팅했었으나, setAutoMode()에서 그 로직을
    // 제거했다(전제였던 "리모컨이 이미 다음넘김 처리" 자체가 거짓으로 확정됐고, AudioRecord는 폰
    // 자체 마이크로 열리므로 블루투스 SCO/A2DP 오디오 세션과 실제로 겹치지 않는다). 이 함수는 이제
    // 수면 감지(§4)의 "세션 중 블루투스 연결 해제됐는가" 체크에서만 쓰인다.
    // PaceOverlayModule.getConnectedBluetoothAudioDevice()와 동일한 검사(BLUETOOTH_CONNECT 런타임
    // 권한 불필요, AudioManager.getDevices()만으로 충분)를 여기 companion에도 둔다.
    private fun isBluetoothAudioConnected(context: Context): Boolean {
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
      return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
      }
    }

    // 2026-07-26 — SLEEP_WINDOW_START_HOUR~SLEEP_WINDOW_END_HOUR(22시~다음날 9시, 자정 걸침) 안에
    // 있는지. 이 창 밖(낮 시간대)에서는 stillnessElapsedMs가 아무리 길어도 수면으로 판정하지 않는다.
    private fun isWithinSleepDetectionWindow(): Boolean {
      val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
      return hour >= SLEEP_WINDOW_START_HOUR || hour < SLEEP_WINDOW_END_HOUR
    }

    // Play/Pause → Focus Session 토글(기존 "Auto Mode"와 같은 스위치). 켜면 사용자가 설정한 시간만큼
    // 세션 시작(그 안에서는 PaceAccessibilityService의 실제 재생 위치 감지로 자동 진행), 시간이
    // 다 되면 자동 종료 — 그 전에 사용자가 직접 끄면 예약된 자동 종료도 같이 취소한다.
    fun setAutoMode(context: Context, enable: Boolean) {
      if (enable && !isBuildAutoNextEnabled(context)) {
        Log.w("PaceOverlayService", "setAutoMode(true) blocked — build flag EXPO_PUBLIC_ENABLE_AUTO_NEXT is off")
        return
      }
      focusSessionHandler.removeCallbacks(focusSessionAutoStop)
      if (enable) {
        PaceAccessibilityService.startWatching(45_000L)
        // 2026-07-26 사용자 지시("iOS랑 통일성 있게 핑거스냅은 비활성화 유지") — iOS가 먼저 핑거스냅을
        // 뺐다(마이크용 AVAudioSession .playAndRecord를 켜면 재생 중이던 영상이 시스템 레벨에서
        // 음소거되는 근본 충돌 때문, YouTubeShortsPlayer.ios.tsx 관련 커밋 참고). Android는 이 음소거
        // 충돌이 실제로 없지만(AudioRecord는 폰 자체 마이크로 별도 열림), 두 플랫폼 동작을 통일하기로
        // 결정 — 코드/디텍터 구현 자체는 남겨두고(향후 재활성화 대비) 여기서 시작 호출만 뺀다.
        // PaceSnapDetector.start(context) { triggerNext(context) } // 의도적으로 비활성화 — 위 주석 참고
        // 2026-07-24 손 밀어내기(shoo) — 핑거스냅과 같은 Focus Session 안에서 나란히 도는 세 번째
        // 핸즈프리 트리거. 카메라 권한이 없으면 PaceHandWaveDetector.start()가 조용히 no-op한다
        // (PaceSnapDetector의 RECORD_AUDIO 방어와 동일한 원칙).
        // 2026-07-27 — 마스터가 켜져도 손짓 자체를 개별로 꺼뒀으면(PREF_HANDSFREE_GESTURE_ENABLED)
        // 시작하지 않는다 — 블루투스 볼륨키 스킵과 대칭되는 독립 토글.
        // 2026-08-01 맥 세션 배터리 감사 발견(useSettingsStore.ts 감사 요청 항목) — 이 fallback
        // 기본값이 true였는데, JS 쪽 handsFreeGesture 기본값은 이미 07-27 이전 결정과 별개로
        // 오늘 false로 바뀌었다(iOS도 동일하게 전환). 한 번도 토글을 안 건드린 새 사용자는
        // setHandsFreeGestureEnabled()가 아직 호출된 적 없어 이 SharedPreferences 키 자체가
        // 없는데, fallback이 true라 JS 기본값(false)과 정반대로 안드로이드에서만 손짓이 켜진
        // 채로 시작되고 있었다 — false로 정정해 플랫폼 간 기본값을 통일한다. 이미 명시적으로
        // true를 저장해둔 기존 사용자는(실제 키가 존재하므로) 이 변경의 영향을 받지 않는다.
        if (context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(PREF_HANDSFREE_GESTURE_ENABLED, false)) {
          PaceHandWaveDetector.start(context) { triggerNext(context) }
        }
        val durationMs = getFocusSessionDurationMinutes(context) * 60 * 1000L
        focusSessionHandler.postDelayed(focusSessionAutoStop, durationMs)
        // 벽시계 마감 시각 저장(프로세스 복구용, 위 PREF_FOCUS_SESSION_DEADLINE_AT_MS 선언부 참고).
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
          .putLong(PREF_FOCUS_SESSION_DEADLINE_AT_MS, System.currentTimeMillis() + durationMs).apply()
      } else {
        PaceAccessibilityService.stopWatching()
        PaceSnapDetector.stop()
        PaceHandWaveDetector.stop()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
          .remove(PREF_FOCUS_SESSION_DEADLINE_AT_MS).apply()
      }
      bumpBluetoothCounter(context, "bt_auto_toggle_count")
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(PREF_AUTO_MODE, enable).apply()
      instance?.let {
        it.updateMediaSessionPlaybackState(playing = enable)
        // 2026-07-20 실기기 검증 중 발견: 알약 배지 탭 경로는 자기가 직접 autoNextEnabled를 바꾸고
        // applyAutoBadgeStyle()도 불렀지만, 10분 자동 종료 타이머처럼 setAutoMode를 "밖에서" 부르는
        // 경로는 이 동기화를 안 태워서 배지가 "AUTO ON"에 멈춰 있었다(토스트는 정상, 배지만 거짓말).
        // 모든 호출 경로가 여길 한 번은 거치므로 여기서 통일해 동기화한다.
        it.autoNextEnabled = enable
        // 2026-08-02 실기기 로그 — "toggleAutoMode failed → CalledFromWrongThreadException: Only the
        // original thread that created a view hierarchy can touch its views". setAutoMode는 JS 브릿지
        // (Expo 모듈 워커 스레드), 미디어세션 콜백, 타이머 Runnable 등 여러 스레드에서 불리는데
        // applyAutoBadgeStyle()은 오버레이 View를 직접 건드린다 — 메인 스레드가 아니면 예외로 죽고,
        // 그 결과 알약 배지가 실제 상태와 어긋난 채 남았다. 항상 메인 루퍼로 넘겨 실행한다.
        Handler(Looper.getMainLooper()).post { it.applyAutoBadgeStyle() }
      }
      showToast(context, if (enable) "🎯 Focus Session Started (${getFocusSessionDurationMinutes(context)}m)" else "🎯 Focus Session Ended")
    }

    // 2026-07-27 사용자 지시 — 손짓을 마스터(Focus Session)와 독립적으로 켜고 끌 수 있게. 값을
    // 영속화하고, 마스터가 이미 켜져 있는 중이면(=PaceHandWaveDetector가 지금 돌고 있을 수 있음)
    // 다음 세션까지 기다리지 않고 즉시 반영한다 — 블루투스 볼륨키 토글(다음 세션 시작 때만 반영)과
    // 달리 이건 라이브 스위치라 즉시 반영이 더 자연스럽다(손짓은 세션 도중 계속 켜져 있는 감지기라
    // 다시 시작할 필요 없이 그냥 지금 stop/start만 하면 됨).
    fun setHandsFreeGestureEnabled(context: Context, enabled: Boolean) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().putBoolean(PREF_HANDSFREE_GESTURE_ENABLED, enabled).apply()
      val masterOn = prefs.getBoolean(PREF_AUTO_MODE, false)
      if (masterOn) {
        if (enabled) PaceHandWaveDetector.start(context) { triggerNext(context) } else PaceHandWaveDetector.stop()
      }
    }

    // 2026-07-27 사용자 실기기 지적("핸즈프리 켰는데 블루투스 여전히 안 됨") — 손짓(위 함수)과 달리
    // 이건 detector를 start/stop하는 게 아니라 PaceAccessibilityService.onKeyEvent가 매 키 입력마다
    // 직접 읽는 companion 플래그라, 세션 도중 설정을 바꿔도 그 플래그만 즉시 갱신해주면 된다(재시작
    // 불필요) — 근데 이 함수 자체가 아예 없어서 JS의 bluetoothVolumeKeySkipEnabled 변경이 세션 시작
    // 시점에만(StartSessionOptions) 반영되고 이미 도는 세션에는 다음 세션까지 전혀 안 먹혔다.
    fun setBluetoothVolumeKeySkipEnabled(context: Context, enabled: Boolean) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putBoolean(PREF_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED, enabled).apply()
      PaceAccessibilityService.bluetoothVolumeKeySkipEnabled = enabled
      // 2026-07-31 — MediaSession.onSkipToNext/Previous(실제 블루투스 리모컨 next/prev 버튼 신호)도
      // 이 인스턴스 필드로 게이팅하게 됐다(위 volumeKeySkipEnabled와 별개 필드였어서 세션 도중 토글이
      // 이 경로엔 전혀 안 먹혔던 버그, 사용자 지적 "블루투스 다 꺼져있었는데" 참고).
      instance?.bluetoothVolumeKeySkipEnabled = enabled
    }

    // 2026-07-28 사장님 결정("리셋형: 그냥 지금부터 30분 다시 카운트, 경과시간 무시") — 취침 타이머를
    // 세션 도중 바꾸면 지금까지 흘러간 시간은 버리고 새 값으로 카운트다운을 처음부터 다시 시작한다.
    // dailyLimitMinutes처럼 "오늘 사용량 대비 남은시간 재계산"이 필요 없어(취침 타이머는 세션 시작
    // 시점부터의 순수 카운트다운이라 "오늘 사용량" 개념이 없음) updateRemaining과 달리 JS 계산 없이
    // 새 값을 그대로 반영하면 된다. minutes<=0은 "끄기"(-1, performTick의 감소 조건 `>0`과 동일 규약).
    fun setSleepTimerMinutes(context: Context, minutes: Int) {
      val normalized = if (minutes > 0) minutes else -1
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_SLEEP_TIMER, normalized).apply()
      instance?.sleepTimerRemainingMinutes = normalized
    }

    // 2026-07-27 사용자 지시("시간이나 다른 것들도 다 적용 안되는거 아냐? 전수 확인해") — 위
    // Bluetooth/손짓과 같은 종류의 결함이 Settings 화면의 나머지 설정(휴식 간격/알림 3종/Hard Block)
    // 에도 전부 있었다: onStartCommand(ACTION_START)가 세션 "시작 시점" 값만 읽어서, 이미 도는 세션
    // 중에 Settings에서 값을 바꿔도 다음 세션 시작 전까지 전혀 반영이 안 됐다. 이 함수 하나로 이미
    // 도는 세션의 인스턴스 필드+SharedPreferences를 함께 즉시 갱신한다(세션 재시작 불필요) —
    // dailyLimitMinutes는 "새 한도 대비 현재 남은시간"을 다시 계산해야 하는 별개 문제라 여기 포함 안
    // 함(오늘 사용량이 필요해 JS가 계산해서 overlayService.updateRemaining()으로 넘기는 기존 경로를
    // 재사용해야 함 — home.tsx/overlay/index.tsx의 remainingMinutes 계산과 동일). sleepTimerMinutes는
    // 위 setSleepTimerMinutes()로 별도 처리(리셋형, 2026-07-28).
    fun updateLiveSessionConfig(
      context: Context,
      breakIntervalMinutes: Int,
      notifyRemaining: Boolean,
      notifyLimit: Boolean,
      notifyBreak: Boolean,
      hardBlockMode: Boolean
    ) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_BREAK_INTERVAL, breakIntervalMinutes)
        .putBoolean(PREF_NOTIFY_REMAINING, notifyRemaining)
        .putBoolean(PREF_NOTIFY_LIMIT, notifyLimit)
        .putBoolean(PREF_NOTIFY_BREAK, notifyBreak)
        .putBoolean(PREF_HARD_BLOCK_MODE, hardBlockMode)
        .apply()
      instance?.let {
        // 새 간격이 지금까지 카운트해온 것보다 짧으면(예: 30분→10분) 그 자리에서 클램프해 다음 tick에
        // 바로 반영되게 한다 — 길어졌으면(10분→30분) 이미 흘러간 시간은 그대로 인정하고 새 간격만 저장.
        it.breakIntervalMinutes = breakIntervalMinutes
        if (breakIntervalMinutes <= 0) it.nextBreakInMinutes = 0
        else it.nextBreakInMinutes = minOf(it.nextBreakInMinutes, breakIntervalMinutes)
        it.notifyRemaining = notifyRemaining
        it.notifyLimit = notifyLimit
        it.notifyBreak = notifyBreak
        it.hardBlockMode = hardBlockMode
      }
    }

    private fun bumpBluetoothCounter(context: Context, key: String) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().putInt(key, prefs.getInt(key, 0) + 1).apply()
    }

    // 2026-08-02 — 오버레이에서 직접 띄우는 보상형 광고(PaceRewardedAdActivity)가 로드/표시에
    // 실패했을 때 사용자에게 알리는 용도. 광고가 안 뜨는 건 사용자 잘못이 아니므로 벌주지 않고
    // (연장은 주지 않되) 다시 시도할 수 있다는 것만 알린다.
    fun showAdFailedToast(context: Context) {
      val ko = java.util.Locale.getDefault().language == "ko"
      showToast(context, if (ko) "광고를 불러오지 못했어요 — 잠시 후 다시 시도해 주세요" else "Couldn't load the ad — please try again in a moment")
    }

    private fun showToast(context: Context, text: String) {
      Handler(Looper.getMainLooper()).post {
        Toast.makeText(context.applicationContext, text, Toast.LENGTH_SHORT).show()
      }
    }

    fun start(
      context: Context,
      remainingMinutes: Int,
      autoNextEnabled: Boolean,
      sleepTimerMinutes: Int,
      breakIntervalMinutes: Int,
      notifyRemaining: Boolean,
      notifyLimit: Boolean,
      notifyBreak: Boolean,
      hardBlockMode: Boolean,
      sleepStillnessMinutes: Int,
      bluetoothVolumeKeySkipEnabled: Boolean
    ) {
      val intent = Intent(context, PaceOverlayService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_REMAINING, remainingMinutes)
        putExtra(EXTRA_AUTO_NEXT, autoNextEnabled)
        putExtra(EXTRA_SLEEP_TIMER_MINUTES, sleepTimerMinutes)
        putExtra(EXTRA_BREAK_INTERVAL_MINUTES, breakIntervalMinutes)
        putExtra(EXTRA_NOTIFY_REMAINING, notifyRemaining)
        putExtra(EXTRA_NOTIFY_LIMIT, notifyLimit)
        putExtra(EXTRA_NOTIFY_BREAK, notifyBreak)
        putExtra(EXTRA_HARD_BLOCK_MODE, hardBlockMode)
        putExtra(EXTRA_SLEEP_STILLNESS_MINUTES, sleepStillnessMinutes)
        putExtra(EXTRA_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED, bluetoothVolumeKeySkipEnabled)
      }
      ContextCompat.startForegroundService(context, intent)
      // 2026-08-01 사장님 지시 — Shorts HOT을 세션 시작 시점에 미리 받아둬서, P 메뉴에서 실제로
      // 열 때는 캐시된 걸 바로 보여준다(ShortsHotStore.prefetchAll/getCached 참고).
      ShortsHotStore.prefetchAll(context)
    }

    fun updateRemaining(context: Context, remainingMinutes: Int) {
      val intent = Intent(context, PaceOverlayService::class.java).apply {
        action = ACTION_UPDATE
        putExtra(EXTRA_REMAINING, remainingMinutes)
      }
      context.startService(intent)
    }

    fun stop(context: Context) {
      context.startService(Intent(context, PaceOverlayService::class.java).apply { action = ACTION_STOP })
    }

    // consumeExpired()와 동일한 1회성 소비 패턴 — checkAccessibilityRevoked()가 세운 신호를 JS가
    // 포그라운드 복귀 시 확인한다.
    fun consumeAccessibilityRevoked(): Boolean {
      val service = instance ?: return false
      if (service.accessibilityRevokedPending) {
        service.accessibilityRevokedPending = false
        return true
      }
      return false
    }

    // 2026-07-19: Handler.postDelayed 대신 AlarmManager.setAndAllowWhileIdle()로 다음 틱을 예약 —
    // Doze 유지보수 윈도우에서도 결국 깨어나고, 이 알람 자체는 시스템에 등록되므로 우리 프로세스가
    // 죽어도 살아남아 PaceTickReceiver→PaceOverlayService(ACTION_TICK)를 다시 깨운다.
    fun scheduleNextTick(context: Context) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val pendingIntent = tickPendingIntent(context)
      val triggerAt = SystemClock.elapsedRealtime() + TICK_INTERVAL_MS
      try {
        alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
      } catch (e: Exception) {
        Log.w("PaceOverlay", "scheduleNextTick failed", e)
      }
    }

    fun cancelScheduledTick(context: Context) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      try {
        alarmManager.cancel(tickPendingIntent(context))
      } catch (e: Exception) {
        Log.w("PaceOverlay", "cancelScheduledTick failed", e)
      }
    }

    private fun tickPendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, PaceTickReceiver::class.java)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
      return PendingIntent.getBroadcast(context, TICK_ALARM_REQUEST_CODE, intent, flags)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.d("PaceOverlay", "onStartCommand action=${intent?.action} remaining=${intent?.getIntExtra(EXTRA_REMAINING, -1)} overlayView=${if (overlayView != null) "exists" else "null"}")
    when (intent?.action) {
      ACTION_START -> {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(PREF_EXPIRED, false).apply()
        remainingMinutes = intent.getIntExtra(EXTRA_REMAINING, 0)
        val sleepTimerMinutes = intent.getIntExtra(EXTRA_SLEEP_TIMER_MINUTES, 0)
        sleepTimerRemainingMinutes = if (sleepTimerMinutes > 0) sleepTimerMinutes else -1
        breakIntervalMinutes = intent.getIntExtra(EXTRA_BREAK_INTERVAL_MINUTES, 0)
        nextBreakInMinutes = breakIntervalMinutes
        notifyRemaining = intent.getBooleanExtra(EXTRA_NOTIFY_REMAINING, true)
        notifyLimit = intent.getBooleanExtra(EXTRA_NOTIFY_LIMIT, true)
        notifyBreak = intent.getBooleanExtra(EXTRA_NOTIFY_BREAK, true)
        autoNextEnabled = intent.getBooleanExtra(EXTRA_AUTO_NEXT, false)
        hardBlockMode = intent.getBooleanExtra(EXTRA_HARD_BLOCK_MODE, false)
        // 2026-07-26 사장님 결정(D8) — 5~20 범위로 방어적 clamp(무료는 JS가 항상 10을 넘기지만,
        // 네이티브 쪽에서도 잘못된 값이 들어와 감지가 무력화/과민화되지 않도록 이중 방어).
        sleepStillnessMinutes = intent.getIntExtra(EXTRA_SLEEP_STILLNESS_MINUTES, 10).coerceIn(5, 20)
        bluetoothVolumeKeySkipEnabled = intent.getBooleanExtra(EXTRA_BLUETOOTH_VOLUME_KEY_SKIP_ENABLED, true)
        PaceAccessibilityService.bluetoothVolumeKeySkipEnabled = bluetoothVolumeKeySkipEnabled
        lastMotionAtMs = SystemClock.elapsedRealtime() // 신규 세션 — 수면감지 무진동 시계를 지금부터 시작
        loadDailyLimitHitState() // 날짜 바뀌었으면 한도 히트카운트 리셋(자정 롤오버)
        if (dailyLimitOriginalMinutes <= 0) {
          // 오늘 첫 세션(또는 리셋 직후) — 지금 넘겨받은 값이 "오늘의 원래 한도"다.
          dailyLimitOriginalMinutes = remainingMinutes
          persistDailyLimitHitState()
        }
        removeBlockOverlay() // 이전 세션이 만료→차단 화면인 채로 새 세션이 시작되는 경우 정리
        infraReady = false
        ensureInfraReady()
        persistState()
        scheduleNextTick(this)
        // 2026-07-26 사용자 지시("실제 재생 중일 때만 차감") — Focus Session(autoNextEnabled) 여부와
        // 무관하게 가드된 세션이 시작되면 항상 재생 위치 추적을 켠다. 접근성이 꺼져 있으면 내부에서
        // 조용히 무시되고, performTick()은 이 경우 기존처럼(항상 차감) 폴백한다.
        PaceAccessibilityService.startPlaybackTracking()
      }
      // 2026-07-19: 프로세스가 죽었다 PaceTickReceiver의 알람으로 되살아난 경우, infraReady가
      // false(새 프로세스 인스턴스라 필드가 전부 기본값)이므로 SharedPreferences에서 상태를 복구한
      // 다음 인프라를 다시 세팅한다 — 정상적으로 계속 돌던 중이었다면(같은 프로세스) 이 복구 분기는
      // session_active가 이미 true+필드도 최신이라 그대로 통과, 중복 세팅 없이 틱 계산만 수행.
      ACTION_TICK -> {
        if (!restoreIfNeeded()) { stopSelf(); return START_NOT_STICKY }
        performTick()
      }
      // ⚠️ 2026-07-19 실기기 검증 중 실제로 발견한 버그: 이 null 분기가 원래 없었다 — 프로세스가
      // 죽으면(SIGKILL 등, force-stop이 아닌 일반 OOM성 kill) 시스템이 START_STICKY를 보고 즉시
      // (알람보다 훨씬 먼저, 실측 ~1초) intent=null로 재시작을 걸어준다는 걸 로그로 처음 확인했다 —
      // 이 경로를 안 챙기면 프로세스만 허무하게 되살아나고 오버레이/폴링/알람 전부 안 돌아 사실상
      // 낭비되는 재시작이었다(실측: 재시작은 됐는데 오버레이가 다시 안 뜨는 걸로 확인). ACTION_TICK과
      // 같은 복구 로직을 타되, performTick(틱 계산)은 하지 않는다 — 이건 "정기 틱"이 아니라 "그냥
      // 죽었다 시스템이 살린 것"이므로 시간을 깎으면 안 된다. 대신 다음 틱 알람만 안전하게 재예약.
      null -> {
        if (restoreIfNeeded()) {
          scheduleNextTick(this)
        } else {
          stopSelf()
          return START_NOT_STICKY
        }
      }
      // ACTION_UPDATE: JS(Extend Time 등)가 남은시간을 외부에서 조정했을 때만 씀 — 정상 카운트다운
      // 자체는 이제 이 서비스가 스스로 하므로(performTick), 여기선 값만 덮어쓰고 틱 스케줄은
      // 건드리지 않는다(다음 틱까지 남은 시간이 리셋되지 않게).
      ACTION_UPDATE -> {
        remainingMinutes = intent.getIntExtra(EXTRA_REMAINING, 0)
        setRemainingText(remainingMinutes)
        if (infraReady) persistState()
      }
      ACTION_STOP -> {
        // 2026-08-01 실기기 재현 — openApp()("P메뉴 → 앱으로") 직후 짧은 유예시간(OPEN_APP_STOP_GRACE_MS)
        // 안에 들어오는 STOP은 그 화면 전환이 유발한 JS 레이스의 부작용으로 간주해 무시한다. 위
        // lastOpenAppAtMs 필드 선언부 주석 참고 — 실제로 세션 종료 버튼을 그 안에 또 누르는 경우는
        // 실사용상 없다고 봐도 되는 극히 좁은 창.
        if (lastOpenAppAtMs != 0L && SystemClock.elapsedRealtime() - lastOpenAppAtMs < OPEN_APP_STOP_GRACE_MS) {
          Log.w("PaceOverlay", "ACTION_STOP ignored — arrived within ${OPEN_APP_STOP_GRACE_MS}ms of openApp() (likely JS unmount race, not a real end)")
          return START_STICKY
        }
        clearSessionActive()
        cancelScheduledTick(this)
        stopForegroundAppPolling()
        removeOverlay()
        removeBlockOverlay()
        removeTier3Toast()
        teardownMediaSession()
        unregisterStillnessSensor()
        PaceAccessibilityService.stopPlaybackTracking()
        infraReady = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
    }
    // START_STICKY: 세션이 활성인 동안 시스템이 이 서비스를 죽이면 재시작을 시도해달라는 신호 —
    // 다만 실제 복구의 주 경로는 AlarmManager(프로세스 생사와 무관하게 시스템에 등록됨)이고, 이건
    // 보조 안전망이다. ACTION_STOP에서는 위에서 이미 START_NOT_STICKY로 개별 반환한다.
    return START_STICKY
  }

  // 2026-07-19: 기존 tickRunnable(Handler.postDelayed 콜백)의 로직을 그대로 옮기되, "다음 틱
  // 예약"만 Handler 재귀 대신 scheduleNextTick(AlarmManager)으로 바꿨다. 예외처리 추가(사용자 지적) —
  // 여기서 뭔가 던지면 예전엔 그대로 앱이 죽었다.
  private fun performTick() {
    try {
      // 2026-07-26 사용자 지적("화면 작아졌다가 다시 커지면 오버레이가 없어짐") — 스플릿스크린/
      // 멀티윈도우 리사이즈 등으로 시스템이 SYSTEM_ALERT_WINDOW를 조용히 떼어내는 경우(addView 실패가
      // 예외 없이 삼켜지는 케이스 포함)를 매 틱(60초)마다 스스로 감지해 복구한다. overlayView 필드
      // 자체는 살아있어도(showOverlay의 `if (overlayView != null) return` 가드 때문에 재호출이
      // no-op으로 씹힘) 실제로 화면에 붙어있지 않으면(isAttachedToWindow==false) 유령 상태로 간주해
      // 강제로 다시 띄운다.
      // 2026-07-26 밤 실기기 재현 — 서비스/알람/세션 전부 살아있는데(session_active=true, 틱도
      // 정상 발동) 알약만 화면에서 사라진 케이스를 발견. 원래 이 체크는 `overlayView != null`일
      // 때만(=참조는 있는데 떨어져나간 경우만) 복구했는데, `overlayView` 자체가 null인 경우(예:
      // showOverlay 호출이 애초에 실패했거나, 다른 경로에서 null로만 리셋되고 재호출은 안 된 경우)는
      // 이 조건이 거짓이 돼 아무 것도 안 했다 — "참조가 없으니 원래 없는 상태겠지"라고 안전하게
      // 가정한 게 실제로는 안전하지 않았다. 이 틱이 도는 시점 자체가 이미 "세션이 활성"이라는
      // 뜻이므로(그렇지 않으면 애초에 이 코드에 안 옴), overlayView가 null이든 detach됐든 상관없이
      // 매 틱마다 무조건 상태를 확인해 필요하면 다시 띄운다.
      // 2026-07-28 — 감지 기반 복구가 실기기에서 실패 확인돼(위 refreshOverlayIfDue 주석 참고)
      // 무조건 주기적 강제 재생성으로 교체. 이 60초 틱은 보조 트리거 — 실제 주기는 REFRESH_INTERVAL_MS.
      refreshOverlayIfDue(remainingMinutes)
      // 2026-07-26 사용자 지시("실제 재생 중일 때만 차감") — 예전엔 세션이 활성인 동안 실제 재생
      // 여부와 무관하게 매분 무조건 깎았다(일시정지/백그라운드도 "사용"으로 카운트되는 정확도 문제).
      // isLikelyPlaying()==false(재생 중이 아님이 확인됨)일 때만 건너뛰고, null(접근성 꺼짐 등 판단
      // 불가)이거나 true(실제 재생 중)면 기존처럼 차감 — 신호가 아예 없을 땐 안전하게 항상 차감
      // 쪽으로 폴백한다.
      val isPlaying = PaceAccessibilityService.isLikelyPlaying()
      if (isPlaying != false) {
        remainingMinutes = (remainingMinutes - 1).coerceAtLeast(0)
      } else {
        Log.d("PaceOverlay", "tick skipped decrement — playback not detected (paused/backgrounded)")
      }
      checkAccessibilityRevoked()
      if (sleepTimerRemainingMinutes > 0) {
        sleepTimerRemainingMinutes = (sleepTimerRemainingMinutes - 1).coerceAtLeast(0)
      }
      // 2026-07-27 사용자 실기기 지적("쇼츠 안 보고 Pace 화면만 보이는데 왜 휴식 팝업 떠") — 위
      // remainingMinutes 차감은 isPlaying==false(재생 안 함이 확인됨)일 때 건너뛰도록 이미 고쳐져
      // 있는데, 이 카운트다운은 그 가드 없이 세션이 활성인 동안 무조건 매분 깎였다. 그 결과 사용자가
      // Pace 자체 화면(Home/Focus/Settings)만 보고 있거나 일시정지 중이어도 벽시계 기준으로 계속
      // 흘러가 실제로 안 보고 있을 때도 알림이 떴다. remainingMinutes와 동일한 조건(재생 중이 아님이
      // 확인된 경우만 건너뜀 — 신호 없음/불확실이면 안전하게 계속 차감)으로 통일한다.
      if (breakIntervalMinutes > 0 && isPlaying != false) {
        nextBreakInMinutes = (nextBreakInMinutes - 1).coerceAtLeast(0)
        if (nextBreakInMinutes <= 0) {
          if (notifyBreak) {
            if (isKoreanLocale()) {
              sendAlertNotification(NOTIFICATION_ID_BREAK_REMINDER, "휴식 시간이에요", "잠깐 스트레칭하거나 심호흡을 해보세요.")
            } else {
              sendAlertNotification(NOTIFICATION_ID_BREAK_REMINDER, "Break time", "Take a moment to stretch or breathe.")
            }
          }
          nextBreakInMinutes = breakIntervalMinutes
        }
      }
      setRemainingText(remainingMinutes)
      // 2026-08-02 — 배지가 Focus Session 잔여를 카운트다운하므로(applyAutoBadgeStyle 참고) 매 틱마다
      // 같이 갱신해야 5m → 4m → …로 실제로 줄어든다. 안 하면 세션 시작 시점 값에 멈춰 있게 된다.
      applyAutoBadgeStyle()
      updateNotification(remainingMinutes)
      persistState()
      Log.d("PaceOverlay", "tick remaining=$remainingMinutes sleepTimer=$sleepTimerRemainingMinutes nextBreakIn=$nextBreakInMinutes")

      if (notifyRemaining && (remainingMinutes == 5 || remainingMinutes == 1)) {
        if (isKoreanLocale()) {
          sendAlertNotification(NOTIFICATION_ID_LOW_TIME, "남은 시간", "오늘 ${remainingMinutes}분 남았어요! 잠시 숨을 돌려볼까요.")
        } else {
          sendAlertNotification(NOTIFICATION_ID_LOW_TIME, "Time remaining", "$remainingMinutes min left today — take a breather?")
        }
      }

      // 수면 감지(스펙 §1-B/§4-B) — 블루투스 탈착은 "보조 신호(타이머 단축)"로만: 탈착 자체가 트리거가
      // 아니라, 탈착이 감지된 뒤로도 여전히 무진동이 이어질 때만 더 짧은 임계값을 적용한다(통화하러
      // 잠깐 빼는 경우는 곧 다시 움직이므로 이 분기를 안 탄다).
      val btNowConnected = isBluetoothAudioConnected(this)
      if (btWasConnectedThisSession && !btNowConnected) {
        btDisconnectedDuringStillness = true
      }
      btWasConnectedThisSession = btNowConnected
      val stillnessElapsedMs = SystemClock.elapsedRealtime() - lastMotionAtMs
      // 2026-07-26 사장님 결정(D8) — 기존 고정 SLEEP_STILLNESS_MS(10분) 대신 sleepStillnessMinutes
      // (프리미엄 전용 조절값, 무료는 항상 10 유지) 사용. BT 탈착 단축 임계값(SLEEP_STILLNESS_SHORT_MS,
      // 6분 고정)은 이번 스코프에 안 넣음 — "고급" 기능은 메인 임계값 하나만으로 충분하다고 판단.
      val stillnessThresholdMs = if (btDisconnectedDuringStillness) SLEEP_STILLNESS_SHORT_MS else sleepStillnessMinutes * 60 * 1000L
      // 2026-07-26 사용자 지적("가만히 있으면 무조건 수면으로 판단하는 거 아니지 않아?") — 낮 시간대
      // 오탐(거치대/adb 등으로 폰만 가만히 있는 경우) 방지를 위해 밤 시간대(위 SLEEP_WINDOW_*)에만
      // 무진동 판정을 수면으로 인정한다. 창 밖에서는 아무리 오래 무진동이어도 sleepDetected=false —
      // 그 시간의 무진동은 그냥 무진동일 뿐 세션을 끊지 않는다(Daily Limit 등 다른 조건은 그대로 적용).
      // 2026-08-02 사장님 지시("수면 감지 기능 꺼 / 어차피 제대로 동작도 안 하잖아 / 수면감지 삭제해") —
      // 오늘 밤 "오버레이가 자꾸 사라진다"의 실제 원인이 이 기능이었다(prefs에 expire_reason=
      // sleep_detected, expired=true로 확인). 가속도계(폰의 물리적 움직임)만 보고 판단하는데, 폰을
      // 책상/거치대에 두고 손가락으로만 스와이프하며 보는 가장 흔한 사용 패턴에서는 폰이 전혀 안
      // 움직여서, 멀쩡히 시청 중인데도 무진동 임계값이 차 세션이 수면으로 강제 종료됐다. 오탐 비용이
      // (한창 보는 중에 앱이 꺼짐) 이득보다 훨씬 커서 기능 자체를 비활성화한다.
      // 판정만 끄고 나머지 배선(센서 등록/임계값/프리미엄 설정값)은 그대로 남겨둔다 — 되살릴 때
      // 이 한 줄만 되돌리면 되고, lastMotionAtMs는 다른 곳에서도 참조하기 때문.
      @Suppress("UNUSED_EXPRESSION") (stillnessElapsedMs >= stillnessThresholdMs && isWithinSleepDetectionWindow())
      val sleepDetected = false

      // sleepTimerRemainingMinutes==0은 "원래 -1(꺼짐)이었는데 우연히 0"이 아니라 반드시
      // ">0에서 감소해서 도달한 0"만 가능(위에서 >0일 때만 감소시키므로) — 별도 플래그 없이 안전하게
      // "Sleep Timer가 켜져 있었고 방금 만료됐다"로 판단 가능.
      val isDailyLimit = remainingMinutes <= 0 && !sleepDetected
      if (isDailyLimit) {
        dailyLimitHitCount += 1
        persistDailyLimitHitState()
        // 한도 도달 3단계(2026-07-23, 사용자 지적 반영 — LimitReachedOverlay.tsx의 3단계를 실제
        // 시청 중 차단 경로에도 이식). 3차부터는 스펙 원문 그대로 "선택지 없이 1~3초 자동 소멸하는
        // 담백한 안내만(차단 아님, 그냥 알려주기만)" — 즉 세션을 실제로 멈추지 않는다: EXTEND_MINUTES를
        // 조용히 더해 카운트다운을 이어가고, 짧은 안내 토스트만 띄운 뒤 평소처럼 다음 틱을 예약한다.
        if (dailyLimitHitCount >= 3) {
          val usageMinutes = dailyLimitOriginalMinutes + (dailyLimitHitCount - 1) * EXTEND_MINUTES
          Log.d("PaceOverlay", "DAILY LIMIT tier=3+ hitCount=$dailyLimitHitCount usageMinutes=$usageMinutes (non-blocking, auto-extended)")
          remainingMinutes += EXTEND_MINUTES
          persistState()
          showTier3Toast(usageMinutes, dailyLimitOriginalMinutes, dailyLimitHitCount)
          scheduleNextTick(this)
          return
        }
      }
      if (remainingMinutes <= 0 || sleepTimerRemainingMinutes == 0 || sleepDetected) {
        val reason = when {
          sleepDetected -> "sleep_detected"
          isDailyLimit -> "daily_limit_reached"
          else -> "sleep_timer_expired"
        }
        Log.d("PaceOverlay", "SESSION END reason=$reason tier=${if (isDailyLimit) dailyLimitHitCount else 0} stillnessElapsedMs=$stillnessElapsedMs thresholdMs=$stillnessThresholdMs btDisconnectedDuringStillness=$btDisconnectedDuringStillness")
        markExpired(reason)
        clearSessionActive()
        if (notifyLimit && reason != "sleep_detected") {
          // 수면감지는 "자고 있는데 알림 소리/진동으로 깨우는" 모순을 피하려 알림을 안 보낸다 —
          // 화면 자체를 잠그므로(아래 showBlockOverlay/lockScreen) 어차피 알림을 봐도 소용없다.
          if (isKoreanLocale()) {
            val limitBody = if (isDailyLimit && dailyLimitHitCount >= 2) "잠시 쉬어갈까요?" else "잠시 휴대폰을 내려놓을 시간이에요."
            sendAlertNotification(NOTIFICATION_ID_LIMIT_REACHED, "오늘의 한도에 도달했어요", limitBody)
          } else {
            val limitBody = if (isDailyLimit && dailyLimitHitCount >= 2) "Time for a break?" else "Time to put the phone down for a bit."
            sendAlertNotification(NOTIFICATION_ID_LIMIT_REACHED, "You've reached today's limit", limitBody)
          }
        }
        cancelScheduledTick(this)
        // 2026-07-19 사용자 제품 결정: "Pace가 만료로 판단했는데 YouTube는 계속 시청 가능"했던 기존
        // 갭(#1/#3)을 여기서 닫는다 — 작은 알약 대신 전체화면 차단(showBlockOverlay)을 항상 띄운다
        // (알림 권한 유무와 무관, notifyLimit 설정과도 무관 — 차단 자체는 옵트아웃 대상이 아님).
        // 포그라운드 앱 감지 폴링/미디어세션은 더 필요 없음(전체화면 차단이 항상 보이므로) — 하지만
        // stopForeground/stopSelf는 하지 않는다: "+5분" 버튼으로 재개 가능해야 하므로 서비스 자체는
        // "종료" 버튼을 눌러야만(endFromBlockOverlay) 완전히 죽는다.
        stopForegroundAppPolling()
        teardownMediaSession()
        unregisterStillnessSensor()
        // Hard Block Mode(기본 OFF, Settings에서 사용자가 직접 켠 경우만): 전체화면 차단에 더해
        // YouTube 자체를 강제로 홈으로 내보낸다 — PaceAccessibilityService가 이미 gesture 권한을
        // 갖고 있어 추가 권한 없이 가능(performGlobalAction은 canPerformGestures 범위 안).
        // 수면감지는 이 설정과 무관하게 항상 goHome — "자는 사람 앞에 유튜브를 계속 틀어두는" 건
        // 옵트인 설정 여부와 상관없이 이 기능의 존재 이유 자체를 무력화하므로.
        if (hardBlockMode || reason == "sleep_detected") {
          PaceAccessibilityService.goHome()
        }
        showBlockOverlay(reason, if (isDailyLimit) dailyLimitHitCount else 0)
        return
      }
      scheduleNextTick(this)
    } catch (e: Exception) {
      // 틱 계산 자체가 실패해도 다음 틱 예약은 시도한다 — 한 번의 계산 실패로 카운트다운
      // 자체가 영구히 멈추는 것(=Daily Limit 무력화)이 가장 나쁜 결과이기 때문.
      Log.e("PaceOverlay", "performTick failed, rescheduling anyway", e)
      scheduleNextTick(this)
    }
  }

  // 2026-08-01 사용자 지적("상단 노티가 하루종일 똑같은데?") — buildNotification()이 ensureInfraReady()
  // 에서 딱 1번만 호출되고 이후 다시 notify()되는 곳이 없어, 세션 내내 "세션 관리 중" 고정 문구만
  // 떠 있었다(남은 시간이 줄어도 전혀 반영 안 됨). remainingMinutes를 받아 알약(remainingLabel)과
  // 동일한 정보를 보여주고, performTick()에서 매 분 updateNotification()으로 갱신한다.
  private fun buildNotification(remainingMinutes: Int): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Pace Session", NotificationManager.IMPORTANCE_MIN)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    val body = if (isKoreanLocale()) "${remainingMinutes}분 남음" else "${remainingMinutes}m left"
    return Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Pace")
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_menu_recent_history)
      .setOngoing(true)
      .build()
  }

  private fun updateNotification(remainingMinutes: Int) {
    try {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(NOTIFICATION_ID, buildNotification(remainingMinutes))
    } catch (e: Exception) {
      Log.w("PaceOverlay", "updateNotification failed", e)
    }
  }

  // 2026-07-19: healthy-shorts-assistant(3) ShortsPlayer.tsx의 Android 컴팩트 알약(dark glass +
  // pulsing dot + AUTO ON/OFF 배지) 시각 스타일을 순수 네이티브로 이식. 원본의 펼침형 어시스턴트
  // 패널(오늘 사용량/진행바/Sleep Timer/Daily Limit 사이클/Pause/End 버튼)까지는 이식하지 않았다 —
  // 그건 RN 트리를 이 창에 브릿지해야(두 번째 ReactRootView 인스턴스) 가능한 범위라 파일 상단
  // 주석에 이미 POC 단계 보류 항목으로 명시돼 있다. 배지 탭 = 실제 Auto Mode 토글(companion
  // setAutoMode 재사용 — Bluetooth Play/Pause 하드웨어 버튼과 동일한 진짜 동작, 가짜 버튼 아님).
  //
  // ⚠️ 2026-07-19 실기기 검증 중 발견·수정한 버그: 처음엔 알약 본문 전체(bar)에도
  // setOnClickListener { openPaceApp() }를 달아서 "본문 탭 = Pace 앱 열기"를 시도했는데, 사용자가
  // 실제로 YouTube 위에서 AUTO 배지를 껐더니 "창이 작아지며 원래 앱(Pace)으로 돌아오고, 다시
  // YouTube로 가면 오버레이가 사라지는" 심각한 오작동을 실제로 보고했다. 원인: autoBadge의
  // setPadding(20, 10, ...)이 dp가 아니라 raw px였다 — 이 고밀도 기기에서 실제 터치 가능 영역이
  // 몇 dp 수준으로 쪼그라들어, 배지를 노리고 탭해도 대부분 부모 bar에 떨어져 의도치 않게
  // openPaceApp()이 발동했다(YouTube 화면 위에 떠 있는 오버레이라 "본문 탭"의 오폭 범위가 바로
  // 실제 영상 위 터치와 겹친다 — RN 화면 안 UI였다면 이 정도로 위험하지 않았을 것). 고침: bar
  // 자체의 클릭 리스너(openPaceApp)를 완전히 제거 — FLAG_NOT_TOUCH_MODAL 특성상 클릭 리스너가 없는
  // 영역은 터치가 아래 앱(YouTube)으로 그대로 통과하므로, 배지를 빗맞혀도 이제 아무 일도 안 일어나고
  // 원래 하려던 영상 조작(스크롤/탭)이 정상적으로 전달된다. 유일한 인터랙션은 배지 자체(아래
  // applyAutoBadgeStyle의 padding을 dp로 교정)로 좁혔다.
  // 2026-07-25 사용자 지시("두껍다고 했잖아", "앞뒤 재생도 필요없잖아", "맥이 반영한 ui대로 동일하게
  // 수정해") — iOS Pace Feed 리디자인(feat(feed) 커밋, src/app/feed/index.tsx 상단바)과 같은 톤으로
  // 전면 재설계. prev/next 버튼 제거(iOS도 "실동작 불안정 + 웹뷰 UI와 겹침" 이유로 이미 제거함,
  // PaceAccessibilityService.swipeOnce 자체는 Bluetooth 리모컨 경로에서 여전히 쓰이므로 손대지 않음).
  // 두껍던 단일 다크 바(#E60C0D12, 6개 요소 빽빽) → 얇은 글래스 캡슐 하나(dot+remaining+세션 토글) +
  // 그 오른쪽에 작은 원형 글래스 P 버튼(+ 세션 중일 때만 보이는 보라 링 zap 배지) — iOS
  // appIconBtn/focusDot과 동일한 사이즈(36dp)·컬러 톤(rgba(0,0,0,0.45) 배경 + rgba(255,255,255,0.22)
  // 테두리)으로 맞췄다. Android는 다이나믹 아일랜드가 없어 남은시간 텍스트는 유지(iOS와 완전히
  // 동일하게 아예 없애면 이 화면이 세션 시간을 보여줄 유일한 자리가 사라짐) — 대신 캡슐 자체를
  // 훨씬 얇고 반투명하게 만들어 "두껍다"는 지적을 해소.
  private fun showOverlay(remainingMinutes: Int) {
    if (overlayView != null) return
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val d = resources.displayMetrics.density

    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }

    // 얇은 글래스 캡슐: pulsing dot + "Xm left" + 세션 토글(autoBadge, 탭 가능 — 진짜 Auto Mode 토글).
    val statusPill = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding((14 * d).toInt(), (8 * d).toInt(), (8 * d).toInt(), (8 * d).toInt())
      background = GradientDrawable().apply {
        cornerRadius = 999f
        setColor(Color.parseColor("#730C0D12")) // rgba(12,13,18,0.45) — iOS 글래스 필과 동일 불투명도
        setStroke((1 * d).toInt().coerceAtLeast(1), Color.parseColor("#38FFFFFF")) // rgba(255,255,255,0.22)
      }
    }

    val dot = View(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#30D158"))
      }
      startAnimation(android.view.animation.AlphaAnimation(1f, 0.35f).apply {
        duration = 700
        repeatMode = android.view.animation.Animation.REVERSE
        repeatCount = android.view.animation.Animation.INFINITE
      })
    }
    statusPill.addView(dot, LinearLayout.LayoutParams((8 * d).toInt(), (8 * d).toInt()).apply { rightMargin = (10 * d).toInt() })

    remainingLabel = TextView(this).apply {
      text = "${remainingMinutes}m left"
      setTextColor(Color.WHITE)
      textSize = 12f
      setTypeface(typeface, android.graphics.Typeface.NORMAL)
    }
    statusPill.addView(remainingLabel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      rightMargin = (10 * d).toInt()
    })

    autoBadge = TextView(this).apply {
      textSize = 9f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      isClickable = true
      setOnClickListener {
        // 2026-08-01 사용자 지시 — "FOCUS OFF" 상태에서 탭했을 때, 그게 자유의사로 끈 게 아니라
        // 무료 사용자의 Focus Session이 시간 다 돼서 자동으로 꺼진 경우라면 그냥 바로 재활성화하지
        // 않는다(광고 없이 무한정 다시 켤 수 있던 구멍). 앱을 열어 JS의 보상형 광고 유도 모달
        // (FocusSessionExtendModal)로 보낸다 — 실제 소비(consumeFocusSessionTimedOut)는 JS가
        // 포그라운드 시 담당하므로 여기선 peek만 한다. 프리미엄이거나 수동으로 껐던 경우는
        // 기존처럼 바로 재활성화(광고 게이트 불필요).
        // 2026-08-02 사장님 지시("쇼츠 오버레이 상태 focus off일 때 누르면 광고 창 띄우는 걸로 해,
        // 앱으로 가는 시나리오 만들지 말고") — openApp()으로 Pace 홈에 데려가 RN 모달을 띄우던 방식을
        // 폐기한다. 쇼츠를 보다가 다른 앱으로 튕겨나가는 흐름 자체가 나빴고, 실제로 홈에 도착해도
        // 모달이 안 뜨는 회귀까지 겹쳤다(실기기 재현). 이제 투명 액티비티(PaceRewardedAdActivity)가
        // 보상형 광고만 띄웠다 닫히므로, 사용자에겐 "쇼츠 위에 광고가 떴다 사라지고 다시 쇼츠"로
        // 보인다 — Pace 앱 화면은 한 번도 안 보인다. 보상 획득 시 그 액티비티가 extendFocusSession을
        // 직접 호출한다(연장 + 원래 앱 복귀까지 그 안에서 처리).
        if (!autoNextEnabled && hasPendingFocusSessionTimeout() && !isPremium(applicationContext)) {
          showExtendChoiceOverlay()
        } else {
          // autoNextEnabled 필드 갱신 + 배지 리프레시는 setAutoMode()가 모든 호출 경로에 대해
          // 일괄 처리한다(위 companion setAutoMode 참고) — 여기서 중복으로 안 건드림.
          setAutoMode(applicationContext, !autoNextEnabled)
          persistState()
        }
      }
    }
    statusPill.addView(autoBadge)
    bar.addView(statusPill, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      rightMargin = (8 * d).toInt()
    })

    applyAutoBadgeStyle() // autoBadge 텍스트/색을 현재 상태로 맞춤
    // 2026-07-26 사용자 지적("자동넘김 표시하려고 번개 넣은 건데 SESSION ON으로 표시할 거면 번개가
    // 필요없잖아") — 맞는 말이다. statusPill의 "SESSION ON/OFF" 텍스트가 이미 같은 상태를 말로
    // 표시하고 있는데 바로 옆에 같은 뜻의 zap 원까지 있는 건 중복이었다. zap 배지 제거.

    // 2026-07-21 밤 사용자 지시(PACE_ARCHITECTURE.md "런치 플로우 단순화") — 콜드 스타트가
    // 이제 탭 대신 곧바로 세션(Overlay+YouTube)으로 가므로, 실사용 중 대부분의 시간(YouTube가
    // 전경, Pace Activity는 백그라운드) 유일하게 항상 보이는 이 알약에 앱으로 돌아가는 경로가
    // 있어야 Home/Focus/Stats/Settings에 접근 가능하다 — JS 쪽 overlay/index.tsx에도 같은
    // 목적의 앱 아이콘 버튼이 있지만 그건 Pace Activity가 전경일 때만(거의 항상 YouTube에
    // 가려짐) 보이므로 실질적으로 이 네이티브 버튼이 진짜 진입점이다. getLaunchIntentForPackage
    // 사용 — 이 모듈이 호스트 앱의 MainActivity 클래스에 직접 의존하지 않도록. 스타일은 iOS
    // appIconBtn과 동일(36dp 원형 글래스, rgba(0,0,0,0.45)+테두리rgba(255,255,255,0.22)).
    val appBtn = TextView(this).apply {
      text = "P"
      textSize = 15f
      gravity = Gravity.CENTER
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setTextColor(Color.parseColor("#F2FFFFFF")) // rgba(255,255,255,0.95)
      isClickable = true
      setOnClickListener { togglePaceMenu() }
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#730C0D12"))
        setStroke((1 * d).toInt().coerceAtLeast(1), Color.parseColor("#38FFFFFF"))
      }
    }
    bar.addView(appBtn, LinearLayout.LayoutParams((36 * d).toInt(), (36 * d).toInt()))

    overlayView = bar

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      // 2026-07-25 사용자 지시 — "애플하고 동일하게" 배치. iOS Pace Feed topBar는 justifyContent:
      // 'flex-end'로 우상단 정렬(App.tsx/feed/index.tsx 참고) — 화면 중앙이 아니라 우상단 코너에
      // 붙인다. 여백도 iOS의 spacing.md(16dp)에 맞춤.
      gravity = Gravity.TOP or Gravity.END
      x = (16 * resources.displayMetrics.density).toInt()
      y = 80 // 상태바 아래 여백 — 기기별 safe-area는 후속 보정 필요
    }
    windowManager?.addView(overlayView, params)
  }

  // 2026-07-31 사장님 지시 — P 버튼 드롭다운 메뉴(별도 오버레이 창, 알약 바로 아래). 열려있으면
  // 닫고, 닫혀있으면 새로 만들어서 연다 — 매번 새로 만드는 이유는 이 창이 짧게 떴다 사라지는
  // 용도라 뷰 재사용보다 단순함이 낫다고 판단.
  private fun togglePaceMenu() {
    if (paceMenuView != null) {
      hidePaceMenu()
    } else {
      showPaceMenu()
    }
  }

  private fun hidePaceMenu() {
    paceMenuView?.let { view -> try { windowManager?.removeView(view) } catch (e: Exception) {} }
    paceMenuView = null
  }

  // 2026-08-02 사장님 지시("쇼츠 보다 focus off 누르면 광고 볼래 크레딧 쓸래 팝업 뜨고, 광고 보겠다고
  // 하면 광고 보여주는 거 아냐?") — 그 선택 팝업. 앱으로 나가지 않고 쇼츠 위에 그대로 띄운다.
  // [광고 보고 5분 더] / [크레딧 5개로 5분 더](잔액 충분할 때만) / [나중에] 3지선다.
  private var extendChoiceView: LinearLayout? = null
  private fun hideExtendChoice() {
    extendChoiceView?.let { view -> try { windowManager?.removeView(view) } catch (e: Exception) {} }
    extendChoiceView = null
  }

  private fun showExtendChoiceOverlay() {
    hideExtendChoice()
    val ko = java.util.Locale.getDefault().language == "ko"
    val d = resources.displayMetrics.density
    val credits = availableCredits(applicationContext)

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding((20 * d).toInt(), (20 * d).toInt(), (20 * d).toInt(), (16 * d).toInt())
      background = GradientDrawable().apply {
        cornerRadius = 20f * d
        setColor(Color.parseColor("#F21A1B22"))
        setStroke((1 * d).toInt().coerceAtLeast(1), Color.parseColor("#33FFFFFF"))
      }
    }
    card.addView(TextView(this).apply {
      text = if (ko) "Focus Session이 끝났어요" else "Focus Session ended"
      textSize = 16f
      setTextColor(Color.WHITE)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    })
    card.addView(TextView(this).apply {
      text = if (ko) "광고를 보거나 크레딧을 쓰면 ${EXTEND_MINUTES}분 더 이어갈 수 있어요"
             else "Watch an ad or use credits for ${EXTEND_MINUTES} more minutes"
      textSize = 13f
      setTextColor(Color.parseColor("#B3FFFFFF"))
      setPadding(0, (6 * d).toInt(), 0, (14 * d).toInt())
    })

    fun button(label: String, bgColor: String, textColor: Int, onTap: () -> Unit): TextView =
      TextView(this).apply {
        text = label
        textSize = 14f
        gravity = Gravity.CENTER
        setTextColor(textColor)
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, (12 * d).toInt(), 0, (12 * d).toInt())
        background = GradientDrawable().apply {
          cornerRadius = 999f
          setColor(Color.parseColor(bgColor))
        }
        isClickable = true
        setOnClickListener { onTap() }
      }

    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
      .apply { topMargin = (8 * d).toInt() }

    card.addView(button(if (ko) "광고 보고 ${EXTEND_MINUTES}분 더" else "Watch ad for ${EXTEND_MINUTES} min", "#6C5CE7", Color.WHITE) {
      hideExtendChoice()
      consumeFocusSessionTimedOut() // 이 경로로 처리하므로 앱 쪽 중복 모달 방지
      PaceRewardedAdActivity.start(applicationContext, EXTEND_MINUTES)
    }, lp)

    if (credits >= EXTEND_MINUTES) {
      card.addView(button(
        if (ko) "크레딧 ${EXTEND_MINUTES}개로 ${EXTEND_MINUTES}분 더 (보유 $credits)" else "Use $EXTEND_MINUTES credits (you have $credits)",
        "#1F3A2E", Color.parseColor("#4ADE80")
      ) {
        hideExtendChoice()
        consumeFocusSessionTimedOut()
        // 실제 잔액 차감은 JS 스토어가 진실원천 — 여기선 "얼마 썼는지"만 남기고 즉시 연장해준다
        // (JS가 다음 포그라운드에 consumePendingCreditSpend로 1회성 소비해 차감).
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
          .putInt(PREF_PENDING_CREDIT_SPEND, prefs.getInt(PREF_PENDING_CREDIT_SPEND, 0) + EXTEND_MINUTES)
          .putInt(PREF_AVAILABLE_CREDITS, (credits - EXTEND_MINUTES).coerceAtLeast(0))
          .apply()
        extendFocusSession(applicationContext, EXTEND_MINUTES)
      }, lp)
    }

    card.addView(button(if (ko) "나중에" else "Not now", "#00000000", Color.parseColor("#99FFFFFF")) {
      hideExtendChoice()
    }, lp)

    val container = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding((24 * d).toInt(), 0, (24 * d).toInt(), 0)
      setBackgroundColor(Color.parseColor("#B3000000"))
      isClickable = true
      setOnClickListener { hideExtendChoice() } // 바깥 탭으로 닫기
      addView(card, LinearLayout.LayoutParams((320 * d).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      0, // 포커스 가능해야 버튼 탭이 먹는다
      android.graphics.PixelFormat.TRANSLUCENT
    )
    try {
      windowManager?.addView(container, params)
      extendChoiceView = container
    } catch (e: Exception) {
      Log.w("PaceOverlay", "showExtendChoiceOverlay failed", e)
    }
  }

  // 2026-07-31 실기기 발견("쇼츠 보다 P에서 Open App하면 앱 갔다가 바로 쇼츠 시작") —
  // getLaunchIntentForPackage()+REORDER_TO_FRONT는 Pace 태스크를 "마지막 상태 그대로" 복원한다.
  // MainActivity가 singleTask라 세션 시작 당시 마지막으로 떠 있던 화면(예: 플랫폼 재진입 로직이
  //있는 화면)이 그대로 되살아나면 그 화면 자체의 로직이 재발동해 유튜브로 즉시 되돌아갈 수 있다.
  // 대신 pace://home 딥링크로 명시적으로 Home을 지정한다 — Expo Router의 기본 링킹 리스너가
  // 이미 떠 있는 액티비티(singleTask → onNewIntent)에도 이 URL을 항상 홈 라우트로 매칭해준다.
  private fun openApp() {
    lastOpenAppAtMs = SystemClock.elapsedRealtime()
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("pace://home")).apply {
      // FLAG_ACTIVITY_NO_USER_ACTION — 실기기 발견(2026-07-31): 이 플래그 없이 유튜브를 백그라운드로
      // 보내면 유튜브가 onUserLeaveHint()를 "사용자가 홈으로 나감"으로 오인해 자동으로 PIP(작은
      // 떠있는 창)에 들어가버린다. 이 플래그는 액티비티 전환이 사용자의 직접 터치가 아님을 시스템에
      // 알려 onUserLeaveHint 호출 자체를 막는다 — 유튜브 PIP 자동진입의 정확한 트리거를 끊는다.
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
    }
    try {
      startActivity(intent)
    } catch (e: Exception) {
      Log.w("PaceOverlayService", "openApp 딥링크 실패, 기본 런치인텐트로 폴백", e)
      val fallback = packageManager.getLaunchIntentForPackage(packageName)
      fallback?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
      fallback?.let { startActivity(it) }
    }
  }

  private fun hideSavedFavoriteList() {
    savedListView?.let { view -> try { windowManager?.removeView(view) } catch (e: Exception) {} }
    savedListView = null
  }

  // 2026-07-31 사장님 지시 + 실기기 재발견 — 원래 quick-list.tsx(별도 액티비티)로 이동하던 걸 전부
  // 네이티브 오버레이로 교체한다: 액티비티 전환 자체가 유튜브를 백그라운드로 보내 자동 PIP를
  // 유발했고(FLAG_ACTIVITY_NO_USER_ACTION로도 못 막음, 유튜브의 setAutoEnterEnabled는 우리 쪽
  // 인텐트 플래그로 못 끔 — Android 공식 문서/삼성 개발자 포럼 확인), 사장님 원 지시("투명의 리스트
  // 오버레이가 나와서... 앱으로 안 나가고 그 자리에서")와도 이 방식이 맞다. 상단에 "현재 영상 추가"
  // 버튼 + 기존 리스트를 같은 창에서 보여주고, 추가를 누른 시점에만 캡처(아직 유튜브가 전경)한다.
  private fun showSavedFavoriteList(kind: String) {
    hideSavedFavoriteList()
    val d = resources.displayMetrics.density
    val panelWidth = (resources.displayMetrics.widthPixels - (32 * d)).toInt().coerceAtMost((380 * d).toInt())

    // 2026-07-31 사장님 지적("저게 투명이야?") — P메뉴(showPaceMenu)의 90% 불투명 스타일을 그대로
    // 복붙했었는데, 이 리스트는 원래부터 "글래스모피즘 투명 박스"로 명시적으로 지시받은 화면이다
    // (RN GlassSurface와 동일한 톤: 옅은 틴트 + 실제 블러). 배경 자체를 훨씬 옅게(약 35% 불투명)
    // 낮추고, API 31+ 기기에서는 WindowManager.LayoutParams.FLAG_BLUR_BEHIND로 뒤(유튜브 영상)를
    // 실제로 블러 처리해 진짜 글래스 느낌을 낸다(구버전은 옅은 틴트만으로 폴백).
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = 16f * d
        setColor(Color.parseColor("#591A1B22"))
        setStroke((1 * d).toInt().coerceAtLeast(1), Color.parseColor("#33FFFFFF"))
      }
      clipToOutline = true
      setPadding((14 * d).toInt(), (14 * d).toInt(), (14 * d).toInt(), (10 * d).toInt())
    }

    val header = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    header.addView(TextView(this).apply {
      text = if (kind == "capture") "Saved" else "Favorite"
      textSize = 15f
      setTextColor(Color.WHITE)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    header.addView(TextView(this).apply {
      text = "✕"
      textSize = 15f
      setTextColor(Color.parseColor("#B3FFFFFF"))
      setPadding((10 * d).toInt(), (4 * d).toInt(), (2 * d).toInt(), (4 * d).toInt())
      isClickable = true
      setOnClickListener { hideSavedFavoriteList() }
    })
    panel.addView(header)

    val listContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val scroll = ScrollView(this).apply { addView(listContainer) }

    // 현재 영상 추가 버튼 — 리스트 최상단, 항상 보임(둘 다: 사장님 지시 "favorit도 Add와 기존
    // list가 보이고 Add를 누르면 리스트에 추가").
    val addRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = 10f * d
        setColor(Color.parseColor("#33FFFFFF"))
      }
      setPadding((10 * d).toInt(), (9 * d).toInt(), (10 * d).toInt(), (9 * d).toInt())
      isClickable = true
    }
    addRow.addView(TextView(this).apply {
      text = "+  Add current video"
      textSize = 13f
      setTextColor(Color.WHITE)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    })
    panel.addView(addRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      topMargin = (10 * d).toInt()
      bottomMargin = (10 * d).toInt()
    })

    fun renderList() {
      listContainer.removeAllViews()
      val items = SavedVideosStore.list(applicationContext, kind)
      if (items.isEmpty()) {
        listContainer.addView(TextView(this@PaceOverlayService).apply {
          text = if (kind == "capture") "Nothing saved yet" else "No favorites yet"
          textSize = 12f
          setTextColor(Color.parseColor("#80FFFFFF"))
          gravity = Gravity.CENTER
          setPadding(0, (18 * d).toInt(), 0, (18 * d).toInt())
        })
      }
      items.forEachIndexed { index, item ->
        val itemRow = LinearLayout(this@PaceOverlayService).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(0, (8 * d).toInt(), 0, (8 * d).toInt())
        }
        val thumb = ImageView(this@PaceOverlayService).apply {
          scaleType = ImageView.ScaleType.CENTER_CROP
          background = GradientDrawable().apply {
            cornerRadius = 8f * d
            setColor(Color.parseColor("#14FFFFFF"))
          }
        }
        val thumbSize = (44 * d).toInt()
        itemRow.addView(thumb, LinearLayout.LayoutParams(thumbSize, thumbSize))
        if (!item.thumbnailUrl.isNullOrEmpty()) loadThumbnailInto(thumb, item.thumbnailUrl)

        val textCol = LinearLayout(this@PaceOverlayService).apply { orientation = LinearLayout.VERTICAL }
        textCol.addView(TextView(this@PaceOverlayService).apply {
          text = item.title ?: "—"
          textSize = 12f
          maxLines = 2
          setTextColor(Color.WHITE)
        })
        if (!item.channel.isNullOrEmpty()) {
          textCol.addView(TextView(this@PaceOverlayService).apply {
            text = item.channel
            textSize = 10f
            setTextColor(Color.parseColor("#8CFFFFFF"))
          })
        }
        itemRow.addView(textCol, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
          marginStart = (10 * d).toInt()
          marginEnd = (6 * d).toInt()
        })

        // 2026-07-31 — Saved/Favorite 둘 다 공유 아이콘 표시(사장님 지시 "favorit도... 공유가
        // 보이게"). Favorite은 행 자체를 탭하면 재생(원본 유튜브 링크로 이동).
        // 2026-08-01 사장님 지적("공유 아이콘이 너무 작다") — 16sp+최소 패딩이라 실제 탭 영역이
        // 안드로이드 권장 최소 터치 타깃(48dp)에 한참 못 미쳐서, 근처를 눌러도 행 자체의 재생
        // 클릭리스너로 새서 안 눌리는 것처럼 느껴졌다(실기기 재현). 아이콘 크기+패딩을 키우고
        // minWidth/minHeight로 탭 영역 자체를 48dp 이상 보장.
        itemRow.addView(TextView(this@PaceOverlayService).apply {
          text = "⇪"
          textSize = 26f
          setTextColor(Color.WHITE)
          gravity = Gravity.CENTER
          minWidth = (48 * d).toInt()
          minHeight = (48 * d).toInt()
          isClickable = true
          setOnClickListener {
            val url = item.url ?: return@setOnClickListener
            try {
              val share = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, url)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              startActivity(Intent.createChooser(share, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
              Log.w("PaceOverlayService", "share 실패", e)
            }
          }
        })
        itemRow.addView(TextView(this@PaceOverlayService).apply {
          text = "✕"
          textSize = 13f
          setTextColor(Color.parseColor("#80FFFFFF"))
          setPadding((8 * d).toInt(), (4 * d).toInt(), (2 * d).toInt(), (4 * d).toInt())
          isClickable = true
          setOnClickListener {
            SavedVideosStore.remove(applicationContext, item.id)
            renderList()
          }
        })

        if (kind == "favorite") {
          itemRow.isClickable = true
          itemRow.setOnClickListener {
            val url = item.url ?: return@setOnClickListener
            try {
              startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
              Log.w("PaceOverlayService", "재생 실패", e)
            }
          }
        }

        listContainer.addView(itemRow)
        if (index < items.size - 1) {
          listContainer.addView(View(this@PaceOverlayService).apply { setBackgroundColor(Color.parseColor("#14FFFFFF")) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * d).toInt().coerceAtLeast(1)))
        }
      }
      // 항목 수에 맞춰 늘어나되(사장님 지시 초안 스타일과 동일), 화면의 45%를 넘으면 스크롤.
      val estimatedRowHeightPx = (60 * d).toInt()
      val estimatedHeight = (items.size.coerceAtLeast(1) * estimatedRowHeightPx)
      val maxHeight = (resources.displayMetrics.heightPixels * 0.45f).toInt()
      scroll.layoutParams = (scroll.layoutParams ?: LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0)).apply {
        height = estimatedHeight.coerceAtMost(maxHeight)
      }
    }

    // 2026-08-01 사장님 지시("Add 누르면 리스트에 추가되면서 공유도 동시에 뜨게") — videoId/url을
    // 알아내려면 공유시트를 거쳐야 하지만(최대 8초), 그동안 사용자를 기다리게 두지 않는다. 접근성
    // 트리에서 즉시 읽을 수 있는 제목/채널로 먼저 낙관적으로 추가해 보여주고(1차 콜백), 공유 결과가
    // 나오면 같은 행을 실제 videoId/url/썸네일로 채운다(2차 콜백) — captureCurrentVideoInfo 참고.
    addRow.setOnClickListener {
      var placeholderId: String? = null
      PaceAccessibilityService.captureCurrentVideoInfo { title, channel, videoId, url, isFinal ->
        foregroundPollHandler.post {
          if (!isFinal) {
            if (!title.isNullOrEmpty()) {
              placeholderId = SavedVideosStore.insert(applicationContext, kind, videoId, title, channel, url)
              if (placeholderId != null) {
                Toast.makeText(applicationContext, "Added ✓", Toast.LENGTH_SHORT).show()
                renderList()
              }
            }
            return@post
          }
          val pid = placeholderId
          if (pid != null) {
            if (videoId != null) {
              SavedVideosStore.updateVideoUrl(applicationContext, pid, videoId, url)
              renderList()
            }
          } else {
            // 1차 콜백 없이 바로 실패로 끝난 경우(공유 버튼 자체를 못 찾음 등) — 예전 방식대로 처리.
            val hasCapture = !title.isNullOrEmpty() || !videoId.isNullOrEmpty()
            if (hasCapture && SavedVideosStore.insert(applicationContext, kind, videoId, title, channel, url) != null) {
              Toast.makeText(applicationContext, "Added ✓", Toast.LENGTH_SHORT).show()
              renderList()
            } else {
              Toast.makeText(applicationContext, "Couldn't read this video — try again", Toast.LENGTH_SHORT).show()
            }
          }
        }
      }
    }

    panel.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    renderList()

    val root = FrameLayout(this).apply { addView(panel, FrameLayout.LayoutParams(panelWidth, FrameLayout.LayoutParams.WRAP_CONTENT)) }
    savedListView = root
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = (16 * d).toInt()
      y = 80 + (44 * d).toInt()
      // API 31+ 진짜 배경 블러(뒤에 재생 중인 유튜브 영상이 실제로 흐려짐) — 구버전은 위 옅은 틴트
      // 배경색만으로 폴백(완전 투명은 아니지만 90% 불투명 박스보다는 훨씬 "유리" 느낌에 가깝다).
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        flags = flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
        blurBehindRadius = (28 * d).toInt()
      }
    }
    try {
      windowManager?.addView(savedListView, params)
    } catch (e: Exception) {
      Log.w("PaceOverlayService", "showSavedFavoriteList 실패", e)
      savedListView = null
    }
  }

  private fun loadThumbnailInto(imageView: ImageView, url: String) {
    Thread {
      try {
        val bitmap: Bitmap = BitmapFactory.decodeStream(URL(url).openStream())
        foregroundPollHandler.post {
          if (imageView.isAttachedToWindow) imageView.setImageBitmap(bitmap)
        }
      } catch (e: Exception) {
        // 썸네일 실패는 조용히 무시 — 플레이스홀더 배경이 이미 그려져 있음.
      }
    }.start()
  }

  private fun hideShortsHotList() {
    shortsHotListView?.let { view -> try { windowManager?.removeView(view) } catch (e: Exception) {} }
    shortsHotListView = null
  }

  // 2026-08-01 사장님 지시 — "Shorts HOT" 실제 구현. Saved/Favorite 패널과 동일한 글래스모피즘
  // 스타일/블러/위치를 그대로 재사용하되, 로컬 SQLite 대신 ShortsHotStore로 백엔드를 호출하고
  // (네트워크라 백그라운드 스레드 필수), 상단은 Add 버튼 대신 카테고리 가로 스크롤 탭이다. 항목은
  // 읽기 전용 콘텐츠라 공유/삭제 없이 탭하면 바로 원본 유튜브로 이동한다.
  private fun showShortsHotList(initialCategory: String) {
    hideShortsHotList()
    val d = resources.displayMetrics.density
    val panelWidth = (resources.displayMetrics.widthPixels - (32 * d)).toInt().coerceAtMost((380 * d).toInt())

    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = 16f * d
        setColor(Color.parseColor("#591A1B22"))
        setStroke((1 * d).toInt().coerceAtLeast(1), Color.parseColor("#33FFFFFF"))
      }
      clipToOutline = true
      setPadding((14 * d).toInt(), (14 * d).toInt(), (14 * d).toInt(), (10 * d).toInt())
    }

    val header = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    header.addView(TextView(this).apply {
      text = "Shorts HOT"
      textSize = 15f
      setTextColor(Color.WHITE)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    header.addView(TextView(this).apply {
      text = "✕"
      textSize = 15f
      setTextColor(Color.parseColor("#B3FFFFFF"))
      setPadding((10 * d).toInt(), (4 * d).toInt(), (2 * d).toInt(), (4 * d).toInt())
      isClickable = true
      setOnClickListener { hideShortsHotList() }
    })
    panel.addView(header)

    var currentCategory = if (ShortsHotStore.CATEGORIES.contains(initialCategory)) initialCategory else "all"
    val categoryTabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    val categoryScroll = HorizontalScrollView(this).apply {
      isHorizontalScrollBarEnabled = false
      addView(categoryTabs)
    }
    panel.addView(categoryScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      topMargin = (8 * d).toInt()
      bottomMargin = (8 * d).toInt()
    })

    val listContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val scroll = ScrollView(this).apply { addView(listContainer) }
    panel.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    fun renderTabs() {
      categoryTabs.removeAllViews()
      ShortsHotStore.CATEGORIES.forEachIndexed { index, category ->
        val selected = category == currentCategory
        val tab = TextView(this).apply {
          text = category.replaceFirstChar { it.uppercase() }
          textSize = 12f
          setTextColor(if (selected) Color.WHITE else Color.parseColor("#99FFFFFF"))
          setTypeface(typeface, if (selected) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
          background = GradientDrawable().apply {
            cornerRadius = 999f
            setColor(if (selected) Color.parseColor("#59FFFFFF") else Color.parseColor("#1FFFFFFF"))
          }
          setPadding((12 * d).toInt(), (6 * d).toInt(), (12 * d).toInt(), (6 * d).toInt())
          isClickable = true
        }
        categoryTabs.addView(tab, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
          if (index > 0) marginStart = (6 * d).toInt()
        })
      }
    }

    fun renderItems(category: String, items: List<ShortsHotStore.HotVideo>) {
          listContainer.removeAllViews()
          if (items.isEmpty()) {
            listContainer.addView(TextView(this@PaceOverlayService).apply {
              text = "No trending videos in this category yet"
              textSize = 12f
              setTextColor(Color.parseColor("#80FFFFFF"))
              gravity = Gravity.CENTER
              setPadding(0, (18 * d).toInt(), 0, (18 * d).toInt())
            })
          }
          items.forEachIndexed { index, item ->
            val itemRow = LinearLayout(this@PaceOverlayService).apply {
              orientation = LinearLayout.HORIZONTAL
              gravity = Gravity.CENTER_VERTICAL
              setPadding(0, (8 * d).toInt(), 0, (8 * d).toInt())
              isClickable = true
              setOnClickListener {
                try {
                  val url = "https://www.youtube.com/shorts/${item.videoId}"
                  startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                  ShortsHotStore.markWatched(applicationContext, category, item.videoId)
                } catch (e: Exception) {
                  Log.w("PaceOverlayService", "Shorts HOT 재생 실패", e)
                }
              }
            }
            val thumb = ImageView(this@PaceOverlayService).apply {
              scaleType = ImageView.ScaleType.CENTER_CROP
              background = GradientDrawable().apply {
                cornerRadius = 8f * d
                setColor(Color.parseColor("#14FFFFFF"))
              }
            }
            val thumbSize = (44 * d).toInt()
            itemRow.addView(thumb, LinearLayout.LayoutParams(thumbSize, thumbSize))
            loadThumbnailInto(thumb, item.thumbnailUrl)

            val textCol = LinearLayout(this@PaceOverlayService).apply { orientation = LinearLayout.VERTICAL }
            textCol.addView(TextView(this@PaceOverlayService).apply {
              text = item.title
              textSize = 12f
              maxLines = 2
              setTextColor(Color.WHITE)
            })
            if (!item.channel.isNullOrEmpty()) {
              textCol.addView(TextView(this@PaceOverlayService).apply {
                text = item.channel
                textSize = 10f
                setTextColor(Color.parseColor("#8CFFFFFF"))
              })
            }
            itemRow.addView(textCol, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
              marginStart = (10 * d).toInt()
            })

            listContainer.addView(itemRow)
            if (index < items.size - 1) {
              listContainer.addView(View(this@PaceOverlayService).apply { setBackgroundColor(Color.parseColor("#14FFFFFF")) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * d).toInt().coerceAtLeast(1)))
            }
          }
          val estimatedRowHeightPx = (60 * d).toInt()
          val estimatedHeight = (items.size.coerceAtLeast(1) * estimatedRowHeightPx)
          val maxHeight = (resources.displayMetrics.heightPixels * 0.4f).toInt()
          scroll.layoutParams = (scroll.layoutParams ?: LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0)).apply {
            height = estimatedHeight.coerceAtMost(maxHeight)
          }
    }

    // 2026-08-01 사장님 지시("미리 로딩해놓으면... 누르면 개느리게 뜨잖아") — 세션 시작 시
    // prefetchAll()이 채워둔 캐시가 있으면 "Loading…" 없이 바로 그린다. 캐시가 아직 없을 때만
    // (프리페치가 안 끝났거나 로그인 타이밍 등) 기존처럼 로딩 표시 후 네트워크로 받는다.
    fun loadCategory(category: String) {
      currentCategory = category
      renderTabs()
      val cached = ShortsHotStore.getCached(category)
      if (cached != null) {
        renderItems(category, cached)
        return
      }
      listContainer.removeAllViews()
      listContainer.addView(TextView(this).apply {
        text = "Loading…"
        textSize = 12f
        setTextColor(Color.parseColor("#80FFFFFF"))
        gravity = Gravity.CENTER
        setPadding(0, (18 * d).toInt(), 0, (18 * d).toInt())
      })
      Thread {
        val items = ShortsHotStore.fetch(applicationContext, category)
        foregroundPollHandler.post {
          if (currentCategory != category) return@post // 로딩 중 다른 탭으로 넘어갔으면 버림
          renderItems(category, items)
        }
      }.start()
    }

    // 탭 클릭 리스너는 renderTabs()가 매번 뷰를 새로 만드므로, 클릭 시 loadCategory를 다시 걸어준다.
    categoryTabs.setOnHierarchyChangeListener(object : android.view.ViewGroup.OnHierarchyChangeListener {
      override fun onChildViewAdded(parent: android.view.View?, child: android.view.View?) {
        val index = categoryTabs.indexOfChild(child)
        if (index in ShortsHotStore.CATEGORIES.indices) {
          child?.setOnClickListener { loadCategory(ShortsHotStore.CATEGORIES[index]) }
        }
      }
      override fun onChildViewRemoved(parent: android.view.View?, child: android.view.View?) {}
    })

    loadCategory(currentCategory)

    val root = FrameLayout(this).apply { addView(panel, FrameLayout.LayoutParams(panelWidth, FrameLayout.LayoutParams.WRAP_CONTENT)) }
    shortsHotListView = root
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = (16 * d).toInt()
      y = 80 + (44 * d).toInt()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        flags = flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
        blurBehindRadius = (28 * d).toInt()
      }
    }
    try {
      windowManager?.addView(shortsHotListView, params)
    } catch (e: Exception) {
      Log.w("PaceOverlayService", "showShortsHotList 실패", e)
      shortsHotListView = null
    }
  }

  private fun showPaceMenu() {
    val d = resources.displayMetrics.density
    // 2026-08-01 사장님 지적("왜케 까매, 글래스모피즘으로 하라고 안 했어") — Saved/Favorite/Shorts
    // HOT 패널과 톤을 맞춘다(옅은 틴트 + 실제 블러, showSavedFavoriteList 참고). 예전엔 "드롭다운은
    // 가독성 위해 덜 투명하게"로 90% 불투명 검정을 썼는데, 그 원칙 자체가 사장님 지시와 어긋났었다.
    val menu = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = 14f * d
        setColor(Color.parseColor("#591A1B22"))
        setStroke((1 * d).toInt().coerceAtLeast(1), Color.parseColor("#33FFFFFF"))
      }
      clipToOutline = true
    }

    // 2026-08-01 사장님 지시 — 아이콘을 라벨 왼쪽에("↗ Open App" 순서). 컬러 이모지(🔥/⭐)는 기기
    // 이모지 폰트에 따라 이상하게 렌더링돼(사장님 확인) 이 파일이 이미 쓰는 순색 유니코드 기호
    // (⇪/✕ 방식)로 통일. "HOT"은 마땅한 단색 기호가 없어 작은 배지(pill)로 대신한다. 각 행은
    // 강제로 넓히지 않고 자기 내용물 크기 그대로(WRAP_CONTENT) — 불필요하게 커지지 않는다
    // (사장님 지적: "왜 창은 크게 키워놓은건데").
    data class MenuItem(val label: String, val action: () -> Unit, val icon: String? = null, val badge: String? = null)
    val items = listOf(
      MenuItem("Open App", { openApp(); hidePaceMenu() }, icon = "↗"),
      // "Shorts"만 — 뒤 HOT 배지가 이미 트렌드를 표시하므로 라벨에 또 "HOT"을 넣으면 중복이라
      // 가장 넓은 행이 됨(사장님 지적: "가로 길이 줄이라고").
      MenuItem("Shorts", { hidePaceMenu(); showShortsHotList("all") }, badge = "HOT"),
      // 2026-08-01 사장님 지시 — Saved/Favorite은 사실상 같은 기능이라 Favorite 하나로 통합.
      // 기존에 "capture" kind로 저장된 항목도 SavedVideosStore.list()가 같이 읽어오도록 처리해뒀다.
      MenuItem("Favorite", { hidePaceMenu(); showSavedFavoriteList("favorite") }, icon = "★"),
    )
    // 2026-08-01 사장님 지적("아이콘 정렬해야 할거 아냐") — 아이콘(↗/★)과 배지(HOT)는 폭이
    // 서로 달라서 그냥 붙이면 라벨("Open App"/"Shorts"/"Favorite") 시작 위치가 행마다 어긋나
    // 보였다. 모든 행에 동일한 고정폭 슬롯을 두고 그 안에서 아이콘/배지를 가운데 정렬해 라벨이
    // 항상 같은 x 위치에서 시작하도록 한다(iOS 컨텍스트 메뉴 아이콘 컬럼과 동일한 방식).
    // 2026-08-01 (재발) 사용자 지적 — 22dp 슬롯은 ↗/★ 아이콘 글자엔 충분했지만 "HOT" 배지(9sp bold
    // + 좌우 패딩 6dp*2)는 그보다 넓어서, FrameLayout이 EXACTLY 22dp로 자식(배지)을 AT_MOST 22dp로
    // 캡핑해버려 배지 pill이 원래 비율보다 좁게 눌려("세로로 찌그러진" 것처럼) 보였다. 상하 패딩만
    // 늘렸던 이전 수정(1dp→3dp)은 이 가로 클램프 자체를 안 건드려서 재발했다 — 슬롯 폭을 배지가
    // 안 눌리고 온전히 들어갈 만큼 32dp로 넓힌다(아이콘 글자는 훨씬 작아 그대로 가운데 정렬됨).
    val iconSlotWidth = (32 * d).toInt()
    items.forEachIndexed { index, item ->
      // 2026-08-01 사장님 지적("박스도 너무 줄였잖아") — 이전에 너무 촘촘히 줄인 패딩/글자
      // 크기를 살짝 되돌림(가로 12→14dp, 세로 7→9dp, 라벨 12f→13f). WRAP_CONTENT 자체는
      // 유지 — 짧은 행 뒤에 빈 공간이 생기는 문제와는 별개다.
      val row = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        isClickable = true
        // 2026-08-01 사용자 지시("가로 넓이 키우라고") — 이전에 줄였던 좌우 패딩을 14→18dp로 늘려
        // 박스 전체 너비를 살짝 키운다(WRAP_CONTENT 구조는 유지 — MATCH_PARENT로 되돌리면 짧은 행
        // 뒤에 빈 공간이 생기던 예전 버그가 재발함).
        setPadding((18 * d).toInt(), (9 * d).toInt(), (18 * d).toInt(), (9 * d).toInt())
        setOnClickListener { item.action() }
      }
      val iconSlot = FrameLayout(this).apply {
        layoutParams = LinearLayout.LayoutParams(iconSlotWidth, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
          marginEnd = (8 * d).toInt()
        }
      }
      if (item.icon != null) {
        iconSlot.addView(TextView(this).apply {
          text = item.icon
          textSize = 14f
          setTextColor(Color.parseColor("#CCFFFFFF"))
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
      } else if (item.badge != null) {
        iconSlot.addView(TextView(this).apply {
          text = item.badge
          textSize = 9f
          setTextColor(Color.WHITE)
          setTypeface(typeface, android.graphics.Typeface.BOLD)
          background = GradientDrawable().apply {
            cornerRadius = 999f
            setColor(Color.parseColor("#E5484D"))
          }
          // 2026-08-01 사용자 지적("HOT 아이콘이 세로로 줄어들어 보이잖아") — 상하 패딩이 1dp뿐이라
          // 옆 라벨 텍스트(13sp)에 비해 배지가 납작하게 눌려 보였다. 3dp로 늘려 배지다운 비율로.
          setPadding((6 * d).toInt(), (3 * d).toInt(), (6 * d).toInt(), (3 * d).toInt())
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
      }
      row.addView(iconSlot)
      row.addView(TextView(this).apply {
        text = item.label
        textSize = 13f
        setTextColor(Color.WHITE)
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      })
      // 2026-08-01 사장님 지적("Open App 뒤에 공간 왜 두는데") — 행을 MATCH_PARENT로 두면 짧은
      // 행("Open App")도 가장 넓은 행("Shorts"+HOT배지)에 맞춰 강제로 늘어나 라벨 뒤에 빈 공간이
      // 생겼다. 각 행을 WRAP_CONTENT로 바꿔 자기 내용물 크기만큼만 차지하게 한다 — 구분선만
      // MATCH_PARENT로 남겨 메뉴 전체 너비(가장 넓은 행 기준)에 맞게 그어진다.
      menu.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
      if (index < items.size - 1) {
        val divider = View(this).apply { setBackgroundColor(Color.parseColor("#1FFFFFFF")) }
        menu.addView(divider, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * d).toInt().coerceAtLeast(1)))
      }
    }

    paceMenuView = menu
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = (16 * d).toInt()
      y = 80 + (44 * d).toInt() // 알약(y=80) 바로 아래 — appBtn 높이(36dp)+여백만큼 내림
      // Saved/Favorite/Shorts HOT 패널과 동일한 실제 블러(API 31+, 구버전은 위 틴트 배경만으로 폴백).
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        flags = flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
        blurBehindRadius = (28 * d).toInt()
      }
    }
    try {
      windowManager?.addView(paceMenuView, params)
    } catch (e: Exception) {
      Log.w("PaceOverlayService", "showPaceMenu 실패", e)
      paceMenuView = null
    }
  }

  // 2026-07-19 사용자 제품 결정 반영 — 한도 도달 시 실제로 YouTube를 "막는" 전체화면 차단. 작은
  // 알약(showOverlay)과 달리 FLAG_NOT_TOUCH_MODAL을 안 쓴다 — 화면 전체를 덮으므로 그 아래 앱으로
  // 터치가 통과할 "바깥"이 없고, 오히려 통과시키면 안 된다(차단의 핵심). 버튼 2개만 인터랙션 가능:
  // "+5분"(세션 재개) / "휴식하기"(Pace로 이동 + 세션 완전 종료) — GLOBAL_ACTION_HOME은 여기서
  // 호출하지 않는다(그건 Hard Block Mode 옵트인 전용, performTick의 만료 분기에서 별도 처리).
  private fun showBlockOverlay(reason: String, dailyLimitTier: Int = 0) {
    if (blockOverlayView != null) return
    windowManager = windowManager ?: getSystemService(Context.WINDOW_SERVICE) as WindowManager
    removeOverlay() // 작은 알약은 전체화면 차단으로 대체되므로 치운다

    // 수면감지(스펙 §1-B "화면 암전 + 밝기 0% → OS 슬립 진입")는 다른 두 사유와 완전히 다른 화면을
    // 쓴다 — "+5분"/"휴식하기" 버튼이 있는 밝은 다이얼로그는 자고 있는 사람 앞에서 화면을 계속
    // 밝혀두는 것이라 목적에 정반대다. 순수 암전(텍스트/버튼 없음)만 그리고, GLOBAL_ACTION_LOCK_SCREEN
    // (아래 lockScreen() 참고)으로 실제 화면 잠금까지 즉시 시도한다 — 이 뷰는 그 사이 잠깐의 간극과
    // 잠금이 실패하는 기기(API<28/접근성 꺼짐)를 위한 폴백.
    if (reason == "sleep_detected") {
      // ⚠️ 에뮬레이터 실측 중 발견(2026-07-23) — 화면 잠금 후 사용자가 스스로 깨서 다시 폰을 쓰려 할 때
      // 이 화면을 벗어날 방법이 전혀 없었다(버튼 없음 + 터치 통과 금지라 그 밑에 뭐가 있든 영원히
      // 안 보임 — 강제종료 외엔 탈출 불가능한 진짜 UX 버그). "화면 암전" 의도는 유지하되(버튼 텍스트
      // 노출 안 함), 아무 곳이나 한 번 탭하면 조용히 닫히게(=endFromBlockOverlay, 다른 사유의
      // "휴식하기"와 동일 동작) 해서 최소한의 탈출구를 보장한다.
      // 2026-07-26 실기기 재확인 — FLAG_LAYOUT_IN_SCREEN/NO_LIMITS만으론 창 자체는 화면 전체로
      // 확장되지만, 상태바/내비바는 SystemUI가 이 창과 별개의 레이어로 그 위에 항상 그리는 시스템
      // 소유 요소라 그 배경색(제스처 내비 인디케이터의 반투명 회색 등)은 우리 View의 검은색과
      // 무관하게 그대로 남는다 — "색을 맞추는" 접근으로는 못 고치고, 애초에 암전 화면에서 상태바
      // 아이콘/제스처 바 자체가 보이면 안 되므로 완전히 숨기는(immersive) 쪽이 올바른 수정이다.
      val blackout = View(this).apply {
        setBackgroundColor(Color.BLACK)
        isClickable = true
        setOnClickListener { endFromBlockOverlay() }
        systemUiVisibility = SLEEP_BLACKOUT_IMMERSIVE_FLAGS
        setOnSystemUiVisibilityChangeListener {
          // 가장자리 스와이프 등으로 시스템 바가 일시적으로 다시 드러나면 즉시 재적용 — 그렇지 않으면
          // 한 번 노출된 뒤로 계속 보여서 암전 의도가 깨진다.
          systemUiVisibility = SLEEP_BLACKOUT_IMMERSIVE_FLAGS
        }
      }
      blockOverlayView = blackout
      val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
        // 창 자체를 화면 전체(시스템 바 포함)로 확장해 검은 View가 화면 전체를 덮게 한다. 터치 통과
        // 금지(모달)는 그대로 유지.
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        android.graphics.PixelFormat.OPAQUE // TRANSLUCENT가 아니라 완전 불투명 — 진짜 암전이어야 함
      ).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        }
      }
      windowManager?.addView(blockOverlayView, params)
      PaceAccessibilityService.lockScreen()
      return
    }

    val isSleepTimer = reason == "sleep_timer_expired"
    val isDailyLimit = reason == "daily_limit_reached"
    // 한도 도달 1차/2차 문구 분기(스펙 §1-E-5 "한도 도달 UI 3단계화" 원문 그대로, 사용자가 재확인한
    // 정확한 카피) — 3차부터는 여기 안 오고 showTier3Toast()의 비차단 경로로 빠진다(performTick 참고).
    val isDailyLimitTier2 = isDailyLimit && dailyLimitTier >= 2
    val iconText = when {
      isSleepTimer -> "⏸"
      isDailyLimitTier2 -> "☕"
      isDailyLimit -> "🛡"
      else -> "⏸"
    }
    // 2026-07-27 감사 발견(크리티컬) — 이 화면(전체화면 차단, 한도 도달의 핵심 UI)이 한국어로만
    // 하드코딩돼 영어 기기에도 그대로 노출되고 있었다. tier1/tier2 문구는 JS LimitReachedOverlay.tsx
    // (translations.ts의 limitReached.*)의 기존 영문 카피와 그대로 맞춰 두 사본이 어긋나지 않게 한다.
    val ko = isKoreanLocale()
    val titleText = when {
      isSleepTimer -> if (ko) "Sleep Timer 종료" else "Sleep Timer ended"
      isDailyLimitTier2 -> if (ko) "잠시 쉬어갈까요?" else "Time for a break?"
      isDailyLimit -> "TAKE YOUR PACE"
      else -> if (ko) "오늘의 한도에 도달했어요" else "You've reached today's limit"
    }
    // tier1만 3줄(제목/부제/본문), 나머지는 2줄(제목/본문) — JS LimitReachedOverlay.tsx의 Modal 구조와 동일.
    val subtitleText = if (isDailyLimit && !isDailyLimitTier2) {
      if (ko) "${dailyLimitOriginalMinutes}분 시청 완료" else "$dailyLimitOriginalMinutes minutes watched"
    } else null
    val bodyText = when {
      isSleepTimer -> if (ko) "설정한 Sleep Timer 시간이 다 됐어요." else "Your Sleep Timer has ended."
      isDailyLimitTier2 -> {
        val elapsed = (dailyLimitTier - 1) * EXTEND_MINUTES
        if (ko) "벌써 ${elapsed}분이 지났습니다" else "$elapsed minutes have already passed"
      }
      isDailyLimit -> if (ko) "계속 시청할 수도, 여기서 멈출 수도 있습니다." else "You can keep watching, or stop here."
      else -> if (ko) "오늘 정해둔 시청 시간을 다 썼어요." else "You've used up today's watch time."
    }
    val extendBtnText = when {
      isDailyLimitTier2 -> if (ko) "계속 보기" else "Keep watching"
      else -> if (ko) "+${EXTEND_MINUTES}분" else "+$EXTEND_MINUTES minutes"
    }
    val endBtnText = when {
      isDailyLimitTier2 -> if (ko) "여기까지 보기" else "Stop here"
      else -> if (ko) "휴식하기" else "Take a break"
    }
    val d = resources.displayMetrics.density

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#F20B0C0F")) // rgba(11,12,15,0.95) — theme.ts colors.background 근사
      setPadding((32 * d).toInt(), 0, (32 * d).toInt(), 0)
    }

    root.addView(TextView(this).apply {
      text = iconText
      textSize = 40f
      gravity = Gravity.CENTER
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = (24 * d).toInt() })

    root.addView(TextView(this).apply {
      text = titleText
      setTextColor(Color.WHITE)
      textSize = 20f
      gravity = Gravity.CENTER
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = (10 * d).toInt() })

    if (subtitleText != null) {
      root.addView(TextView(this).apply {
        text = subtitleText
        setTextColor(Color.parseColor("#D1D5DB"))
        textSize = 13f
        gravity = Gravity.CENTER
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = (8 * d).toInt() })
    }

    root.addView(TextView(this).apply {
      text = bodyText
      setTextColor(Color.parseColor("#9CA3AF"))
      textSize = 13f
      gravity = Gravity.CENTER
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = (36 * d).toInt() })

    // ⚠️ 실기기 검증 중 발견(사용자 지적 — 버튼 줄이 가운데가 아니라 한쪽으로 치우쳐 보임): root가
    // VERTICAL LinearLayout일 때 자식을 addView(view)로(LayoutParams 생략) 넣으면
    // generateDefaultLayoutParams()가 WRAP_CONTENT가 아니라 MATCH_PARENT 너비를 준다 — buttonRow가
    // 전체 폭을 차지하는데 자기 gravity는 기본값(START)이라 버튼 두 개가 한쪽 끝에 몰려버렸다.
    // buttonRow 자체에 CENTER gravity를 명시해서 고친다.
    val buttonRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }

    buttonRow.addView(TextView(this).apply {
      text = extendBtnText
      setTextColor(Color.WHITE)
      textSize = 13f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setPadding((22 * d).toInt(), (13 * d).toInt(), (22 * d).toInt(), (13 * d).toInt())
      background = GradientDrawable().apply { cornerRadius = 100f; setColor(Color.parseColor("#5856D6")) }
      isClickable = true
      setOnClickListener { extendFromBlockOverlay() }
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = (10 * d).toInt() })

    buttonRow.addView(TextView(this).apply {
      text = endBtnText
      setTextColor(Color.parseColor("#D1D5DB"))
      textSize = 13f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setPadding((22 * d).toInt(), (13 * d).toInt(), (22 * d).toInt(), (13 * d).toInt())
      background = GradientDrawable().apply { cornerRadius = 100f; setColor(Color.parseColor("#1AFFFFFF")) }
      isClickable = true
      setOnClickListener { endFromBlockOverlay() }
    })

    root.addView(buttonRow)
    blockOverlayView = root

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      0, // flags=0: 풀스크린 전체가 터치를 그대로 흡수(모달) — 알약과 반대로 "통과 금지"가 목적
      android.graphics.PixelFormat.TRANSLUCENT
    )
    windowManager?.addView(blockOverlayView, params)
  }

  private fun removeBlockOverlay() {
    blockOverlayView?.let { windowManager?.removeView(it) }
    blockOverlayView = null
  }

  // 한도 도달 3차 이상(스펙 §1-E-5) — 다른 사유들의 showBlockOverlay와 완전히 다른 성격: 이건
  // "차단"이 아니라 "안내"라 세션을 멈추지 않는다(performTick에서 이 함수를 부르기 전에 이미
  // EXTEND_MINUTES를 조용히 더하고 다음 틱을 정상 예약해둔 상태). 그래서 이 뷰는 터치를 흡수하지
  // 않는다(FLAG_NOT_TOUCHABLE) — 그 아래 YouTube가 이 토스트가 떠 있는 동안에도 그대로 조작 가능해야
  // "차단 아님"이 실제로 성립한다. JS Tier3Toast(LimitReachedOverlay.tsx)와 동일한 4종 문구를
  // hitCount로 순환하고, 동일한 WCAG 2.2.1(Timing Adjustable) 대응도 미러링한다 — 스크린리더가
  // 켜져 있으면 자동 소멸 대신 탭으로 닫게 바꾸고 즉시 음성 안내.
  private var tier3ToastView: View? = null
  private val tier3ToastHandler = Handler(Looper.getMainLooper())
  private var tier3DismissRunnable: Runnable? = null

  private fun showTier3Toast(usageMinutes: Int, goalMinutes: Int, hitCount: Int) {
    // 2026-07-27 감사 발견(크리티컬) — 4개 문구 중 2개(title2/title4)가 한국어로만 하드코딩돼 영어
    // 기기에도 그대로 노출되고 있었다(나머지 2개만 영어라 뒤섞인 상태). JS translations.ts의
    // limitReached.tier3Title/Body1~4와 맞춰 전부 로케일에 맞게 뜨도록 정정.
    val messages = if (isKoreanLocale()) {
      listOf(
        "천천히 가세요." to "지금까지 ${usageMinutes}분 시청했습니다.",
        "잠시 쉬어갈까요?" to "오늘 ${usageMinutes}분 시청했습니다.",
        "시간을 알차게 보내셨네요." to "오늘 목표 시간을 초과했습니다.",
        "오늘 다른 할일이 있었나요?" to "목표 ${goalMinutes}분을 넘겼어요."
      )
    } else {
      listOf(
        "Take your pace." to "You've watched $usageMinutes minutes so far.",
        "Time for a short break?" to "You've watched $usageMinutes minutes today.",
        "Time well spent." to "You've gone over today's goal.",
        "Got other things to do today?" to "You've gone over your $goalMinutes-minute goal."
      )
    }
    val (msgTitle, msgBody) = messages[(hitCount - 3) % messages.size]

    removeTier3Toast() // 이전 토스트가 아직 안 사라졌으면(연속 도달 등) 먼저 치우고 새로 띄움
    windowManager = windowManager ?: getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as? android.view.accessibility.AccessibilityManager
    val screenReaderOn = am?.isEnabled == true && am.isTouchExplorationEnabled
    val d = resources.displayMetrics.density

    val pill = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply { cornerRadius = 20f * d; setColor(Color.parseColor("#F20B0C0F")) }
      setPadding((20 * d).toInt(), (14 * d).toInt(), (20 * d).toInt(), (14 * d).toInt())
    }
    pill.addView(TextView(this).apply {
      text = msgTitle
      setTextColor(Color.WHITE)
      textSize = 14f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    })
    pill.addView(TextView(this).apply {
      text = msgBody
      setTextColor(Color.parseColor("#9CA3AF"))
      textSize = 12f
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = (4 * d).toInt() })

    if (screenReaderOn) {
      pill.isClickable = true
      pill.setOnClickListener { removeTier3Toast() }
    }

    tier3ToastView = pill
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      if (screenReaderOn) WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
      else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = (180 * d).toInt()
    }
    windowManager?.addView(tier3ToastView, params)

    if (am?.isEnabled == true) {
      @Suppress("DEPRECATION")
      val event = android.view.accessibility.AccessibilityEvent.obtain(android.view.accessibility.AccessibilityEvent.TYPE_ANNOUNCEMENT)
      event.text.add("$msgTitle $msgBody")
      am.sendAccessibilityEvent(event)
    }

    if (!screenReaderOn) {
      val dismiss = Runnable { removeTier3Toast() }
      tier3DismissRunnable = dismiss
      tier3ToastHandler.postDelayed(dismiss, 2200)
    }
  }

  private fun removeTier3Toast() {
    tier3DismissRunnable?.let { tier3ToastHandler.removeCallbacks(it) }
    tier3DismissRunnable = null
    tier3ToastView?.let { windowManager?.removeView(it) }
    tier3ToastView = null
  }

  private fun extendFromBlockOverlay() {
    removeBlockOverlay()
    remainingMinutes += EXTEND_MINUTES
    // Sleep Timer 만료로 여기 온 거면 그냥 꺼버린다 — 안 그러면 재개하자마자 다음 틱에서 다시 0이라
    // 즉시 재만료(무한 루프)된다. Daily Limit로 온 경우는 sleepTimerRemainingMinutes가 이미 -1이거나
    // 양수라 이 분기가 영향을 안 준다.
    if (sleepTimerRemainingMinutes == 0) sleepTimerRemainingMinutes = -1
    // 수면감지로 왔더라도(이론상 이 버튼 자체가 그 화면엔 없지만 방어적으로) 무진동 시계를 재시작 —
    // 안 그러면 재개 직후 다음 틱에서 곧바로 다시 만료된다(위 Sleep Timer와 같은 부류의 무한루프).
    lastMotionAtMs = SystemClock.elapsedRealtime()
    persistState() // PREF_SESSION_ACTIVE를 다시 true로 되돌림(만료 시 clearSessionActive됐던 것)
    showOverlay(remainingMinutes) // 작은 알약 복귀
    startForegroundAppPolling()
    setupMediaSession()
    registerStillnessSensor()
    scheduleNextTick(this)
  }

  private fun endFromBlockOverlay() {
    removeBlockOverlay()
    openPaceApp()
    cancelScheduledTick(this)
    infraReady = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun openPaceApp() {
    try {
      val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      launchIntent?.let { startActivity(it) }
    } catch (e: Exception) {
      Log.w("PaceOverlay", "openPaceApp failed", e)
    }
  }

  // 2026-07-25 iOS feed의 bottom autoModeBadge(초록=ON/반투명흰색=OFF)와 톤을 맞췄다 — 배지 자체가
  // zapBadge 가시성의 소스오브트루스이므로 여기서 같이 갱신(호출부 2곳, showOverlay/setAutoMode 모두
  // 이 함수 하나만 부르면 됨).
  private fun applyAutoBadgeStyle() {
    autoBadge?.apply {
      // 2026-07-26 사장님 지시("session on은 focus on으로") — iOS(feed/index.tsx의
      // feed.focusSessionOnBadge/focusSessionStartBadge)와 라벨을 맞춤(둘 다 대칭적인 ON/OFF 쌍으로
      // 통일 — iOS는 예전에 "SESSION ON"/"START SESSION"으로 비대칭이었던 것도 같이 정리).
      // 2026-08-02 사장님 지시("5분 더를 했을 때 오늘 한도는 40분 남았고 FOCUS 5분을 다 썼을 때
      // 오버레이 표시를 어떻게 하면 좋을까") — 알약의 "Xm left"는 하루 한도 잔여인데, 광고로 방금
      // 받은 Focus 5분을 기대한 사용자에겐 같은 숫자가 다른 뜻으로 읽혔다(실제로 "광고 보고 왔는데
      // 왜 43분이야?" 혼란 발생). 두 숫자를 분리한다: 왼쪽 "Xm left"는 오늘 남은 시청 시간으로
      // 의미를 고정하고, 이 배지가 Focus Session 잔여를 카운트다운한다("FOCUS 5m" → 4m → …).
      // 0이 되면 자동으로 "FOCUS OFF"가 되어 상태 전환도 한눈에 보인다. 공간을 새로 안 쓰고
      // 기존 "FOCUS ON" 글자 자리를 그대로 활용.
      text = if (autoNextEnabled) {
        val remain = focusSessionRemainingMinutes(applicationContext)
        if (remain != null && remain > 0) "FOCUS ${remain}m" else "FOCUS ON"
      } else "FOCUS OFF"
      val d = resources.displayMetrics.density
      setPadding((10 * d).toInt(), (7 * d).toInt(), (10 * d).toInt(), (7 * d).toInt())
      setTextColor(if (autoNextEnabled) Color.parseColor("#0B0C0F") else Color.parseColor("#9CA3AF"))
      background = GradientDrawable().apply {
        cornerRadius = 999f
        setColor(if (autoNextEnabled) Color.parseColor("#30D158") else Color.parseColor("#1FFFFFFF"))
      }
    }
    zapBadge?.visibility = if (autoNextEnabled) View.VISIBLE else View.GONE
  }

  private fun setRemainingText(remainingMinutes: Int) {
    Log.d("PaceOverlay", "setRemainingText($remainingMinutes) remainingLabel=${if (remainingLabel != null) "exists" else "NULL"}")
    remainingLabel?.text = "${remainingMinutes}m left"
  }

  private fun removeOverlay() {
    overlayView?.let { windowManager?.removeView(it) }
    overlayView = null
    remainingLabel = null
    autoBadge = null
    zapBadge = null
    hidePaceMenu() // 세션 종료 시 P 메뉴가 열려있던 채로 알약만 사라지면 메뉴 창이 고아로 남는다.
    hideSavedFavoriteList() // 위와 동일한 이유로 Saved/Favorite 리스트 창도 같이 정리.
    hideShortsHotList() // 위와 동일한 이유로 Shorts HOT 리스트 창도 같이 정리.
  }

  // 사용량 접근 권한이 없으면 폴링을 건너뛰고 항상 표시(기존 동작으로 폴백) — JS 쪽
  // (overlayService.android.ts)이 세션 시작 전에 권한을 이미 확인/요청하지만, 네이티브 쪽도
  // 방어적으로 한 번 더 확인한다.
  private fun startForegroundAppPolling() {
    if (isPolling) return
    if (!ForegroundAppWatcher.hasUsageAccessPermission(applicationContext)) {
      overlayView?.visibility = View.VISIBLE
      return
    }
    isPolling = true
    overlayView?.visibility = View.GONE // 첫 폴링 결과가 나올 때까지는 숨김(안전한 기본값)
    foregroundPollHandler.post(foregroundPollRunnable)
  }

  private fun stopForegroundAppPolling() {
    if (!isPolling) return
    isPolling = false
    foregroundPollHandler.removeCallbacks(foregroundPollRunnable)
  }

  override fun onDestroy() {
    stopForegroundAppPolling()
    removeOverlay()
    removeBlockOverlay()
    removeTier3Toast()
    teardownMediaSession()
    unregisterStillnessSensor()
    // 세션 자체가 끝나면(한도 도달/사용자 종료 등) Focus Session이 켜져 있었더라도 워처가 orphan
    // 상태로 계속 도는 일이 없게 같이 정리 — 10분 타이머가 아직 안 끝났어도 취소.
    focusSessionHandler.removeCallbacks(focusSessionAutoStop)
    PaceAccessibilityService.stopWatching()
    PaceSnapDetector.stop()
    PaceHandWaveDetector.stop()
    infraReady = false
    if (instance === this) instance = null
    super.onDestroy()
  }
}

// 2026-07-31 사장님 지시(Saved/Favorite 오버레이 재구현) — 리스트가 유튜브를 벗어나지 않는 네이티브
// 오버레이 창(PaceOverlayService.showSavedFavoriteList)에서 직접 떠야 하므로, RN/JS 브릿지가
// 살아있단 보장 없이도 동작해야 한다. src/database/schema.ts의 saved_videos 테이블을 그대로
// 공유(expo-sqlite가 만든 파일을 경로로 직접 열기 — expo-sqlite/android/.../SQLiteModule.kt가
// "<filesDir>/SQLite/<db>"에 만드는 걸 확인). 컬럼/스키마가 바뀌면 이 object도 같이 갱신해야 한다.
private object SavedVideosStore {
  data class SavedVideoRow(
    val id: String,
    val videoId: String?,
    val title: String?,
    val channel: String?,
    val url: String?,
    val thumbnailUrl: String?
  )

  private fun dbFile(context: Context): File = File(context.filesDir, "SQLite/pace.db")

  private fun openDb(context: Context): SQLiteDatabase? {
    val file = dbFile(context)
    if (!file.exists()) return null
    return try {
      SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
    } catch (e: Exception) {
      Log.e("PaceOverlay", "SavedVideosStore.openDb failed", e)
      null
    }
  }

  fun getUserId(context: Context): String? =
    context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      .getString(PaceOverlayService.PREF_CACHED_USER_ID, null)

  fun youtubeThumbnailUrl(videoId: String): String = "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"

  fun list(context: Context, kind: String): List<SavedVideoRow> {
    val userId = getUserId(context) ?: return emptyList()
    val db = openDb(context) ?: return emptyList()
    val out = mutableListOf<SavedVideoRow>()
    // 2026-08-01 Saved/Favorite 통합 — 메뉴에서 "Saved"는 없어졌지만, 예전에 kind="capture"로
    // 저장된 항목이 새 "Favorite" 목록에서 사라지지 않도록 같이 읽어온다.
    val kinds = if (kind == "favorite") arrayOf("favorite", "capture") else arrayOf(kind)
    val placeholders = kinds.joinToString(",") { "?" }
    try {
      db.rawQuery(
        "SELECT id, video_id, title, channel, url, thumbnail_url FROM saved_videos WHERE user_id=? AND kind IN ($placeholders) ORDER BY added_at DESC",
        arrayOf(userId, *kinds)
      ).use { c ->
        while (c.moveToNext()) {
          out.add(
            SavedVideoRow(
              id = c.getString(0),
              videoId = c.getString(1),
              title = c.getString(2),
              channel = c.getString(3),
              url = c.getString(4),
              thumbnailUrl = c.getString(5)
            )
          )
        }
      }
    } catch (e: Exception) {
      Log.e("PaceOverlay", "SavedVideosStore.list failed", e)
    } finally {
      db.close()
    }
    return out
  }

  // 2026-08-01 사장님 지시("Add 누르면 리스트에 추가되면서 공유도 동시에") — videoId/url이 아직 없어도
  // (공유 결과를 기다리는 중) 일단 낙관적으로 행을 만들고, 나중에 updateVideoUrl로 채워 넣을 수 있게
  // 생성된 id를 반환한다.
  fun insert(context: Context, kind: String, videoId: String?, title: String?, channel: String?, url: String?): String? {
    val userId = getUserId(context) ?: return null
    val db = openDb(context) ?: return null
    return try {
      val id = "sv-${System.currentTimeMillis()}-${(1000..9999).random()}"
      val thumbnailUrl = videoId?.let { youtubeThumbnailUrl(it) }
      val addedAt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        .format(java.util.Date())
      db.execSQL(
        "INSERT INTO saved_videos (id, user_id, kind, video_id, title, channel, url, thumbnail_url, platform_app, added_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        arrayOf(id, userId, kind, videoId, title, channel, url, thumbnailUrl, "youtube", addedAt)
      )
      id
    } catch (e: Exception) {
      Log.e("PaceOverlay", "SavedVideosStore.insert failed", e)
      null
    } finally {
      db.close()
    }
  }

  // 공유 결과(videoId/url)가 나중에 도착하면 낙관적으로 만든 행을 실제 값으로 채운다.
  fun updateVideoUrl(context: Context, id: String, videoId: String, url: String?): Boolean {
    val db = openDb(context) ?: return false
    return try {
      db.execSQL(
        "UPDATE saved_videos SET video_id=?, url=?, thumbnail_url=? WHERE id=?",
        arrayOf(videoId, url, youtubeThumbnailUrl(videoId), id)
      )
      true
    } catch (e: Exception) {
      Log.e("PaceOverlay", "SavedVideosStore.updateVideoUrl failed", e)
      false
    } finally {
      db.close()
    }
  }

  fun remove(context: Context, id: String): Boolean {
    val db = openDb(context) ?: return false
    return try {
      db.execSQL("DELETE FROM saved_videos WHERE id=?", arrayOf(id))
      true
    } catch (e: Exception) {
      Log.e("PaceOverlay", "SavedVideosStore.remove failed", e)
      false
    } finally {
      db.close()
    }
  }
}

// 2026-08-01 사장님 지시 — Shorts HOT. Saved/Favorite과 같은 이유(RN 브릿지 생존을 보장 못 하는
// 네이티브 오버레이 컨텍스트)로 백엔드 REST(backend/.../ShortsHotController)를 직접 호출한다.
// baseUrl/JWT는 PaceOverlayModule.cacheApiBaseUrl/cacheAuthToken이 미리 캐시해둔 값을 읽는다
// (client.ts가 로그인/토큰 갱신마다 채움) — 토큰이 아직 없으면(콜드스타트 타이밍) 빈 목록 반환.
private object ShortsHotStore {
  // backend ShortsHotService.CATEGORIES와 반드시 동일하게 유지 — GET /shorts-hot/categories로
  // 매번 동기화하는 대신 카테고리가 자주 안 바뀐다는 전제로 하드코딩(왕복 1회 절약).
  val CATEGORIES = listOf("all", "music", "gaming", "comedy", "entertainment", "pets")

  data class HotVideo(val videoId: String, val title: String, val channel: String?, val thumbnailUrl: String)

  // 2026-08-01 사장님 지시("미리 로딩해놓으면 되잖아, 누르면 개느리게 뜨잖아") — 세션 시작 시점에
  // 카테고리 6개를 전부 미리 받아 메모리에 캐시해둔다. 패널을 열 때 이 캐시가 있으면 "Loading…"
  // 없이 바로 그려주고(사용자 체감 즉시 로딩), 최신화를 위해 뒤에서 조용히 재요청도 같이 건다.
  private val cache = java.util.concurrent.ConcurrentHashMap<String, List<HotVideo>>()

  fun getCached(category: String): List<HotVideo>? = cache[category]

  fun prefetchAll(context: Context) {
    Thread {
      CATEGORIES.forEach { category ->
        try {
          fetch(context, category)
        } catch (e: Exception) {
          Log.w("PaceOverlay", "ShortsHotStore.prefetchAll failed: category=$category", e)
        }
      }
    }.start()
  }

  private fun baseUrl(context: Context): String? {
    val url = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      .getString(PaceOverlayService.PREF_CACHED_API_BASE_URL, null)
    return if (url.isNullOrEmpty()) null else url
  }

  private fun authToken(context: Context): String? {
    val token = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      .getString(PaceOverlayService.PREF_CACHED_AUTH_TOKEN, null)
    return if (token.isNullOrEmpty()) null else token
  }

  // 리스트는 카테고리당 전체 사용자 공통(백엔드가 매일 새벽 갱신하는 전역 캐시)이라 "본 영상"은
  // 기기 로컬(SharedPreferences)에 카테고리별로 저장 — 재방문 시 본 영상은 뒤로 밀어서
  // 매번 같은 상위 항목부터 보게 되는 것을 방지한다.
  private fun watchedKey(category: String) = "shorts_hot_watched_$category"

  fun markWatched(context: Context, category: String, videoId: String) {
    val prefs = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
    val key = watchedKey(category)
    val current = prefs.getStringSet(key, emptySet()) ?: emptySet()
    prefs.edit().putStringSet(key, current + videoId).apply()
  }

  private fun watchedIds(context: Context, category: String): Set<String> {
    return context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      .getStringSet(watchedKey(category), emptySet()) ?: emptySet()
  }

  // 동기 호출 — 호출부(showShortsHotList)가 이미 백그라운드 스레드에서 부른다.
  fun fetch(context: Context, category: String): List<HotVideo> {
    val base = baseUrl(context) ?: return emptyList()
    val token = authToken(context) ?: return emptyList()
    var conn: java.net.HttpURLConnection? = null
    return try {
      val url = java.net.URL("$base/shorts-hot?category=${java.net.URLEncoder.encode(category, "UTF-8")}")
      conn = (url.openConnection() as java.net.HttpURLConnection).apply {
        connectTimeout = 8000
        readTimeout = 8000
        requestMethod = "GET"
        setRequestProperty("Authorization", "Bearer $token")
      }
      if (conn.responseCode != 200) {
        Log.w("PaceOverlay", "ShortsHotStore.fetch failed: HTTP ${conn.responseCode}")
        return emptyList()
      }
      val body = conn.inputStream.bufferedReader().use { it.readText() }
      val arr = org.json.JSONArray(body)
      val out = mutableListOf<HotVideo>()
      for (i in 0 until arr.length()) {
        val obj = arr.getJSONObject(i)
        out.add(
          HotVideo(
            videoId = obj.getString("videoId"),
            title = obj.optString("title", "—"),
            channel = if (obj.has("channel") && !obj.isNull("channel")) obj.getString("channel") else null,
            thumbnailUrl = obj.getString("thumbnailUrl")
          )
        )
      }
      // 2026-08-01 사장님 지시 — 본 영상을 뒤로 미루기만 하던 걸(가려지긴 해도 스크롤하면 여전히
      // 보임) 아예 목록에서 제외하는 것으로 변경. 백엔드가 같은 날 KEEP_COUNT를 15→30으로 올려서
      // (ShortsHotService.java 참고) 다 본 카테고리가 쉽게 텅 비지 않을 만큼 여유를 확보해뒀다.
      val watched = watchedIds(context, category)
      val unwatched = out.filterNot { it.videoId in watched }
      cache[category] = unwatched
      unwatched
    } catch (e: Exception) {
      Log.e("PaceOverlay", "ShortsHotStore.fetch failed", e)
      emptyList()
    } finally {
      conn?.disconnect()
    }
  }
}
