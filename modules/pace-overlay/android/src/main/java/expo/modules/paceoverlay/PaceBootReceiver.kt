package expo.modules.paceoverlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

// 2026-07-25 BOOT_COMPLETED 복구(B3, PACE_PROJECT_MANAGEMENT.md 참고) — 세션이 활성 중(remainingMinutes
// 카운트다운 진행 중)일 때 기기가 재부팅되면, AlarmManager에 등록해둔 다음 틱 알람(PaceTickReceiver
// 경유, scheduleNextTick)이 재부팅과 함께 시스템에 의해 전부 취소된다. 그러면 SharedPreferences엔
// "세션 활성" 상태가 여전히 true로 남아있는데, 그걸 이어갈 알람도 포그라운드 서비스도 더 이상 없어
// 사용자가 Pace를 직접 열기 전까지는 조용히 방치된다 — 그 사이엔 아무 집행도 안 일어남.
//
// ⚠️ 범위를 명확히 좁힘(중요): 이 리시버가 고치는 건 "재부팅 시점에 이미 진행 중이던 세션의 복구"
// 뿐이다. "그날 세션을 한 번도 시작 안 했으면 유튜브를 써도 전혀 감지가 안 된다"는 문제는 재부팅과
// 무관하게 이 앱의 기존 설계 자체다 — Daily Limit 추적은 전부 overlayService.startSession()(사용자가
// 홈 화면에서 "YouTube with PACE" 등을 탭해야 시작됨)에 묶여 있고, 재부팅 여부와 상관없이 세션을
// 시작한 적이 없으면 애초에 추적할 것이 없다(PaceOverlayService에 상시 백그라운드 감시 루프가 따로
// 없음, statsRepository.getTodayUsageMinutes()도 viewing_sessions 테이블만 집계 — UsageStatsManager
// 전체 사용량이 아님). 이 상시 감시는 완전히 별개의 신규 기능(제품 결정 필요) — 여기서 임의로 만들지
// 않음. 자세한 내용은 PACE_PROJECT_MANAGEMENT.md §6 2026-07-25 로그 참고.
//
// 복구 방법: PaceOverlayService.onStartCommand의 intent==null 분기(PaceOverlayService.kt 745줄 주석
// 참고)를 그대로 재사용한다 — 원래 "프로세스가 SIGKILL 등으로 죽은 뒤 시스템이 START_STICKY로 즉시
// 재기동한 경우"를 위해 이미 있던 경로로, restoreIfNeeded()가 SharedPreferences에서 상태를 복구하고
// ensureInfraReady()로 인프라(오버레이/폴링/미디어세션 등)를 다시 세팅한 뒤 scheduleNextTick()으로
// 다음 알람만 재예약한다 — performTick()을 부르지 않으므로 재부팅 자체로 시간이 깎이지 않는다. 세션이
// 활성이 아니었으면(PREF_SESSION_ACTIVE==false) restoreIfNeeded()가 false를 반환하고 서비스가 즉시
// stopSelf()하므로 이 리시버는 사실상 아무 부작용이 없다 — action을 아예 지정하지 않는다(null).
class PaceBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

    // ⚠️ 권한 방어(사용자 지시 — "권한 없이 뭔가 시작하려다 조용히 실패/크래시하는 게 지금 gap보다
    // 나쁘다"): 세션이 활성이었어도, 그 사이 사용자가 "다른 앱 위에 표시" 권한을 껐으면 오버레이
    // 창(showOverlay)이 SecurityException을 던질 수 있다. overlayService.android.ts:40의
    // hasOverlayPermission() 체크와 동일한 기준을 여기서도 먼저 확인 — 없으면 아무것도 시작하지
    // 않고 조용히 리턴한다(세션 자체는 SharedPreferences에 그대로 남아있으니, 사용자가 Pace를 열면
    // 기존 로직대로 처리됨 — 이 리시버가 못 하면 그냥 기존과 동일한 "앱을 열어야 재개" 상태일 뿐,
    // 더 나빠지지 않는다).
    val hasOverlayPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(context)
    } else {
      true
    }
    if (!hasOverlayPermission) {
      Log.i("PaceBootReceiver", "BOOT_COMPLETED: overlay permission not granted, skipping session resume")
      return
    }

    // PaceTickReceiver와 동일한 표준 패턴 — 브로드캐스트 처리 중 CPU가 잠들지 않게 짧게 wake lock을
    // 잡아 startService() 뒤 onStartCommand가 실행될 창을 보장한다.
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Pace:BootWakeLock")
    wakeLock.acquire(10_000L)
    try {
      Log.i("PaceBootReceiver", "BOOT_COMPLETED received, attempting session resume via PaceOverlayService")
      // action을 지정하지 않음(null) — onStartCommand의 null 분기(=프로세스 부활 복구 경로)를 그대로 탄다.
      // BOOT_COMPLETED는 Android의 백그라운드 서비스 시작 제한에서 명시적으로 예외로 허용되는
      // 브로드캐스트라 startForegroundService()를 여기서 바로 불러도 안전하다 — 다만 이 코드베이스의
      // 기존 관례(PaceTickReceiver)를 그대로 따라 startService()로 통일한다(서비스 쪽
      // ensureInfraReady()가 즉시 startForeground()를 호출해 5초 제한 안에 포그라운드로 승격한다).
      context.startService(Intent(context, PaceOverlayService::class.java))
    } catch (e: Exception) {
      // 세션이 없으면(restoreIfNeeded()==false) 서비스가 stopSelf()로 정상 종료하므로 여기서 예외가
      // 날 일은 거의 없지만, OEM 스킨의 백그라운드 시작 제한 등으로 던질 가능성을 기존 코드 전반의
      // 방어적 스타일(예: foregroundPollRunnable, requestAccessibilityPermission)과 동일하게 삼킨다 —
      // 리시버가 죽으면 재부팅마다 로그에 크래시가 쌓이는 게 지금 gap보다 나쁘다.
      Log.w("PaceBootReceiver", "startService failed on BOOT_COMPLETED", e)
    } finally {
      if (wakeLock.isHeld) wakeLock.release()
    }
  }
}
