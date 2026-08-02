package expo.modules.paceoverlay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback

// 2026-08-02 사장님 지시("쇼츠 오버레이 상태 focus off일 때 누르면 광고 창 띄우는 걸로 해라,
// 앱으로 가는 시나리오 만들지 말고") — 기존에는 FOCUS OFF 배지를 누르면 openApp()으로 Pace 앱
// (홈 화면)을 띄우고 거기서 RN 모달로 광고를 보여줬다. 사용자 입장에선 쇼츠를 보다가 난데없이
// 다른 앱으로 튕겨나가는 흐름이라 나빴고, 실제로 홈으로 온 뒤 모달이 안 뜨는 회귀까지 겹쳤다.
//
// 이 액티비티는 "보이지 않는 껍데기"다: 완전 투명 테마 + noHistory + excludeFromRecents로
// 화면에 자기 자신을 그리지 않고, 오직 보상형 광고(전면)를 띄우는 용도로만 잠깐 존재한다.
// 광고가 닫히면 즉시 finish()하므로 사용자는 "쇼츠 위에 광고가 떴다가 닫히고 쇼츠로 돌아왔다"로
// 느낀다 — Pace 앱 화면은 한 번도 보이지 않는다.
//
// ⚠️ 광고 SDK는 반드시 Activity 컨텍스트가 있어야 전면 광고를 띄울 수 있다(Service/오버레이 창에서
// 직접 불가). 그래서 "앱으로 가지 않는" 요구를 만족시키는 유일한 방법이 이 투명 Activity다.
class PaceRewardedAdActivity : Activity() {

  companion object {
    private const val TAG = "PaceRewardedAd"
    // JS(services/ads/rewardedAd.ts)가 쓰는 것과 동일한 규칙을 네이티브에도 심는다. 실 단위는
    // 출시 빌드에서만 쓰고 평소엔 구글 공식 테스트 단위 — 자기 폰에서 실 광고를 반복 시청하면
    // AdMob invalid traffic(계정 정지) 위험이 있다는 기존 원칙 그대로.
    private const val REAL_UNIT_ID = "ca-app-pub-3201481146134957/5534238136"
    private const val TEST_UNIT_ID = "ca-app-pub-3940256099942544/5224354917"
    const val EXTRA_EXTEND_MINUTES = "extendMinutes"
    // JS가 부팅 시 밀어주는 값(EXPO_PUBLIC_USE_REAL_ADS) — 네이티브는 이 플래그를 스스로 모른다.
    const val PREF_USE_REAL_ADS = "use_real_ads"

    fun start(context: Context, extendMinutes: Int) {
      val intent = Intent(context, PaceRewardedAdActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
        putExtra(EXTRA_EXTEND_MINUTES, extendMinutes)
      }
      context.startActivity(intent)
    }
  }

  private var extendMinutes = 5
  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    extendMinutes = intent?.getIntExtra(EXTRA_EXTEND_MINUTES, 5) ?: 5
    val prefs = getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
    val unitId = if (prefs.getBoolean(PREF_USE_REAL_ADS, false)) REAL_UNIT_ID else TEST_UNIT_ID

    RewardedAd.load(this, unitId, AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
      override fun onAdFailedToLoad(error: LoadAdError) {
        // 광고가 안 뜨는 건 사용자 잘못이 아니므로 벌주지 않는다 — 조용히 닫고, 사용자가 다시
        // 시도할 수 있게 한다(연장은 주지 않음: 광고를 실제로 못 봤으므로).
        Log.w(TAG, "rewarded ad load failed: ${error.code} ${error.message}")
        PaceOverlayService.showAdFailedToast(applicationContext)
        finishOnce()
      }

      override fun onAdLoaded(ad: RewardedAd) {
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
          override fun onAdDismissedFullScreenContent() = finishOnce()
          override fun onAdFailedToShowFullScreenContent(error: com.google.android.gms.ads.AdError) {
            Log.w(TAG, "rewarded ad show failed: ${error.code} ${error.message}")
            PaceOverlayService.showAdFailedToast(applicationContext)
            finishOnce()
          }
        }
        ad.show(this@PaceRewardedAdActivity) {
          // 보상 획득 — Focus Session을 extendMinutes만큼 연장한다. extendFocusSession이 내부에서
          // 워처 재시작 + 마감시각 저장 + 토스트 + 원래 보던 앱으로 복귀까지 담당한다.
          Log.i(TAG, "reward earned -> extendFocusSession($extendMinutes)")
          PaceOverlayService.extendFocusSession(applicationContext, extendMinutes)
        }
      }
    })
  }

  private fun finishOnce() {
    if (finished) return
    finished = true
    finish()
    // 이 액티비티는 화면을 그리지 않으므로 전환 애니메이션도 없어야 자연스럽다(쇼츠 위에 광고만
    // 떴다 사라진 것처럼 보이게).
    overridePendingTransition(0, 0)
  }
}
