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

    /** true면 공유 인텐트가 아니라 **클립보드**에서 URL을 읽는다(아래 onCreate 주석에 근거). */
    const val EXTRA_READ_CLIPBOARD = "pace.readClipboard"
  }

  // ⚠️ 포커스를 가진 상태에서만 유효하다 — 이 액티비티가 전면에 올라온 뒤 onCreate에서만 호출한다.
  private fun readClipboardText(): String? {
    return try {
      val cm = getSystemService(CLIPBOARD_SERVICE) as? android.content.ClipboardManager ?: return null
      val clip = cm.primaryClip ?: return null
      if (clip.itemCount <= 0) return null
      clip.getItemAt(0)?.coerceToText(this)?.toString()
    } catch (e: Exception) {
      Log.w("PaceShareCapture", "클립보드 읽기 실패", e)
      null
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val sharedText = if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
        intent.getStringExtra(Intent.EXTRA_TEXT)
      } else if (intent?.getBooleanExtra(EXTRA_READ_CLIPBOARD, false) == true) {
        // ⭐ 2026-08-05 실기기 A/B로 확정 — 유튜브 쇼츠의 공유 버튼은 **시스템 공유창을 안 띄운다.**
        //   유튜브 자체 UI(topResumedActivity가 com.google.android.youtube인 채로 뜬다)이고, 내용물은
        //   다이렉트공유 아이콘 5개 + "링크 복사" + "Quick Share"가 전부다 — **앱 목록이 아예 없고**
        //   손잡이를 끌어도 펼쳐지지 않는다(예전 코드가 기대한 "더보기" 버튼도 없다).
        //   대조군: 같은 기기에서 시스템 ACTION_SEND를 직접 쏘면 android/…ResolverActivity가 앱 그리드를
        //   정상으로 보여준다 — 즉 둘은 완전히 다른 화면이고, Pace는 유튜브 공유창엔 영영 못 뜬다.
        //   (Pace 자체는 정상 등록돼 있다: `cmd package query-activities`에 PaceShareCaptureActivity가
        //    nonLocalizedLabel=Pace로 잡힌다.)
        //
        //   그래서 경로를 바꾼다: 접근성 서비스가 "링크 복사"를 눌러 URL을 클립보드에 넣고, 이 액티비티가
        //   그걸 읽는다. ⚠️ Android 10+는 **포커스를 가진 앱이나 기본 IME만** 클립보드를 읽을 수 있어
        //   (developer.android.com/about/versions/10/privacy/changes) 접근성 서비스에서 직접은 못 읽는다.
        //   이 액티비티가 필요한 이유가 그것이다 — Translucent + noHistory라 화면 깜빡임 없이 포커스만
        //   잠깐 얻고 즉시 사라진다.
        readClipboardText()
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
