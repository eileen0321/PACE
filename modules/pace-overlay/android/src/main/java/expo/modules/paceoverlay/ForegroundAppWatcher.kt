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
    // TikTok 한국 리전 설치본의 실제 패키지명 — 실기기(한국 리전) 검증 중 발견: 위
    // com.zhiliaoapp.musically(글로벌 패키지명)만 등록돼 있으면 이 기기에서 앱 실행 자체는
    // 정상이지만 ForegroundAppWatcher가 포그라운드 패키지를 못 알아봐 오버레이가 전혀 안 뜬다
    // (2026-07-18, src/constants/supportedApps.ts와 동기화).
    "com.ss.android.ugc.trill",
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

  // 마지막으로 확인된 포그라운드 패키지 + 그 시점의 커서(다음 조회 시작점) — 폴링마다 유지.
  // 인스턴스 상태가 아니라 object(싱글턴) 상태라 서비스가 재시작되면(onDestroy 후 재생성) 자동
  // 초기화된다.
  private var lastKnownForegroundPackage: String? = null
  private var cursor: Long = 0L

  // ⚠️ 실기기 검증 중 발견한 버그(2026-07-18): MOVE_TO_FOREGROUND는 "앱 전환이 일어난 순간"에만
  // 한 번 발생하는 전이(edge-triggered) 이벤트지, "지금 이 앱이 포그라운드다"를 매초 계속 알려주는
  // 신호가 아니다. 처음엔 최근 10초 윈도우만 훑었는데, 사용자가 YouTube Shorts 한 화면에 10초
  // 넘게 머무르기만 해도(스와이프 안 하고 그냥 시청) 윈도우 안에 새 전이 이벤트가 없어 null을
  // 반환 — 오버레이가 아직 YouTube를 보고 있는데도 사라지는 실버그로 실기기에서 재현 확인됨.
  // 고정 윈도우 크기를 아무리 늘려도 "그보다 오래 한 화면에 머무르면" 같은 버그가 재발하므로,
  // 윈도우 크기에 의존하지 않는 증분(incremental) 방식으로 교체 — 마지막으로 조회한 시점(cursor)
  // 이후의 새 이벤트만 훑고, 새 MOVE_TO_FOREGROUND가 없으면 마지막으로 알려진 값을 그대로 유지한다
  // (그게 "다음 전이가 오기 전까진 여전히 유효한 현재 상태"라는 UsageEvents의 실제 의미이므로).
  fun getForegroundPackage(context: Context): String? {
    val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    // 최초 호출(cursor==0)이면 최근 2분만 소급 조회 — 그 이전 히스토리는 어차피 지금 상태와 무관.
    val begin = if (cursor == 0L) end - 120_000 else cursor
    val events = usageStatsManager.queryEvents(begin, end)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
        lastKnownForegroundPackage = event.packageName
      }
    }
    cursor = end
    return lastKnownForegroundPackage
  }
}
