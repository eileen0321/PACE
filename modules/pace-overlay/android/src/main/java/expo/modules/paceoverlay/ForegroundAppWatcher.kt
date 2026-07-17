package expo.modules.paceoverlay

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process

// 지원 앱 목록. src/constants/supportedApps.ts와 반드시 동기화 — Kotlin이 JS 상수를 읽을 방법이
// 없어 양쪽에 각각 하드코딩한다(PACE_ARCHITECTURE.md "제품 전략 피벗" 참고). 2026-07-18: 사용자
// 지시로 healthy-shorts-assistant(2) 원본 그대로 TikTok도 복원(MVP 축소안에서 잠시 제외했었음).
object SupportedApps {
  val PACKAGES = setOf(
    "com.google.android.youtube",
    "com.instagram.android",
    "com.zhiliaoapp.musically",
  )
}

// 포그라운드 앱 감지 — UsageStatsManager 기반(AccessibilityService 아님).
//
// ⚠️ 2026-01-28부터 Google Play가 AccessibilityService API 사용 심사를 크게 강화했고, "자동화/
// 포그라운드 앱 감지 같은 접근성과 무관한 용도"는 명시적으로 반려 사유로 분류된다(웹 리서치로 확인,
// PACE_ARCHITECTURE.md 참고). 그래서 "지금 어떤 앱이 포그라운드인가"만 알아내는 이 좁은 용도는
// UsageStatsManager로 구현한다 — 이 API는애초에 스크린타임/사용량 추적 앱을 위한 정석 API라 정책
// 리스크가 없다. 실시간성은 AccessibilityService보다 떨어지지만(폴링 기반, ~1초 간격이면 충분),
// Auto Next의 실제 스와이프 제스처 디스패치는 이 API로 대체 불가 — 그건 여전히 AccessibilityService가
// 필요하고, 그 결정은 Auto Next 구현 시점에 별도로 다시 검토해야 한다.
object ForegroundAppWatcher {
  fun hasUsageAccessPermission(context: Context): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  // 최근 이벤트 윈도우 중 가장 최근 MOVE_TO_FOREGROUND의 packageName. 폴링 간격(1초) 대비 여유를 두고
  // 최근 10초 윈도우만 훑는다 — 오래된 이벤트까지 매번 다시 훑을 필요 없음.
  fun getForegroundPackage(context: Context): String? {
    val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    val begin = end - 10_000
    val events = usageStatsManager.queryEvents(begin, end)
    var lastForegroundPackage: String? = null
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
        lastForegroundPackage = event.packageName
      }
    }
    return lastForegroundPackage
  }
}
