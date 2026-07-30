package expo.modules.paceoverlay

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

// 2026-07-31 사장님 지시(Favorite/Capture) — 유튜브 Shorts는 URL 주소창이 없는 몰입형 플레이어라
// 접근성 트리만으로는 실제 영상 링크(videoId)를 못 읽는다. 표준 해법: 이 액티비티를 ACTION_SEND
// (text/plain) 대상으로 매니페스트에 등록해두고, PaceAccessibilityService가 유튜브의 "동영상 공유"
// 버튼을 눌러 시스템 공유시트를 띄운 뒤 그 목록에서 "Pace"를 찾아 클릭하면, 안드로이드가 실제 공유
// 텍스트(영상 URL 포함)를 여기로 그대로 전달한다 — 유튜브 UI 내부 구조가 버전마다 바뀌어도 깨지지
// 않는 공식 Intent 계약에 기반한 방법이라 findNodeByContentDesc류 휴리스틱보다 훨씬 견고하다.
// 투명 테마(android:theme, AndroidManifest.xml) + noHistory로 화면 깜빡임 없이 즉시 처리 후 사라진다.
class PaceShareCaptureActivity : Activity() {

  companion object {
    // PaceAccessibilityService가 공유 버튼을 누르기 직전에 이 콜백을 등록해둔다. onCreate가
    // 호출되면 그 콜백에 공유 텍스트를 전달하고 즉시 비운다 — 재사용 방지.
    var pendingCallback: ((sharedText: String?) -> Unit)? = null
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val sharedText = if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
        intent.getStringExtra(Intent.EXTRA_TEXT)
      } else {
        null
      }
      Log.d("PaceShareCapture", "received sharedText=$sharedText")
      pendingCallback?.invoke(sharedText)
    } catch (e: Exception) {
      Log.e("PaceShareCapture", "onCreate 예외", e)
      pendingCallback?.invoke(null)
    } finally {
      pendingCallback = null
      finish()
    }
  }
}
