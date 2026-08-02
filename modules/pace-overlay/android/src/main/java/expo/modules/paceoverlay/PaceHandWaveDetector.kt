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
  // 2026-08-02 실기기 발견 — MediaPipe 추론 지연(기기 부하 시 700ms 훌쩍 넘김)이 겹치면 이 창
  // 안에 프레임이 1개만 남아 growthRatio가 항상 자기 자신과 비교돼(=1.0) 버렸다. 추론이 느려도
  // 비교할 "과거" 샘플이 남아있도록 넉넉히 늘림.
  private const val GROWTH_WINDOW_MS = 2500L
  // 2026-07-26 사용자 지적 — "폰을 거치대에 세워두고 얼굴 앞에서 화면 쪽으로 손을 미는" 실제 사용
  // 거리에서는 손이 카메라에 아주 가까이 붙지 않는다(그렇게 하려면 거치대에서 손을 뻗어 렌즈 코앞까지
  // 가져가야 하는데 비현실적). V1의 1.5배 임계값은 5번 중 5번 다 실패할 만큼 너무 빡빡했다 —
  // 낮추고, 그래도 안 잡히면 다음 로그(아래 onResult의 근접 실패 로그)로 실측 growthRatio를 보고
  // 재조정한다.
  // 2026-08-02 실기기 재조정 — 사용자가 10번 넘게 시도했는데 실측 growthRatio가 계속 1.08~1.10
  // 근처(near-miss 로그, threshold=1.2)에 머물러 단 한 번도 안 넘어갔다. 1.2는 여전히 실사용
  // 거리/속도 기준 너무 빡빡한 것으로 확인돼 낮춘다.
  // 2026-08-02 실기기 로그 기반 재조정(사장님: "또 손짓 하나도 안 됐어") — 실패한 시도들의 실측
  // growthRatio가 1.07/1.075/1.08/1.086/1.09/1.095로 전부 1.1 바로 아래에 몰려 있었고, 성공은
  // 1.10~1.20뿐이었다. 즉 실제 사용자의 "미는" 동작이 만들어내는 값이 1.07~1.10 구간인데 기준이
  // 그 위에 걸쳐 있어 열 번에 한두 번만 걸렸다. 가만히 든 손은 1.00 근처(기존 로그로 확인)라
  // 1.05로 내려도 오탐 여유가 충분하다.
  // 2026-08-02 밤 — 위 "1.05로 내려도 오탐 여유가 충분하다"는 판단이 실기기에서 틀렸음이 증명됐다.
  // 사장님이 손짓을 전혀 하지 않은 25초 구간에서 WAVE가 8번 발생했고(22:05:31~55), 그 실측값이
  // 1.053/1.054/1.057/1.059/1.063/1.069/1.077/1.164였다 — 즉 아무 동작 없이도 노이즈만으로 1.16까지
  // 올라간다. 원인은 기준값을 "윈도우 내 최솟값"으로 바꾼 것과 윈도우가 2.5초로 길어진 것이 겹쳐,
  // 손 인식이 살짝 흔들린 순간의 작은 값이 기준으로 박히면서 비율이 쉽게 부풀려지기 때문이다.
  // 그동안 "안 잡힌다"는 보고에 임계값만 계속 내린 결과(1.5→1.2→1.1→1.05) 이 지경이 됐는데,
  // 진짜 원인은 감지 축이 하나뿐이었던 것이었다(SWEEP_RATIO_THRESHOLD 주석 참고).
  // 이제 좌우 흔들기는 스윕 축이 담당하므로, 성장 축은 "의도적으로 손을 카메라 쪽으로 확 미는"
  // 동작만 잡도록 관측된 노이즈 상한(1.164)보다 확실히 위로 올린다.
  private const val GROWTH_RATIO_THRESHOLD = 1.3
  // 2026-08-02 실기기 로그로 확인된 진짜 결함(사장님: "동일하게 손짓해도 판단을 못 하는 거겠지" —
  // 정확한 지적이었다) — 위 임계값들은 전부 handSize "성장률"만 조정한 것이라, 감지할 수 있는 동작이
  // 사실상 "손을 카메라 쪽으로 미는 것" 하나뿐이었다. 사용자가 실제로 하는 좌우로 흔드는 동작은
  // 손과 카메라의 거리가 그대로여서 handSize가 안 변한다 → growthRatio가 영원히 1.02 근처에 머문다.
  // 로그 증거(22:03:20~27, 8초간): 손이 매 프레임 정상 인식되는데 handSize가 0.1380~0.1401에 붙어
  // 있고 near-miss만 계속 찍힘 — 임계값을 아무리 낮춰도 안 잡히는 게 당연했다(축이 틀렸으므로).
  // 그래서 손목 x좌표의 이동폭(손 크기로 정규화)을 별도 축으로 본다. 0.9 = "손 너비의 0.9배만큼
  // 가로로 움직였다" — 가만히 든 손의 미세한 흔들림은 0.1~0.35 수준(같은 로그 구간 실측)이라
  // 오탐 여유가 충분하고, 의도적인 흔들기는 이 값을 넉넉히 넘긴다.
  // 2026-08-02 실기기 실측으로 재조정 — 사장님이 흔드시는 동안의 sweep 실측이 0.66/0.70/0.71/0.72/
  // 0.73/0.76/0.77/0.78/0.80로 전부 0.9 바로 아래에 몰려 단 한 번도 안 걸렸다(같은 구간의 growth는
  // 1.0~1.08로 1.3에도 한참 못 미침 — 즉 두 축 모두 문턱 아래라 "하나도 안 되는" 상태였다).
  // 실제 동작이 만들어내는 값 아래로 내린다. 손을 가만히 든 상태는 sweep이 0.2~0.3 수준이므로
  // (WAVE by=growth 로그의 동시 sweep 값: 0.23/0.31/0.60) 0.75와는 여유가 있다.
  // 2026-08-02 밤 재조정 — 아래 진동 축(countDirectionReversals)이 좌우 흔들기를 전담하게 됐으므로,
  // 이 스윕 축은 "한 번에 크게 훑는" 동작 전용으로 되돌린다. 실측상 확실히 안전한 값만 남긴다
  // (성공 실측 0.86/1.01 vs 가만히 든 손이 growth로 잡힐 때 동시 sweep 0.52까지 관측됨) — 0.75는
  // 실패 구간(0.62~0.74)과 너무 가까워 경계에 걸쳐 있었다.
  // ⚠️ 2026-08-02 밤 — 진동 축을 넣으면서 이 값을 0.75→0.85로 올렸는데, 그 진동 축에 버그가 있어
  // 한 번도 발화하지 않는 바람에(reversals 항상 0) 결과적으로 감지가 이전보다 더 안 되게 만들었다.
  // 새 축을 추가할 때 기존 축을 같이 조이면 새 축이 실패했을 때 곧장 회귀가 된다 — 원래 값으로
  // 되돌린다. 진동 축이 실측으로 검증된 뒤에 필요하면 그때 다시 판단한다.
  private const val SWEEP_RATIO_THRESHOLD = 0.75

  // 진동 축 — 방향 전환 1회로 인정하려면 직전 극점에서 이만큼(손 너비 대비)은 되돌아와야 한다.
  // 이 게이팅이 없으면 미세한 손떨림이 매 프레임 방향을 뒤집어 즉시 오탐이 된다. 실측 근거:
  // 실패한 흔들기의 전체 이동폭이 0.62~0.74(=편도 스윙 약 0.3 이상)였고, 가만히 든 손은 창 전체를
  // 합쳐도 0.2~0.3이라 개별 스윙은 이보다 훨씬 작다 — 0.25면 진짜 흔들기만 통과한다.
  private const val MIN_SWING_RATIO = 0.25
  // 왕복 1회(좌→우→좌)를 요구한다. 1회로 두면 손을 한쪽으로 치우는 단순 이동도 걸린다.
  private const val MIN_REVERSALS = 2
  private const val MIN_HAND_SIZE = 0.03 // 손이 화면에 거의 안 보일 만큼 작으면(먼 배경 노이즈) 무시
  // 재무장 조건 — 트리거 시점 손 크기의 이 비율 이하로 작아져야 "손을 치웠다"로 인정.
  // 2026-08-01 사용자 지적("두번씩 넘어가는거 여전함") — 0.75는 실제 "훠이" 동작 중간에 손이
  // 살짝 오므라들거나 흔들리는 정도로도 우연히 만족되기 쉬웠다(한 번의 연속 동작인데 중간에
  // 재무장→그 남은 전진 동작이 새 기준선 대비 또 growthRatio를 넘겨 트리거 두 번). 손을 화면
  // 앞에서 확실히 뺐다고 볼 수 있는 수준까지 훨씬 낮춘다.
  // 2026-08-02 실기기 로그로 재조정("그래도 잘 안 되잖아") — 트리거 간격이 2.8~3.5초로 정확히
  // REARM_TIMEOUT_MS(3초)에 붙어 있었다. 즉 크기 기준(0.45)으로는 재무장이 사실상 한 번도 성립하지
  // 않고 매번 3초 타임아웃을 기다렸다는 뜻 — 그 사이 사용자가 아무리 손짓해도 전부 무시되니 "안
  // 된다"고 느껴진다. 0.45(트리거 당시 크기의 45%까지 축소)는 손을 카메라에서 아주 멀리 빼야만
  // 만족하는 값이라 실사용 동작으로는 도달하지 않는다.
  // 애초에 0.45로 조인 이유는 "두 번씩 넘어감"을 막기 위해서였는데, 그 진짜 원인은 오늘 따로 찾아
  // 고쳤다(loopedBack에도 performSwipeUp을 호출하던 폴링 로직 — PaceAccessibilityService 수정 참고).
  // 따라서 이 값을 이렇게까지 조일 필요가 없어졌다. 손을 살짝 뒤로 빼는 정도(85%)면 재무장.
  private const val REARM_SIZE_RATIO = 0.85
  // 손이 안 작아지고 계속 카메라 앞에 머무는 극단적인 경우를 위한 안전판(무한정 재무장 안 되는 것 방지).
  // 위와 같은 이유로 3초 → 1.5초. REFRACTORY_MS(1.2초)와 함께 "연속 손짓의 최소 간격"을 정하는데,
  // 3초는 체감상 너무 길어 반응이 없는 것처럼 느껴졌다.
  private const val REARM_TIMEOUT_MS = 1500L

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
  // 2026-08-02 실기기 tombstone으로 근본원인 확정 — SIGSEGV(fault addr 0x1a0)가 detectAsync →
  // sendLiveStreamData → PacketCreator.createProto 네이티브 경로에서 두 번 발생했고, 그때마다 앱
  // 프로세스가 통째로 죽었다. 죽으면 같은 프로세스에 있는 PaceAccessibilityService까지 함께 죽고,
  // 시스템은 그 서비스를 "Crashed services"로 표시한 뒤 다시 바인딩해주지 않는다(설정 화면엔 계속
  // "켜짐"으로 보이므로 사용자도 우리도 알아챌 수 없었다) → 손짓·블루투스·자동넘김이 한꺼번에
  // 영구 정지. 즉 이 크래시 하나가 그동안의 "갑자기 아무것도 안 됨" 증상의 정체다.
  //
  // 레이스의 구조: analyzeFrame()은 CameraX 분석 워커 스레드에서 돌고, cleanupResources()는 메인
  // 스레드에서 handLandmarker.close()를 부른다. 프레임 하나가 detectAsync 안(JNI 패킷 생성 중)에
  // 들어가 있는 사이에 네이티브 그래프가 파괴되면 널 역참조로 즉사한다. shutdownNow()는 인터럽트만
  // 걸 뿐 진행 중인 분석을 기다려주지 않아 창이 그대로 열려 있었다. 또한 SIGSEGV는 JVM 예외가
  // 아니라 try/catch로는 원천적으로 막을 수 없다 — 애초에 겹치지 않게 하는 것이 유일한 해법이다.
  // detectAsync(LIVE_STREAM)는 패킷만 큐에 넣고 즉시 반환하므로 이 락을 메인 스레드가 잠깐 기다려도
  // 추론 시간만큼 블록되지 않는다(ANR 위험 없음).
  private val landmarkerLock = Any()
  // clearAnalyzer()로 새 프레임 유입 자체를 먼저 끊기 위해 참조를 들고 있는다(위 락과 함께 2중 방어).
  private var imageAnalysis: ImageAnalysis? = null
  private var analysisExecutor: ExecutorService? = null
  private var fakeLifecycleOwner: FakeLifecycleOwner? = null
  private var lastProcessedAtMs = 0L
  private var lastTriggerAtMs = 0L
  // 2026-08-01 사용자 지적("화면이 2개씩 넘어가냐 큐에 넣었다가") — 손을 밀어낸 뒤 바로 안 치우고
  // 카메라 앞에 머물러 있으면, 그 잔류 흔들림만으로도 GROWTH_WINDOW_MS(700ms) 새 창에서 growthRatio가
  // 다시 1.2를 넘어 REFRACTORY_MS(1.2초)만 지나면 또 트리거됐다(실기기 로그로 확인 — 한 번의 제스처
  // 뒤에 1.7~3초 간격으로 WAVE가 연달아 찍힘). 시간 기반 냉각만으로는 "손이 안 물러났다"를 못 잡는다 —
  // 트리거 시점 손 크기의 REARM_SIZE_RATIO 이하로 다시 작아져야(=손을 치웠다는 증거) 재무장하도록
  // 게이트를 추가한다. 손이 화면에서 완전히 사라지는 경우(landmarks 없음)도 물러난 것으로 간주.
  private var awaitingRearm = false
  private var rearmBelowSize = 0.0
  // (timestamp, handSize) 짧은 이력 — GROWTH_WINDOW_MS 안에서의 성장 배수만 보면 되므로 아주 작은 링버퍼로 충분.
  private val sizeHistory = ArrayDeque<Pair<Long, Double>>()
  // (timestamp, wrist.x) 짧은 이력 — 좌우 흔들기(스윕) 판정용. sizeHistory와 같은 윈도우/원리.
  private val xHistory = ArrayDeque<Pair<Long, Double>>()
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
    xHistory.clear()
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
        imageAnalysis = analysis

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
    // 순서가 곧 안전장치다(위 landmarkerLock 주석의 SIGSEGV 참고).
    // ① 분석기부터 떼어내 새 프레임이 analyzeFrame으로 더 들어오지 못하게 막고,
    try { imageAnalysis?.clearAnalyzer() } catch (_: Exception) {}
    imageAnalysis = null
    // ② 카메라를 언바인드한 뒤,
    try { cameraProvider?.unbindAll() } catch (_: Exception) {}
    cameraProvider = null
    @Suppress("DEPRECATION")
    fakeLifecycleOwner?.registry?.markState(Lifecycle.State.DESTROYED)
    fakeLifecycleOwner = null
    // ③ 이미 detectAsync 안에 들어가 있는 마지막 프레임이 빠져나올 때까지 락으로 기다린 다음 닫는다.
    //    shutdownNow()를 먼저 부르면 인터럽트만 걸고 기다리지 않아 close()와 겹칠 수 있으므로,
    //    반드시 close() 이후에 executor를 내린다.
    synchronized(landmarkerLock) {
      try { handLandmarker?.close() } catch (_: Exception) {}
      handLandmarker = null
    }
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
        // 락 안에서 running을 한 번 더 확인한다 — 위 라인들을 도는 사이에 stop()이 걸렸을 수 있고,
        // 그 경우 handLandmarker는 이미 닫혔거나 닫히는 중이다(널 체크만으로는 close()가 진행 중인
        // 순간을 못 걸러낸다 — 그 틈이 정확히 SIGSEGV가 났던 창이다).
        synchronized(landmarkerLock) {
          if (running) handLandmarker?.detectAsync(mpImage, now)
        }
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

  // 진동 축 — xHistory(손목 x좌표 이력) 안에서 "충분히 큰 방향 전환"이 몇 번 일어났는지 센다.
  // 극점(peak) 검출 + 히스테리시스: 한쪽으로 가던 중 직전 극점에서 minSwing 이상 되돌아왔을 때만
  // 1회로 인정하고 방향을 뒤집는다. minSwing 미만의 흔들림은 극점만 갱신하고 카운트되지 않으므로
  // (=히스테리시스 밴드), 손을 가만히 들고 있을 때의 미세 떨림은 아무리 자주 반전돼도 0으로 남는다.
  // 손 크기로 정규화하기 때문에 카메라와의 거리가 달라져도 같은 동작이면 같은 값이 나온다.
  private fun countDirectionReversals(handSize: Double): Int {
    if (xHistory.size < 3 || handSize <= 0.0) return 0
    val minSwing = handSize * MIN_SWING_RATIO
    var reversals = 0
    var dir = 0 // 0 = 아직 방향 미확정, +1 = 오른쪽으로 진행 중, -1 = 왼쪽
    var extreme = xHistory.first().second
    for (i in 1 until xHistory.size) {
      val x = xHistory[i].second
      if (dir == 0) {
        // ⚠️ 2026-08-02 밤 실기기 로그로 발견한 버그 — 여기를 dir>=0 / dir<=0 두 조건으로 처리했더니
        // dir==0일 때 두 조건이 동시에 참이라 손이 어느 쪽으로 움직이든 극점(extreme)이 x를 그대로
        // 따라가 버렸다. 그래서 스윙이 전혀 쌓이지 못해 dir이 영원히 0에 머물고 reversals가 항상 0 —
        // 손을 확실히 흔드는 구간(sweep 0.60~0.80)에서도 reversals=0만 찍혔다. 방향이 정해지기 전에는
        // 극점을 고정해두고, 거기서 minSwing 이상 벌어진 쪽으로 최초 방향만 확정한다(전환으로 세지 않음).
        if (x - extreme >= minSwing) { dir = 1; extreme = x }
        else if (extreme - x >= minSwing) { dir = -1; extreme = x }
        continue
      }
      if (dir > 0) {
        if (x > extreme) extreme = x                       // 오른쪽으로 더 감 — 극점만 갱신
        else if (extreme - x >= minSwing) {                 // 극점에서 충분히 되돌아옴 = 전환
          reversals++; dir = -1; extreme = x
        }
      } else {
        if (x < extreme) extreme = x
        else if (x - extreme >= minSwing) {
          reversals++; dir = 1; extreme = x
        }
      }
    }
    return reversals
  }

  private fun onResult(result: HandLandmarkerResult, onWave: () -> Unit) {
    if (result.landmarks().isEmpty()) {
      awaitingRearm = false // 손이 화면에서 사라짐 = 확실히 물러난 것으로 보고 재무장
      // 2026-08-02 — 손이 사라졌으면 이전 접근 동작의 크기 이력도 버린다. 남겨두면 다음에 손을
      // 다시 넣었을 때 "직전 동작의 큰 손"이 최솟값 기준에 섞여 들어가(또는 반대로 남은 작은 값이
      // 오탐을 유발해) 판정이 흐려진다. 매 접근을 깨끗한 상태에서 새로 재기 위함.
      sizeHistory.clear()
      xHistory.clear() // 가로 이동 이력도 같은 이유로 버린다(손이 나갔다 들어오면 새로 재기 시작)
      return
    }
    val landmarks = result.landmarks()[0]
    if (landmarks.size <= 9) return
    val wrist = landmarks[0]
    val middleMcp = landmarks[9]
    val handSize = hypot((wrist.x() - middleMcp.x()).toDouble(), (wrist.y() - middleMcp.y()).toDouble())
    if (handSize < MIN_HAND_SIZE) return

    val now = System.currentTimeMillis()

    if (awaitingRearm) {
      if (handSize <= rearmBelowSize || now - lastTriggerAtMs > REARM_TIMEOUT_MS) {
        // 2026-08-02 진단 — 재무장이 "크기 축소"로 풀렸는지 "타임아웃"으로 풀렸는지 구분해야
        // 손짓 반응성 문제의 원인을 계속 추적할 수 있다(트리거당 1줄이라 스팸 아님).
        Log.d(TAG, "rearmed after ${now - lastTriggerAtMs}ms by=${if (handSize <= rearmBelowSize) "shrink" else "timeout"} size=$handSize needed<=$rearmBelowSize")
        awaitingRearm = false
      } else {
        // 아직 손을 안 치웠음 — 방금 그 제스처의 잔류 흔들림이므로 새 제스처로 세지 않는다.
        return
      }
    }

    // 2026-08-02 실기기 로그로 확정된 근본 결함 — 지금까지의 판정은 handSize 성장률뿐이라 사실상
    // "손을 카메라 쪽으로 밀기"만 감지했다. 그런데 사용자가 실제로 하는 동작은 이름 그대로 손을
    // 좌우로 흔드는 것이고, 그때는 손과 카메라의 거리가 변하지 않아 handSize가 그대로다.
    // 로그 증거(22:03:20~27): 손이 프레임 안에 계속 잡히는데 handSize가 0.1380~0.1401에 붙어 있고
    // growthRatio가 1.019~1.026에서만 오르내리며 near-miss만 수십 줄 — 흔드는 내내 단 한 번도
    // 임계값(1.05)에 못 닿았다("손짓 하나도 안 돼"의 정체). 임계값을 더 낮추는 건 답이 아니다.
    // 미세한 손떨림까지 트리거가 돼 오탐이 폭증한다. 축 자체가 틀린 것이므로 가로 이동을 따로 본다.
    //
    // 손목 x좌표의 윈도우 내 이동폭(최대-최소)을 손 크기로 정규화해서 쓴다 — 픽셀/정규화 좌표를
    // 그대로 쓰면 손이 카메라에 가까울수록(=화면에서 클수록) 같은 동작이 더 큰 값으로 나와 거리에
    // 따라 감도가 달라지지만, 손 크기로 나누면 "내 손 너비의 몇 배를 움직였나"가 되어 거리와 무관해진다.
    xHistory.addLast(now to wrist.x().toDouble())
    while (xHistory.isNotEmpty() && now - xHistory.first().first > GROWTH_WINDOW_MS) {
      xHistory.removeFirst()
    }
    val sweepRatio = if (xHistory.size >= 2) {
      (xHistory.maxOf { it.second } - xHistory.minOf { it.second }) / handSize
    } else 0.0

    sizeHistory.addLast(now to handSize)
    while (sizeHistory.isNotEmpty() && now - sizeHistory.first().first > GROWTH_WINDOW_MS) {
      sizeHistory.removeFirst()
    }
    val oldestInWindow = sizeHistory.firstOrNull() ?: return
    // 2026-08-02 실기기 발견("손짓 100번 넘게 해도 단 한 번도 안 됨") — 로그에서 growthRatio가
    // 매번 정확히 1.0으로 찍혔다. sizeHistory에 방금 추가한 현재 프레임 하나만 남아있으면
    // oldestInWindow가 곧 그 현재 프레임 자신이라 handSize/handSize=1.0(자기 자신과 비교)이 되는데,
    // 실제로 매번 이 상태였다는 뜻 — detectAsync가 REFRACTORY_MS 최적화(2026-08-01 추가)와 카메라/
    // 추론 지연이 겹쳐 GROWTH_WINDOW_MS(700ms)보다 훨씬 뜸하게 불려서, 새 프레임이 들어올 때마다
    // 이전 기록이 이미 700ms를 넘겨 다 지워진 뒤였다(=비교할 "과거"가 항상 없었음). oldestInWindow가
    // 방금 넣은 그 항목 자체(같은 타임스탬프)면 아직 비교할 과거 기록이 없는 것이므로, 의미없는
    // growthRatio=1.0을 계산하지 말고 이번 프레임은 조용히 건너뛴다(다음 프레임에서 최소 2개 이상
    // 쌓이면 그때부터 의미있는 비교가 시작됨).
    if (oldestInWindow.first == now) return
    // 2026-08-02 실기기 로그 분석("왜 첫 번째 손짓은 무조건 안 되고 5,6번 만에 되는지") — 기준을
    // "윈도우에서 가장 오래된 샘플"에서 "가장 작았던 샘플"로 바꾼다.
    // 로그 증거: 실패 구간은 handSize가 0.164~0.171에 붙은 채 growthRatio가 1.00 언저리에서 안
    // 움직였고(손을 이미 카메라 앞에 든 상태로 흔듦 — 비교할 "작았던 시점"이 윈도우에 없음),
    // 성공한 트리거는 전부 손이 멀리서 다가온 경우(1.18/1.69/2.24)였다. 오래된 샘플 기준은 손이
    // 이미 프레임 안에 크게 들어와 있으면 기준값 자체가 커서 비율이 영영 안 오르고, 사용자가
    // 우연히 손을 완전히 뺐다 다시 넣어야(=작은 샘플이 새로 생겨야) 겨우 걸린다 — "5,6번 만에
    // 된다"의 정체. 최솟값 기준이면 윈도우 안에 손이 조금이라도 작았던 순간이 있으면 바로 잡히고,
    // 손이 계속 같은 크기면 여전히 1.0 근처라 오탐도 늘지 않는다.
    val baselineSize = sizeHistory.minOf { it.second }
    if (baselineSize <= 0.0) return
    val growthRatio = handSize / baselineSize
    val pastRefractory = now - lastTriggerAtMs > REFRACTORY_MS

    // 2026-07-26 튜닝용 — 임계값을 못 넘긴 시도도 실측값을 남겨야 다음 조정 근거가 생긴다("안 됨"만
    // 알아서는 얼마나 못 미쳤는지 알 수 없었다).
    // 2026-08-02 출시 전 정리 — 게이트가 "임계값의 0.9배 이상"이었는데 임계값이 1.1로 낮아지면서
    // 0.99 이상이면 전부 걸려, 손이 화면에 잡혀 있는 동안 사실상 매 프레임(최대 초당 6~7회) 찍혔다.
    // 오늘 실기기 조사에서 이 로그가 다른 로그를 계속 밀어냈다. 진짜 "아깝게 실패"(임계값의 97% 이상)
    // 일 때만 남기도록 좁힌다 — 튜닝 근거는 그대로 확보하면서 스팸은 사라진다.
    // 2026-08-02 밤 — 세 번째 축: 방향 전환 횟수(진동). 앞선 두 축을 임계값만 계속 조정해온
    // 이력(GROWTH 1.5→1.2→1.1→1.05→1.3, SWEEP 0.9→0.75)이 전부 같은 함정에 빠져 있었다.
    //
    // 실측 데이터(사장님 시도 구간 로그):
    //   성공: sweep 0.86/1.01, growth 1.31/1.33/1.36/1.37/1.40
    //   실패(near-miss) 11회: sweep 0.62~0.74, growth 1.03~1.14  ← 전부 문턱 바로 아래
    //   그중 한 번은 sweep=0.7442 — 기준 0.75를 0.006 차이로 놓쳤다.
    // 즉 동작은 매번 비슷한데 "얼마나 멀리 갔나"라는 크기 하나로 자르니 경계에 걸쳐 6번에 1번만
    // 걸렸다. 여기서 임계값을 또 내리면 오탐이 터진다 — 실제로 1.05까지 내렸을 때 가만히 있어도
    // 노이즈만으로 1.16이 나와 되돌린 이력이 있다. 크기 축은 이미 한계에 도달했다.
    //
    // 그래서 "흔들기"의 정의 자체를 바꾼다. 손 흔들기를 다른 동작과 구분하는 건 이동 거리가 아니라
    // **방향을 반복해서 바꾼다는 것**이다(가만히 든 손도, 손을 한쪽으로 치우는 동작도 방향 전환이
    // 없다). 신호처리에서 진동을 세는 표준 기법(zero-crossing/극점 검출 + 진폭 게이팅)을 그대로
    // 쓴다 — 최소 진폭(MIN_SWING_RATIO)을 넘긴 방향 전환만 1회로 세므로 미세한 손떨림은 아무리
    // 많이 반전돼도 카운트되지 않는다. 크기 축과 달리 "오탐↔미탐"을 맞바꾸지 않고 둘 다 좋아진다.
    val reversals = countDirectionReversals(handSize)
    val oscillated = reversals >= MIN_REVERSALS

    val grew = growthRatio > GROWTH_RATIO_THRESHOLD
    val swept = sweepRatio > SWEEP_RATIO_THRESHOLD

    if (!grew && !swept && !oscillated && (growthRatio > GROWTH_RATIO_THRESHOLD * 0.97 || sweepRatio > SWEEP_RATIO_THRESHOLD * 0.7 || reversals >= 1)) {
      Log.d(TAG, "near-miss growth=$growthRatio(th=$GROWTH_RATIO_THRESHOLD) sweep=$sweepRatio(th=$SWEEP_RATIO_THRESHOLD) reversals=$reversals(th=$MIN_REVERSALS) handSize=$handSize")
    }

    // 접근(밀기)/스윕(한 번에 크게 훑기)/진동(좌우 흔들기)은 OR — 뭘 하든 의도는 "다음 영상"으로 동일하다.
    if ((grew || swept || oscillated) && pastRefractory) {
      val by = when { oscillated -> "oscillation"; swept -> "sweep"; else -> "growth" }
      Log.i(TAG, "WAVE detected by=$by growth=$growthRatio sweep=$sweepRatio reversals=$reversals handSize=$handSize")
      lastTriggerAtMs = now
      sizeHistory.clear()
      xHistory.clear()
      awaitingRearm = true
      rearmBelowSize = handSize * REARM_SIZE_RATIO
      // PaceSnapDetector와 동일한 이유로 메인 Looper에서 후속 스와이프를 호출한다(백그라운드
      // 스레드에서 dispatchGesture 계열 호출 시 큐잉/지연되는 문제가 실기기에서 확인된 바 있음).
      Handler(Looper.getMainLooper()).post { onWave() }
    }
  }
}
