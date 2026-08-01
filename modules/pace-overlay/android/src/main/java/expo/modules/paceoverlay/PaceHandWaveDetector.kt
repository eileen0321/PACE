package expo.modules.paceoverlay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import java.io.ByteArrayOutputStream
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.hypot

// 2026-07-24 손 밀어내기(shoo) Hands-Free Next(사용자 지시) — 몸쪽에서 카메라 쪽으로 손을 훠이
// 밀어내면 다음 영상. 핑거스냅(PaceSnapDetector)과 같은 설계 원칙: Focus Session이 켜져 있는 동안만
// 켜지고, 특정 손모양(주먹 등)을 분류하지 않는다 — 21개 손 랜드마크 중 손목(0)~중지 뿌리(9) 사이
// 거리(=화면에서 손이 차지하는 크기)가 짧은 시간 안에 확 커지는 "다가오는 움직임"만 본다. 정적 포즈
// 분류보다 모션 기반이 오탐이 적고 구현도 단순하다.
//
// 배터리 최소화(웹 리서치 반영, 2026-07-24):
// - 미리보기 UI 없이 ImageAnalysis 단독 유스케이스만 바인딩(Preview 합성 비용 자체가 없음)
// - STRATEGY_KEEP_ONLY_LATEST — MediaPipe 처리가 프레임 생성 속도를 못 따라가도 큐가 쌓이지 않음
// - 카메라 프레임은 보통 30fps로 나오지만 실제로는 PROCESS_INTERVAL_MS(150ms)당 1장만 처리 —
//   손동작 인식엔 30fps가 전혀 필요 없고, 처리 빈도를 줄이는 게 배터리에 가장 직접적으로 효과적.
// - 해상도도 320x240 저해상도로 고정 요청(손 랜드마크 인식엔 충분, 인코딩/변환 비용도 최소화).
// - MediaPipe delegate는 GPU가 아니라 CPU(Delegate.CPU) — 이 정도로 낮은 처리 빈도/해상도에서는
//   GPU 컨텍스트를 계속 띄워두는 비용이 오히려 더 크다(짧고 드문 추론엔 CPU delegate가 유리하다는
//   일반적인 온디바이스 ML 가이드라인).
// - Focus Session 종료 즉시 카메라 프로바이더를 완전히 unbind(단순히 분석만 멈추는 게 아니라 카메라
//   센서 자체를 꺼서 전력 소비를 끊는다).
object PaceHandWaveDetector {
  private const val TAG = "PaceHandWaveDetector"
  private const val MODEL_ASSET = "hand_landmarker.task"
  private const val PROCESS_INTERVAL_MS = 150L
  private const val REFRACTORY_MS = 1200L
  // 손 크기(손목~중지 뿌리 거리, 정규화 좌표계 0~1)가 이 윈도우 안에서 이 배수 이상 커지면
  // "다가오는 움직임"으로 판단. 초기 추정치 — 실기기 튜닝 전(V1, PaceSnapDetector와 동일 원칙).
  private const val GROWTH_WINDOW_MS = 700L
  // 2026-07-26 사용자 지적 — "폰을 거치대에 세워두고 얼굴 앞에서 화면 쪽으로 손을 미는" 실제 사용
  // 거리에서는 손이 카메라에 아주 가까이 붙지 않는다(그렇게 하려면 거치대에서 손을 뻗어 렌즈 코앞까지
  // 가져가야 하는데 비현실적). V1의 1.5배 임계값은 5번 중 5번 다 실패할 만큼 너무 빡빡했다 —
  // 낮추고, 그래도 안 잡히면 다음 로그(아래 onResult의 근접 실패 로그)로 실측 growthRatio를 보고
  // 재조정한다.
  private const val GROWTH_RATIO_THRESHOLD = 1.2
  private const val MIN_HAND_SIZE = 0.03 // 손이 화면에 거의 안 보일 만큼 작으면(먼 배경 노이즈) 무시

  // 2026-07-26 사용자 관찰("손모양이 아니여도 카메라만 가리면 넘어가는듯") — MediaPipe 손 랜드마크
  // 신뢰도(0.5)가 빠른 움직임/블러에서 프레임을 놓치는 경우의 안전망. 손 랜드마크와 별개로 Y평면
  // 평균 밝기(luma)만 보고 "짧은 시간 안에 급격히 어두워짐 = 뭔가로 렌즈를 가림"을 잡는다 — ML
  // 모델을 안 거치므로 계산이 훨씬 싸고, 손 인식이 실패하는 바로 그 상황(렌즈를 완전히 덮어 손
  // 랜드마크 자체를 못 찾는 경우)에 오히려 더 잘 맞는다. 둘 중 하나라도 걸리면 트리거(OR 조건) —
  // lastTriggerAtMs를 공유해 같은 제스처가 두 경로에서 중복 트리거되지 않게 한다.
  private const val LUMA_WINDOW_MS = 400L
  private const val LUMA_DROP_RATIO = 0.45 // 최근 대비 밝기가 이 비율 이하로 떨어지면(45% 이하) 발동
  private const val LUMA_DARK_ABS_MAX = 70.0 // 절대 밝기도 충분히 어두워야(0~255) — 정상 조도 변화 오탐 방지

  @Volatile private var running = false
  // 2026-07-28 감사 발견 — start()/stop()이 빠르게 연속 호출되면(예: Focus 탭 "손짓" 스위치를 짧은
  // 시간 안에 껐다 켰다), providerFuture.addListener()의 비동기 콜백이 `running`만 확인하고 "이게 어느
  // start() 호출에 속한 콜백인지"는 확인 안 해서, 이미 stop()된 첫 번째 start()의 지연 콜백이 그 사이에
  // 실행된 두 번째(현재 유효한) start()의 owner/handLandmarker를 건드리는 레이스가 있었다 — 최악의 경우
  // 이미 DESTROYED된 첫 번째 LifecycleRegistry에 markState(RESUMED)를 호출해 예외가 나고,
  // cleanupAfterStartFailure()가 방금 정상 시작된 두 번째 세션의 리소스까지 지워버린다("마지막으로 켰는데
  // 조용히 꺼져있음"). start()/stop() 호출마다 증가하는 세대 토큰으로 콜백이 자기 세대인지 확인하게 한다.
  @Volatile private var startGeneration = 0
  private var cameraProvider: ProcessCameraProvider? = null
  private var handLandmarker: HandLandmarker? = null
  private var analysisExecutor: ExecutorService? = null
  private var fakeLifecycleOwner: FakeLifecycleOwner? = null
  private var lastProcessedAtMs = 0L
  private var lastTriggerAtMs = 0L
  // (timestamp, handSize) 짧은 이력 — GROWTH_WINDOW_MS 안에서의 성장 배수만 보면 되므로 아주 작은 링버퍼로 충분.
  private val sizeHistory = ArrayDeque<Pair<Long, Double>>()
  // (timestamp, averageLuma) 짧은 이력 — occlusion(가려짐) 안전망용, sizeHistory와 동일한 원리.
  private val lumaHistory = ArrayDeque<Pair<Long, Double>>()

  // 2026-07-24: 프로젝트에 트랜지티브로 딸려온 androidx.lifecycle 버전이 LifecycleOwner를 순수 Java
  // 인터페이스(getLifecycle())로 노출해 Kotlin `override val lifecycle` 프로퍼티 오버라이드 문법이
  // 안 먹혔다(컴파일 에러로 실기기에서 직접 확인) — 함수 형태로 명시적 오버라이드해 버전 무관하게 컴파일되게 한다.
  private class FakeLifecycleOwner : LifecycleOwner {
    val registry = LifecycleRegistry(this)
    override fun getLifecycle(): Lifecycle = registry
  }

  fun hasPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

  fun isRunning(): Boolean = running

  // 2026-07-24 실기기 검증 중 발견한 진짜 버그 — start()가 setAutoMode() 호출 체인을 타고 JS
  // 브릿지 스레드(메인/UI 스레드가 아님)에서 그대로 불렸는데, 안드로이드 Lifecycle API
  // (LifecycleRegistry.markState 등)와 CameraX bindToLifecycle은 반드시 메인 스레드에서만 호출
  // 가능하다 — "Method markState must be called on the main thread" IllegalStateException이
  // setBluetoothAutoMode 호출 자체를 조용히 실패시키고 있었다(JS는 .catch로 삼켜서 원인 불명이었음).
  // 무거운 초기화 전부를 메인 Looper로 넘겨 이 스레드 요구사항을 만족시킨다.
  fun start(context: Context, onWave: () -> Unit) {
    if (running) return
    if (!hasPermission(context)) {
      Log.w(TAG, "CAMERA not granted — not starting")
      return
    }
    running = true
    val myGeneration = ++startGeneration
    Handler(Looper.getMainLooper()).post { startOnMainThread(context, onWave, myGeneration) }
  }

  private fun startOnMainThread(context: Context, onWave: () -> Unit, myGeneration: Int) {
    if (!running || myGeneration != startGeneration) return // stop() 또는 더 최신 start()가 먼저 있었음
    sizeHistory.clear()
    lastTriggerAtMs = 0L

    try {
      handLandmarker = HandLandmarker.createFromOptions(
        context,
        HandLandmarker.HandLandmarkerOptions.builder()
          .setBaseOptions(
            BaseOptions.builder()
              .setModelAssetPath(MODEL_ASSET)
              .setDelegate(Delegate.CPU)
              .build()
          )
          .setRunningMode(RunningMode.LIVE_STREAM)
          .setNumHands(1)
          .setMinHandDetectionConfidence(0.5f)
          .setMinTrackingConfidence(0.5f)
          .setMinHandPresenceConfidence(0.5f)
          .setResultListener { result, _ -> onResult(result, onWave) }
          .setErrorListener { e -> Log.e(TAG, "HandLandmarker error", e) }
          .build()
      )
    } catch (e: Exception) {
      Log.e(TAG, "HandLandmarker init failed", e)
      running = false
      handLandmarker = null
      return
    }

    analysisExecutor = Executors.newSingleThreadExecutor()
    val owner = FakeLifecycleOwner().also { fakeLifecycleOwner = it }
    @Suppress("DEPRECATION")
    owner.registry.markState(Lifecycle.State.CREATED)

    val providerFuture = ProcessCameraProvider.getInstance(context)
    providerFuture.addListener({
      // stop() 또는 그 사이의 또 다른 start()가 이 콜백보다 먼저 실행됐으면(=내가 stale) 손대지 않는다 —
      // running만 보면 "지금 켜져 있나"만 알 뿐 "이게 그 켜진 세션의 콜백인가"는 모른다(위 주석 참고).
      if (!running || myGeneration != startGeneration) return@addListener
      try {
        val provider = providerFuture.get()
        // 폴더블/일부 태블릿처럼 전면 카메라 자체가 없는 기기 대비 — CameraSelector 바인딩이
        // 예외를 던지긴 하지만, 명시적으로 먼저 확인해 로그를 분명히 남긴다.
        if (!provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
          Log.w(TAG, "no front camera on this device — hand-wave unavailable")
          cleanupAfterStartFailure()
          return@addListener
        }
        cameraProvider = provider

        val analysis = ImageAnalysis.Builder()
          .setTargetResolution(Size(320, 240))
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
        analysisExecutor?.let { executor ->
          analysis.setAnalyzer(executor) { proxy -> analyzeFrame(proxy, onWave) }
        }

        provider.unbindAll()
        @Suppress("DEPRECATION")
        owner.registry.markState(Lifecycle.State.RESUMED)
        provider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
        Log.i(TAG, "camera bound, watching for hand-wave")
      } catch (e: Exception) {
        // 카메라가 다른 앱(예: 통화)에 물려있거나 기기가 거부하는 경우 등 — running=false만 하고
        // 끝내면 이미 만들어둔 handLandmarker/executor가 그대로 새는 진짜 리소스 누수였다. stop()과
        // 동일한 정리 경로를 타야 한다.
        Log.e(TAG, "camera bind failed", e)
        cleanupAfterStartFailure()
      }
    }, ContextCompat.getMainExecutor(context))
  }

  fun stop() {
    if (!running && cameraProvider == null && handLandmarker == null) return
    running = false
    // cleanupResources()도 LifecycleRegistry.markState/카메라 unbind를 건드리므로 start()와 같은
    // 이유로 메인 스레드 강제가 필요하다.
    Handler(Looper.getMainLooper()).post {
      cleanupResources()
      Log.i(TAG, "stopped")
    }
  }

  // start() 도중 카메라 바인딩이 실패했을 때(다른 앱이 카메라 점유 중, 전면 카메라 없음 등) 이미
  // 만들어둔 handLandmarker/executor/lifecycle을 stop()과 동일하게 정리한다 — running=false만 하고
  // 끝내면 리소스가 새는 버그였다.
  private fun cleanupAfterStartFailure() {
    running = false
    cleanupResources()
  }

  private fun cleanupResources() {
    try { cameraProvider?.unbindAll() } catch (_: Exception) {}
    cameraProvider = null
    @Suppress("DEPRECATION")
    fakeLifecycleOwner?.registry?.markState(Lifecycle.State.DESTROYED)
    fakeLifecycleOwner = null
    try { handLandmarker?.close() } catch (_: Exception) {}
    handLandmarker = null
    analysisExecutor?.shutdownNow()
    analysisExecutor = null
    sizeHistory.clear()
  }

  private fun analyzeFrame(proxy: ImageProxy, onWave: () -> Unit) {
    val now = System.currentTimeMillis()
    if (!running || now - lastProcessedAtMs < PROCESS_INTERVAL_MS) {
      proxy.close()
      return
    }
    lastProcessedAtMs = now
    try {
      // occlusion 안전망 — Y평면 평균 밝기만 보는 거라 MediaPipe 추론 전에 먼저, 훨씬 싸게 계산.
      checkOcclusion(averageLuma(proxy), now, onWave)
      // 2026-08-01 최적화(로그 실측 기반) — REFRACTORY_MS(1.2초) 안에서는 fireTrigger/onResult가
      // 어차피 새 트리거를 무시하는데(디바운스), 지금까진 그 1.2초 동안도(≈8프레임) 매번 YUV→Bitmap
      // 변환 + MediaPipe 손 랜드마크 추론(가장 비싼 연산, 화면전환 애니메이션 도중 손이 아직
      // 화면에 남아있는 시간대와 정확히 겹침)을 그대로 돌리고 있었다 — 어차피 버려질 결과였다.
      // 밝기 기반 occlusion 안전망은 계속 싸게 돌려서(위) 냉각기간 중 새 렌즈 가림도 놓치지 않되,
      // 비싼 손 랜드마크 추론만 냉각기간 동안 건너뛴다.
      if (now - lastTriggerAtMs <= REFRACTORY_MS) return
      val bitmap = yuv420ToBitmap(proxy)
      if (bitmap != null) {
        val rotated = rotateBitmap(bitmap, proxy.imageInfo.rotationDegrees)
        val mpImage = BitmapImageBuilder(rotated).build()
        handLandmarker?.detectAsync(mpImage, now)
      }
    } catch (e: Exception) {
      Log.e(TAG, "analyzeFrame failed", e)
    } finally {
      proxy.close()
    }
  }

  // Y평면(휘도) 바이트를 그대로 평균 — YUV_420_888에서 Y가 곧 밝기이므로 비트맵 변환 없이 가장 싸게
  // "이 프레임이 전체적으로 얼마나 밝은지"를 얻는다. 320x240 전체를 순회해도 매 프레임이 아니라
  // PROCESS_INTERVAL_MS(150ms)당 1번뿐이라 비용이 무시할 만하다.
  private fun averageLuma(proxy: ImageProxy): Double {
    val yBuffer = proxy.planes[0].buffer
    val yBytes = ByteArray(yBuffer.remaining())
    yBuffer.duplicate().get(yBytes)
    var sum = 0L
    for (b in yBytes) sum += (b.toInt() and 0xFF)
    return sum.toDouble() / yBytes.size
  }

  // 2026-07-26 사용자 관찰 기반 안전망 — 손 랜드마크 신뢰도와 무관하게, 프레임이 짧은 시간 안에
  // 급격히+충분히 어두워지면(렌즈 앞을 뭔가로 가림) 트리거. sizeHistory/growthRatio와 완전히
  // 같은 원리(윈도우 안 최댓값 대비 현재 비율)를 밝기에 대해 적용.
  private fun checkOcclusion(luma: Double, now: Long, onWave: () -> Unit) {
    lumaHistory.addLast(now to luma)
    while (lumaHistory.isNotEmpty() && now - lumaHistory.first().first > LUMA_WINDOW_MS) {
      lumaHistory.removeFirst()
    }
    val brightestInWindow = lumaHistory.maxOfOrNull { it.second } ?: return
    if (brightestInWindow <= 0.0) return
    val dropRatio = luma / brightestInWindow
    if (dropRatio <= LUMA_DROP_RATIO && luma <= LUMA_DARK_ABS_MAX) {
      fireTrigger("occlusion luma=$luma brightestInWindow=$brightestInWindow dropRatio=$dropRatio", onWave)
    }
  }

  // onResult(손 크기 성장)와 checkOcclusion(밝기 급감) 두 경로가 공유하는 발동 로직 — 중복 트리거
  // 방지(REFRACTORY_MS)와 메인 스레드 dispatch를 한 곳에 모은다.
  private fun fireTrigger(reason: String, onWave: () -> Unit) {
    val now = System.currentTimeMillis()
    if (now - lastTriggerAtMs <= REFRACTORY_MS) return
    Log.i(TAG, "WAVE detected ($reason)")
    lastTriggerAtMs = now
    sizeHistory.clear()
    lumaHistory.clear()
    // PaceSnapDetector와 동일한 이유로 메인 Looper에서 후속 스와이프를 호출한다(백그라운드
    // 스레드에서 dispatchGesture 계열 호출 시 큐잉/지연되는 문제가 실기기에서 확인된 바 있음).
    Handler(Looper.getMainLooper()).post { onWave() }
  }

  // ImageAnalysis 기본 출력 포맷(YUV_420_888) → Bitmap. CameraX 버전마다 존재 여부가 불확실한
  // ImageProxy.toBitmap() 편의 함수에 기대지 않고, API 19부터 있던 표준 YuvImage 경로로 직접
  // 변환한다 — 320x240 저해상도 + 150ms 간격이라 JPEG 왕복 비용도 무시할 만하다.
  private fun yuv420ToBitmap(proxy: ImageProxy): Bitmap? {
    if (proxy.format != ImageFormat.YUV_420_888) {
      Log.w(TAG, "unexpected image format=${proxy.format}")
      return null
    }
    val yPlane = proxy.planes[0].buffer
    val uPlane = proxy.planes[1].buffer
    val vPlane = proxy.planes[2].buffer
    val ySize = yPlane.remaining()
    val uSize = uPlane.remaining()
    val vSize = vPlane.remaining()
    val nv21 = ByteArray(ySize + uSize + vSize)
    yPlane.get(nv21, 0, ySize)
    vPlane.get(nv21, ySize, vSize)
    uPlane.get(nv21, ySize + vSize, uSize)

    val yuvImage = YuvImage(nv21, ImageFormat.NV21, proxy.width, proxy.height, null)
    val out = ByteArrayOutputStream()
    yuvImage.compressToJpeg(Rect(0, 0, proxy.width, proxy.height), 90, out)
    val bytes = out.toByteArray()
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
  }

  private fun rotateBitmap(bitmap: Bitmap, degrees: Int): Bitmap {
    if (degrees == 0) return bitmap
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  private fun onResult(result: HandLandmarkerResult, onWave: () -> Unit) {
    if (result.landmarks().isEmpty()) return
    val landmarks = result.landmarks()[0]
    if (landmarks.size <= 9) return
    val wrist = landmarks[0]
    val middleMcp = landmarks[9]
    val handSize = hypot((wrist.x() - middleMcp.x()).toDouble(), (wrist.y() - middleMcp.y()).toDouble())
    if (handSize < MIN_HAND_SIZE) return

    val now = System.currentTimeMillis()
    sizeHistory.addLast(now to handSize)
    while (sizeHistory.isNotEmpty() && now - sizeHistory.first().first > GROWTH_WINDOW_MS) {
      sizeHistory.removeFirst()
    }
    val oldestInWindow = sizeHistory.firstOrNull() ?: return
    val growthRatio = handSize / oldestInWindow.second
    val pastRefractory = now - lastTriggerAtMs > REFRACTORY_MS

    // 2026-07-26 튜닝용 — 임계값을 못 넘긴 시도도 실측값을 남겨야 다음 조정 근거가 생긴다("안 됨"만
    // 알아서는 얼마나 못 미쳤는지 알 수 없었다). 스팸 방지로 임계값 근처(0.9배 이상)일 때만 남긴다.
    if (growthRatio > GROWTH_RATIO_THRESHOLD * 0.9 && growthRatio <= GROWTH_RATIO_THRESHOLD) {
      Log.d(TAG, "near-miss growthRatio=$growthRatio handSize=$handSize threshold=$GROWTH_RATIO_THRESHOLD")
    }

    if (growthRatio > GROWTH_RATIO_THRESHOLD && pastRefractory) {
      Log.i(TAG, "WAVE detected growthRatio=$growthRatio handSize=$handSize")
      lastTriggerAtMs = now
      sizeHistory.clear()
      // PaceSnapDetector와 동일한 이유로 메인 Looper에서 후속 스와이프를 호출한다(백그라운드
      // 스레드에서 dispatchGesture 계열 호출 시 큐잉/지연되는 문제가 실기기에서 확인된 바 있음).
      Handler(Looper.getMainLooper()).post { onWave() }
    }
  }
}
