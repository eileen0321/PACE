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
    // 온디맨드 로드가 이 시간 안에 끝나지 않으면 투명 창을 닫는다(loadWatchdog 주석 참고).
    // JS 경로(rewardedAd.ts)의 로드 타임아웃과 같은 값으로 맞춘다.
    private const val LOAD_TIMEOUT_MS = 20_000L

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

    /**
     * 광고를 보지 않고 팝업을 닫았을 때 미리 받아둔 인스턴스를 버린다.
     * 하드웨어 비디오 디코더는 제한된 자원이라 안 쓸 광고를 들고 있으면 다른 앱(유튜브)의 영상이
     * 검게 나올 수 있다(onAdDismissedFullScreenContent 주석의 실기기 증상·근거 참고).
     */
    fun dropPreloaded() {
      preloadedAd = null
      preloadedAtMs = 0L
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
  // 보상을 실제로 받았는지 — 광고가 닫힐 때 원래 보던 앱으로 복귀할지 판단한다(showAd 주석 참고).
  private var earnedReward = false

  // 2026-08-04 전수 조사 발견 — 이 액티비티는 "투명한 전체화면 창"이다. 투명해서 눈에는 유튜브가
  // 그대로 보이지만 **터치는 전부 이 창이 먹는다**. 그런데 로드 콜백이 끝내 안 오는 경우
  // (네트워크가 물린 채 끊기지 않는 상황)를 끊어줄 장치가 없어서, 그럴 때 사용자는 "유튜브가 보이는데
  // 아무것도 눌리지 않는" 상태에 갇혔다. JS 쪽 경로에는 이미 같은 취지의 로드 타임아웃이 있다
  // (services/ads/rewardedAd.ts) — 네이티브에도 동일하게 건다.
  private val watchdogHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val loadWatchdog = Runnable {
    Log.w(TAG, "rewarded ad load timed out — 투명 창이 터치를 먹지 않도록 닫는다")
    PaceOverlayService.showAdFailedToast(applicationContext)
    finishOnce()
  }

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

    watchdogHandler.postDelayed(loadWatchdog, LOAD_TIMEOUT_MS)
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
    watchdogHandler.removeCallbacks(loadWatchdog) // 로드는 끝났다 — 시청 시간에는 제한을 두지 않는다
    // 2026-08-04 전수 조사 — 로드가 도는 동안 이 액티비티가 이미 사라졌을 수 있다(홈키, 또는
    // noHistory로 시스템이 finish). 그 상태에서 show()를 부르면 종료 중인 태스크 위로 광고 창을
    // 띄우려다 아무것도 안 그려진 빈 창이 남을 수 있다. 그냥 조용히 포기한다 — 광고를 못 봤으니
    // 연장도 없고, 사용자는 다시 누르면 된다.
    if (isFinishing || isDestroyed) {
      Log.w(TAG, "activity gone before show — 광고를 띄우지 않는다")
      ad.fullScreenContentCallback = null
      return
    }
    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
      override fun onAdDismissedFullScreenContent() {
        // 2026-08-04 사장님 실기기 지적("광고 보고 5분 받았는데 왜 쇼츠가 안 보이고 까만 화면이야") —
        // 광고 시청 직후부터 유튜브 영상만 검게 나오고(재생 UI·진행바는 정상), 다른 영상으로 넘겨도
        // 계속 검으며, **유튜브 프로세스를 죽이면 즉시 복구**되는 것을 실기기로 확인했다.
        //
        // ⚠️ 원인 정정 — 처음엔 "사전 로드가 하드웨어 디코더를 점유해서"로 진단했는데, 그건 **틀렸다.**
        // 실기기 로그를 다시 읽어 진짜 원인을 확정했다:
        //   21:53:48.756  reward earned → extendFocusSession → returnToLastTrackedApp() (유튜브를 앞으로)
        //   21:53:48.963  com.android.vending(플레이스토어)이 그 위로 올라옴             (200ms 뒤)
        //   21:53:50~14   triggerNext() aborted — isSupportedAppWindowVisible()=false ×8
        // 보상 콜백은 **광고가 아직 화면에 떠 있는 동안** 오는데 거기서 유튜브를 끌어올려서, 곧바로
        // 광고/스토어에 다시 덮이고 사용자가 전부 닫았을 때 유튜브가 어정쩡한 상태로 남았다
        // (MediaSession state=NONE, 화면엔 ⏸ 아이콘 + 검은 화면). 크래시는 없었다(tombstone 없음).
        // → 복귀를 이 시점(광고가 실제로 닫힌 뒤)으로 옮겼다. 아래 returnToLastTrackedApp 호출이 그것이다.
        //
        // 아래 preloadedAd 정리는 원인은 아니었지만 그대로 둔다 — 쓰지도 않을 광고 인스턴스를 계속
        // 들고 있을 이유가 없고, 참조를 끊어야 SDK가 자원을 반납할 수 있다(그 자체로 옳다).
        // 사전 로드는 "선택 팝업이 뜰 때"만 하고(showExtendChoiceOverlay), 광고를 안 보고 팝업을
        // 닫으면 dropPreloaded()로 버린다.
        preloadedAd = null
        ad.fullScreenContentCallback = null
        // 광고가 실제로 닫힌 지금이 원래 보던 앱으로 되돌릴 유일하게 안전한 시점이다.
        // 보상을 못 받고 그냥 닫았으면 연장도 없었으므로 복귀도 하지 않는다 — 사용자가 스스로 닫은
        // 것이라 화면을 마음대로 바꾸면 안 된다.
        if (earnedReward) PaceOverlayService.returnToLastTrackedApp(applicationContext)
        finishOnce()
      }
      override fun onAdFailedToShowFullScreenContent(error: com.google.android.gms.ads.AdError) {
        Log.w(TAG, "rewarded ad show failed: ${error.code} ${error.message}")
        PaceOverlayService.showAdFailedToast(applicationContext)
        finishOnce()
      }
    }
    // 🔴 2026-08-05 실기기 픽셀 측정으로 확정 — 사장님 "광고 왜 지금도 하단 검은색 키야".
    // 광고가 떠 있는 화면을 raw로 떠서 실제 색을 쟀다(화면 1080x2316):
    //     상태바 #060709(우리 색) / 광고 배경 #2e2e32~#403a46 / 내비바 바로 위 1px #3f3b46
    //     **내비바 영역 #000000 (순수 검정)**
    // 우리가 칠했다면 #060709가 나와야 하는데 정확히 #000000이었다 — 즉 우리가 칠한 게 아니라
    // **광고가 그 영역을 안 그려서 투명 창 뒤(아무것도 없음)가 비친 것**이다. 창 자체는 내비바까지
    // 덮고 있는데(Requested h=2249, 화면 2316 - 상태바 67) 광고 뷰만 자기 인셋을 적용해 y=2190에서
    // 끝난다. 그 인셋은 구글 SDK 액티비티 안에서 일어나므로 **우리 테마로는 못 바꾼다** —
    // 오늘 styles.xml에서 색만 네 번 바꿔가며 시도한 게 전부 헛수고였던 이유가 이것이다.
    //   (색을 우리가 칠해봐야 광고 배경색은 광고마다 달라 애초에 맞출 수가 없다.)
    // → 칠하는 게 아니라 **내비바를 없앤다.** AdMob 공식 API가 정확히 이걸 위해 있다:
    //   setImmersiveMode(true)를 show() 전에 부르면 광고 표시 중 SYSTEM_UI_FLAG_IMMERSIVE_STICKY +
    //   SYSTEM_UI_FLAG_HIDE_NAVIGATION이 켜져 내비바가 숨는다 — 검은 띠가 생길 자리 자체가 사라진다.
    //   (공식 레퍼런스: RewardedAd.setImmersiveMode, "Call this method before show()")
    // 부작용 없음: 광고가 닫히면 플래그도 함께 사라져 원래 앱의 시스템 바는 그대로 돌아온다.
    ad.setImmersiveMode(true)
    ad.show(this) {
      // 보상 획득 — Focus Session을 extendMinutes만큼 연장한다(워처 재시작 + 마감시각 저장 + 토스트).
      // ⚠️ 이 콜백은 **광고가 아직 화면에 떠 있는 동안** 온다. 여기서 원래 앱으로 복귀시키면 광고와
      // 플레이스토어가 그 위를 다시 덮어 유튜브가 어정쩡한 상태로 남는다(위 onAdDismissed 주석의
      // 실기기 로그 참고) — 그래서 returnToApp=false로 연장만 하고, 복귀는 광고가 닫힐 때 한다.
      Log.i(TAG, "reward earned -> extendFocusSession($extendMinutes) (복귀는 광고 닫힌 뒤)")
      earnedReward = true
      PaceOverlayService.extendFocusSession(applicationContext, extendMinutes, returnToApp = false)
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    watchdogHandler.removeCallbacks(loadWatchdog)
  }

  private fun finishOnce() {
    if (finished) return
    finished = true
    watchdogHandler.removeCallbacks(loadWatchdog)
    finish()
    // 이 액티비티는 화면을 그리지 않으므로 전환 애니메이션도 없어야 자연스럽다(쇼츠 위에 광고만
    // 떴다 사라진 것처럼 보이게).
    overridePendingTransition(0, 0)
  }
}
