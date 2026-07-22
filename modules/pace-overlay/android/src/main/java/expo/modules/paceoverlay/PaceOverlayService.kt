package expo.modules.paceoverlay

import android.app.*
import android.content.Context
import android.content.Intent
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
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
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
  // 2026-07-19: 한도/Sleep Timer 만료 시 뜨는 전체화면 차단 화면 — 작은 알약(overlayView)과 별개
  // View. 알림 권한과 무관하게 항상 뜬다(SYSTEM_ALERT_WINDOW는 세션 시작 때 이미 확인된 별개 권한).
  private var blockOverlayView: View? = null
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
      // 2026-07-19 사용자 지적 반영: UsageStatsManager 호출에 예외처리가 전혀 없었다 — 권한이
      // 세션 도중 회수되거나(사용자가 설정에서 끔) OEM 스킨의 이상 동작으로 여기서 던지면, 메인
      // 스레드 Handler 콜백이라 앱 프로세스 전체가 죽는다. try/catch로 감싸 이번 폴은 실패해도
      // 폴링 루프 자체(다음 postDelayed)는 계속 살아있게 한다.
      try {
        // 2026-07-20 실기기 검증 중 발견(알약이 "됐다 안됐다") — UsageStatsManager는 실시간 정확도를
        // 보장 안 하는 폴링 API라 놓치는 경우가 있었다. 접근성이 켜져 있으면 이벤트 기반(즉시 반영,
        // PaceAccessibilityService.getCurrentForegroundPackage)을 우선 쓰고, 꺼져있을 때만 기존
        // UsageStatsManager로 폴백한다.
        val foregroundPackage = PaceAccessibilityService.getCurrentForegroundPackage()
          ?: ForegroundAppWatcher.getForegroundPackage(applicationContext)
        val shouldShow = foregroundPackage != null && SupportedApps.PACKAGES.contains(foregroundPackage)
        overlayView?.visibility = if (shouldShow) View.VISIBLE else View.GONE
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
  // 이 프로세스 인스턴스에서 인프라(오버레이 창/폴링/미디어세션/포그라운드 알림)를 이미 세팅했는지 —
  // ACTION_TICK이 "정상 진행 중 틱"인지 "프로세스가 죽었다 알람으로 되살아난 첫 틱"인지 구분하는 용도.
  private var infraReady = false

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
    audioFocusHandler.removeCallbacksAndMessages(null)
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

  // 오버레이 창/포그라운드 알림/포그라운드 폴링/미디어세션 세팅 — ACTION_START(정상 시작)와
  // ACTION_TICK(프로세스가 죽었다 알람으로 되살아난 경우, infraReady==false)이 공유하는 초기화
  // 경로. 이미 세팅돼 있으면(같은 프로세스에서 이미 돌고 있던 정상 틱) 아무 것도 안 한다.
  private fun ensureInfraReady() {
    if (infraReady) return
    startForeground(NOTIFICATION_ID, buildNotification())
    showOverlay(remainingMinutes)
    startForegroundAppPolling()
    setupMediaSession()
    registerStillnessSensor()
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
    private const val TICK_INTERVAL_MS = 60_000L
    private const val CHANNEL_ID = "pace_overlay_channel"
    private const val NOTIFICATION_ID = 4201
    private const val ACTION_START = "expo.modules.paceoverlay.START"
    private const val ACTION_UPDATE = "expo.modules.paceoverlay.UPDATE"
    private const val ACTION_STOP = "expo.modules.paceoverlay.STOP"
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

    // 수면 감지(스펙 §1-B/§4-B) — 리서치 근거는 Flip Mode(PaceFlipModule.kt)와 공유: 실제 수면감지
    // 앱들(Sleep as Android 등) 공개 자료 기준 순수 무진동 3분(사용자 원 스펙)은 오탐 위험이 높다고
    // 명시돼 있어 10분으로 완화. 블루투스 탈착이 겹치면(보조 신호) 6분으로 단축 — 그래도 여전히
    // "탈착 이후로도 그만큼 안 움직여야" 하므로 탈착 자체가 즉시 트리거가 되지 않는다.
    private const val SLEEP_STILLNESS_MS = 10 * 60 * 1000L
    private const val SLEEP_STILLNESS_SHORT_MS = 6 * 60 * 1000L
    // Flip Mode의 LINEAR_ACCEL_EPSILON(1.2)보다 살짝 낮게 — 여긴 "완전히 멈췄다"를 원하므로
    // Flip Mode(오탐 완화용 보조 게이트)보다 더 엄격하게 잡아도 무방.
    private const val STILLNESS_WAKE_EPSILON = 1.0f
    // 수면감지는 몇 분 단위 판정이라 초 단위 정밀도가 필요 없음 — 배터리를 위해 배칭 지연을 여유있게.
    private const val STILLNESS_REPORT_LATENCY_US = 5_000_000 // 5s
    private const val PREF_LAST_MOTION_AT_MS = "session_last_motion_at_ms"
    // 한도 도달 3단계 히트카운트 영속 키(날짜 스코프) — 위 PREF_LAST_MOTION_AT_MS와 마찬가지로
    // PREFS_NAME 안에 같이 저장(별도 파일 불필요).
    private const val PREF_DAILY_LIMIT_HIT_DATE = "daily_limit_hit_date"
    private const val PREF_DAILY_LIMIT_HIT_COUNT = "daily_limit_hit_count"
    private const val PREF_DAILY_LIMIT_ORIGINAL_MINUTES = "daily_limit_original_minutes"

    // PaceOverlayModule.consumeExpired()가 읽는 "네이티브가 시간을 다 써서 스스로 세션을
    // 차단했다" 플래그 + 사유 — JS가 다음에 Pace로 돌아왔을 때 한 번만 소비(읽고 즉시 리셋)한다.
    const val PREFS_NAME = "pace_overlay"
    const val PREF_EXPIRED = "expired"
    const val PREF_EXPIRE_REASON = "expire_reason"
    const val PREF_AUTO_MODE = "bt_auto_mode"
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
    private val focusSessionAutoStop = Runnable { instance?.let { setAutoMode(it.applicationContext, false) } }

    fun setFocusSessionDurationMinutes(context: Context, minutes: Int) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_FOCUS_SESSION_MINUTES, minutes.coerceAtLeast(1)).apply()
    }

    fun getFocusSessionDurationMinutes(context: Context): Int =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getInt(PREF_FOCUS_SESSION_MINUTES, DEFAULT_FOCUS_SESSION_MINUTES)

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

    // 2026-07-23 사용자 지시 — 핑거스냅(마이크, AudioRecord)과 블루투스 리모컨이 같은 오디오
    // 세션을 두고 충돌할 수 있다는 QA 지적(C섹션) 반영: 블루투스 오디오 출력이 연결돼 있으면
    // 리모컨이 이미 같은 역할(다음 넘김)을 하므로 핑거스냅을 아예 켜지 않는다 — 상호 배타적으로.
    // PaceOverlayModule.getConnectedBluetoothAudioDevice()와 동일한 검사(BLUETOOTH_CONNECT 런타임
    // 권한 불필요, AudioManager.getDevices()만으로 충분)를 여기 companion에도 둔다.
    private fun isBluetoothAudioConnected(context: Context): Boolean {
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
      return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
      }
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
        // 2026-07-20 실기기 검증 중 발견: revert 과정에서 이 호출이 통째로 빠져 있었다 — 핑거스냅이
        // "AUTO ON"과 완전히 끊어진 채 방치돼 있었음(권한 있어도 디텍터가 아예 안 켜짐). 실제 재생
        // 위치 감지(위)와 핑거스냅(마이크)은 같은 Focus Session 안에서 나란히 도는 별개의 트리거라
        // 둘 다 여기서 같이 켜고 꺼야 한다. 단, 블루투스가 연결돼 있으면 위 사유로 스냅은 건너뛴다.
        if (isBluetoothAudioConnected(context)) {
          Log.d("PaceOverlayService", "PaceSnapDetector skipped — Bluetooth audio device connected, remote already covers next-swipe")
        } else {
          PaceSnapDetector.start(context) { triggerNext(context) }
        }
        val durationMs = getFocusSessionDurationMinutes(context) * 60 * 1000L
        focusSessionHandler.postDelayed(focusSessionAutoStop, durationMs)
      } else {
        PaceAccessibilityService.stopWatching()
        PaceSnapDetector.stop()
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
        it.applyAutoBadgeStyle()
      }
      showToast(context, if (enable) "🎯 Focus Session Started (${getFocusSessionDurationMinutes(context)}m)" else "🎯 Focus Session Ended")
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
      notifyBreak: Boolean,
      hardBlockMode: Boolean
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
        clearSessionActive()
        cancelScheduledTick(this)
        stopForegroundAppPolling()
        removeOverlay()
        removeBlockOverlay()
        removeTier3Toast()
        teardownMediaSession()
        unregisterStillnessSensor()
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
      persistState()
      Log.d("PaceOverlay", "tick remaining=$remainingMinutes sleepTimer=$sleepTimerRemainingMinutes nextBreakIn=$nextBreakInMinutes")

      if (notifyRemaining && (remainingMinutes == 5 || remainingMinutes == 1)) {
        sendAlertNotification(NOTIFICATION_ID_LOW_TIME, "남은 시간", "오늘 ${remainingMinutes}분 남았어요! 잠시 숨을 돌려볼까요.")
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
      val stillnessThresholdMs = if (btDisconnectedDuringStillness) SLEEP_STILLNESS_SHORT_MS else SLEEP_STILLNESS_MS
      val sleepDetected = stillnessElapsedMs >= stillnessThresholdMs

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
          val limitBody = if (isDailyLimit && dailyLimitHitCount >= 2) "잠시 쉬어갈까요?" else "잠시 휴대폰을 내려놓을 시간이에요."
          sendAlertNotification(NOTIFICATION_ID_LIMIT_REACHED, "오늘의 한도에 도달했어요", limitBody)
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

    // 2026-07-20 실기기 검증 7차에서 확정된 사실 — 실제 유튜브 앱 재생 중엔 Bluetooth 하드웨어
    // 버튼이 절대 Pace로 안 온다(OS가 MediaSessionService 내부에서 무조건 YouTube로 타겟팅, 5가지
    // 우회 다 실패). 반면 이 알약 자체는 Pace 소유의 진짜 View라 탭은 100% Pace가 받는다 — 블루투스
    // 라우팅을 아예 안 거치므로 그 제약이 적용되지 않는 별도 경로(사용자 제안). triggerNext/
    // triggerPrevious는 이미 Bluetooth 경로에서 검증된 PaceAccessibilityService.swipeOnce()를 그대로
    // 재사용 — 새 스와이프 로직 아님, 입력 소스만 하드웨어 버튼 대신 알약 탭으로 바뀐 것.
    val prevBtn = TextView(this).apply {
      text = "⏮"
      textSize = 13f
      isClickable = true
      setOnClickListener { triggerPrevious(applicationContext) }
    }
    applyPillButtonStyle(prevBtn)
    bar.addView(prevBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      rightMargin = (6 * resources.displayMetrics.density).toInt()
    })

    val nextBtn = TextView(this).apply {
      text = "⏭"
      textSize = 13f
      isClickable = true
      setOnClickListener { triggerNext(applicationContext) }
    }
    applyPillButtonStyle(nextBtn)
    bar.addView(nextBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      rightMargin = (10 * resources.displayMetrics.density).toInt()
    })

    autoBadge = TextView(this).apply {
      textSize = 9f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      isClickable = true
      setOnClickListener {
        // autoNextEnabled 필드 갱신 + 배지 리프레시는 setAutoMode()가 모든 호출 경로에 대해
        // 일괄 처리한다(위 companion setAutoMode 참고) — 여기서 중복으로 안 건드림.
        setAutoMode(applicationContext, !autoNextEnabled)
        persistState()
      }
    }
    applyAutoBadgeStyle()
    bar.addView(autoBadge)

    // 2026-07-21 밤 사용자 지시(PACE_ARCHITECTURE.md "런치 플로우 단순화") — 콜드 스타트가
    // 이제 탭 대신 곧바로 세션(Overlay+YouTube)으로 가므로, 실사용 중 대부분의 시간(YouTube가
    // 전경, Pace Activity는 백그라운드) 유일하게 항상 보이는 이 알약에 앱으로 돌아가는 경로가
    // 있어야 Home/Focus/Stats/Settings에 접근 가능하다 — JS 쪽 overlay/index.tsx에도 같은
    // 목적의 앱 아이콘 버튼이 있지만 그건 Pace Activity가 전경일 때만(거의 항상 YouTube에
    // 가려짐) 보이므로 실질적으로 이 네이티브 버튼이 진짜 진입점이다. getLaunchIntentForPackage
    // 사용 — 이 모듈이 호스트 앱의 MainActivity 클래스에 직접 의존하지 않도록.
    val appBtn = TextView(this).apply {
      text = "P"
      textSize = 12f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      isClickable = true
      setOnClickListener {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        launchIntent?.let { startActivity(it) }
      }
    }
    applyPillButtonStyle(appBtn)
    bar.addView(appBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      leftMargin = (10 * resources.displayMetrics.density).toInt()
    })

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
      val blackout = View(this).apply {
        setBackgroundColor(Color.BLACK)
        isClickable = true
        setOnClickListener { endFromBlockOverlay() }
      }
      blockOverlayView = blackout
      val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
        0, // flags=0: 터치 통과 금지(모달)는 다른 사유와 동일
        android.graphics.PixelFormat.OPAQUE // TRANSLUCENT가 아니라 완전 불투명 — 진짜 암전이어야 함
      )
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
    val titleText = when {
      isSleepTimer -> "Sleep Timer 종료"
      isDailyLimitTier2 -> "잠시 쉬어갈까요?"
      isDailyLimit -> "TAKE YOUR PACE"
      else -> "오늘의 한도에 도달했어요"
    }
    // tier1만 3줄(제목/부제/본문), 나머지는 2줄(제목/본문) — JS LimitReachedOverlay.tsx의 Modal 구조와 동일.
    val subtitleText = if (isDailyLimit && !isDailyLimitTier2) "${dailyLimitOriginalMinutes}분 시청 완료" else null
    val bodyText = when {
      isSleepTimer -> "설정한 Sleep Timer 시간이 다 됐어요."
      isDailyLimitTier2 -> "벌써 ${(dailyLimitTier - 1) * EXTEND_MINUTES}분이 지났습니다"
      isDailyLimit -> "계속 시청할 수도, 여기서 멈출 수도 있습니다."
      else -> "오늘 정해둔 시청 시간을 다 썼어요."
    }
    val extendBtnText = if (isDailyLimitTier2) "계속 보기" else "+${EXTEND_MINUTES}분"
    val endBtnText = if (isDailyLimitTier2) "여기까지 보기" else "휴식하기"
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
    val messages = listOf(
      "Take your pace." to "지금까지 ${usageMinutes}분 시청했습니다.",
      "잠시 쉬어갈까요?" to "오늘 ${usageMinutes}분 시청했습니다.",
      "Time well spent." to "오늘 목표 시간을 초과했습니다.",
      "오늘 다른 할일이 있었나요?" to "목표 ${goalMinutes}분을 넘겼어요."
    )
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

  // Previous/Next 알약 버튼 공용 스타일 — autoBadge와 동일하게 dp 스케일 패딩을 써서 고밀도
  // 화면에서 터치 영역이 raw px처럼 쪼그라드는 걸 방지(2026-07-19 AUTO 배지 오작동 버그와 동일한
  // 원인을 처음부터 피함).
  private fun applyPillButtonStyle(view: TextView) {
    val d = resources.displayMetrics.density
    view.setPadding((10 * d).toInt(), (10 * d).toInt(), (10 * d).toInt(), (10 * d).toInt())
    view.setTextColor(Color.WHITE)
    view.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(Color.parseColor("#14FFFFFF"))
    }
  }

  private fun applyAutoBadgeStyle() {
    autoBadge?.apply {
      // 2026-07-21 밤 사용자 지시 — "Auto"/"자동" 브랜딩을 UI에서 완전히 제거. 이 배지는 Focus
      // Session이 지금 실제로 도는지(런타임 상태)를 보여준다.
      text = if (autoNextEnabled) "SESSION ON" else "SESSION OFF"
      // dp 스케일 패딩(density 곱) — 이전엔 raw px(20,10)라 고밀도 화면에서 실제 터치 영역이
      // 몇 dp로 쪼그라들어 배지를 빗맞히기 쉬웠다(위 showOverlay 주석 참고). Android 권장 최소
      // 터치 타깃(48dp)엔 못 미치지만, 알약 배지라는 시각적 크기 제약 안에서 최대한 넓힘.
      val d = resources.displayMetrics.density
      setPadding((16 * d).toInt(), (12 * d).toInt(), (16 * d).toInt(), (12 * d).toInt())
      setTextColor(if (autoNextEnabled) Color.WHITE else Color.parseColor("#9CA3AF"))
      background = GradientDrawable().apply {
        cornerRadius = 100f
        setColor(if (autoNextEnabled) Color.parseColor("#5856D6") else Color.parseColor("#14FFFFFF"))
      }
    }
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
    infraReady = false
    if (instance === this) instance = null
    super.onDestroy()
  }
}
