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
  // 진단 하트비트 주기(2026-08-05) — 프레임이 계속 들어오는지 확인용.
  private const val HEARTBEAT_MS = 3000L
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

  // 2026-08-03 실측 데이터 기반 추가 축(속도). 진단 모드로 모은 1,134 프레임(평소 795 / 성공 58 /
  // 놓친 시도 35)을 분석한 결과가 근거이며, 상세 표는 PACE_PROJECT_MANAGEMENT.md에 있다.
  //
  // 왜 임계값 조정으로는 못 고쳤는가: growth 단독으로 기준을 내리면 회수와 오탐이 정확히 비례한다
  // (1.30→0건 회수/오탐 5.5%, 1.25→12건/9.8%, 1.20→21건/15.3%, 1.15→29건/20.1%). 즉 어디에
  // 선을 그어도 손해를 보는 축이다. sweep은 평소 중앙 0.321 vs 손짓 0.353으로 거의 안 갈라져
  // 원리적으로 구분이 불가능하고, reversals는 평소에도 2가 나와 오탐 축이었다.
  //
  // 반면 "얼마나 빨리 커졌나"(handSize 변화율, 배/초)는 실제로 갈라진다:
  //   평소(정지) 중앙 -0.06 / p95 0.56, 놓친 손짓 중앙 0.32, 성공 손짓 중앙 1.07
  // growth와 AND로 걸면 오탐과 미탐을 맞바꾸지 않는다 — 실측으로
  //   growth>1.20 AND 속도>0.3 → 놓친 35건 중 14건 회수, 평소 오탐 0.00%(0/827)
  //   growth>1.20 단독            → 21건 회수, 오탐 15.3%
  // 평소의 느린 손 움직임(오탐의 대부분)이 속도 조건에서 걸러지기 때문이다.
  private const val SPEED_ASSIST_GROWTH_THRESHOLD = 1.20
  // 2026-08-03 실기기 재측정으로 0.3 → 0.25. 근거: 사장님 실사용 로그에서 growth는 1.20을 넘겼는데
  // 속도만 미달해 놓친 4건이 **전부 정확히 0.278**이었다(0.3 바로 아래에 몰림). 0.25면 그 4건이 전부
  // 회수되고, 그 아래로 더 내려도 추가 회수가 없다(0.20/0.15에서도 회수 4건으로 동일) — 즉 0.25가
  // 이 분포에서 회수를 다 가져가는 최소값이다.
  // 이 값은 growth>1.20과 **AND**로만 쓰이므로 단독으로 오탐을 만들 수 없다. 평소(정지) 프레임은
  // growth가 1.0 근처라 애초에 이 분기에 도달하지 않는다.
  private const val SPEED_THRESHOLD_PER_SEC = 0.25
  // 두 피크는 시간이 어긋난다 — 손짓 초반은 빠르지만 아직 작고(속도 피크), 후반은 크지만 이미
  // 느려진다(성장 피크). 그래서 "같은 프레임에서 둘 다 만족"으로 걸면 57 프레임 중 5개만 통과해
  // 사실상 안 잡힌다. 속도는 최근 창 안의 최댓값으로 본다(성장 창 GROWTH_WINDOW_MS와 별개).
  private const val SPEED_PEAK_WINDOW_MS = 700L

  // 진단 모드 — 디버그 빌드에서만 자동 ON(start() 시 applicationInfo의 FLAG_DEBUGGABLE로 판단).
  // 릴리즈 빌드에서는 항상 false라 로그가 한 줄도 안 나간다.
  @Volatile private var diagEnabled = false
  private var lastDiagAtMs = 0L
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
  // 2026-08-03 — 0.75 → 0.22. **그동안의 전제가 틀렸다는 것이 무검열 측정으로 확정됐다.**
  //
  // 기존 기록에는 "평소(가만히) sweep 중앙 0.321, 손짓 0.353 — 거의 안 갈라져 원리적으로 구분 불가"로
  // 남아 있었고, 그 숫자 때문에 기준을 0.75로 높게 묶어둔 채 다른 축만 아홉 번 조정했다. 그런데 그
  // 0.321은 **검열된 데이터에서 나온 허수**였다 — near-miss 로그가 "임계값 근처"에서만 찍히도록 걸려
  // 있어서, 실제 정지 상태의 낮은 값들이 표본에 한 번도 안 들어왔다.
  //
  // 매 프레임 무조건 기록하는 진단 모드(diagEnabled)로 실기기에서 다시 재니 분포가 완전히 달랐다:
  //   가만히(390프레임): 중앙 0.030  p95 0.092  최대 0.185
  //   손짓  (307프레임): 중앙 0.274  p90 0.448  최대 0.561
  // 즉 두 분포는 거의 겹치지 않는다(가만히 최댓값 0.185 < 손짓 중앙값 0.274). 실제 값은 기록된
  // 0.321보다 10배 작았다.
  //
  // 임계값별 실측 트레이드오프(손짓 프레임 통과율 / 가만히 오탐률):
  //   0.75 → 0.3% / 0%   ← 기존값. sweep 축이 사실상 꺼져 있던 것과 같다(발동 73건 중 sweep 4건)
  //   0.30 → 42.0% / 0%
  //   0.25 → 54.7% / 0%
  //   0.22 → 62.9% / 0%   ← 채택. 오탐 0%를 유지하는 구간에서 회수가 가장 큰 값
  //   0.18 → 71.3% / 1.03%  ← 여기서부터 오탐 발생
  // 0.22는 관측된 가만히 최댓값(0.185)보다 확실히 위라 안전마진도 있다.
  //
  // ⚠️ 다음에 이 값을 만지려면 반드시 diagEnabled 로그로 "가만히" 구간을 함께 재서 위와 같은 표를
  // 만든 뒤에 정할 것. 손짓 데이터만 보고 정하면 정확히 이 실패를 반복한다.
  private const val SWEEP_RATIO_THRESHOLD = 0.22
  // 2026-08-05 — 손이 "정말 나갔다"고 판단하기까지의 유예. 스윕 양 끝의 모션블러/프레임 이탈로
  // 한두 프레임 놓치는 것과, 손을 실제로 내린 것을 구분한다. PROCESS_INTERVAL_MS(150ms) 기준
  // 두세 프레임 분량 — 실제로 손을 내리면 그보다 훨씬 오래 비므로 구분이 확실하다.
  private const val HAND_LOST_GRACE_MS = 400L
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
  // 마지막으로 손 랜드마크를 실제로 잡은 시각 — 위 HAND_LOST_GRACE_MS 판정용.
  private var lastLandmarkAtMs = 0L
  // 진단 카운터(2026-08-05) — analyzeFrame 진입 / detectAsync 호출 / onResult 수신.
  @Volatile private var framesIn = 0
  @Volatile private var detectSent = 0
  @Volatile private var resultsIn = 0
  @Volatile private var lastHeartbeatAtMs = 0L
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
    // 디버그 빌드에서만 매 프레임 진단 로그(위 diagEnabled 주석 참고). 릴리즈에서는 항상 false.
    diagEnabled = (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
    lastDiagAtMs = 0L
    val myGeneration = ++startGeneration
    Handler(Looper.getMainLooper()).post { startOnMainThread(context, onWave, myGeneration) }
  }

  private fun startOnMainThread(context: Context, onWave: () -> Unit, myGeneration: Int) {
    if (!running || myGeneration != startGeneration) return // stop() 또는 더 최신 start()가 먼저 있었음
    sizeHistory.clear()
    xHistory.clear()
    lastTriggerAtMs = 0L
    lastLandmarkAtMs = 0L // 새 세션 — 이전 세션의 "마지막으로 손을 본 시각"이 남으면 유예 판정이 틀어진다

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
    // ⭐ 2026-08-05 사장님 실기기("막판엔 손짓이 하나도 안 됐다") — 로그가 WAVE 직후 완전히 끊겼는데
    //   카메라는 Pace가 계속 잡고 있었다(= 카메라는 열어둔 채 분석만 영구 정지). 그런데 지금 로그로는
    //   **CameraX가 프레임을 안 주는 것**인지 **MediaPipe가 결과를 안 돌려주는 것**인지 구분이 안 된다
    //   (DIAG는 onResult에서만 찍히므로 둘 다 "로그 없음"으로 보인다).
    //   → 셋을 각각 세어 주기적으로 남긴다. HB가 아예 안 찍히면 CameraX가 멈춘 것이고,
    //     HB는 찍히는데 out이 안 늘면 MediaPipe가 멈춘 것이다.
    framesIn++
    if (now - lastHeartbeatAtMs >= HEARTBEAT_MS) {
      lastHeartbeatAtMs = now
      Log.i(TAG, "HB in=$framesIn sent=$detectSent out=$resultsIn running=$running")
    }
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
          if (running) { handLandmarker?.detectAsync(mpImage, now); detectSent++ }
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

  /**
   * 최근 SPEED_PEAK_WINDOW_MS 안에서 관측된 handSize 증가 속도의 최댓값(배/초).
   *
   * 인접한 두 샘플만 보고 (다음/이전 - 1) / 경과초로 계산한다. 손 크기 자체가 아니라 "이전 크기 대비
   * 몇 배가 되었나"를 초로 나눈 상대 속도라, 손과 카메라의 거리가 달라도 같은 동작이면 비슷한 값이
   * 나온다(handSize를 그대로 미분하면 가까이서 흔들 때만 커진다).
   *
   * 감소 구간(손을 빼는 동작)은 음수라 자연히 최댓값에서 밀려난다 — 별도 처리 불필요.
   * 샘플이 2개 미만이면 0.0(속도 조건 미충족)으로 안전하게 떨어진다.
   */
  private fun peakGrowthSpeedPerSec(now: Long): Double {
    if (sizeHistory.size < 2) return 0.0
    val recent = sizeHistory.filter { now - it.first <= SPEED_PEAK_WINDOW_MS }
    if (recent.size < 2) return 0.0
    var peak = 0.0
    for (i in 1 until recent.size) {
      val (tPrev, sPrev) = recent[i - 1]
      val (tCur, sCur) = recent[i]
      val dtSec = (tCur - tPrev) / 1000.0
      // 같은 밀리초에 두 샘플이 들어오면 0으로 나눠 Infinity가 되고, 그 한 프레임이 영원히 피크로
      // 남아 오탐을 만든다. dt가 유의미할 때만 센다(PROCESS_INTERVAL_MS=150이라 정상 경로는 안 걸림).
      if (dtSec < 0.02 || sPrev <= 0.0) continue
      val speed = (sCur / sPrev - 1.0) / dtSec
      if (speed > peak) peak = speed
    }
    return peak
  }

  private fun onResult(result: HandLandmarkerResult, onWave: () -> Unit) {
    resultsIn++
    if (result.landmarks().isEmpty()) {
      awaitingRearm = false // 손이 화면에서 사라짐 = 확실히 물러난 것으로 보고 재무장
      // 2026-08-02 — 손이 사라졌으면 이전 접근 동작의 크기 이력도 버린다. 남겨두면 다음에 손을
      // 다시 넣었을 때 "직전 동작의 큰 손"이 최솟값 기준에 섞여 들어가(또는 반대로 남은 작은 값이
      // 오탐을 유발해) 판정이 흐려진다. 매 접근을 깨끗한 상태에서 새로 재기 위함.
      //
      // ⚠️ 2026-08-05 사장님 실기기("손짓 되는데 여전히 첫 손짓은 잘 안 됨") — 위 초기화가
      //   **한 프레임만 비어도** 즉시 돌던 게 문제였다. 손을 크게 흔들면 스윕 양 끝에서 모션블러가
      //   생기거나 손이 화면 밖으로 살짝 나가 MediaPipe가 그 프레임만 손을 못 잡는다. 그때마다
      //   xHistory가 통째로 비워지므로 **스윕 폭을 한 번도 끝까지 재지 못한다** — 지워진 뒤 남은
      //   조각만 재게 되어 sweepRatio가 실제보다 훨씬 작게 나온다.
      //   첫 손짓이 특히 안 되는 이유: 첫 동작은 손이 화면 밖에서 들어오며 가장 크고 빠르다
      //   (=빈 프레임이 가장 많다). 두세 번째부터는 손이 이미 화면 가운데 있어 덜 끊긴다.
      //   ⭐ 코드에 남은 실측 기록이 이 설명과 정확히 맞는다 — "sweep 성공값(0.75~0.81)과
      //     실패값(0.14~0.23)이 같은 동작인데 4배씩 벌어진다"(아래 진단 로그 주석). 이력이 중간에
      //     지워지면 스윕의 일부만 재게 되어 딱 저런 분포가 나온다.
      //   → 손이 HAND_LOST_GRACE_MS 넘게 안 보일 때만 "진짜 나갔다"고 보고 버린다. 순간적으로
      //     놓친 프레임은 이력을 유지해 스윕을 끝까지 잇는다. 윈도우가 2.5초라 유예 400ms가
      //     남기는 잔여 샘플은 판정에 유의미한 영향을 주지 않는다(오탐 증가 위험 낮음).
      if (lastLandmarkAtMs != 0L && System.currentTimeMillis() - lastLandmarkAtMs > HAND_LOST_GRACE_MS) {
        sizeHistory.clear()
        xHistory.clear() // 가로 이동 이력도 같은 이유로 버린다(손이 나갔다 들어오면 새로 재기 시작)
      }
      return
    }
    lastLandmarkAtMs = System.currentTimeMillis()
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
    // 2026-08-03 사장님 실기기 보고("10번에 1번 되는 케이스도 있음") — 진단 모드. 디버그 빌드에서만
    // **매 프레임 전 축을 무조건** 남긴다(near-miss 게이트를 타지 않는다).
    //
    // 왜 무검열이어야 하나: 지금까지 아홉 번의 임계값 조정이 전부 실패한 근본 원인이 "임계값 근처만
    // 로그에 남는" 검열된 데이터였다. 그 데이터로는 "손은 보이는데 아무 동작도 안 할 때"의 분포
    // (=오탐 하한선)를 알 수 없어서, 매번 "실패가 문턱 바로 아래 몰려 있다"는 착시를 보고 문턱을
    // 내렸다가 오탐 폭증으로 되돌리기를 반복했다.
    //
    // dt(직전 처리 프레임과의 간격)를 같이 남기는 이유: sweep 성공값(0.75~0.81)과 실패값(0.14~0.23)이
    // 같은 동작인데 4배씩 벌어지는 것이 관측됐다. 손 흔들기는 보통 2~4Hz인데 처리 간격이 그에 근접하면
    // 샘플링이 극점을 놓쳐(에일리어싱) 이동폭이 실제보다 훨씬 작게 측정된다 — "될 때만 되는" 증상의
    // 유력한 설명이다. 실제 처리율을 알아야 이 가설을 확인할 수 있다.
    // 속도 축(위 상수 주석의 실측 근거 참고). sizeHistory는 GROWTH_WINDOW_MS(2.5초)까지 담고 있으므로
    // 여기서는 최근 SPEED_PEAK_WINDOW_MS 구간만 잘라 인접 샘플 간 변화율의 최댓값을 본다.
    // 단위는 "배/초" — (다음/이전 - 1) / 경과초. 손 크기로 나눈 상대값이라 카메라와의 거리에 무관하다.
    val peakSpeed = peakGrowthSpeedPerSec(now)

    if (diagEnabled) {
      val dt = if (lastDiagAtMs > 0) now - lastDiagAtMs else 0
      lastDiagAtMs = now
      Log.d(TAG, "DIAG dt=$dt g=$growthRatio s=$sweepRatio v=$peakSpeed size=$handSize n=${sizeHistory.size}")
    }

    val grew = growthRatio > GROWTH_RATIO_THRESHOLD
    val swept = sweepRatio > SWEEP_RATIO_THRESHOLD
    // 기존 두 축은 그대로 두고 조건을 하나 더 얹기만 한다(가산적) — 지금 잡히던 동작은 전부 그대로
    // 잡히고, 놓치던 것 중 일부만 추가로 잡힌다. 기존 축을 조이면서 새 축을 넣었다가 오히려 더
    // 나빠졌던 2026-08-02의 실패를 반복하지 않기 위함이다.
    val grewFast = growthRatio > SPEED_ASSIST_GROWTH_THRESHOLD && peakSpeed > SPEED_THRESHOLD_PER_SEC

    if (!grew && !swept && !grewFast &&
      (growthRatio > SPEED_ASSIST_GROWTH_THRESHOLD * 0.97 || sweepRatio > SWEEP_RATIO_THRESHOLD * 0.7)
    ) {
      // 2026-08-03 — 게이트를 GROWTH_RATIO_THRESHOLD(1.30)가 아니라 SPEED_ASSIST_GROWTH_THRESHOLD
      // (1.20) 기준으로 낮춘다. 새 축이 판정하는 구간이 1.20~1.30인데 기존 게이트로는 그 구간의
      // 실패가 로그에 안 남아, 다음에 이 축을 조정할 때 또 잘린 데이터만 보게 된다(그 "검열된 데이터"가
      // 그동안 임계값 조정이 매번 실패한 근본 원인이었다). speed도 같이 남긴다.
      Log.d(TAG, "near-miss growth=$growthRatio(th=$GROWTH_RATIO_THRESHOLD/$SPEED_ASSIST_GROWTH_THRESHOLD) sweep=$sweepRatio(th=$SWEEP_RATIO_THRESHOLD) speed=$peakSpeed(th=$SPEED_THRESHOLD_PER_SEC) handSize=$handSize")
    }

    // 접근(밀기)과 스윕(좌우 흔들기)은 OR — 둘 중 뭘 하든 사용자 의도는 "다음 영상"으로 동일하다.
    if ((grew || swept || grewFast) && pastRefractory) {
      val by = when {
        swept -> "sweep"
        grew -> "growth"
        else -> "growth+speed"
      }
      Log.i(TAG, "WAVE detected by=$by growth=$growthRatio sweep=$sweepRatio speed=$peakSpeed handSize=$handSize")
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
