package expo.modules.paceoverlay

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.Manifest
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

// Expo Modules API(2026 기준 권장 패턴 — 구식 NativeModules+@ReactMethod 대신) 로컬 모듈.
// JS 쪽 바인딩은 modules/pace-overlay/index.ts, 상위 서비스 인터페이스는
// src/services/platform/overlayService.android.ts(OverlayService)와 1:1 대응.
// PACE_ARCHITECTURE.md "Android Overlay 네이티브 POC" 섹션 참고 — 아직 npx expo prebuild +
// EAS Dev Client로 실기기 빌드 검증 전인 POC 코드다.
class PaceOverlayModule : Module() {
  // Bluetooth Hands-Free(2026-07-19) — AudioManager로 현재 연결된 블루투스 오디오 출력을 조회.
  // BLUETOOTH_CONNECT 런타임 권한(Android 12+)이 필요한 건 BluetoothAdapter의 클래식 API 쪽이고,
  // AudioManager.getDevices()로 출력 라우팅만 보는 이 경로는 별도 권한 없이 동작한다.
  private fun getConnectedBluetoothAudioDevice(context: Context): Pair<Boolean, String?> {
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return Pair(false, null)
    val btDevice = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull {
      it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
    }
    return Pair(btDevice != null, btDevice?.productName?.toString())
  }

  override fun definition() = ModuleDefinition {
    Name("PaceOverlay")

    Events("onFeedMediaCommand")

    // 2026-07-20 Pace Feed 전용 MediaSession(PaceFeedMediaSession.kt 참고) — PaceOverlayService의
    // 세션과 별개, feed/index.tsx 화면이 떠 있는 동안만 존재. AirPods next/previous/play-pause를
    // 여기서 받으면 "onFeedMediaCommand" JS 이벤트로 쏜다(useFeedRemoteControl.android.ts가 구독).
    Function("startFeedMediaSession") {
      appContext.reactContext?.let { context ->
        PaceFeedMediaSession.onCommand = { action -> sendEvent("onFeedMediaCommand", mapOf("action" to action)) }
        PaceFeedMediaSession.start(context)
      }
    }

    Function("stopFeedMediaSession") {
      PaceFeedMediaSession.stop()
    }

    Function("setFeedPlaybackState") { playing: Boolean ->
      PaceFeedMediaSession.setPlaying(playing)
    }

    // Android 6.0+는 SYSTEM_ALERT_WINDOW가 런타임 권한이 아니라 설정 화면 승인이 필요하다.
    Function("hasOverlayPermission") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(appContext.reactContext)
      } else {
        true
      }
    }

    // 설정 > "다른 앱 위에 표시" 화면으로 이동. 결과는 hasOverlayPermission()을 포그라운드 복귀 시 재확인해서 판단.
    // ⚠️ Kotlin/DSL 컴파일 노트: 0-인자 Function/AsyncFunction 블록에서 `return@Function`(값 없음, Unit)을
    // 쓰면 DSL이 기대하는 'Any?'와 타입이 안 맞아 컴파일 에러가 난다(실기기 빌드로 처음 발견) — 이른 return
    // 대신 `?.let { }`으로 감싸 전체 블록이 Unit 하나로만 추론되게 통일한다.
    Function("requestOverlayPermission") {
      appContext.reactContext?.let { context ->
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}")
        ).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        context.startActivity(intent)
      }
    }

    // 포그라운드 앱 감지(ForegroundAppWatcher, UsageStatsManager 기반)에 필요한 별도 권한 —
    // "다른 앱 위에 표시"와는 다른 특수 권한이라 별도 승인 플로우가 필요하다.
    Function("hasUsageAccessPermission") {
      appContext.reactContext?.let { context -> ForegroundAppWatcher.hasUsageAccessPermission(context) } ?: false
    }

    Function("requestUsageAccessPermission") {
      appContext.reactContext?.let { context ->
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
      }
    }

    // 2026-07-19: Daily Limit뿐 아니라 Sleep Timer/Break Reminder/저시간·한도도달 알림까지 전부
    // 네이티브(PaceOverlayService)가 자기 완결적으로 담당하도록 확장 — 세션 시작 시점의 값을
    // 전부 함께 넘긴다(PaceOverlayService.kt 상단 주석 참고).
    AsyncFunction("start") { remainingMinutes: Int, autoNextEnabled: Boolean, sleepTimerMinutes: Int, breakIntervalMinutes: Int, notifyRemaining: Boolean, notifyLimit: Boolean, notifyBreak: Boolean, hardBlockMode: Boolean ->
      // 2026-07-24 진단용 — 실기기에서 세션 시작 후 PaceOverlayService.onStartCommand 로그가 단 한
      // 줄도 안 찍히는 현상 조사 중. startForegroundService 자체가(혹은 그 이전 단계가) 예외를
      // 던지는데 JS 쪽 .catch(() => {})가 조용히 삼켜서 원인이 안 보였다 — 여기서 먼저 잡아 로그로
      // 남긴다.
      appContext.reactContext?.let { context ->
        try {
          Log.i("PaceOverlayModule", "start() called, calling PaceOverlayService.start")
          PaceOverlayService.start(context, remainingMinutes, autoNextEnabled, sleepTimerMinutes, breakIntervalMinutes, notifyRemaining, notifyLimit, notifyBreak, hardBlockMode)
          Log.i("PaceOverlayModule", "PaceOverlayService.start returned normally")
        } catch (e: Exception) {
          Log.e("PaceOverlayModule", "PaceOverlayService.start threw", e)
          throw e
        }
      } ?: Log.w("PaceOverlayModule", "start() called but reactContext is null")
    }

    AsyncFunction("updateRemaining") { remainingMinutes: Int ->
      // 2026-07-18 실기기 검증 중 발견: 앱이 백그라운드(YouTube 위 오버레이 표시 중)로 가면
      // remainingMinutes가 JS 쪽 타이머에서는 정확히 줄어드는데도 네이티브 알약 텍스트가 갱신 안
      // 되는 버그 재현 — appContext.reactContext가 백그라운드 상태에서 null이 되는지 진단용 로그.
      val context = appContext.reactContext
      Log.d("PaceOverlay", "updateRemaining($remainingMinutes) called, reactContext=${if (context != null) "OK" else "NULL"}")
      context?.let { PaceOverlayService.updateRemaining(it, remainingMinutes) }
    }

    AsyncFunction("stop") {
      appContext.reactContext?.let { context ->
        PaceOverlayService.stop(context)
      }
    }

    // 네이티브 카운트다운(PaceOverlayService.tickRunnable)이 Daily Limit 또는 Sleep Timer 만료로
    // 스스로 세션을 차단했는지 확인 — 읽는 즉시 리셋(1회성 소비). JS가 앱 포그라운드 복귀
    // 시(AppState 'active') 호출해서 DB 세션 기록 등 백그라운드 JS 타이머로는 더 이상 처리할 수
    // 없는 후속 작업을 뒤늦게(eventually-consistent) 마무리한다 — 알림 자체는 이제 네이티브가
    // 즉시 쏘므로(sendAlertNotification) JS는 더 이상 신경 안 써도 됨. 만료 안 됐으면 null,
    // 만료됐으면 사유 문자열("daily_limit_reached"/"sleep_timer_expired") 반환.
    Function("consumeExpired") {
      val reason: String? = appContext.reactContext?.let { context ->
        val prefs = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        val wasExpired = prefs.getBoolean(PaceOverlayService.PREF_EXPIRED, false)
        if (wasExpired) {
          val expireReason = prefs.getString(PaceOverlayService.PREF_EXPIRE_REASON, "daily_limit_reached")
          prefs.edit().putBoolean(PaceOverlayService.PREF_EXPIRED, false).apply()
          expireReason
        } else {
          null
        }
      }
      reason
    }

    // Auto Next 실제 스와이프(PaceAccessibilityService, 2026-07-18) — ⚠️ Play 스토어 정책 리스크
    // (PACE_ARCHITECTURE.md 참고): "사용자 대신 스와이프"는 AccessibilityService 심사에서 "접근성
    // 목적이 아닌 남용"으로 리젝될 수 있다. 사용자 결정(2026-07-18): 코드는 완성해두되 스토어 제출
    // 시 활성화 여부는 EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드 플래그로 별도 결정(autoNextService.android.ts).
    Function("hasAccessibilityPermission") {
      appContext.reactContext?.let { context -> PaceAccessibilityService.isEnabled(context) } ?: false
    }

    // 2026-07-19: 사용자 지시 — "설정 → 접근성 → 설치된 앱 → PACE" 3단 네비게이션 없이 PACE
    // 항목 화면으로 최대한 바로 이동. Settings.ACTION_ACCESSIBILITY_DETAILS_SETTINGS(API 34+)가
    // 지원되면 컴포넌트를 지정해 PACE 상세 화면으로 직행하고, 미지원 기기에서는 기존 전체 접근성
    // 목록으로 안전하게 폴백한다.
    // ⚠️ 실기기(Android 13/One UI) 검증 중 발견: 미지원 기기에서 이 인텐트가 ActivityNotFoundException이
    // 아니라 SecurityException(Permission Denial)을 던졌다 — 삼성 Settings가 인텐트를 내부
    // 컴포넌트로 resolve는 하되 직접 시작은 거부하는 케이스. ActivityNotFoundException만 잡던
    // catch가 이걸 놓쳐서 JS까지 에러가 그대로 튀어 올라가는 크래시였다(사용자가 실기기에서 직접
    // 재현). RuntimeException으로 넓혀서 어떤 제조사가 어떤 식으로 거부하든 항상 폴백하게 고침.
    // "ENABLE 탭 한 번"으로 완전히 끝내는 건 안드로이드 자체가 막아놓은 영역이라(앱이 자기
    // 접근성 권한을 스스로 켜지 못하게 하는 보안장치) 여기서 더 줄일 수 없음 — 마지막 토글은
    // 항상 사용자의 실제 탭이 있어야 한다.
    Function("requestAccessibilityPermission") {
      appContext.reactContext?.let { context ->
        val serviceComponent = ComponentName(context, PaceAccessibilityService::class.java)
        val directIntent = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK
          putExtra(":settings:fragment_args_key", serviceComponent.flattenToString())
          putExtra("extra_fragment_arg_key", serviceComponent.flattenToString())
        }
        try {
          context.startActivity(directIntent)
        } catch (e: RuntimeException) {
          try {
            val fallbackIntent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
              flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(fallbackIntent)
          } catch (fallbackError: RuntimeException) {
            Log.e("PaceOverlay", "requestAccessibilityPermission: both direct and fallback intents failed", fallbackError)
          }
        }
      }
    }

    AsyncFunction("startAutoNextWatching") { intervalMs: Int ->
      PaceAccessibilityService.startWatching(intervalMs.toLong())
    }

    AsyncFunction("stopAutoNextWatching") {
      PaceAccessibilityService.stopWatching()
    }

    // 2026-07-26 사용자 지시("몇 편 봤는지 카운트") — 이번 세션에서 실제로 넘어간 영상 편수
    // (자동넘김 스와이프든 사용자가 직접 손으로 넘긴 것이든 전부 포함). 접근성이 꺼져있으면 0.
    // consumeExpired()와 같은 동기 Function 패턴 — JS는 세션 종료 직전(overlayService.endSession()
    // 호출 전에) 이 값을 읽어 DB videos_watched에 정직하게 기록한다.
    Function("getVideoWatchCount") {
      PaceAccessibilityService.getVideoCount()
    }

    // Bluetooth 리모컨 버튼뿐 아니라 Focus 탭 등 인앱 Next/Previous 버튼 탭에서도 같은 스와이프를
    // 쓸 수 있도록 노출(2026-07-19) — MediaSession 콜백(PaceOverlayService)이 부르는 것과 동일한
    // PaceAccessibilityService.swipeOnce()를 JS에서도 직접 호출 가능하게 한다.
    Function("triggerSwipe") { up: Boolean ->
      PaceAccessibilityService.swipeOnce(up)
    }

    // Focus 탭 Auto Mode 토글 버튼 등 인앱 탭에서도 하드웨어 리모컨 Play/Pause와 동일한 경로
    // (PaceOverlayService.setAutoMode — 카운터/토스트/MediaSession 재생상태 동기화까지 포함)를 타게 한다.
    Function("setBluetoothAutoMode") { enable: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setAutoMode(context, enable) }
    }

    // 2026-07-20 사용자 지시 — Focus Session 지속 시간을 10분 하드코딩이 아니라 사용자가 직접
    // 고르게 한다(정책상으로도 문제없음, PACE_ARCHITECTURE.md 참고). 다음 setBluetoothAutoMode(true)
    // 호출부터 반영된다 — 이미 도는 중인 세션의 예약된 자동 종료 시각은 안 바뀜.
    Function("setFocusSessionDurationMinutes") { minutes: Int ->
      appContext.reactContext?.let { context -> PaceOverlayService.setFocusSessionDurationMinutes(context, minutes) }
    }

    Function("getFocusSessionDurationMinutes") {
      appContext.reactContext?.let { context -> PaceOverlayService.getFocusSessionDurationMinutes(context) } ?: 10
    }

    // 2026-07-21 밤 감사 발견 — EXPO_PUBLIC_ENABLE_AUTO_NEXT는 JS 전용 빌드 플래그라 알약 탭/블루투스
    // 리모컨(둘 다 코틀린에서 직접 setAutoMode를 부름)을 전혀 못 막았다. 앱 부팅 시 이 값을 네이티브에
    // 한 번 전달해두면 setAutoMode(true)가 어느 경로로 불려도 실제로 막힌다(PaceOverlayService.
    // setBuildAutoNextEnabled/isBuildAutoNextEnabled 참고). _layout.tsx가 부팅 시 1회 호출.
    Function("setBuildAutoNextEnabled") { enabled: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setBuildAutoNextEnabled(context, enabled) }
    }

    // Bluetooth Hands-Free Control(2026-07-19, Copilot 스펙 정리 반영) — 실제 스와이프/Auto Mode
    // 토글/토스트는 전부 PaceOverlayService의 MediaSession 콜백에서 네이티브가 자기 완결적으로
    // 처리한다(이벤트 브릿지 불필요, Daily Limit과 같은 설계 원칙). JS는 이 함수로 표시용 상태만
    // 폴링해서 Home/Focus/Settings/Insights UI에 반영한다.
    Function("getBluetoothState") {
      val context = appContext.reactContext
      val prefs = context?.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      val deviceInfo = context?.let { getConnectedBluetoothAudioDevice(it) }
      mapOf(
        "isConnected" to (deviceInfo?.first ?: false),
        "deviceName" to deviceInfo?.second,
        "autoModeEnabled" to (prefs?.getBoolean(PaceOverlayService.PREF_AUTO_MODE, false) ?: false),
        "nextCount" to (prefs?.getInt("bt_next_count", 0) ?: 0),
        "previousCount" to (prefs?.getInt("bt_previous_count", 0) ?: 0),
        "autoToggleCount" to (prefs?.getInt("bt_auto_toggle_count", 0) ?: 0)
      )
    }

    // 2026-07-20 핑거스냅 Hands-Free Next(Focus Session 전용, PACE_ARCHITECTURE.md 참고) — RECORD_AUDIO는
    // 일반 dangerous 런타임 권한이라 시스템 다이얼로그가 필요. Expo Modules API의 permissions 헬퍼로
    // 표준 요청 플로우를 그대로 쓴다(hasOverlayPermission류의 "설정 화면" 특수 권한과는 다른 경로).
    Function("hasRecordAudioPermission") {
      appContext.reactContext?.let { context -> PaceSnapDetector.hasPermission(context) } ?: false
    }

    AsyncFunction("requestRecordAudioPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.RECORD_AUDIO)
    }

    // 2026-07-24 손 밀어내기(shoo) Hands-Free Next — 핑거스냅의 RECORD_AUDIO와 동일한 이유로 표준
    // dangerous 런타임 권한 요청 플로우가 필요하다(카메라도 마찬가지로 시스템 다이얼로그 필요).
    Function("hasCameraPermission") {
      appContext.reactContext?.let { context -> PaceHandWaveDetector.hasPermission(context) } ?: false
    }

    AsyncFunction("requestCameraPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    // Focus Session이 켜져 있는 동안에만 호출된다 — 앱 시작부터 상시 청취가 아님(사용자 지시).
    // 스냅 감지 시 알약/Bluetooth와 동일한 triggerNext(swipeOnce + 카운터 + 토스트)를 그대로 재사용.
    Function("startSnapDetection") {
      appContext.reactContext?.let { context ->
        PaceSnapDetector.start(context) { PaceOverlayService.triggerNext(context) }
      }
    }

    Function("stopSnapDetection") {
      PaceSnapDetector.stop()
    }

    Function("isSnapDetectionRunning") {
      PaceSnapDetector.isRunning()
    }
  }
}
