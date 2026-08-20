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
  // 리모컨 키가 이 시간 안에 들어온 적 있으면 "연결됨"으로 본다. 넉넉히 잡는다 —
  // 리모컨은 눌러야 신호가 나므로 짧게 잡으면 잠깐 안 누른 사이 회색으로 돌아간다.
  private val REMOTE_ALIVE_WINDOW_MS = 6L * 60L * 60L * 1000L // 6시간

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
        // 2026-08-01 사용자 지시("더 단축할순 없어?") — ACCESSIBILITY_DETAILS_SETTINGS(위 함수)와
        // 달리 사용정보 접근은 signature 권한 없이도 data=package: URI로 앱 상세 토글 화면에 바로
        // 갈 수 있다는 게 AOSP에 문서화돼 있다(서드파티도 됨) — 접근성처럼 항상 막히는 게 아니라
        // OEM에 따라 다를 수 있어 try로 감싸고, 실패하면 일반 목록 + 안내 토스트로 폴백한다.
        val activity = appContext.currentActivity
        val directIntent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
          data = Uri.parse("package:${context.packageName}")
          if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        try {
          (activity ?: context).startActivity(directIntent)
        } catch (e: RuntimeException) {
          Log.w("PaceOverlayModule", "requestUsageAccessPermission: direct per-app intent failed, falling back to list", e)
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
          val fallbackIntent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
            if (activity == null) flags = Intent.FLAG_ACTIVITY_NEW_TASK
          }
          try {
            (activity ?: context).startActivity(fallbackIntent)
          } catch (fallbackError: RuntimeException) {
            Log.e("PaceOverlayModule", "requestUsageAccessPermission: fallback also failed", fallbackError)
          }
        }
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

    // 오버레이 서비스가 실제로 살아있는지(session_active=true인데 프로세스가 죽은 상태 판별용).
    Function("isOverlayServiceAlive") {
      PaceOverlayService.isServiceAlive()
    }

    // 오버레이 권한(SYSTEM_ALERT_WINDOW) 회수 1회성 신호 — 위 접근성과 동일 패턴.
    Function("consumeOverlayRevoked") {
      PaceOverlayService.consumeOverlayRevoked()
    }

    // Auto Next 실제 스와이프(PaceAccessibilityService, 2026-07-18) — ⚠️ Play 스토어 정책 리스크
    // (PACE_ARCHITECTURE.md 참고): "사용자 대신 스와이프"는 AccessibilityService 심사에서 "접근성
    // 목적이 아닌 남용"으로 리젝될 수 있다. 사용자 결정(2026-07-18): 코드는 완성해두되 스토어 제출
    // 시 활성화 여부는 EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드 플래그로 별도 결정(autoNextService.android.ts).
    // 2026-08-02 — "설정에 켜져 있음"과 "실제로 동작함"은 다르다. 프로세스가 죽으면 시스템이 서비스를
    // 다시 바인딩하지 않는데 설정 문자열은 그대로 남아, 그동안 앱은 이 상태를 정상으로 오판했다
    // (PaceAccessibilityService.isAlive 주석 참고). 두 조건을 모두 만족해야 true — 그래야 홈의
    // 접근성 경고 배너가 실제 고장 상태에서 떠서 사용자가 다시 켤 수 있다.
    Function("hasAccessibilityPermission") {
      appContext.reactContext?.let { context ->
        // 2026-08-04 — isAlive() → isAliveOrRebinding(). 이 값이 false면 Focus 탭의 블루투스/손짓
        // 토글이 막히고 사용자를 접근성 설정으로 보내는데, 재바인딩 공백(수 초)에 걸리면 "이미 켜져
        // 있는데 계속 설정으로만 보내는" 상태가 된다(사장님 실기기 신고). 상세 근거는
        // PaceAccessibilityService.isAliveOrRebinding 주석.
        PaceAccessibilityService.isEnabled(context) && PaceAccessibilityService.isAliveOrRebinding()
      } ?: false
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
        // 2026-08-01 사용자 지시("설정하면 바로 PACE로 와야 한다고 말했을 텐데") — 지금 이 순간(설정
        // 화면으로 나가기 직전) 시각을 저장해둔다. PaceAccessibilityService.onServiceConnected()가
        // 이 시각으로부터 일정 시간 안에 불리면 "방금 여기서 연 설정에서 사용자가 직접 토글을 켰다"로
        // 판단해 자동으로 Pace를 앞으로 가져온다(위 PREF_ACCESSIBILITY_REQUEST_AT_MS 선언부 참고).
        context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE).edit()
          .putLong(PaceOverlayService.PREF_ACCESSIBILITY_REQUEST_AT_MS, System.currentTimeMillis()).apply()
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

    // 2026-08-07 사용자 지시 — Favorite 리스트 "이어서 재생" 옵트인 토글. settings.tsx의
    // favoriteAutoChain 변경 시 호출(overlayService.android.ts 경유).
    Function("setFavoriteAutoChainEnabled") { enable: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setFavoriteAutoChainEnabled(context, enable) }
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

    // 2026-08-02 사장님 지시("focus off 누르면 광고 볼래/크레딧 쓸래 팝업") — 그 팝업을 쇼츠 위
    // 네이티브 오버레이로 띄우려면 네이티브가 크레딧 잔액을 알아야 한다(크레딧은 JS 스토어에만 존재).
    // isPremium과 동일한 JS→네이티브 푸시.
    // 2026-08-03 — 쇼츠 위 보상광고(PaceRewardedAdActivity)가 실광고 유닛을 쓸지 테스트 유닛을 쓸지는
    // JS 빌드 플래그(EXPO_PUBLIC_USE_REAL_ADS)로 정해지는데 네이티브는 그 값을 모른다. 이 값을 안 밀면
    // 기본값 false로 출시 빌드에서도 테스트 광고만 나간다(출시 전 검증에서 실제로 그 상태였음).
    // 2026-08-03 — 통계 화면의 "오늘 사용 시간"을 알약과 같은 기준(실제 재생 중이었던 시간)으로
    // 맞추기 위해 네이티브가 누적한 값을 JS로 넘긴다(PaceOverlayService.watchedSeconds 주석 참고).
    // 2026-08-03 사장님 지시 — 분석 화면에서 "유튜브 앱을 켜둔 시간"과 "Pace가 기록한 시간"을
    // 나란히 보여주기 위한 값(ForegroundAppWatcher.supportedAppForegroundSecondsToday 주석 참고).
    // 권한이 없거나 조회 실패면 0 → 호출부가 해당 섹션을 아예 숨긴다.
    Function("getSupportedAppForegroundSecondsToday") {
      appContext.reactContext?.let { context ->
        ForegroundAppWatcher.supportedAppForegroundSecondsToday(context)
      } ?: 0
    }

    Function("getWatchedSeconds") {
      appContext.reactContext?.let { context -> PaceOverlayService.watchedSeconds(context) } ?: 0
    }

    // 2026-08-04 — UMP 동의 결과를 네이티브 보상형 광고에 전달(PaceRewardedAdActivity 주석 참고).
    Function("setAdsConsent") { canRequestAds: Boolean, personalized: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setAdsConsent(context, canRequestAds, personalized) }
    }

    Function("setUseRealAds") { useRealAds: Boolean ->
      appContext.reactContext?.let { context -> PaceOverlayService.setUseRealAds(context, useRealAds) }
    }

    Function("setAvailableCredits") { credits: Int ->
      appContext.reactContext?.let { context -> PaceOverlayService.setAvailableCredits(context, credits) }
    }

    // 네이티브 팝업에서 크레딧으로 연장했을 때 "얼마 썼는지"를 JS가 1회성으로 회수해 실제 스토어
    // 잔액을 차감한다(잔액의 진실원천은 JS) — consumeExpired류와 같은 소비-once 패턴.
    Function("consumePendingCreditSpend") {
      appContext.reactContext?.let { context -> PaceOverlayService.consumePendingCreditSpend(context) } ?: 0
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
      // 2026-08-10 — 플래그가 prefs로 옮겨가면서(PaceOverlayService.PREF_FOCUS_TIMED_OUT_PENDING)
      // Context가 필요해졌다. reactContext가 없는 순간(브릿지 정리 중)엔 소비하지 않고 false —
      // 플래그는 prefs에 남아 있으므로 다음 호출에서 그대로 살아난다(예전 메모리 방식과 달리 안 잃는다).
      appContext.reactContext?.let { context -> PaceOverlayService.consumeFocusSessionTimedOut(context) } ?: false
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
      // 🔴 2026-08-13 사장님 지적("블루투스 연결돼 있는데 집중에서 파란불이 안 들어온다, 동작도 하는데") —
      //   위 getConnectedBluetoothAudioDevice는 **오디오 기기(A2DP/SCO)만** 본다. 리모컨/셔터는
      //   HID 입력기기라 오디오 목록에 영원히 안 잡힌다 → 실제로 눌러서 넘어가는데도 "연결 안 됨"이었다.
      //   어댑터를 직접 조회하려면 Android 12+에서 BLUETOOTH_CONNECT 런타임 권한이 필요해 **새 권한
      //   프롬프트**가 생긴다. 그 대신 이미 갖고 있는 **관측 증거**를 쓴다 — 리모컨이 키를 보낸 적이
      //   있으면 그건 추정이 아니라 연결됐다는 직접 증거다.
      //   prefs에 남긴 벽시계 시각을 본다 — 메모리 값만 보면 접근성 서비스가 재시작될 때마다
      //   (앱 업데이트/프로세스 재시작) 초기화돼 실제로는 연결돼 있는데 회색으로 돌아간다.
      val lastRemoteKeyAt = prefs?.getLong(PaceOverlayService.PREF_LAST_REMOTE_KEY_AT, 0L) ?: 0L
      // 🔴 2026-08-14 사장님 지적("블루투스 전원 꺼도 초록불 켜져 있는데 맞아?") — **틀렸다.**
      //   위 remoteRecentlyUsed는 "최근 6시간 안에 리모컨 키가 왔는가"만 재므로, 리모컨을 끄거나
      //   블루투스를 꺼도 6시간 동안 초록불이 유지됐다. UI가 말하는 "연결됨"과 이 값이 재는
      //   "최근에 썼음"은 다른 정보다.
      //
      //   ⚠️ 처음엔 BluetoothAdapter.isEnabled를 AND로 걸려 했으나 그것도 임시방편이다 —
      //     **리모컨만 꺼도 어댑터는 켜져 있으니** 여전히 초록불이 남는다.
      //   → 웹 조사(Android 공식 InputDevice/InputManager 문서) 결과 **권한 없이** 정확히 알 수 있다:
      //     리모컨/셔터는 HID 입력기기라 `InputDevice.getDeviceIds()` 목록에 잡히고, **연결이 끊기면
      //     목록에서 사라진다.** 키가 왔을 때 저장해 둔 descriptor(재연결·재부팅에도 안정적이라고
      //     문서가 명시)가 지금 목록에 있는지만 보면 된다.
      //     BLUETOOTH_CONNECT 같은 새 권한이 전혀 필요 없다(545행 주석이 피하려던 그 프롬프트).
      val remoteDescriptor = prefs?.getString(PaceOverlayService.PREF_REMOTE_DEVICE_DESCRIPTOR, null)
      val remoteStillAttached = remoteDescriptor != null && runCatching {
        android.view.InputDevice.getDeviceIds().any { id ->
          android.view.InputDevice.getDevice(id)?.descriptor == remoteDescriptor
        }
      }.getOrDefault(false)
      // 🔴 2026-08-14(3차) 사장님 실측 — "맨 처음에 앱 실행하고 리모컨 전원 켜니까 초록불 안 나옴,
      //   그 뒤로는 됨." 정확한 진단이다. 위 descriptor는 **리모컨 키가 한 번 와야** 저장되므로
      //   (PaceAccessibilityService.onKeyEvent) 설치 후 처음 연결한 순간에는 항상 null → 회색이다.
      //   그런데 그 순간에도 리모컨은 이미 HID 입력기기로 붙어 있다(실측: dumpsys input에
      //   IsExternal:true 1개, BT STATE_CONNECTED).
      //   → 키 입력을 기다리지 말고 **지금 붙어 있는 입력기기 목록에서 직접 찾는다.**
      //     ⚠️ InputDevice.isExternal()은 @hide라 앱에서 못 쓴다. 공개 API만으로 내장 버튼과
       //       가르는 기준:
      //         · 가상 기기가 아니고(!isVirtual)
      //         · 키보드 소스를 가지며(SOURCE_KEYBOARD — 리모컨은 볼륨키를 보낸다)
      //         · VID/PID가 0이 아니다 — 내장 gpio_keys/qpnp_pon류는 0으로 보고되고
      //           블루투스 HID는 실제 벤더/제품 ID를 싣는다.
      //     처음 한 번은 무엇을 보고 판단했는지 로그로 남긴다(기기마다 다를 수 있어 실측용).
      val externalRemoteAttached = runCatching {
        android.view.InputDevice.getDeviceIds().any { id ->
          val dev = android.view.InputDevice.getDevice(id) ?: return@any false
          val isKeyboardish = (dev.sources and android.view.InputDevice.SOURCE_KEYBOARD) != 0
          val hasHardwareId = dev.vendorId != 0 || dev.productId != 0
          val match = !dev.isVirtual && isKeyboardish && hasHardwareId
          if (match) Log.i("PaceOverlay", "BT 리모컨 후보 감지 — name=${dev.name} vid=${dev.vendorId} pid=${dev.productId} desc=${dev.descriptor}")
          match
        }
      }.getOrDefault(false)
      // 🔴 2026-08-14(2차) 사장님 재신고 "블루투스 전원 안 들어가 있는데 초록색인데" — **여전히
      //   초록이었다.** 바로 위 descriptor 판정은 정확하지만, descriptor는 "이 빌드에서 리모컨 키가
      //   한 번이라도 온" 뒤에야 생긴다(PaceAccessibilityService onKeyEvent에서 저장). 그 전에는
      //   여기 6시간 폴백이 그대로 돌아서 **리모컨을 꺼도 6시간 동안 초록**이라는 원래 증상이
      //   고스란히 남아 있었다 — 고쳤다고 적어둔 바로 그 버그가 실기기에선 안 고쳐진 상태.
      //   실측(01:05): 리모컨 전원 OFF인데 초록. 같은 순간 `dumpsys input`에 외부 입력기기가
      //   **하나도 없었다**(전부 IsExternal:false = 내장 버튼). 연결 안 됨이 명백한데 화면은
      //   연결됐다고 말했다.
      // → 시간 기반 폴백을 **없앤다.** descriptor를 모르면 "연결됐다"고 주장하지 않는다(회색).
      //   업그레이드 직후 첫 한 번은 회색이지만 리모컨을 한 번 누르는 순간 descriptor가 잡혀 그
      //   뒤로는 항상 정확하다. 이 점은 "리모컨이 실제로 붙어 있나"를 보려고 만든 표시이므로
      //   (2026-08-13 사장님 지시), 모르면서 초록을 켜는 것보다 모른다고 말하는 쪽이 옳다.
      // descriptor를 이미 아는 경우가 가장 정확하고(그 리모컨 하나를 특정한다), 모르면 위 하드웨어
      // 판별로 답한다 — 둘 다 "지금 붙어 있나"를 재는 값이라 시간 폴백처럼 늦게까지 남지 않는다.
      val remoteRecentlyUsed = remoteStillAttached || externalRemoteAttached
      mapOf(
        // 🔴 2026-08-14 사장님 지적("우리 블루투스 리모컨은 오디오 거르게 되어 있잖아. 오디오
        //   블루투스면 연결이 되어 있어도 회색이어야 하지 않아?") — 맞다. 여기가 `오디오 기기 연결
        //   OR 리모컨 붙음`이라, **이어폰만 연결해도 초록**이었다. 이 점이 붙어 있는 행은
        //   "블루투스 리모컨"이고, 이 표시를 만든 목적 자체가 "리모컨이 실제로 붙어 있나"다
        //   (2026-08-13 사장님 지시) — 오디오 기기는 그 질문의 답이 아니다.
        //   오디오 항이 원래 있었던 이유는 리모컨을 감지할 방법이 없던 시절의 대용품이었는데,
        //   이제 descriptor로 리모컨을 직접 확인하므로 대용품은 필요 없고 오탐만 남는다.
        //   deviceName(표시용 이름)은 오디오 정보를 그대로 두되, 연결 판정에서는 뺀다.
        "isConnected" to remoteRecentlyUsed,
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

    // 🔴 2026-08-10 사장님 지시(쇼츠 검색) — 검색은 Railway 백엔드가 아니라 **Vercel 프록시**를 친다
    //   (YOUTUBE_PROXY_URL, /api/youtube-shorts · /api/search-presets). 두 개는 **서로 다른 호스트**라
    //   위 cacheApiBaseUrl로는 알 수 없어서 별도로 밀어준다.
    //   왜 프록시인가: 검색을 YouTube Data API(search.list)로 하면 **100 units/회 = 하루 100회**라
    //   앱 전체가 오전에 멈춘다. 프록시는 검색 페이지 스크래핑이라 쿼터를 안 쓰고, 같은 검색어는
    //   CDN에 캐시된다(실측 X-Vercel-Cache HIT).
    Function("cacheProxyBaseUrl") { proxyUrl: String ->
      appContext.reactContext?.let { context ->
        context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
          .edit().putString(PaceOverlayService.PREF_CACHED_PROXY_BASE_URL, proxyUrl).apply()
      }
    }

    // 2026-08-01 사용자 실기기 지적("작아진 화면 다시 키워야지 왜 새 쇼츠/홈이 보여") — 이미 실행
    // 중인 세션을 재소환할 때 Linking.openURL(딥링크/URL)로는 항상 그 URL의 intent-filter가 매핑된
    // 특정 화면(Shorts 새 진입, 또는 YouTube 기본 홈 탭)으로 새로 내비게이션돼버려서, PIP로 줄어있던
    // 기존 화면을 그대로 복원하지 못했다(웹 URL판/순수 스킴판 둘 다 실기기로 확인, supportedApps.ts
    // resumePlatformApp 주석 참고). 딥링크가 아니라 getLaunchIntentForPackage+REORDER_TO_FRONT로
    // "런처 아이콘을 다시 탭한 것"과 동일하게 기존 태스크를 그 상태 그대로 앞으로 가져온다 — 이건
    // openApp()의 기존 폴백 경로와 같은 패턴(그쪽은 Pace 자신, 이건 YouTube 등 제3자 앱 대상).
    // 2026-08-05 — 위 resumeThirdPartyApp을 "쓸지 말지"를 JS가 가르기 위한 판별.
    // true면 사용자가 PIP로 줄여둔 창이 실제로 남아 있다는 뜻 = 복원이 옳다.
    // false면 복원할 게 없어 런처 인텐트가 유튜브 홈을 새로 열게 되므로, JS가 정상 진입
    // (openShortsFeed)으로 돌려야 한다. 근거는 PaceAccessibilityService.isPackageInPictureInPicture 주석.
    Function("isThirdPartyAppInPip") { packageName: String ->
      PaceAccessibilityService.isPackageInPictureInPicture(packageName)
    }

    Function("resumeThirdPartyApp") { packageName: String ->
      // 2026-08-02 진단 로그 — 사용자가 "Open App 누르면 다시 쇼츠로 튕긴다"고 보고했는데, 실기기
      // 로그로 튕기는 시점의 시그니처(REORDER_TO_FRONT, 새 START 없음)가 이 함수와 정확히 일치하는
      // 걸 확인했다. 이 함수는 JS onSelectPlatform(세션 running 중 카드 재탭)에서만 불리는데 사용자는
      // 카드를 안 눌렀다고 함 — 재현 시 이 로그로 정확히 언제/몇 번 불렸는지 확정한다.
      Log.i("PaceOverlayModule", "resumeThirdPartyApp($packageName) called")
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

    // 2026-08-04 사장님 지적("쇼츠 with PACE는 각자 폰의 유튜브 앱 쇼츠 누른 것과 같아야 유튜브
    // 개인 알고리즘을 타는 거 아냐") — 정확한 지적이었고, 실기기 비교로 확인했다.
    //
    // 기존에는 `https://www.youtube.com/shorts`(영상 ID 없는 URL)를 열었는데, 그건 **Shorts 탭이
    // 아니라 홈 탭 컨텍스트에서 쇼츠 하나**를 트는 것이었다. 실기기 스크린샷 비교:
    //   우리 URL          → 하단 네비 "홈" 선택 상태, 판다 영상
    //   vnd.youtube://shorts → 역시 "홈" 선택 상태 (후보였으나 실패)
    //   Shorts 탭 직접 탭  → 하단 네비 "Shorts" 선택 상태, 전혀 다른 영상
    // 즉 사용자가 앱에서 Shorts를 누를 때 보는 그 개인화 피드와 다른 경로였다.
    //
    // 공개 문서에는 Shorts 탭 딥링크가 없다(웹 검색으로 확인). 그래서 기기에 설치된 유튜브 APK의
    // 인텐트 필터를 직접 덤프해서(`dumpsys package com.google.android.youtube`) 유튜브가 스스로
    // 등록해둔 전용 액션을 찾았다:
    //   Action: "com.google.android.youtube.action.open.shorts"  (Shell$HomeActivity가 처리)
    // 실기기 실행 결과 하단 네비 "Shorts"가 선택된 진짜 Shorts 탭 피드로 진입하는 것을 확인했다.
    //
    // ⚠️ 이건 공개 API가 아니라 유튜브 앱 내부 액션이라 언젠가 사라질 수 있다 — 실패하면 false를
    // 돌려주고 호출부(constants/supportedApps.ts)가 기존 URL 방식으로 폴백한다.
    // 2026-08-04 사장님 지시("주소 변환 방식을 백엔드에 두고 업데이트를 하든") — 액션 문자열을
    // 하드코딩하지 않고 JS가 넘겨준다. JS는 그 값을 서버(api/shorts-entry.ts)에서 받으므로,
    // 유튜브가 액션 이름을 바꾸거나 없애도 **서버만 고치면 설치된 앱이 즉시 따라간다**(스토어 심사
    // 불필요). 인자가 없으면 검증된 기본값을 쓴다(구버전 JS 호환).
    Function("openYouTubeShortsFeed") { action: String?, packageName: String? ->
      appContext.reactContext?.let { context ->
        try {
          val intent = Intent(action ?: "com.google.android.youtube.action.open.shorts").apply {
            setPackage(packageName ?: "com.google.android.youtube")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          // 처리할 액티비티가 없으면(유튜브 미설치/구버전/액션 제거) 여기서 예외 → 폴백.
          context.startActivity(intent)
          true
        } catch (e: Exception) {
          Log.w("PaceOverlayModule", "openYouTubeShortsFeed failed — falling back to URL", e)
          false
        }
      } ?: false
    }

    /**
     * 🔴 2026-08-15 — URL을 **유튜브 앱으로 직행**시켜 연다(App Link 라우팅 우회).
     *
     * JS의 `Linking.openURL`은 패키지를 지정할 방법이 없어서, 안드로이드가 매번 "이 https URL을
     * 어느 앱이 처리할지"를 결정하는 라우팅 단계를 탄다. 유튜브가 죽어 있는 콜드 상태에서 그
     * 단계가 몇 초를 먹는다 — 실측으로 **6초 넘게 완전한 검은 화면**이었다(QA_FULL_TEST US25의
     * 실측 표 참고. `setPackage`를 붙이면 1초 내 표시로 바뀌고 Shorts 세로 화면도 그대로 유지된다).
     *
     * 네이티브 오버레이(P 메뉴)의 재생 경로 4곳은 Kotlin에서 직접 `setPackage`를 붙여 고쳤는데,
     * **집중 탭의 보관함만 JS(`focus.tsx` onOpenSaved)에서 열어서** 그 수정이 닿지 않았다.
     * 그 한 곳을 위해 같은 동작을 JS에도 열어준다.
     *
     * @return 열었으면 true. false면 호출부가 기존 `Linking.openURL`로 폴백한다
     *         (유튜브 미설치/비활성 — 그땐 느리더라도 열리는 게 낫다).
     */
    Function("openUrlInYouTube") { url: String ->
      appContext.reactContext?.let { context ->
        try {
          context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            setPackage("com.google.android.youtube")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          })
          true
        } catch (e: Exception) {
          Log.w("PaceOverlayModule", "openUrlInYouTube failed — JS가 Linking으로 폴백", e)
          false
        }
      } ?: false
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

    // 🔴 2026-08-20 — 네이티브 세션(포그라운드 서비스)이 **지금 살아있는가**.
    // _layout.tsx의 고아 세션 복구가 살아있는 세션을 죽이고 새로 시작하던 버그 수정용
    // (PaceOverlayService.isServiceAlive 주석에 실기기 로그 근거 있음).
    Function("isNativeSessionRunning") {
      PaceOverlayService.isServiceAlive()
    }
  }
}
