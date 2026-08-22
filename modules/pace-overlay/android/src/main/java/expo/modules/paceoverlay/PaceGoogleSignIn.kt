package expo.modules.paceoverlay

import android.app.Activity
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
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
   * mode
   *  - "authorized" : GetGoogleIdOption(filter=true). 이 앱에 로그인한 적 있는 계정만.
   *                   틱톡이 보여준 "다시 로그인" 시트로, 탭 한 번이면 끝난다.
   *  - "button"     : GetSignInWithGoogleOption. **"Sign in with Google 버튼을 눌렀을 때"** 쓰라고
   *                   구글이 지정한 옵션으로, 계정 선택 바텀시트를 **항상** 띄운다.
   *
   * 🔴 2026-08-22 실기기에서 확인한 것 — 처음엔 GetGoogleIdOption(filter=false)로 "기기의 모든 계정"을
   *   띄우려 했는데, 계정이 3개나 있는 기기에서도 NoCredentialException("No credentials available")이
   *   났다. GetGoogleIdOption은 **자동/원탭용**이라 조건이 안 맞으면 그냥 없다고 답한다.
   *   버튼을 눌러 들어온 첫 로그인에는 GetSignInWithGoogleOption을 써야 한다.
   *   → JS는 "authorized"로 먼저 시도하고, NO_CREDENTIAL이면 "button"으로 넘어간다.
   */
  fun signIn(activity: Activity, serverClientId: String, mode: String, promise: Promise) {
    if (serverClientId.isBlank()) {
      promise.reject("NO_CLIENT_ID", "serverClientId가 비어 있다", null)
      return
    }
    try {
      val option: CredentialOption = if (mode == "button") {
        GetSignInWithGoogleOption.Builder(serverClientId).build()
      } else {
        GetGoogleIdOption.Builder()
          .setServerClientId(serverClientId)
          .setFilterByAuthorizedAccounts(true)
          // 자동 선택은 끈다 — 사용자가 계정을 눈으로 확인하고 누르게 한다(계정 오선택 방지).
          .setAutoSelectEnabled(false)
          .build()
      }

      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

      CredentialManager.create(activity).getCredentialAsync(
        activity,
        request,
        null,
        executor,
        object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
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
      )
    } catch (e: Exception) {
      // CredentialManager.create()나 요청 빌드 단계에서의 실패(구버전 기기, GMS 미설치 등).
      Log.w(TAG, "Credential Manager 시작 실패", e)
      promise.reject("CREDENTIAL_MANAGER_UNAVAILABLE", e.message ?: "Credential Manager 사용 불가", e)
    }
  }
}
