package expo.modules.paceoverlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager

// 2026-07-19 사용자 지적("Sleep 등 예외처리")에 대한 대응 — 기존 tickRunnable은
// Handler.postDelayed(메인 스레드 타이머)라 기기가 Doze(장시간 화면 꺼짐+정지)에 들어가면 지연되거나
// 프로세스가 죽으면 아예 멈춘다. AlarmManager.setAndAllowWhileIdle()로 예약한 알람은 Doze 유지보수
// 윈도우에도 반드시 깨어나 이 리시버를 호출하고, 프로세스가 죽어있었다면 시스템이 새로 살려서
// 호출한다 — PaceOverlayService.ACTION_TICK이 상태를 SharedPreferences에서 복구해 이어간다.
//
// SCHEDULE_EXACT_ALARM 같은 특수 권한이 필요한 setExactAndAllowWhileIdle() 대신 setAndAllowWhileIdle()을
// 쓴다 — "정확히 60.000초"가 중요한 게 아니라 "Doze에서도 결국 깨어나 이어간다"가 핵심이라, 권한 요청
// UX 부담 없이 같은 강건성을 얻을 수 있다(Doze 유지보수 윈도우 안에서 소폭 지연될 수 있음은 감수).
class PaceTickReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    // 브로드캐스트 처리 중 짧게라도 CPU가 다시 잠들지 않도록 — startService() 호출 자체는 즉시
    // 반환되지만, 그 뒤 서비스의 onStartCommand가 실행될 아주 짧은 창을 보장하기 위한 표준 패턴.
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Pace:TickWakeLock")
    wakeLock.acquire(10_000L) // 10초 상한 — 혹시라도 release 누락 시 배터리 누수 방지
    try {
      val serviceIntent = Intent(context, PaceOverlayService::class.java).apply {
        action = PaceOverlayService.ACTION_TICK
      }
      context.startService(serviceIntent)
    } finally {
      if (wakeLock.isHeld) wakeLock.release()
    }
  }
}
