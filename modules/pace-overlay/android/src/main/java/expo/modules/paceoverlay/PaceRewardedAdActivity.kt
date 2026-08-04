package expo.modules.paceoverlay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
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
    // 2026-08-04 출시 전 광고 감사 — 아래 로드가 AdRequest.Builder().build()로만 나가서 **사용자 동의를
    // 전혀 반영하지 않고 있었다**. UMP 동의는 JS(services/ads/adsConsent.ts)만 알고 네이티브는 모르는데,
    // 그 값을 밀어주는 배선이 없었던 것. 결과적으로 EEA 사용자가 개인화를 거부해도 이 네이티브 광고는
    // 개인화로 요청됐다(정책 위반 소지). use_real_ads와 동일한 경로로 JS가 부팅 시 밀어준다.
    const val PREF_ADS_CAN_REQUEST = "ads_can_request"
    const val PREF_ADS_PERSONALIZED = "ads_personalized"

    // 2026-08-04 사장님 지적("광고 로딩이 느려") — 예전엔 사용자가 "광고 보고 5분 더"를 누른 **그 순간**
    // RewardedAd.load()를 시작해서, 네트워크 왕복이 끝날 때까지 아무것도 안 보이는 상태로 기다려야 했다.
    // 구글 문서도 "지연을 줄이려면 미리 로드하라"고 명시한다(배너는 정책상 사전 로드 금지지만 보상형은
    // 권장). 선택 팝업이 뜨는 순간(showExtendChoiceOverlay) 미리 받아두면, 실제로 누를 때는 이미 준비돼
    // 있어 즉시 재생된다.
    @Volatile private var preloadedAd: RewardedAd? = null
    @Volatile private var preloadedAtMs = 0L
    @Volatile private var preloading = false
    // 구글 보상형 광고는 로드 후 약 1시간이면 만료된다 — 만료 직전 것을 쓰면 show가 실패하므로
    // 넉넉히 앞당겨 폐기하고 새로 받는다.
    private const val PRELOAD_TTL_MS = 45 * 60 * 1000L

    private fun adUnitId(context: Context): String {
      val prefs = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      return if (prefs.getBoolean(PREF_USE_REAL_ADS, false)) REAL_UNIT_ID else TEST_UNIT_ID
    }

    // 동의를 못 받았으면 요청 자체를 하지 않는다(EEA에서 동의 없는 요청은 정책 위반). 개인화 여부는
    // JS가 판단해 밀어준 값을 그대로 따른다 — 판단 전(기본값)에는 안전한 비개인화로 나간다.
    private fun buildAdRequest(context: Context): AdRequest? {
      val prefs = context.getSharedPreferences(PaceOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
      // 기본값 true — JS가 아직 안 밀어준 구버전 상태에서 광고가 아예 안 나가는 회귀를 막는다
      // (동의가 필요한 지역이면 JS가 false를 밀어준다).
      if (!prefs.getBoolean(PREF_ADS_CAN_REQUEST, true)) return null
      val builder = AdRequest.Builder()
      if (!prefs.getBoolean(PREF_ADS_PERSONALIZED, false)) {
        // 구글 공식 방식 — AdMobAdapter에 npa=1 extra를 실어 비개인화로 요청한다.
        val extras = Bundle().apply { putString("npa", "1") }
        builder.addNetworkExtrasBundle(com.google.ads.mediation.admob.AdMobAdapter::class.java, extras)
      }
      return builder.build()
    }

    /** 선택 팝업이 뜰 때 미리 불러둔다(PaceOverlayService.showExtendChoiceOverlay에서 호출). */
    fun preload(context: Context) {
      if (preloading) return
      if (preloadedAd != null && System.currentTimeMillis() - preloadedAtMs < PRELOAD_TTL_MS) return
      val request = buildAdRequest(context) ?: return
      preloading = true
      RewardedAd.load(context.applicationContext, adUnitId(context), request, object : RewardedAdLoadCallback() {
        override fun onAdFailedToLoad(error: LoadAdError) {
          preloading = false
          preloadedAd = null
          // 실패해도 조용히 둔다 — 사용자가 실제로 누르면 그때 다시 로드하는 기존 경로가 살아있다.
          Log.i(TAG, "preload failed (will load on demand): ${error.code} ${error.message}")
        }

        override fun onAdLoaded(ad: RewardedAd) {
          preloading = false
          preloadedAd = ad
          preloadedAtMs = System.currentTimeMillis()
          Log.i(TAG, "preload ready")
        }
      })
    }

    /** 미리 받아둔 광고를 1회성으로 꺼낸다(만료됐으면 버리고 null). */
    private fun takePreloaded(): RewardedAd? {
      val ad = preloadedAd ?: return null
      preloadedAd = null
      if (System.currentTimeMillis() - preloadedAtMs >= PRELOAD_TTL_MS) return null
      return ad
    }

    fun start(context: Context, extendMinutes: Int) {
      val intent = Intent(context, PaceRewardedAdActivity::class.java).apply {
        // 2026-08-02 사장님 지적("왜 앱 홈으로 가냐") — NEW_TASK만 주면 안드로이드가 이 액티비티를
        // Pace 앱의 기존 태스크(MainActivity=홈이 들어있는)에 붙여버린다. 그 태스크가 통째로 앞으로
        // 나오면서, 투명 액티비티 뒤로 Pace 홈 화면이 그대로 비쳤다 — "광고 누르니 앱 홈이 보인다"의
        // 정체. 매니페스트의 taskAffinity=""(자기만의 태스크)와 MULTIPLE_TASK를 함께 써서 앱 태스크와
        // 완전히 분리한다 → 투명 배경 뒤에는 직전 화면(유튜브)이 그대로 남는다.
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
        putExtra(EXTRA_EXTEND_MINUTES, extendMinutes)
      }
      context.startActivity(intent)
    }
  }

  private var extendMinutes = 5
  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // 2026-08-02 사장님 실기기 지적("광고 보기 눌렀더니 앱이 보이고 하단 흰 키 나오고 다시 광고로
    // 감") — 이 액티비티는 화면을 안 그리는 투명 껍데기인데, 투명 테마(Theme.Translucent)는 시스템
    // 바 색을 지정하지 않아 OEM 기본값(밝은 배경 + 흰 내비게이션 키)이 그대로 적용됐다. 그래서 광고가
    // 실제로 뜨기 전 짧은 순간 하단 키가 하얗게 번쩍이고 뒤 화면이 비쳐 "앱으로 갔다가 광고로 돌아오는"
    // 것처럼 보였다. 앱과 동일한 어두운 시스템 바로 고정해 그 번쩍임을 없앤다(MainActivity가 쓰는
    // 것과 같은 색 — 이 모듈에선 앱의 R.color를 못 보므로 값으로 직접 지정).
    val systemBarColor = android.graphics.Color.parseColor("#060709")
    window.statusBarColor = systemBarColor
    window.navigationBarColor = systemBarColor
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
      window.isStatusBarContrastEnforced = false
    }
    extendMinutes = intent?.getIntExtra(EXTRA_EXTEND_MINUTES, 5) ?: 5

    // 2026-08-04 — 선택 팝업이 뜰 때 미리 받아둔 광고가 있으면 네트워크 왕복 없이 즉시 재생한다
    // (위 preload 주석 참고). 없거나 만료됐으면 기존대로 지금 로드한다.
    val ready = takePreloaded()
    if (ready != null) {
      Log.i(TAG, "using preloaded ad")
      showAd(ready)
      return
    }

    val request = buildAdRequest(this)
    if (request == null) {
      // 동의를 못 받아 요청 자체가 불가 — 사용자를 기다리게 하지 말고 즉시 닫는다.
      Log.w(TAG, "ads consent not granted — skipping request")
      PaceOverlayService.showAdFailedToast(applicationContext)
      finishOnce()
      return
    }

    RewardedAd.load(this, adUnitId(this), request, object : RewardedAdLoadCallback() {
      override fun onAdFailedToLoad(error: LoadAdError) {
        // 광고가 안 뜨는 건 사용자 잘못이 아니므로 벌주지 않는다 — 조용히 닫고, 사용자가 다시
        // 시도할 수 있게 한다(연장은 주지 않음: 광고를 실제로 못 봤으므로).
        Log.w(TAG, "rewarded ad load failed: ${error.code} ${error.message}")
        PaceOverlayService.showAdFailedToast(applicationContext)
        finishOnce()
      }

      override fun onAdLoaded(ad: RewardedAd) = showAd(ad)
    })
  }

  private fun showAd(ad: RewardedAd) {
    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
      override fun onAdDismissedFullScreenContent() {
        // 다음 연장을 대비해 미리 받아둔다 — 연속으로 광고를 보며 이어가는 흐름에서 두 번째부터도
        // 기다림이 없어진다.
        preload(applicationContext)
        finishOnce()
      }
      override fun onAdFailedToShowFullScreenContent(error: com.google.android.gms.ads.AdError) {
        Log.w(TAG, "rewarded ad show failed: ${error.code} ${error.message}")
        PaceOverlayService.showAdFailedToast(applicationContext)
        finishOnce()
      }
    }
    ad.show(this) {
      // 보상 획득 — Focus Session을 extendMinutes만큼 연장한다. extendFocusSession이 내부에서
      // 워처 재시작 + 마감시각 저장 + 토스트 + 원래 보던 앱으로 복귀까지 담당한다.
      Log.i(TAG, "reward earned -> extendFocusSession($extendMinutes)")
      PaceOverlayService.extendFocusSession(applicationContext, extendMinutes)
    }
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
