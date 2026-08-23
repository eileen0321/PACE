package expo.modules.paceoverlay

import android.app.Activity
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.PrepareGetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.CredentialOption
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.Promise
import java.util.concurrent.Executors

/**
 * 🔴 2026-08-22 사장님 지적("틱톡처럼 바텀시트로 띄우던가 니가 팝업으로 띄워서 그런거 아냐?") — 맞았다.
 *
 * 증상: 라이트 모드 기기에서 로그인을 누르면 하단 내비게이션 키가 흰색이 됐다가 회색으로 남았다.
 * 처음엔 "구글 소유 화면이라 못 고친다"고 답했는데, 그건 **그 앞단계를 안 본 답**이었다.
 * 실제로 같은 폰에서 비교 측정한 결과:
 *   - PACE(레거시 경로): com.google.android.gms/.common.account.AccountPickerActivity
 *     → 화면 가운데 흰 **다이얼로그** + 뒤를 덮는 딤이 하단 바까지 먹어 39% 회색 띠가 남는다.
 *   - 틱톡(Credential Manager 경로): 흰 **바텀시트**가 화면 맨 아래까지 이어진다.
 *     하단 바 픽셀은 99% 흰색으로 PACE보다 더 밝은데도, 시트의 연장으로 보여서 깨져 보이지 않는다.
 * 즉 색이 문제가 아니라 **어떤 UI를 띄우느냐**가 문제였고, 그건 우리가 고르는 것이다.
 *
 * 왜 여기서 직접 구현하나:
 *   설치된 @react-native-google-signin(무료 Original)은 play-services-auth만 의존하고
 *   `GoogleSignin`(레거시) 하나만 export한다. 바텀시트를 띄우는 `GoogleOneTapSignIn`은 주석에만
 *   언급되고 실제로는 **유료 Universal Sign In 모듈**에 있다(node_modules에서 확인).
 *   유료 모듈이 감싸는 것도 결국 아래와 같은 공식 androidx.credentials API라, 같은 일을
 *   이 모듈에서 직접 한다.
 *
 * ⚠️ 두 단계 호출이 정상이다(구글 공식 권장 패턴):
 *   1) filterByAuthorizedAccounts=true — 이미 이 앱에 로그인한 적 있는 계정만. 틱톡이 보여준
 *      "다시 로그인" 시트가 이것이고, 탭 한 번으로 끝나 가장 매끄럽다.
 *   2) 1)이 NoCredentialException이면(=처음 로그인) filterByAuthorizedAccounts=false로 재호출해
 *      기기의 모든 구글 계정을 보여준다.
 *   JS(auth/google.ts)가 이 순서를 담당한다 — 네이티브는 요청받은 대로만 띄운다.
 */
object PaceGoogleSignIn {
  private const val TAG = "PaceGoogleSignIn"

  // 콜백 실행용. 로그인은 자주 일어나지 않으므로 요청마다 단발 스레드를 쓰지 않고 공용 풀 하나를 둔다.
  private val executor = Executors.newSingleThreadExecutor()

  /**
   * 🔴 2026-08-23 사장님 지적("바텀시트 뜨기 전에 흰색 하단키가 잠깐 보였음") — 실측했다.
   *   탭 후 0.35초 시점의 topResumedActivity가 이미
   *   `com.google.android.gms/.identitycredentials.ui.SignInCredentialChooserActivity`이고
   *   하단바는 96% 흰색이다. 즉 **시트 창은 떴는데 내용이 아직 안 그려진** 구간이고, 30fps
   *   프레임 계수로 약 0.8초였다. 그 창은 GMS 소유라 테마를 못 씌운다.
   *   → 줄이는 유일한 방법은 **미리 준비**다. Credential Manager의 prepareGetCredential은
   *     자격증명 조회를 미리 끝내두는 공식 API로, UI가 뜨는 지연을 줄이는 것이 목적이다.
   *     로그인 화면이 뜰 때 준비를 걸어두고, 사용자가 버튼을 누르면 그 핸들로 바로 UI를 연다.
   *   ⚠️ 준비가 실패하거나 아직 안 끝났으면 그냥 평소 경로로 간다 — 최적화일 뿐 필수 경로가 아니다.
   */
  @Volatile private var preparedHandle: PrepareGetCredentialResponse.PendingGetCredentialHandle? = null
  @Volatile private var preparedForMode: String? = null

  fun prepare(activity: Activity, serverClientId: String, mode: String) {
    if (serverClientId.isBlank()) return
    try {
      val request = GetCredentialRequest.Builder().addCredentialOption(buildOption(serverClientId, mode)).build()
      CredentialManager.create(activity).prepareGetCredentialAsync(
        request,
        null,
        executor,
        object : CredentialManagerCallback<PrepareGetCredentialResponse, GetCredentialException> {
          override fun onResult(result: PrepareGetCredentialResponse) {
            preparedHandle = result.pendingGetCredentialHandle
            preparedForMode = mode
            Log.i(TAG, "prepareGetCredential 완료 mode=$mode")
          }
          override fun onError(e: GetCredentialException) {
            preparedHandle = null; preparedForMode = null
            Log.i(TAG, "prepareGetCredential 실패(무시하고 평소 경로) mode=$mode: ${e.message}")
          }
        }
      )
    } catch (e: Exception) {
      Log.w(TAG, "prepareGetCredential 시작 실패(무시)", e)
    }
  }

  private fun buildOption(serverClientId: String, mode: String): CredentialOption = when (mode) {
    "button" -> GetSignInWithGoogleOption.Builder(serverClientId).build()
    else -> GetGoogleIdOption.Builder()
      .setServerClientId(serverClientId)
      .setFilterByAuthorizedAccounts(mode == "authorized")
      .setAutoSelectEnabled(false)
      .build()
  }

  /**
   * mode (JS가 이 순서로 시도한다 — 앞이 실패하면 다음으로)
   *  - "authorized" : GetGoogleIdOption(filter=true). 이 앱에 로그인한 적 있는 계정만.
   *                   **바텀시트**로 뜨고 탭 한 번이면 끝난다. 가장 매끄러운 경로.
   *  - "all"        : GetGoogleIdOption(filter=false). 기기의 모든 구글 계정. 역시 바텀시트.
   *  - "button"     : GetSignInWithGoogleOption. 위 둘이 다 안 될 때의 최후 수단.
   *                   이 기기(Android 13)에서는 **가운데 카드**로 떴다.
   *
   * 🔴 2026-08-23 — 한 번 "all"을 뺐다가 되살렸다. 뺀 이유는 실기기에서 계정이 3개인데도
   *   NoCredentialException("No credentials available")이 났기 때문인데, 같은 시각 로그에
   *   기기 자체의 구글 인증이 깨져 있는 흔적이 있었다:
   *     E AuthPII: [RequestTokenManager] getToken() -> BAD_AUTHENTICATION. App: com.android.vending
   *     W Auth   : [ChimeraGetToken] exception ... app=com.google.android.gsf
   *   (알림에도 "s7.reviewer@gmail.com 계정을 계속 사용하려면 로그인하세요"가 떠 있었다)
   *   즉 NO_CREDENTIAL이 API의 정상 동작이 아니라 **그 기기의 일시적 인증 불량**일 수 있다.
   *   한 번의 실패로 경로를 없애면 정상 기기에서 더 나은 UI(바텀시트)를 영영 못 쓰게 되므로,
   *   비용이 없는 중간 단계로 남긴다 — 실패해도 다음 단계로 흘러갈 뿐이다.
   *   ⚠️ 기기 인증이 정상인 상태에서 "all"이 바텀시트를 띄우는지 아직 재확인 못 했다.
   */
  /**
   * 🔴 2026-08-23 "시트 색과 하단키 색이 안 맞는다" — **실험으로 종결. 다시 시도하지 말 것.**
   *   픽셀 실측: 시트 본문 rgb(246,250,255) / 하단바 rgb(254,255,255). 이음매는 실재한다.
   *   그 하단바가 우리 창인지 확인하려고, 시트를 띄우기 직전에 우리 Activity의
   *   navigationBarColor를 시트 본문 색(#F6FAFF)으로 칠하고 WindowInsetsControllerCompat으로
   *   light nav bar까지 켜본 뒤 재측정했다 → **하단바는 rgb(254,255,255) 그대로였다.**
   *   즉 그 영역은 우리 창이 아니라 GMS 시트 창(SignInCredentialChooserActivity)이 그린다.
   *   시트 배경도 같은 창이라 마찬가지로 못 바꾼다. 효과 없던 틴트 코드는 제거했다.
   *
   *   비교(같은 폰, 같은 라이트 모드):
   *     틱톡 시트 rgb(245,250,255) / 하단바 rgb(254,255,255)
   *     PACE 시트 rgb(246,250,255) / 하단바 rgb(254,255,255)
   *   → 틱톡도 동일한 이음매를 갖는다. 앱이 손댈 수 있는 차이가 아니다.
   *   (#F6FAFF의 푸른 기는 Material You가 기기 배경화면에서 뽑는 surface 색이라 기기마다 다르다)
   */

  fun signIn(activity: Activity, serverClientId: String, mode: String, promise: Promise) {
    if (serverClientId.isBlank()) {
      promise.reject("NO_CLIENT_ID", "serverClientId가 비어 있다", null)
      return
    }
    try {
      val request = GetCredentialRequest.Builder().addCredentialOption(buildOption(serverClientId, mode)).build()
      val cm = CredentialManager.create(activity)

      val callback = object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
          override fun onResult(result: GetCredentialResponse) {
            try {
              val credential = result.credential
              if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
              ) {
                val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                val idToken = googleCredential.idToken
                if (idToken.isNullOrBlank()) {
                  promise.reject("NO_ID_TOKEN", "자격증명은 받았는데 idToken이 비어 있다", null)
                  return
                }
                promise.resolve(idToken)
              } else {
                // 구글 ID 토큰이 아닌 자격증명(패스키/비밀번호 등)이 돌아온 경우 — 요청에 구글 옵션만
                // 넣었으므로 정상 흐름에서는 오지 않지만, 오면 JS가 레거시 경로로 폴백하게 한다.
                promise.reject("UNEXPECTED_CREDENTIAL", "예상하지 못한 자격증명 타입: ${credential.type}", null)
              }
            } catch (e: Exception) {
              Log.w(TAG, "자격증명 파싱 실패", e)
              promise.reject("PARSE_FAILED", e.message ?: "자격증명 파싱 실패", e)
            }
          }

          override fun onError(e: GetCredentialException) {
            // 각 케이스를 JS가 구분할 수 있게 코드를 나눠서 돌려준다.
            //  - CANCELLED: 사용자가 시트를 닫음 → 조용히 종료(에러 팝업 띄우지 말 것)
            //  - NO_CREDENTIAL: 이 앱에 로그인한 적 있는 계정이 없음 → JS가 filter=false로 재시도
            //  - 그 외: Play 서비스 문제 등 → JS가 레거시 경로로 폴백
            val code = when (e) {
              is GetCredentialCancellationException -> "CANCELLED"
              is NoCredentialException -> "NO_CREDENTIAL"
              else -> "CREDENTIAL_MANAGER_FAILED"
            }
            Log.i(TAG, "getCredential 실패 code=$code mode=$mode: ${e.message}")
            promise.reject(code, e.message ?: code, e)
          }
      }

      // 미리 준비된 핸들이 이 mode 것이면 그걸로 연다 — 시트가 훨씬 빨리 그려져 흰 하단바 구간이 줄어든다.
      // 핸들은 1회용이므로 쓰고 나면 비운다.
      val handle = if (preparedForMode == mode) preparedHandle else null
      preparedHandle = null; preparedForMode = null
      if (handle != null) {
        Log.i(TAG, "준비된 핸들로 UI 오픈 mode=$mode")
        cm.getCredentialAsync(activity, handle, null, executor, callback)
      } else {
        cm.getCredentialAsync(activity, request, null, executor, callback)
      }
    } catch (e: Exception) {
      // CredentialManager.create()나 요청 빌드 단계에서의 실패(구버전 기기, GMS 미설치 등).
      Log.w(TAG, "Credential Manager 시작 실패", e)
      promise.reject("CREDENTIAL_MANAGER_UNAVAILABLE", e.message ?: "Credential Manager 사용 불가", e)
    }
  }
}
