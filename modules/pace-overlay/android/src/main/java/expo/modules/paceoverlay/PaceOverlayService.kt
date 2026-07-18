package expo.modules.paceoverlay

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat

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
  // start()가 세션 시작 시 넘겨준 값으로 초기화되고, 이후엔 배지 탭(아래 showOverlay)이 유일한
  // 갱신 경로 — JS 쪽에서 세션 도중 Auto Next를 토글해도 이 배지엔 실시간 반영 안 됨(overlayService.
  // android.ts에 updateRemaining같은 별도 업데이트 액션이 없음). 배지 자체가 토글의 소스오브트루스가
  // 되게 설계해 이 비대칭을 우회.
  private var autoNextEnabled = false

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
  // 2026-07-19: Daily Limit과 정확히 같은 이유로 Sleep Timer/Break Reminder/저시간(5분·1분)
  // 경고/한도도달 알림도 전부 이 네이티브 tickRunnable로 옮긴다. 사용자 지적(정리하면): "타이머
  // 자체는 플랫폼 공통 개념인데 왜 iOS/Android 구분에 매달리냐, 카운트다운이 실제로 동작하고
  // 실제로 끄는 게 핵심이고 끄는 '방법'만 다른 것 아니냐" — 맞는 지적이라 Daily Limit에만 적용했던
  // 네이티브-자기완결 패턴을 이 서비스가 담당하는 나머지 시간제한 기능 전부(Android 한정, iOS는애초에
  // Screen Time이 이 문제 자체가 없음)에 동일하게 확장한다. -1 = "Sleep Timer 꺼짐"(0으로 하면
  // "막 만료됨"과 구분이 안 돼서 별도 sentinel 사용).
  private var remainingMinutes = 0
  private var sleepTimerRemainingMinutes = -1
  private var breakIntervalMinutes = 0
  private var nextBreakInMinutes = 0
  private var notifyRemaining = true
  private var notifyLimit = true
  private var notifyBreak = true
  private val tickHandler = Handler(Looper.getMainLooper())
  private var isTicking = false
  private val tickRunnable = object : Runnable {
    override fun run() {
      remainingMinutes = (remainingMinutes - 1).coerceAtLeast(0)
      if (sleepTimerRemainingMinutes > 0) {
        sleepTimerRemainingMinutes = (sleepTimerRemainingMinutes - 1).coerceAtLeast(0)
      }
      if (breakIntervalMinutes > 0) {
        nextBreakInMinutes = (nextBreakInMinutes - 1).coerceAtLeast(0)
        if (nextBreakInMinutes <= 0) {
          if (notifyBreak) {
            sendAlertNotification(NOTIFICATION_ID_BREAK_REMINDER, "휴식 시간이에요", "잠깐 스트레칭하거나 심호흡을 해보세요.")
          }
          nextBreakInMinutes = breakIntervalMinutes
        }
      }
      setRemainingText(remainingMinutes)
      Log.d("PaceOverlay", "tick remaining=$remainingMinutes sleepTimer=$sleepTimerRemainingMinutes nextBreakIn=$nextBreakInMinutes")

      if (notifyRemaining && (remainingMinutes == 5 || remainingMinutes == 1)) {
        sendAlertNotification(NOTIFICATION_ID_LOW_TIME, "남은 시간", "오늘 ${remainingMinutes}분 남았어요! 잠시 숨을 돌려볼까요.")
      }

      // sleepTimerRemainingMinutes==0은 "원래 -1(꺼짐)이었는데 우연히 0"이 아니라 반드시
      // ">0에서 감소해서 도달한 0"만 가능(위에서 >0일 때만 감소시키므로) — 별도 플래그 없이 안전하게
      // "Sleep Timer가 켜져 있었고 방금 만료됐다"로 판단 가능.
      if (remainingMinutes <= 0 || sleepTimerRemainingMinutes == 0) {
        val reason = if (remainingMinutes <= 0) "daily_limit_reached" else "sleep_timer_expired"
        markExpired(reason)
        if (notifyLimit) {
          sendAlertNotification(NOTIFICATION_ID_LIMIT_REACHED, "오늘의 한도에 도달했어요", "잠시 휴대폰을 내려놓을 시간이에요.")
        }
        stopForegroundAppPolling()
        stopTicking()
        removeOverlay()
        teardownMediaSession()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return
      }
      tickHandler.postDelayed(this, TICK_INTERVAL_MS)
    }
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

  private fun setupMediaSession() {
    if (mediaSession != null) return
    val session = MediaSession(this, "PaceSession")
    session.setCallback(object : MediaSession.Callback() {
      override fun onSkipToNext() { triggerNext(applicationContext) }
      override fun onSkipToPrevious() { triggerPrevious(applicationContext) }
      override fun onPlay() { setAutoMode(applicationContext, true) }
      override fun onPause() { setAutoMode(applicationContext, false) }
    })
    session.isActive = true
    mediaSession = session
    updateMediaSessionPlaybackState(playing = true)
    requestAudioFocusForMediaButtons()
  }

  private fun teardownMediaSession() {
    abandonAudioFocus()
    mediaSession?.release()
    mediaSession = null
  }

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
        .build()
      audioManager.requestAudioFocus(request)
      audioFocusRequest = request
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun abandonAudioFocus() {
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
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
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putBoolean(PREF_EXPIRED, true)
      .putString(PREF_EXPIRE_REASON, reason)
      .apply()
  }

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
    private const val EXTRA_SLEEP_TIMER_MINUTES = "sleepTimerMinutes"
    private const val EXTRA_BREAK_INTERVAL_MINUTES = "breakIntervalMinutes"
    private const val EXTRA_NOTIFY_REMAINING = "notifyRemaining"
    private const val EXTRA_NOTIFY_LIMIT = "notifyLimit"
    private const val EXTRA_NOTIFY_BREAK = "notifyBreak"
    private const val ALERT_CHANNEL_ID = "pace_overlay_alerts"
    private const val NOTIFICATION_ID_LOW_TIME = 4202
    private const val NOTIFICATION_ID_LIMIT_REACHED = 4203
    private const val NOTIFICATION_ID_BREAK_REMINDER = 4204

    // PaceOverlayModule.consumeExpired()가 읽는 "네이티브가 시간을 다 써서 스스로 세션을
    // 차단했다" 플래그 + 사유 — JS가 다음에 Pace로 돌아왔을 때 한 번만 소비(읽고 즉시 리셋)한다.
    const val PREFS_NAME = "pace_overlay"
    const val PREF_EXPIRED = "expired"
    const val PREF_EXPIRE_REASON = "expire_reason"
    const val PREF_AUTO_MODE = "bt_auto_mode"

    // Bluetooth Hands-Free(2026-07-19) — MediaSession 콜백(하드웨어 리모컨)과 PaceOverlayModule의
    // JS 바인딩(Focus 탭 인앱 버튼 탭) 둘 다 이 companion 함수를 호출한다 — 입력 소스만 다르고 실제
    // 동작(스와이프/토글/토스트/카운터)은 하나로 통일. instance는 활성 세션이 있을 때만 재생상태를
    // MediaSession에 반영하는 용도라, 세션 없이 호출돼도(instance==null) 스와이프/토스트/카운터
    // 자체는 정상 동작한다.
    private var instance: PaceOverlayService? = null

    fun triggerNext(context: Context) {
      PaceAccessibilityService.swipeOnce(up = true)
      bumpBluetoothCounter(context, "bt_next_count")
      showToast(context, "⏭ Next Short")
    }

    fun triggerPrevious(context: Context) {
      PaceAccessibilityService.swipeOnce(up = false)
      bumpBluetoothCounter(context, "bt_previous_count")
      showToast(context, "⏮ Previous Short")
    }

    // Play/Pause → Auto Mode 토글(기존 Auto Next 기능과 동일한 스위치, 별개 개념 아님) — 이미 검증된
    // PaceAccessibilityService.startWatching/stopWatching 그대로 재사용.
    fun setAutoMode(context: Context, enable: Boolean) {
      if (enable) PaceAccessibilityService.startWatching(8_000L) else PaceAccessibilityService.stopWatching()
      bumpBluetoothCounter(context, "bt_auto_toggle_count")
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(PREF_AUTO_MODE, enable).apply()
      instance?.updateMediaSessionPlaybackState(playing = enable)
      showToast(context, if (enable) "🎧 Auto Mode Enabled" else "🎧 Auto Mode Disabled")
    }

    private fun bumpBluetoothCounter(context: Context, key: String) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit().putInt(key, prefs.getInt(key, 0) + 1).apply()
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
      notifyBreak: Boolean
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
        val sleepTimerMinutes = intent.getIntExtra(EXTRA_SLEEP_TIMER_MINUTES, 0)
        sleepTimerRemainingMinutes = if (sleepTimerMinutes > 0) sleepTimerMinutes else -1
        breakIntervalMinutes = intent.getIntExtra(EXTRA_BREAK_INTERVAL_MINUTES, 0)
        nextBreakInMinutes = breakIntervalMinutes
        notifyRemaining = intent.getBooleanExtra(EXTRA_NOTIFY_REMAINING, true)
        notifyLimit = intent.getBooleanExtra(EXTRA_NOTIFY_LIMIT, true)
        notifyBreak = intent.getBooleanExtra(EXTRA_NOTIFY_BREAK, true)
        autoNextEnabled = intent.getBooleanExtra(EXTRA_AUTO_NEXT, false)
        showOverlay(remainingMinutes)
        startForegroundAppPolling()
        startTicking()
        setupMediaSession()
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
        teardownMediaSession()
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

  // 2026-07-19: healthy-shorts-assistant(3) ShortsPlayer.tsx의 Android 컴팩트 알약(dark glass +
  // pulsing dot + AUTO ON/OFF 배지) 시각 스타일을 순수 네이티브로 이식. 원본의 펼침형 어시스턴트
  // 패널(오늘 사용량/진행바/Sleep Timer/Daily Limit 사이클/Pause/End 버튼)까지는 이식하지 않았다 —
  // 그건 RN 트리를 이 창에 브릿지해야(두 번째 ReactRootView 인스턴스) 가능한 범위라 파일 상단
  // 주석에 이미 POC 단계 보류 항목으로 명시돼 있다. 대신: 배지 탭 = 실제 Auto Mode 토글
  // (companion setAutoMode 재사용 — Bluetooth Play/Pause 하드웨어 버튼과 동일한 진짜 동작, 가짜
  // 버튼 아님), 알약 본문 탭 = Pace 앱을 포그라운드로 열어서 이미 존재하는 Focus 탭 전체 컨트롤로
  // 안내 — 없는 패널을 흉내내지 않고 같은 목적(원격 제어 접근)을 실제 동작으로 달성한다.
  private fun showOverlay(remainingMinutes: Int) {
    if (overlayView != null) return
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(36, 22, 20, 22)
      background = GradientDrawable().apply {
        cornerRadius = 30f
        setColor(Color.parseColor("#E60C0D12")) // rgba(12,13,18,0.9) 근사 — (3) bg-[#0C0D12]/90
      }
      isClickable = true
      setOnClickListener { openPaceApp() }
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
    bar.addView(dot, LinearLayout.LayoutParams(14, 14).apply { rightMargin = 18 })

    remainingLabel = TextView(this).apply {
      text = "Pace  ⏱ ${remainingMinutes}m Left"
      setTextColor(Color.WHITE)
      textSize = 13f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    bar.addView(remainingLabel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = 16 })

    autoBadge = TextView(this).apply {
      textSize = 9f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      isClickable = true
      setOnClickListener {
        autoNextEnabled = !autoNextEnabled
        setAutoMode(applicationContext, autoNextEnabled)
        applyAutoBadgeStyle()
      }
    }
    applyAutoBadgeStyle()
    bar.addView(autoBadge)

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

  private fun applyAutoBadgeStyle() {
    autoBadge?.apply {
      text = if (autoNextEnabled) "AUTO ON" else "AUTO OFF"
      setPadding(20, 10, 20, 10)
      setTextColor(if (autoNextEnabled) Color.WHITE else Color.parseColor("#9CA3AF"))
      background = GradientDrawable().apply {
        cornerRadius = 100f
        setColor(if (autoNextEnabled) Color.parseColor("#5856D6") else Color.parseColor("#14FFFFFF"))
      }
    }
  }

  private fun openPaceApp() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    startActivity(launchIntent)
  }

  private fun setRemainingText(remainingMinutes: Int) {
    Log.d("PaceOverlay", "setRemainingText($remainingMinutes) remainingLabel=${if (remainingLabel != null) "exists" else "NULL"}")
    remainingLabel?.text = "Pace  ⏱ ${remainingMinutes}m Left"
  }

  private fun removeOverlay() {
    overlayView?.let { windowManager?.removeView(it) }
    overlayView = null
    remainingLabel = null
    autoBadge = null
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
    teardownMediaSession()
    super.onDestroy()
  }
}
