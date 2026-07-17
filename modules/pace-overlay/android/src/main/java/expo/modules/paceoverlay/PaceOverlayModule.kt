package expo.modules.paceoverlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
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
    Function("requestOverlayPermission") {
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}")
      ).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
      context.startActivity(intent)
    }

    AsyncFunction("start") { remainingMinutes: Int, autoNextEnabled: Boolean ->
      val context = appContext.reactContext ?: return@AsyncFunction
      PaceOverlayService.start(context, remainingMinutes, autoNextEnabled)
    }

    AsyncFunction("updateRemaining") { remainingMinutes: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction
      PaceOverlayService.updateRemaining(context, remainingMinutes)
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction
      PaceOverlayService.stop(context)
    }
  }
}
