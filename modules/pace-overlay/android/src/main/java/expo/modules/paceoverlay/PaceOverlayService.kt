package expo.modules.paceoverlay

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.view.Gravity
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

  companion object {
    private const val CHANNEL_ID = "pace_overlay_channel"
    private const val NOTIFICATION_ID = 4201
    private const val ACTION_START = "expo.modules.paceoverlay.START"
    private const val ACTION_UPDATE = "expo.modules.paceoverlay.UPDATE"
    private const val ACTION_STOP = "expo.modules.paceoverlay.STOP"
    private const val EXTRA_REMAINING = "remainingMinutes"
    private const val EXTRA_AUTO_NEXT = "autoNextEnabled"

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
    when (intent?.action) {
      ACTION_START -> {
        startForeground(NOTIFICATION_ID, buildNotification())
        showOverlay(intent.getIntExtra(EXTRA_REMAINING, 0))
      }
      ACTION_UPDATE -> setRemainingText(intent.getIntExtra(EXTRA_REMAINING, 0))
      ACTION_STOP -> {
        removeOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    // Foreground Service는 Auto Next가 켜져 있을 때만(=오버레이가 떠 있는 동안만) 구동 —
    // 시스템이 죽이면 안 되지만 START_NOT_STICKY로 불필요한 재시작도 막는다.
    return START_NOT_STICKY
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
    remainingLabel?.text = "Pace  ⏱ ${remainingMinutes}m Left"
  }

  private fun removeOverlay() {
    overlayView?.let { windowManager?.removeView(it) }
    overlayView = null
    remainingLabel = null
  }

  override fun onDestroy() {
    removeOverlay()
    super.onDestroy()
  }
}
