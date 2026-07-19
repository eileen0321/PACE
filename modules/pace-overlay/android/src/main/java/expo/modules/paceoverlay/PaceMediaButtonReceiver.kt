package expo.modules.paceoverlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.KeyEvent

// 2026-07-19 PoC(실험용) — 사용자 제안 "Cheat Code 1": ACTION_MEDIA_BUTTON을 android:priority
// 최댓값으로 선점해 abortBroadcast()로 YouTube에 도달하기 전에 가로채는 방식.
// ⚠️ 검증 전 알려진 리스크: Android 5.0(API 21)부터 하드웨어 미디어 버튼은 시스템 전역 순서
// 브로드캐스트가 아니라 MediaSession 라우팅으로 전달 방식이 바뀌었고, Android 8.0(API 26)부터는
// 암시적 브로드캐스트의 매니페스트 리시버 등록이 대부분 제한됐다(이 기기 API 33) — 이 리시버가
// onReceive 자체를 못 받을 가능성이 높다고 예상하지만, "이론상 안 될 것 같다"가 아니라 실기기
// 로그로 직접 확인한다.
class PaceMediaButtonReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.d("PaceMediaButtonReceiver", "onReceive fired! action=${intent.action}")
    if (Intent.ACTION_MEDIA_BUTTON == intent.action) {
      val keyEvent = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
      Log.d("PaceMediaButtonReceiver", "keyEvent=$keyEvent")
      if (keyEvent != null && keyEvent.action == KeyEvent.ACTION_DOWN) {
        if (keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_NEXT || keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
          Log.d("PaceMediaButtonReceiver", "matched NEXT/PLAY_PAUSE — calling abortBroadcast()")
          try {
            abortBroadcast()
            Log.d("PaceMediaButtonReceiver", "abortBroadcast() succeeded")
          } catch (e: Exception) {
            Log.e("PaceMediaButtonReceiver", "abortBroadcast() failed", e)
          }
          PaceAccessibilityService.swipeOnce(true)
        }
      }
    }
  }
}
