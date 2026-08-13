package expo.modules.paceoverlay

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

// 2026-07-31 사장님 지시(Favorite/Capture) — 유튜브 Shorts는 URL 주소창이 없는 몰입형 플레이어라
// 접근성 트리만으로는 실제 영상 링크(videoId)를 못 읽는다. 원래 설계: 이 액티비티를 ACTION_SEND
// (text/plain) 대상으로 등록해두고, 유튜브의 "공유" → 시스템 공유시트에서 "Pace"를 눌러 실제 공유
// 텍스트를 받는다.
//
// ⭐ 2026-08-05 실기기 A/B로 확정 — **그 경로는 이제 동작하지 않는다.** 유튜브 쇼츠의 공유 버튼은
//   시스템 공유창을 안 띄운다(topResumedActivity가 com.google.android.youtube인 채로 유튜브 자체 UI가
//   뜬다). 내용물은 다이렉트공유 아이콘 5개 + "링크 복사" + "Quick Share"가 전부이고 **앱 목록이 없다.**
//   같은 기기에서 시스템 ACTION_SEND를 직접 쏘면 android/…ResolverActivity가 앱 그리드를 정상 표시하므로
//   둘은 완전히 다른 화면이다. 게다가 "링크 복사"는 접근성 트리에 아예 노출되지 않아 우리가 대신
//   눌러줄 수도 없다(전 창 탐색·flagIncludeNotImportantViews까지 시도해 확인).
//
//   → 그래서 **사용자가 직접** 공유 → 링크 복사를 하고, 우리는 클립보드에서 결과만 받는다
//     (EXTRA_READ_CLIPBOARD 경로). ACTION_SEND 경로는 다른 기기/OEM이나 유튜브가 되돌릴 경우를 위해 유지한다.
//
// 투명 테마 + noHistory(AndroidManifest.xml)라 화면 깜빡임 없이 포커스만 잠깐 얻고 즉시 사라진다.
class PaceShareCaptureActivity : Activity() {

  companion object {
    // 호출부가 실행 직전에 등록해둔다. 결과를 전달한 뒤 즉시 비운다 — 재사용 방지.
    var pendingCallback: ((sharedText: String?) -> Unit)? = null

    /** true면 공유 인텐트가 아니라 **클립보드**에서 URL을 읽는다. */
    const val EXTRA_READ_CLIPBOARD = "pace.readClipboard"

    /** 읽기가 끝나면 이 패키지를 다시 앞으로 가져온다(예: 유튜브). 없으면 복귀하지 않는다. */
    const val EXTRA_RETURN_TO_PACKAGE = "pace.returnToPackage"

    /** 복귀 요청 — 이 액티비티가 아니라 **오래 사는 서비스**가 지연 후 수행한다(위 deliver 주석의 근거). */
    var onReturnRequested: ((packageName: String) -> Unit)? = null
  }

  // 클립보드 읽기를 기다리는 중인지 — onCreate에서 세우고 onWindowFocusChanged(true)에서 소비한다.
  private var awaitingClipboard = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    // 공유 인텐트로 들어온 경우는 여기서 끝난다(텍스트가 인텐트에 있으므로 포커스와 무관).
    if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
      val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
      Log.d("PaceShareCapture", "received sharedText=" + sharedText)
      deliver(sharedText)
      return
    }
    if (intent?.getBooleanExtra(EXTRA_READ_CLIPBOARD, false) == true) {
      // ⚠️ 2026-08-05 실기기 — onCreate에서 클립보드를 읽으면 **항상 null**이었다
      //   (로그: "received sharedText=null"). Android 10+의 클립보드 제한은 "포커스를 가진 앱"만
      //   허용하는데, onCreate 시점엔 액티비티가 생성만 됐을 뿐 아직 포커스가 없다.
      //   포커스는 onWindowFocusChanged(true)에서 온다 — 읽기를 그쪽으로 미룬다.
      awaitingClipboard = true
      return
    }
    deliver(null)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (!hasFocus || !awaitingClipboard) return
    awaitingClipboard = false
    val text = readClipboardText()
    Log.d("PaceShareCapture", "clipboard(focused)=" + text)
    deliver(text)
  }

  // ⚠️ 포커스를 가진 상태에서만 유효하다 — onWindowFocusChanged(true) 이후에만 호출한다.
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

  private fun deliver(text: String?) {
    try {
      pendingCallback?.invoke(text)
    } catch (e: Exception) {
      Log.e("PaceShareCapture", "콜백 예외", e)
    } finally {
      pendingCallback = null
      // ⚠️ 2026-08-05 사장님 지적("Pace가 갑자기 열리는데 정상이라고?") — 아니다. 클립보드를 읽으려면
      //   포커스가 필요해 이 액티비티가 잠깐 앞으로 나오는 건 맞지만, 그 뒤 **사용자를 유튜브에
      //   돌려놓지 않은 건 그냥 버그다.**
      //   ⚠️ 1차 시도(여기서 곧바로 startActivity + finish)는 **실기기에서 안 먹혔다** — 저장 직후
      //     topResumedActivity가 여전히 com.strides7.pace/.MainActivity였다. finish()가 바로 뒤따르면
      //     시스템이 우리 태스크를 다시 앞으로 되돌리기 때문이다.
      //     → 복귀는 **오래 사는 PaceOverlayService**가 약간의 지연 뒤에 수행한다(returnToPackage 콜백).
      val back = intent?.getStringExtra(EXTRA_RETURN_TO_PACKAGE)
      if (!back.isNullOrBlank()) onReturnRequested?.invoke(back)
      onReturnRequested = null
      // 🔴 2026-08-14 사장님 지적("유튜브에서 favorite 누르면 왜 앱 홈으로 갔다가 다시 유튜브로 가는데") —
      //   finish()만 하면 우리 태스크(taskAffinity="")가 남아, 시스템이 그 다음으로 **Pace의
      //   MainActivity 태스크**를 앞으로 올린다. 위 콜백이 700ms 뒤 유튜브를 다시 띄우기 전까지
      //   그 화면이 그대로 보인다 — 그게 사장님이 보신 "앱 홈"이다.
      //   → 태스크째로 없앤다. 그러면 시스템이 **직전에 앞에 있던 태스크(유튜브)**로 바로 돌아가
      //     중간 화면이 아예 안 생긴다. 위 콜백은 안전망으로 남긴다(기기별 복귀 선택 차이 대비).
      runCatching { finishAndRemoveTask() }.getOrElse { finish() }
      // 이 액티비티가 뜨고 사라지는 전환 애니메이션까지 없애 "번쩍임"을 최소화한다.
      @Suppress("DEPRECATION")
      overridePendingTransition(0, 0)
    }
  }
}
