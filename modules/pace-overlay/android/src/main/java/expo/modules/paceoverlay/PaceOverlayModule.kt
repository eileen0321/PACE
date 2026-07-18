package expo.modules.paceoverlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Expo Modules API(2026 기준 권장 패턴 — 구식 NativeModules+@ReactMethod 대신) 로컬 모듈.
// JS 쪽 바인딩은 modules/pace-overlay/index.ts, 상위 서비스 인터페이스는
// src/services/platform/overlayService.android.ts(OverlayService)와 1:1 대응.
// PACE_ARCHITECTURE.md "Android Overlay 네이티브 POC" 섹션 참고 — 아직 npx expo prebuild +
// EAS Dev Client로 실기기 빌드 검증 전인 POC 코드다.
class PaceOverlayModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaceOverlay")

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

    AsyncFunction("start") { remainingMinutes: Int, autoNextEnabled: Boolean ->
      appContext.reactContext?.let { context ->
        PaceOverlayService.start(context, remainingMinutes, autoNextEnabled)
      }
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

    // 네이티브 카운트다운(PaceOverlayService.tickRunnable)이 0에 도달해 스스로 세션을 차단했는지
    // 확인 — 읽는 즉시 false로 리셋(1회성 소비). JS가 앱 포그라운드 복귀 시(AppState 'active')
    // 호출해서 DB 세션 기록/알림 등 백그라운드 JS 타이머로는 더 이상 처리할 수 없는 후속 작업을
    // 뒤늦게(eventually-consistent) 마무리한다 — PaceOverlayService.kt 상단 주석 참고.
    Function("consumeExpired") {
      val expired = appContext.reactContext?.let { context ->
        val prefs = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        val wasExpired = prefs.getBoolean(PaceOverlayService.PREF_EXPIRED, false)
        if (wasExpired) prefs.edit().putBoolean(PaceOverlayService.PREF_EXPIRED, false).apply()
        wasExpired
      } ?: false
      expired
    }

    // Auto Next 실제 스와이프(PaceAccessibilityService, 2026-07-18) — ⚠️ Play 스토어 정책 리스크
    // (PACE_ARCHITECTURE.md 참고): "사용자 대신 스와이프"는 AccessibilityService 심사에서 "접근성
    // 목적이 아닌 남용"으로 리젝될 수 있다. 사용자 결정(2026-07-18): 코드는 완성해두되 스토어 제출
    // 시 활성화 여부는 EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드 플래그로 별도 결정(autoNextService.android.ts).
    Function("hasAccessibilityPermission") {
      appContext.reactContext?.let { context -> PaceAccessibilityService.isEnabled(context) } ?: false
    }

    Function("requestAccessibilityPermission") {
      appContext.reactContext?.let { context ->
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
      }
    }

    AsyncFunction("startAutoNextWatching") { intervalMs: Int ->
      PaceAccessibilityService.startWatching(intervalMs.toLong())
    }

    AsyncFunction("stopAutoNextWatching") {
      PaceAccessibilityService.stopWatching()
    }
  }
}
