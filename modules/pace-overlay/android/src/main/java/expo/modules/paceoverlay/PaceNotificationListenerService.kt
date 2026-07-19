package expo.modules.paceoverlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ComponentName
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.service.notification.NotificationListenerService
import android.util.Log

// 2026-07-19 PoC(실험용, 아직 프로덕션 경로 아님) — 사용자 제안: 하드웨어 미디어 버튼을 가로챌 순
// 없지만(실기기 검증 완료: YouTube가 오디오 포커스/포그라운드를 다 뺏겨도 여전히 버튼을 먼저 받음),
// NotificationListenerService + MediaSessionManager.getActiveSessions()로 "관찰 + 명령"은 가능할
// 수 있다는 가설. MEDIA_CONTENT_CONTROL(시스템 전용 권한)과 달리 알림 접근 권한(사용자가 설정에서
// 직접 승인)만으로 getActiveSessions() 호출 자격이 생긴다 — 이 서비스 자체가 그 "알림 접근 컴포넌트"
// 역할. adb 브로드캐스트로 list/next/prev/pause를 직접 호출해 실기기에서 YouTube Shorts가
// skipToNext()에 실제로 반응하는지 검증하는 용도 — 검증되면 정식 native module 경로로 옮긴다.
class PaceNotificationListenerService : NotificationListenerService() {

  private var testReceiver: BroadcastReceiver? = null
  private var mediaButtonReceiver: BroadcastReceiver? = null

  override fun onListenerConnected() {
    super.onListenerConnected()
    Log.d("PaceMediaController", "onListenerConnected — notification access granted, registering test receiver")
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.getStringExtra("cmd")) {
          "list" -> logActiveSessions()
          "next" -> sendCommand { it.transportControls.skipToNext() }
          "prev" -> sendCommand { it.transportControls.skipToPrevious() }
          "pause" -> sendCommand { it.transportControls.pause() }
          "play" -> sendCommand { it.transportControls.play() }
        }
      }
    }
    val filter = IntentFilter("com.pace.app.TEST_MEDIACONTROLLER")
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(receiver, filter)
    }
    testReceiver = receiver

    // 2026-07-19 PoC 2단계 — 웹 검색으로 나온 미검증 변수: 매니페스트 등록(PaceMediaButtonReceiver)은
    // Android 8+ 암시적 브로드캐스트 제한으로 실패했지만, 런타임 registerReceiver()는 그 제한을
    // 안 받는다는 정보가 있어 별도로 검증. ACTION_MEDIA_BUTTON 자체가 API 21+부터 MediaSession
    // 라우팅으로 완전히 대체돼 시스템이 이 브로드캐스트를 아예 안 보낼 가능성이 높다고 예상하지만,
    // "안 될 것 같다"가 아니라 로그로 직접 확인한다.
    val mbReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        Log.d("PaceMediaButtonReceiver", "[RUNTIME] onReceive fired! action=${intent.action}")
        val keyEvent = intent.getParcelableExtra<android.view.KeyEvent>(Intent.EXTRA_KEY_EVENT)
        Log.d("PaceMediaButtonReceiver", "[RUNTIME] keyEvent=$keyEvent")
      }
    }
    val mbFilter = IntentFilter(Intent.ACTION_MEDIA_BUTTON)
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(mbReceiver, mbFilter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(mbReceiver, mbFilter)
    }
    mediaButtonReceiver = mbReceiver
    Log.d("PaceMediaButtonReceiver", "[RUNTIME] dynamic ACTION_MEDIA_BUTTON receiver registered")
  }

  override fun onListenerDisconnected() {
    testReceiver?.let { unregisterReceiver(it) }
    testReceiver = null
    mediaButtonReceiver?.let { unregisterReceiver(it) }
    mediaButtonReceiver = null
    super.onListenerDisconnected()
  }

  private fun getYoutubeController(): MediaController? {
    val manager = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    val component = ComponentName(this, PaceNotificationListenerService::class.java)
    val sessions = try {
      manager.getActiveSessions(component)
    } catch (e: SecurityException) {
      Log.e("PaceMediaController", "getActiveSessions denied — notification access not granted?", e)
      return null
    }
    Log.d("PaceMediaController", "getActiveSessions() found ${sessions.size} controller(s)")
    return sessions.firstOrNull { it.packageName == "com.google.android.youtube" }
  }

  private fun logActiveSessions() {
    val manager = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    val component = ComponentName(this, PaceNotificationListenerService::class.java)
    val sessions = try {
      manager.getActiveSessions(component)
    } catch (e: SecurityException) {
      Log.e("PaceMediaController", "getActiveSessions denied — notification access not granted?", e)
      return
    }
    if (sessions.isEmpty()) {
      Log.d("PaceMediaController", "no active sessions found")
      return
    }
    sessions.forEach { c ->
      val meta = c.metadata
      val title = meta?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE)
      val actions = c.playbackState?.actions
      Log.d(
        "PaceMediaController",
        "session pkg=${c.packageName} playbackState=${c.playbackState?.state} title=$title actions=$actions " +
          "(SKIP_NEXT=${actions?.and(android.media.session.PlaybackState.ACTION_SKIP_TO_NEXT) != 0L})"
      )
    }
  }

  private fun sendCommand(action: (MediaController) -> Unit) {
    val controller = getYoutubeController()
    if (controller == null) {
      Log.w("PaceMediaController", "no YouTube controller found — cannot send command")
      return
    }
    Log.d("PaceMediaController", "sending command to YouTube controller (state before=${controller.playbackState?.state})")
    action(controller)
  }
}
