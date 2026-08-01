package expo.modules.paceoverlay

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.widget.Toast
import android.Manifest
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// 2026-07-26 밤 — sleepStillnessMinutes(D8) 추가로 start()의 위치 인자가 9개가 되면서 Expo Modules
// API의 AsyncFunction 위치 인자 오버로드 한도(8개, ObjectDefinitionBuilder.kt 참고)를 넘겨 컴파일이
// 깨졌다. 위치 인자를 더 늘리는 대신 단일 Record 객체로 묶어 인자 개수 제한 자체를 우회 — 앞으로
// 세션 시작 옵션이 늘어나도 이 패턴을 유지하면 같은 문제가 재발하지 않는다.
class StartSessionOptions : Record {
  @Field val remainingMinutes: Int = 0
  @Field val autoNextEnabled: Boolean = false
  @Field val sleepTimerMinutes: Int = 0
  @Field val breakIntervalMinutes: Int = 0
  @Field val notifyRemaining: Boolean = true
  @Field val notifyLimit: Boolean = true
  @Field val notifyBreak: Boolean = true
  @Field val hardBlockMode: Boolean = false
  @Field val sleepStillnessMinutes: Int = 10
  @Field val bluetoothVolumeKeySkipEnabled: Boolean = true
}

// 2026-07-27 사용자 지시 — 이미 도는 세션에 즉시 반영해야 하는 설정 묶음(휴식 간격/알림 3종/Hard
// Block). StartSessionOptions와 동일한 이유(위치 인자 8개 제한)로 Record 하나로 묶는다.
class LiveSessionConfig : Record {
  @Field val breakIntervalMinutes: Int = 0
  @Field val notifyRemaining: Boolean = true
  @Field val notifyLimit: Boolean = true
  @Field val notifyBreak: Boolean = true
  @Field val hardBlockMode: Boolean = false
}

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
        // 2026-08-01 사용자 지시("권한 관련된것들은... 설정하고 다시 돌아오고") — 아래 3개 권한
        // 함수 전부 동일하게 currentActivity가 있으면 NEW_TASK 없이 그 Activity에서 열어, 설정
        // 화면이 Pace와 같은 태스크 백스택에 얹히게 한다(뒤로가기 한 번 = Pace로 복귀). NEW_TASK로
        // 별개 태스크를 만들면 뒤로가기가 설정 앱 자체의 백스택만 돌다 결국 홈으로 빠져버린다.
        val activity = appContext.currentActivity
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}")
        ).apply { if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        (activity ?: context).startActivity(intent)
      }
    }

    // 포그라운드 앱 감지(ForegroundAppWatcher, UsageStatsManager 기반)에 필요한 별도 권한 —
    // "다른 앱 위에 표시"와는 다른 특수 권한이라 별도 승인 플로우가 필요하다.
    Function("hasUsageAccessPermission") {
      appContext.reactContext?.let { context -> ForegroundAppWatcher.hasUsageAccessPermission(context) } ?: false
    }

    Function("requestUsageAccessPermission") {
      appContext.reactContext?.let { context ->
        // 2026-08-01 사용자 지적("왜 앱 키자마자 사용정보 접근 허용 메뉴가 나와") — 접근성 권한
        // 안내(위 requestAccessibilityPermission)와 달리 이건 아무 설명 없이 바로 시스템 설정을
        // 띄웠다. 같은 톤(상단 가운데 토스트, 2회 노출)으로 무슨 화면인지 먼저 알려준다.
        val guidance = if (java.util.Locale.getDefault().language == "ko") {
          "다른 앱 사용 감지 권한 — 목록에서 'Pace'를 찾아 켜주세요"
        } else {
          "Usage access — find \"Pace\" in the list and turn it on"
        }
        fun showGuidanceToast() {
          Toast.makeText(context, guidance, Toast.LENGTH_LONG).apply {
            setGravity(Gravity.TOP, 0, (180 * context.resources.displayMetrics.density).toInt())
          }.show()
        }
        showGuidanceToast()
        Handler(Looper.getMainLooper()).postDelayed({ showGuidanceToast() }, 3500L)
        val activity = appContext.currentActivity
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
          if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        (activity ?: context).startActivity(intent)
      }
    }

    // 2026-07-26 사용자 지시(외부 AI 조언 반영) — 접근성/오버레이/사용정보 접근 3대 권한이 삼성 One UI
    // 배터리 최적화의 1순위 타깃이라 백그라운드에서 조용히 회수되는 걸 이번 세션 내내 실제로 겪었다
    // (memory: feedback_reenable_accessibility_after_reinstall.md). "배터리 사용량 최적화 제외"를
    // 받아두면 그 회수 빈도를 줄일 수 있는 표준 대응책.
    Function("hasBatteryOptimizationExemption") {
      appContext.reactContext?.let { context ->
        val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        pm.isIgnoringBatteryOptimizations(context.packageName)
      } ?: false
    }

    Function("requestBatteryOptimizationExemption") {
      appContext.reactContext?.let { context ->
        val activity = appContext.currentActivity
        try {
          val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}")
          ).apply { if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK }
          (activity ?: context).startActivity(intent)
        } catch (e: ActivityNotFoundException) {
          // 일부 OEM 커스텀 ROM은 이 다이렉트 인텐트를 안 지원 — 일반 배터리 설정 목록으로 폴백.
          Log.w("PaceOverlayModule", "ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS not supported, falling back", e)
          val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK
          }
          (activity ?: context).startActivity(fallback)
        }
      }
    }

    // 2026-07-19: Daily Limit뿐 아니라 Sleep Timer/Break Reminder/저시간·한도도달 알림까지 전부
    // 네이티브(PaceOverlayService)가 자기 완결적으로 담당하도록 확장 — 세션 시작 시점의 값을
    // 전부 함께 넘긴다(PaceOverlayService.kt 상단 주석 참고).
    AsyncFunction("start") { options: StartSessionOptions ->
      // 2026-07-24 진단용 — 실기기에서 세션 시작 후 PaceOverlayService.onStartCommand 로그가 단 한
      // 줄도 안 찍히는 현상 조사 중. startForegroundService 자체가(혹은 그 이전 단계가) 예외를
      // 던지는데 JS 쪽 .catch(() => {})가 조용히 삼켜서 원인이 안 보였다 — 여기서 먼저 잡아 로그로
      // 남긴다.
      appContext.reactContext?.let { context ->
        try {
          Log.i("PaceOverlayModule", "start() called, calling PaceOverlayService.start")
          PaceOverlayService.start(
            context,
            options.remainingMinutes,
            options.autoNextEnabled,
            options.sleepTimerMinutes,
            options.breakIntervalMinutes,
            options.notifyRemaining,
            options.notifyLimit,
            options.notifyBreak,
            options.hardBlockMode,
            options.sleepStillnessMinutes,
            options.bluetoothVolumeKeySkipEnabled
          )
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
      appContext.reactContext?.let { context ->
        val prefs = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        val wasExpired = prefs.getBoolean(PaceOverlayService.PREF_EXPIRED, false)
        if (wasExpired) {
          val expireReason = prefs.getString(PaceOverlayService.PREF_EXPIRE_REASON, "daily_limit_reached")
          // 2026-07-26 — sleep_detected일 때만 존재(PaceOverlayService.markExpired 참고). JS가 세션
          // ended_at을 "감지된 시각"이 아니라 "마지막으로 움직인 시각(진짜 잠든 시각에 더 가까움)"으로
          // 정확히 기록하는 데 쓴다. -1이면 "이 정보 없음"(sleep_detected가 아니었던 경우).
          val sleepOnsetAtMs = prefs.getLong(PaceOverlayService.PREF_SLEEP_ONSET_AT_MS, -1L)
          prefs.edit().putBoolean(PaceOverlayService.PREF_EXPIRED, false).apply()
          mapOf("reason" to expireReason, "sleepOnsetAtMs" to sleepOnsetAtMs)
        } else {
          null
        }
      }
    }

    // 2026-07-26 사용자 지시(외부 AI 조언 반영, "저장하고 있다가 다시 노티") — 접근성 권한이 세션
    // 도중 조용히 회수됐는지 1회성 소비 확인. consumeExpired()와 동일 패턴.
    Function("consumeAccessibilityRevoked") {
      PaceOverlayService.consumeAccessibilityRevoked()
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
    // 2026-07-31 실기기 발견(사용자 지적: "다이렉트 설정화면으로 가라고 했더니 왜케 여러개야
    // 가이드도 없이") — 아래 directIntent(ACCESSIBILITY_DETAILS_SETTINGS)는 실기기에서 항상
    // `SecurityException: ... requires android.permission.OPEN_ACCESSIBILITY_DETAILS_SETTINGS`로
    // 실패한다(adb shell로 직접 재현·확인) — 이 권한은 시스템/사전탑재 앱에만 부여되는
    // signature|privileged 권한이라 서드파티 앱은 이 인�텐트를 원천적으로 쓸 수 없다("가끔
    // 실패"가 아니라 "항상 실패", 제조사와 무관). 즉 폴백(일반 접근성 목록)이 사실상 100%
    // 발동하는데 안내 문구가 없어 사용자가 "어디서 뭘 켜야 할지" 알 수 없었다 — 폴백 화면으로
    // 갈 때 안내 토스트를 띄운다.
    Function("requestAccessibilityPermission") {
      appContext.reactContext?.let { context ->
        // 2026-08-01 사용자 지적("설정하고 back하면 앱으로 와야 할거 아냐, 계속 설정이면 사람들이
        // 앱으로 다시 찾아오겠니") — FLAG_ACTIVITY_NEW_TASK로 열면 설정 앱이 Pace와 별개의 태스크로
        // 뜬다. 별개 태스크에서 뒤로가기를 계속 누르면 그 태스크(설정) 안의 화면들만 돌다가 결국
        // 런처(홈)로 빠져버려 Pace로 못 돌아온다. 지금 포그라운드 Activity(currentActivity)가 있으면
        // NEW_TASK 없이 그 Activity에서 startActivity — 그러면 설정 화면이 Pace의 "같은 태스크"
        // 백스택에 얹혀서 뒤로가기 한 번에 정확히 Pace로 돌아온다. currentActivity가 없는 예외적인
        // 경우(백그라운드에서 호출 등)에만 NEW_TASK로 폴백.
        val activity = appContext.currentActivity
        val serviceComponent = ComponentName(context, PaceAccessibilityService::class.java)
        val directIntent = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
          if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK
          putExtra(":settings:fragment_args_key", serviceComponent.flattenToString())
          putExtra("extra_fragment_arg_key", serviceComponent.flattenToString())
        }
        try {
          (activity ?: context).startActivity(directIntent)
        } catch (e: RuntimeException) {
          try {
            val fallbackIntent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
              if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            (activity ?: context).startActivity(fallbackIntent)
            val guidance = if (java.util.Locale.getDefault().language == "ko") {
              "설치된 앱(또는 다운로드된 앱) 목록에서 'Pace'를 찾아 켜주세요"
            } else {
              "Find \"Pace\" under Installed apps (or Downloaded apps) and turn it on"
            }
            // 2026-08-01 사용자 지적("안내가 떴다가 사라져 하단에 떠서 잘 안보이고") — 기본 Toast는
            // 화면 하단(제스처 바 근처)에 뜨는데, 이 시점 사용자 시선은 방금 막 열린 설정 화면
            // 상단(제목 "접근성")에 가 있다. gravity를 상단으로 옮기고, LENGTH_LONG(~3.5초) 한 번으론
            // 놓치기 쉬워 동일 토스트를 한 번 더 띄워 실질 노출 시간을 늘린다(총 ~7초).
            fun showGuidanceToast() {
              Toast.makeText(context, guidance, Toast.LENGTH_LONG).apply {
                setGravity(Gravity.TOP, 0, (180 * context.resources.displayMetrics.density).toInt())
              }.show()
            }
            showGuidanceToast()
            Handler(Looper.getMainLooper()).postDelayed({ showGuidanceToast() }, 3500L)
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

    // 2026-07-27 사용자 지시 — 손짓(카메라 제스처)을 마스터(Focus Session)와 별개로 켜고 끄는 독립 토글.
    Function("setHandsFreeGestureEnabled") { enable: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setHandsFreeGestureEnabled(context, enable) }
    }

    // 2026-07-27 사용자 실기기 지적 — 블루투스 볼륨키 스킵도 손짓과 동일하게 이미 도는 세션에
    // 즉시 반영돼야 한다(예전엔 다음 세션 시작 때만 반영되는 StartSessionOptions뿐이었음).
    Function("setBluetoothVolumeKeySkipEnabled") { enable: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setBluetoothVolumeKeySkipEnabled(context, enable) }
    }

    // 2026-07-27 사용자 지시("시간이나 다른 것들도 다 적용 안되는거 아냐? 전수 확인해") — 휴식 간격/
    // 알림 3종/Hard Block을 이미 도는 세션에 즉시 반영.
    Function("updateLiveSessionConfig") { config: LiveSessionConfig ->
      appContext.reactContext?.let { context ->
        PaceOverlayService.updateLiveSessionConfig(
          context,
          config.breakIntervalMinutes,
          config.notifyRemaining,
          config.notifyLimit,
          config.notifyBreak,
          config.hardBlockMode
        )
      }
    }

    // 2026-07-28 사장님 결정("리셋형: 지금부터 새 값으로 다시 카운트, 경과시간 무시") — 취침 타이머를
    // 이미 도는 세션 중에 바꾸면 새 값으로 카운트다운을 처음부터 다시 시작한다.
    Function("setSleepTimerMinutes") { minutes: Int ->
      appContext.reactContext?.let { context -> PaceOverlayService.setSleepTimerMinutes(context, minutes) }
    }

    // 2026-07-20 사용자 지시 — Focus Session 지속 시간을 10분 하드코딩이 아니라 사용자가 직접
    // 고르게 한다(정책상으로도 문제없음, PACE_ARCHITECTURE.md 참고). 다음 setBluetoothAutoMode(true)
    // 호출부터 반영된다 — 이미 도는 중인 세션의 예약된 자동 종료 시각은 안 바뀜.
    Function("setFocusSessionDurationMinutes") { minutes: Int ->
      appContext.reactContext?.let { context -> PaceOverlayService.setFocusSessionDurationMinutes(context, minutes) }
    }

    // 2026-08-01 사용자 지시("포커스 다 쓰면... 누르면 광고 보고 시간주면 되잖아") — 네이티브
    // "FOCUS OFF" 배지가 타임아웃 이후 탭됐을 때 광고 없이 바로 재활성화하지 않고 앱을 열어
    // 보상형 광고 유도 모달로 보내려면, 네이티브가 지금 프리미엄인지 알아야 한다(구독 상태 자체는
    // JS에만 있음) — isPremium이 바뀔 때마다(_layout.tsx) 이 값을 밀어준다.
    Function("setIsPremium") { isPremium: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setIsPremium(context, isPremium) }
    }

    // 2026-07-27 감사 발견 — 프리미엄→무료 다운그레이드 시 sleepStillnessMinutes(D8, 무진동
    // 수면감지 임계값)를 이미 도는 중인 세션에도 즉시 반영하기 위한 경로(setFocusSessionDurationMinutes는
    // 다음 세션부터만 반영되지만, 이건 라이브 값이라 지금 바로 반영됨 — PaceOverlayService 참고).
    Function("setSleepStillnessMinutes") { minutes: Int ->
      appContext.reactContext?.let { context -> PaceOverlayService.setSleepStillnessMinutes(context, minutes) }
    }

    Function("getFocusSessionDurationMinutes") {
      appContext.reactContext?.let { context -> PaceOverlayService.getFocusSessionDurationMinutes(context) } ?: 10
    }

    // 2026-07-26 사용자 지시("무료일땐 10분 고정, 보상광고 보면 늘려줘") — Focus Session이 설정된
    // 시간이 다 돼서 자동으로 꺼졌는지 1회성 소비 확인(consumeExpired와 동일 패턴). 사용자가 직접
    // 끈 경우는 이 신호가 안 뜸.
    Function("consumeFocusSessionTimedOut") {
      PaceOverlayService.consumeFocusSessionTimedOut()
    }

    // 보상형 광고 시청 완료 후 호출 — Focus Session을 extraMinutes만큼 재개.
    Function("extendFocusSession") { extraMinutes: Int ->
      appContext.reactContext?.let { context -> PaceOverlayService.extendFocusSession(context, extraMinutes) }
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

    // 2026-07-31 사장님 지시(Saved/Favorite 오버레이 재구현) — P메뉴의 Saved/Favorite 리스트는 이제
    // JS 화면으로 이동하지 않고 네이티브 WindowManager 오버레이로 그 자리에서 뜬다(유튜브 이탈 자체가
    // PIP를 유발하는 걸 막기 위함, PACE_PROJECT_MANAGEMENT.md 참고). 이 오버레이는 RN 브릿지가 살아있단
    // 보장이 없는 시점(포그라운드 서비스에서 직접)에 떠야 하므로 SQLite(saved_videos)를 직접 열어
    // 읽고 쓴다 — user_id만은 SQLite에 없고 AsyncStorage(RN 쪽)에 있어 시점 보장을 위해 로그인/게스트
    // 진입마다 이 함수로 SharedPreferences에 미리 캐시해둔다.
    Function("cacheUserId") { userId: String ->
      appContext.reactContext?.let { context ->
        context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
          .edit().putString(PaceOverlayService.PREF_CACHED_USER_ID, userId).apply()
      }
    }

    // 2026-08-01 사장님 지시(Shorts HOT) — 위 cacheUserId와 동일한 이유. Shorts HOT은 SQLite가 아니라
    // 백엔드 REST 호출이 필요해 baseUrl+JWT를 같은 방식으로 미리 캐시해둔다(client.ts 참고).
    Function("cacheApiBaseUrl") { baseUrl: String ->
      appContext.reactContext?.let { context ->
        context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
          .edit().putString(PaceOverlayService.PREF_CACHED_API_BASE_URL, baseUrl).apply()
      }
    }

    // 2026-08-01 사용자 실기기 지적("작아진 화면 다시 키워야지 왜 새 쇼츠/홈이 보여") — 이미 실행
    // 중인 세션을 재소환할 때 Linking.openURL(딥링크/URL)로는 항상 그 URL의 intent-filter가 매핑된
    // 특정 화면(Shorts 새 진입, 또는 YouTube 기본 홈 탭)으로 새로 내비게이션돼버려서, PIP로 줄어있던
    // 기존 화면을 그대로 복원하지 못했다(웹 URL판/순수 스킴판 둘 다 실기기로 확인, supportedApps.ts
    // resumePlatformApp 주석 참고). 딥링크가 아니라 getLaunchIntentForPackage+REORDER_TO_FRONT로
    // "런처 아이콘을 다시 탭한 것"과 동일하게 기존 태스크를 그 상태 그대로 앞으로 가져온다 — 이건
    // openApp()의 기존 폴백 경로와 같은 패턴(그쪽은 Pace 자신, 이건 YouTube 등 제3자 앱 대상).
    Function("resumeThirdPartyApp") { packageName: String ->
      appContext.reactContext?.let { context ->
        try {
          val intent = context.packageManager.getLaunchIntentForPackage(packageName)
          intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
          intent?.let { context.startActivity(it) }
        } catch (e: Exception) {
          Log.w("PaceOverlayModule", "resumeThirdPartyApp($packageName) failed", e)
        }
      }
    }

    Function("cacheAuthToken") { token: String ->
      appContext.reactContext?.let { context ->
        context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
          .edit().putString(PaceOverlayService.PREF_CACHED_AUTH_TOKEN, token).apply()
      }
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
