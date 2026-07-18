package expo.modules.paceoverlay

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

// Android=떠 있는 알약(pill) 오버레이(PACE_ARCHITECTURE.md "Android=floating pill / iOS=frame 차분"과
// 일치시킨 네이티브 구현). TYPE_APPLICATION_OVERLAY 레거시 방식 — Android 17+ Bubbles API 우선 전략은
// 별도 PaceBubbleService로 분리 예정(문서 "최신 플랫폼 트렌드 반영" 참고, 이 파일은 폴백 경로).
//
// ⚠️ POC 단계: 실제 RN 컴포넌트(OverlayBar.android.tsx)를 그대로 이 창에 렌더링하는 것이 이상적이지만,
// 별도 윈도우에 React 트리를 브릿지하는 건 훨씬 복잡한 작업(두 번째 ReactRootView 인스턴스 필요)이라
// 1단계 POC는 순수 네이티브 View(TextView)로 최소 정보만 표시한다. 색상 값은 constants/theme.ts의
// colors.primary(#5856D6)를 하드코딩(Kotlin이 JS 상수를 읽을 수 없음 — 값이 바뀌면 양쪽 다 갱신 필요).
class PaceOverlayService : Service() {
  private var windowManager: WindowManager? = null
  private var overlayView: LinearLayout? = null
  private var remainingLabel: TextView? = null

  // 포그라운드 앱 감지 폴링 — SupportedApps.PACKAGES(YouTube/Instagram)에 있을 때만 오버레이를
  // 보이게 하고, 그 외(카카오톡/런처/Pace 자신 등)에서는 숨긴다(ForegroundAppWatcher.kt 참고,
  // UsageStatsManager 기반). 뷰를 매번 add/removeView하지 않고 visibility만 토글해 WindowManager
  // churn을 피한다.
  private val foregroundPollHandler = Handler(Looper.getMainLooper())
  private var isPolling = false
  private val foregroundPollRunnable = object : Runnable {
    override fun run() {
      val foregroundPackage = ForegroundAppWatcher.getForegroundPackage(applicationContext)
      val shouldShow = foregroundPackage != null && SupportedApps.PACKAGES.contains(foregroundPackage)
      overlayView?.visibility = if (shouldShow) View.VISIBLE else View.GONE
      foregroundPollHandler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  // ⚠️ 실기기 검증 중 발견한 핵심 버그(2026-07-18): 남은시간 카운트다운을 원래 JS 쪽
  // (useTimerStore.tickMinute, setInterval)이 담당했는데, 사용자가 YouTube로 나가서 앱이
  // 백그라운드로 가면 이 JS setInterval 콜백이 아예 실행을 멈춘다(Bridgeless/Fabric 아키텍처에서
  // 백그라운드 JS 타이머가 억제되는 것으로 추정 — 반면 바로 위 foregroundPollRunnable은 네이티브
  // Handler 기반이라 똑같은 조건에서도 계속 정상 작동하는 걸 실기기로 직접 대조 확인했다). 그
  // 결과 시간제어(Daily Limit) 기능 자체가 백그라운드에서 사실상 무력화되는 심각한 버그였다 —
  // 오버레이 알약 텍스트가 멈추는 건 증상일 뿐, 진짜 문제는 한도를 넘겨도 세션이 절대 안
  // 끝난다는 것. 그래서 카운트다운의 "권한"을 JS에서 이 서비스로 옮긴다 — foregroundPollRunnable과
  // 똑같은 검증된 패턴(네이티브 Handler.postDelayed)을 그대로 재사용.
  //
  // JS 쪽으로 만료를 실시간으로 밀어올리는 이벤트 브릿지(Expo Modules Events)는 시도했으나 이
  // 버전의 Kotlin DSL에서 정확한 등록 문법을 확인 못 해 리스크가 컸다. 대신 "네이티브가 자기
  // 완결적으로 차단을 집행"하는 더 단순하고 견고한 설계로 전환: 0에 도달하면 서비스 스스로 오버레이
  // 제거 + 서비스 종료까지 다 하고(=사용자 눈엔 즉시 차단이 보임), SharedPreferences에 "expired"
  // 플래그만 남긴다. JS는 그 다음 Pace로 돌아왔을 때(AppState 'active') 그 플래그를 읽어서 DB
  // 세션 기록 + 알림만 뒤늦게(eventually-consistent) 처리 — 실시간 이벤트 배관 없이도 핵심 UX(차단)는
  // 100% 네이티브가 보장한다.
  private var remainingMinutes = 0
  private val tickHandler = Handler(Looper.getMainLooper())
  private var isTicking = false
  private val tickRunnable = object : Runnable {
    override fun run() {
      remainingMinutes = (remainingMinutes - 1).coerceAtLeast(0)
      setRemainingText(remainingMinutes)
      if (remainingMinutes <= 0) {
        markExpired()
        stopForegroundAppPolling()
        stopTicking()
        removeOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return
      }
      tickHandler.postDelayed(this, TICK_INTERVAL_MS)
    }
  }

  private fun markExpired() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putBoolean(PREF_EXPIRED, true)
      .apply()
  }

  companion object {
    private const val POLL_INTERVAL_MS = 1000L
    private const val TICK_INTERVAL_MS = 60_000L
    private const val CHANNEL_ID = "pace_overlay_channel"
    private const val NOTIFICATION_ID = 4201
    private const val ACTION_START = "expo.modules.paceoverlay.START"
    private const val ACTION_UPDATE = "expo.modules.paceoverlay.UPDATE"
    private const val ACTION_STOP = "expo.modules.paceoverlay.STOP"
    private const val EXTRA_REMAINING = "remainingMinutes"
    private const val EXTRA_AUTO_NEXT = "autoNextEnabled"

    // PaceOverlayModule.consumeExpired()가 읽는 "네이티브가 시간을 다 써서 스스로 세션을
    // 차단했다" 플래그 — JS가 다음에 Pace로 돌아왔을 때 한 번만 소비(읽고 즉시 false로 리셋)한다.
    const val PREFS_NAME = "pace_overlay"
    const val PREF_EXPIRED = "expired"

    fun start(context: Context, remainingMinutes: Int, autoNextEnabled: Boolean) {
      val intent = Intent(context, PaceOverlayService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_REMAINING, remainingMinutes)
        putExtra(EXTRA_AUTO_NEXT, autoNextEnabled)
      }
      ContextCompat.startForegroundService(context, intent)
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
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.d("PaceOverlay", "onStartCommand action=${intent?.action} remaining=${intent?.getIntExtra(EXTRA_REMAINING, -1)} overlayView=${if (overlayView != null) "exists" else "null"}")
    when (intent?.action) {
      ACTION_START -> {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(PREF_EXPIRED, false).apply()
        startForeground(NOTIFICATION_ID, buildNotification())
        remainingMinutes = intent.getIntExtra(EXTRA_REMAINING, 0)
        showOverlay(remainingMinutes)
        startForegroundAppPolling()
        startTicking()
      }
      // ACTION_UPDATE: JS(Extend Time 등)가 남은시간을 외부에서 조정했을 때만 씀 — 정상 카운트다운
      // 자체는 이제 이 서비스가 스스로 하므로(tickRunnable), 여기선 값만 덮어쓰고 틱 스케줄은
      // 건드리지 않는다(다음 틱까지 남은 시간이 리셋되지 않게).
      ACTION_UPDATE -> {
        remainingMinutes = intent.getIntExtra(EXTRA_REMAINING, 0)
        setRemainingText(remainingMinutes)
      }
      ACTION_STOP -> {
        stopForegroundAppPolling()
        stopTicking()
        removeOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    // Foreground Service는 Auto Next가 켜져 있을 때만(=오버레이가 떠 있는 동안만) 구동 —
    // 시스템이 죽이면 안 되지만 START_NOT_STICKY로 불필요한 재시작도 막는다.
    return START_NOT_STICKY
  }

  private fun startTicking() {
    if (isTicking) return
    isTicking = true
    tickHandler.postDelayed(tickRunnable, TICK_INTERVAL_MS)
  }

  private fun stopTicking() {
    isTicking = false
    tickHandler.removeCallbacks(tickRunnable)
  }

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Pace Session", NotificationManager.IMPORTANCE_MIN)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    return Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Pace")
      .setContentText("세션 관리 중")
      .setSmallIcon(android.R.drawable.ic_menu_recent_history)
      .setOngoing(true)
      .build()
  }

  private fun showOverlay(remainingMinutes: Int) {
    if (overlayView != null) return
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(32, 20, 32, 20)
      background = GradientDrawable().apply {
        cornerRadius = 28f
        setColor(Color.parseColor("#BFFFFFFF")) // rgba(255,255,255,0.75) 근사
      }
    }
    remainingLabel = TextView(this).apply {
      text = "Pace  ⏱ ${remainingMinutes}m Left"
      setTextColor(Color.parseColor("#1C1C1E"))
      textSize = 13f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    bar.addView(remainingLabel)
    overlayView = bar

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = 80 // 상태바 아래 여백 — 기기별 safe-area는 후속 보정 필요
    }
    windowManager?.addView(overlayView, params)
  }

  private fun setRemainingText(remainingMinutes: Int) {
    Log.d("PaceOverlay", "setRemainingText($remainingMinutes) remainingLabel=${if (remainingLabel != null) "exists" else "NULL"}")
    remainingLabel?.text = "Pace  ⏱ ${remainingMinutes}m Left"
  }

  private fun removeOverlay() {
    overlayView?.let { windowManager?.removeView(it) }
    overlayView = null
    remainingLabel = null
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
    stopTicking()
    removeOverlay()
    super.onDestroy()
  }
}
