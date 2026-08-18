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
  // 🔴 2026-08-15 사장님 지적 — "사람이 앞에 있을 때를 먼저 인식하고 손을 인식해야 하는 거 아냐?"
  // 정확히 맞는 지적이고, 지금까지 순서가 거꾸로였다. 이 감지기는 **사람이 있든 없든 손 모양만**
  // 찾는다. 그래서 커튼 흔들림·지나가는 그림자·이불 주름이 손으로 잡히고(실측 08:58:23
  // handSize=0.209), 그 오탐이 markUserActivity()를 태워 **수면감지를 통째로 무력화한다**
  // (QA_FULL_TEST US26-b). 사람이 앞에 있을 때만 손을 인정하면 그 오탐이 원인에서 사라진다.
  //
  // 모델은 tasks-vision 0.10.29에 **이미 들어 있다**(새 의존성 없음). BlazeFace short-range,
  // float16 230KB — 근거리(~2m) 전면 카메라용이라 이 용도에 정확히 맞는다.
  private const val FACE_MODEL_ASSET = "blaze_face_short_range.tflite"
  // 얼굴 확인 주기. 사람이 있다/없다는 초 단위로 바뀌는 값이 아니라 1초면 충분하고, 손 인식
  // 프레임 예산(PROCESS_INTERVAL_MS 150ms)을 뺏지 않는 게 이 값의 존재 이유다 — 손짓이 잘 안
  // 된다는 보고가 이미 있는 상태라(US21) 손 쪽 처리량은 1프레임도 줄이면 안 된다.
  private const val FACE_INTERVAL_MS = 1000L
  // 얼굴을 마지막으로 본 뒤 이만큼 안에 들어온 손 신호만 인정한다. 고개를 돌리거나 잠깐 화면
  // 밖으로 나가는 정도(초 단위)로 손짓이 죽으면 안 되므로 넉넉하게 잡는다.
  private const val FACE_PRESENCE_GRACE_MS = 15_000L
  private const val PROCESS_INTERVAL_MS = 150L
  // 2026-08-05 실측 — "매 넘김마다 첫 손짓이 안 된다"의 정체를 처음으로 숫자로 확인했다.
  // 실기기 로그(사장님이 실제로 손짓한 구간, WAVE 67회에서 연속 손짓 인접 간격 n=41):
  //     최소 1.33s / 25% 3.15s / 중앙 4.51s / 75% 5.57s
  //     1.2초 미만 0회 · 1.2~1.5초 3회 · 1.5~2.0초 2회 · 2.0~3.0초 5회 · 3초 이상 31회
  // 1.2초 미만이 **단 한 표본도 없다**. 감도 문제라면 바닥이 이렇게 칼같이 잘릴 수 없다 —
  // 이건 임계값이 아니라 구조적 정전 구간이다. 코드 경로와 정확히 맞는다:
  //   ① analyzeFrame이 트리거 후 REFRACTORY_MS(1200ms) 동안 detectAsync 자체를 건너뛴다
  //      → 그 1.2초간 랜드마크가 0개, sizeHistory/xHistory가 텅 빈 채로 유지된다.
  //   ② 1.2초가 지나 첫 샘플이 들어와도 oldestInWindow == now 라 그 프레임은 건너뛴다(+150ms).
  //   ③ 즉 물리적으로 가능한 최단 재발화는 1200+150 = 1350ms — 실측 최소값 1.33s와 일치.
  // 사용자가 넘긴 직후 1.35초 안에 손을 흔들면 **감지가 아니라 처리 자체가 없다.** 연속으로
  // 스킵할 때 정확히 그 구간에 손짓이 들어가므로 "첫 손짓만 안 된다"로 체감된다.
  // ⚠️ 그럼에도 이 값을 지금 낮추지 않는다. 낮추면 같은 한 번의 손짓이 두 번 발화할 수 있고
  //   (handSize는 손목~중지뿌리 거리라 손을 흔드는 동안 회전만으로도 0.6배 아래로 내려갔다
  //   올라온다 → awaitingRearm이 shrink로 조기 해제됨), 그게 바로 "왜 지맘대로 계속 넘어가"다.
  //   재무장이 shrink로 풀리는지 timeout으로 풀리는지 실측("rearmed after …ms by=") 없이 만지면
  //   지금까지 아홉 번 반복한 실패를 열 번째로 반복하는 것이다. 그 로그는 릴리즈 빌드에도
  //   남으므로, 다음 실사용 세션에서 logcat만 받으면 바로 확정된다.
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
  // 🔴 2026-08-16 실측 재조정 — 사장님 "손짓 너무 안 된다". 카메라 권한을 되살린 뒤 실제로 손짓하신
  //   구간의 로그를 모아 분포를 냈다(모두 **사장님이 실제로 손짓한** 표본이다):
  //     놓친 시도(near-miss) n=105 : min 0.126 / 25% 0.168 / 중앙 0.203 / 75% 0.269 / max 0.486
  //     성공한 손짓          : 0.096 0.120 0.133 0.136 0.180 0.249 0.262 0.319 0.391 0.403 0.469 0.487
  //   두 분포가 거의 완전히 겹친다. 즉 이건 **노이즈 대 신호가 아니라 같은 동작**인데, 임계값 0.22가
  //   그 분포 한가운데(중앙 0.203) 바로 위에 놓여 **절반 이상을 버리고 있었다.**
  //   게다가 같은 로그에서 growth는 대부분 1.0, speed는 0.0이라 **판정이 사실상 sweep 하나에 걸려
  //   있다** — 그 하나의 문턱이 분포 중앙에 있으면 체감은 "열 번에 서너 번"이 된다.
  //   → 놓친 시도의 25퍼센타일(0.168) 바로 아래로 내린다. 지금 버려지던 시도의 약 3/4을 회수한다.
  //   ⚠️ 오탐 방어는 임계값이 아니라 다른 축이 맡는다 — SWEEP_CONFIRM_FRAMES(연속 2프레임)가
  //     단발 노이즈를 막고, 얼굴 게이트가 "사람이 없을 때"를 통째로 막는다. 2026-08-15에 크기
  //     임계값(0.20)으로 오탐을 막으려다 실패한 전례가 있다 — 그 오탐의 handSize는 0.209였다.
  private const val SWEEP_RATIO_THRESHOLD = 0.16

  // 🔴 2026-08-09 사장님 지적 — "안 움직이거나 조금만 움직여도 카메라 위치에서 손짓으로 인식해서
  //   영상이 넘어간다", "카메라 높이에 손이 있으면 살짝만 움직여도 영상이 넘어가네".
  //
  //   실기기 로그(릴리즈 빌드, 22:22~22:26)로 원인을 확정했다 — 발동 8건 중 **7건이 by=sweep**이고,
  //   그중 2건은 **speed=0.0**(손 크기가 전혀 안 변함 = 사실상 정지)인데도 발동했다:
  //     22:22:08  by=sweep sweep=0.227 speed=0.0 handSize=0.197   ← 문턱 0.22 대비 여유 3%
  //     22:26:22  by=sweep sweep=0.246 speed=0.0 handSize=0.153
  //
  //   진짜 원인은 임계값이 아니라 **sweep에 시간 개념이 없다는 것**이었다.
  //   sweep = (윈도우 내 x 최대 - 최소) / handSize 인데 그 윈도우가 GROWTH_WINDOW_MS(2.5초)다.
  //   2.5초는 "훠이" 한 번(0.3~0.6초)보다 훨씬 길어서, 손을 카메라 높이에 들고 있기만 해도 그 사이
  //   생기는 미세한 드리프트/손떨림이 **누적**되어 손 너비의 22%를 넘긴다. 빠른 손짓과 느린 드리프트가
  //   같은 값으로 나오니 구분이 원리적으로 불가능했다.
  //
  //   → 임계값(0.22)은 그대로 두고 **빠져 있던 시간 조건을 넣는다.** sweep을 짧은 창에서만 재면
  //     같은 이동폭이라도 "빠르게 움직였을 때"만 값이 살아남는다:
  //       빠른 손짓  — 한 번의 스윙이 이 창 안에 통째로 들어와 값이 그대로 유지된다
  //       느린 드리프트 — 어느 700ms를 잘라도 조각만 들어와 값이 확 줄어든다
  //   SPEED_PEAK_WINDOW_MS(700ms)와 같은 값을 쓴다 — 그쪽도 "손짓 한 번의 시간 규모"로 실측해 정한 값이라
  //   같은 물리량을 같은 척도로 보게 된다.
  //
  //   ⚠️ 이 파일의 경고("SWEEP_RATIO_THRESHOLD를 만지려면 diag로 가만히 구간을 함께 재라")를 지킨다 —
  //     **임계값은 안 건드렸다.** 축의 정의(측정 구간)를 고친 것이라 그 경고의 대상이 아니다.
  //     그래도 회귀가 의심되면 위 실측 3줄과 같은 형식으로 by=/sweep=/speed= 로그를 다시 받아 비교할 것.
  private const val SWEEP_WINDOW_MS = 700L
  // Apple WWDC20 방식(연속 프레임 증거 누적)의 우리 버전 — 아래 sweptNow/sweepStreak 주석 참고.
  // PROCESS_INTERVAL_MS(150ms) x 2 = 300ms. 애플 권장 구간(0.1~0.8초) 안이고 실제 손짓보다 짧다.
  private const val SWEEP_CONFIRM_FRAMES = 2
  // 2026-08-05 — 손이 "정말 나갔다"고 판단하기까지의 유예. 스윕 양 끝의 모션블러/프레임 이탈로
  // 한두 프레임 놓치는 것과, 손을 실제로 내린 것을 구분한다. PROCESS_INTERVAL_MS(150ms) 기준
  // 두세 프레임 분량 — 실제로 손을 내리면 그보다 훨씬 오래 비므로 구분이 확실하다.
  private const val HAND_LOST_GRACE_MS = 400L
  // 🔴 2026-08-14 사장님 실기기 신고("아무것도 안 눌렀는데 3개가 넘어가", "지맘대로 검색으로 가있어",
  //   "쇼츠 선택하니까 좀 나오다 다른 영상으로 넘어간다") — 원인은 **이 값이 너무 낮았던 것**이다.
  //
  //   ⚠️ SWEEP_RATIO_THRESHOLD(0.22)는 **건드리지 않았다.** 이 파일이 "그 값을 만지려면 diag로
  //     가만히 구간을 함께 재라"고 경고하고 있고, 실제로 오탐 로그의 sweep은 0.296~0.594로 그
  //     임계보다 훨씬 위였다 — 임계값 문제가 아니었다는 뜻이다.
  //
  //   실기기 발동 34건의 handSize 분포(logcat 전수, 내림차순):
  //     0.342 0.327 0.297 0.284 0.280 0.273 0.267 0.266 0.264 0.263 0.229 0.212 0.202 0.200
  //     ── 여기서 뚜렷하게 끊긴다 ──
  //     0.189 0.188 0.174 0.172 0.168 0.167 0.164 0.158 0.156 0.156 0.154 0.149 0.143
  //     0.120 0.118 0.108 0.107 0.103 0.097 0.094
  //   두 무리로 갈린다: **0.20 이상 14건 / 0.19 이하 20건.**
  //   손을 실제로 카메라에 대고 "훠이" 하면 손이 화면의 25~35%를 차지한다(위 무리). 아래 무리는
  //   화면의 10% 안팎 — 폰을 든 손이 화면 가장자리에 걸치거나, 얼굴/배경 일부를 손으로 오인한
  //   것이다. 기존 0.03(화면의 3%)은 그 전부를 통과시켰다.
  //
  // → 0.20으로 올린다. 위 실측에서 오탐 무리 20건(59%)이 통째로 걸러지고, 의도적 손짓(0.25~0.35)은
  //   여유 있게 통과한다. 이 값은 "얼마나 크게 보이는가"라 조명·속도와 무관해 sweep보다 훨씬 안정적이다.
  // ⚠️ 다음에 이 값을 만질 때도 위처럼 **발동 로그의 handSize 전수 분포**를 먼저 뽑아서 정할 것.
  // 2026-08-15 실기기 — 0.20은 틀린 처방이었다. 사장님이 손짓을 10번 넘게 했는데 30초 동안
  // near-miss 로그조차 한 줄도 안 남았다(19:55:52~19:56:22). 성공한 두 번의 handSize가 0.274/0.230,
  // 즉 **임계값 바로 위**였다 — 손을 렌즈에 바짝 붙여야만 겨우 걸리는 상태였다.
  // 결정적으로, 이 값을 0.20으로 올리게 만든 그 오탐의 실측 handSize가 **0.209**였다.
  // 0.20은 그 오탐을 막지도 못하면서 진짜 손짓만 잘라냈다 — 크기는 사람과 커튼을 가르는 축이 아니다.
  // 그 역할은 이제 얼굴 게이트(shouldTrustHandSignal)가 제대로 맡는다. 원래 0.03보다는 높게 두어
  // 명백한 노이즈만 거르고, 실사용 거리는 되돌린다.
  private const val MIN_HAND_SIZE = 0.08
  // 크기로 버린 프레임도 최소한 흔적은 남긴다 — 위 30초 공백이 진단을 통째로 막았다.
  private const val SMALL_HAND_LOG_INTERVAL_MS = 1000L
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
  // ── 사람 존재 확인(2026-08-15) ──
  private var faceDetector: com.google.mediapipe.tasks.vision.facedetector.FaceDetector? = null
  private var lastFaceCheckAtMs = 0L
  private var lastSmallHandLogAtMs = 0L
  /** 이 세션에서 마지막으로 얼굴을 본 시각. 0 = 아직 한 번도 못 봄. */
  @Volatile private var lastFaceSeenAtMs = 0L
  /** 이 세션에서 얼굴을 **한 번이라도** 봤는가 — 아래 게이트의 안전장치가 이 값을 본다. */
  @Volatile private var faceEverSeen = false
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
  // sweep 조건이 연속으로 몇 프레임 만족됐는지(오탐 방지 — SWEEP_CONFIRM_FRAMES 주석 참고).
  private var sweepStreak = 0
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
      // 🔴 2026-08-16 사장님 "권한 노티도 없고 손짓은 안 되는데" — 정확한 지적이다.
      //   여기서 조용히 return하는 바람에, 카메라 권한이 꺼지면 손짓이 **아무 설명 없이 죽는다.**
      //   실제로 오늘 그 상태로 한참을 헤맸다(앱 데이터 초기화로 권한이 날아갔는데 아무도 몰랐다).
      //   사용자 입장에선 "손짓 토글은 켜져 있는데 안 먹는다"로만 보인다 — 원인을 알 길이 없다.
      //   접근성 권한이 꺼졌을 때 알림을 띄우는 것과 같은 취급을 해야 한다.
      Log.w(TAG, "CAMERA not granted — not starting")
      PaceOverlayService.notifyCameraPermissionMissing(context)
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
    sweepStreak = 0
    lastTriggerAtMs = 0L
    lastLandmarkAtMs = 0L // 새 세션 — 이전 세션의 "마지막으로 손을 본 시각"이 남으면 유예 판정이 틀어진다
    lastFaceCheckAtMs = 0L
    lastFaceSeenAtMs = 0L
    faceEverSeen = false

    // 얼굴 감지기는 **동기 IMAGE 모드**로 만든다. 손 쪽(LIVE_STREAM 비동기)과 달리 초당 1회만
    // 부르므로 콜백을 얽을 이유가 없고, BlazeFace short-range는 128x128 CPU 추론이라 분석 스레드를
    // 잠깐 잡아도 무시할 만하다. 실패해도 손 인식은 그대로 살려둔다 — 얼굴은 어디까지나 게이트다.
    faceDetector = try {
      com.google.mediapipe.tasks.vision.facedetector.FaceDetector.createFromOptions(
        context,
        com.google.mediapipe.tasks.vision.facedetector.FaceDetector.FaceDetectorOptions.builder()
          .setBaseOptions(
            BaseOptions.builder()
              .setModelAssetPath(FACE_MODEL_ASSET)
              .setDelegate(Delegate.CPU)
              .build()
          )
          .setRunningMode(RunningMode.IMAGE)
          .setMinDetectionConfidence(0.5f)
          .build()
      )
    } catch (e: Exception) {
      Log.e(TAG, "FaceDetector init failed — 손짓은 게이트 없이 기존대로 동작한다", e)
      null
    }

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
      try { faceDetector?.close() } catch (_: Exception) {}
      faceDetector = null
      faceEverSeen = false
      lastFaceSeenAtMs = 0L
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
      // 2026-08-15 — 얼굴 상태를 여기 얹는다. 얼굴 게이트는 "어두운 방에서 얼굴을 못 봐서 손짓이
      // 죽는가"를 실측해야 신뢰할 수 있는데, 그걸 볼 수 있는 주기적 신호가 이것뿐이다.
      val faceAge = if (faceEverSeen) "${now - lastFaceSeenAtMs}ms전" else "없음"
      Log.i(TAG, "HB in=$framesIn sent=$detectSent out=$resultsIn running=$running face=$faceAge gate=${if (faceDetector != null && faceEverSeen) "on" else "off"}")
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
      // 2026-08-15 — 얼굴 확인은 **손의 냉각기간과 무관하게** 자체 주기로 돈다. 사람이 자리를 뜬
      // 순간이 하필 냉각기간과 겹쳤다고 그 1초를 건너뛸 이유가 없다. 비싼 YUV→Bitmap 변환은 둘 중
      // 하나라도 필요할 때만 한 번 하고 **같은 비트맵을 나눠 쓴다**(변환을 두 번 하지 않는다).
      val faceDue = faceDetector != null && now - lastFaceCheckAtMs >= FACE_INTERVAL_MS
      val handDue = now - lastTriggerAtMs > REFRACTORY_MS
      if (!faceDue && !handDue) return
      val bitmap = yuv420ToBitmap(proxy)
      if (bitmap != null) {
        val rotated = rotateBitmap(bitmap, proxy.imageInfo.rotationDegrees)
        if (faceDue) {
          lastFaceCheckAtMs = now
          detectFace(rotated, now)
        }
        if (!handDue) return
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

  /**
   * 사람이 카메라 앞에 있는지 한 번 확인한다(초당 1회). 결과는 시각만 기록하고 판단은 호출부에 맡긴다.
   *
   * 얼굴 감지가 실패해도(어두움/각도) 조용히 지나간다 — 여기서 손짓을 직접 막지 않는다.
   * 게이트 판단은 아래 shouldTrustHandSignal()에 모아두었고, 그쪽에 안전장치가 있다.
   */
  private fun detectFace(bitmap: android.graphics.Bitmap, now: Long) {
    try {
      val result = faceDetector?.detect(BitmapImageBuilder(bitmap).build()) ?: return
      if (result.detections().isNotEmpty()) {
        if (!faceEverSeen) Log.i(TAG, "FACE 첫 인식 — 이제부터 손짓 게이트가 작동한다")
        faceEverSeen = true
        lastFaceSeenAtMs = now
      }
    } catch (e: Exception) {
      Log.w(TAG, "face detect failed", e)
    }
  }

  /**
   * 지금 잡힌 손 신호를 믿어도 되는가 — **사람이 앞에 있을 때만 손을 인정한다**(2026-08-15).
   *
   * 안전장치가 핵심이다: **이 세션에서 얼굴을 한 번도 못 봤으면 게이트를 걸지 않는다.**
   *   · 얼굴이 잡히는 환경(밝은 방, 정면) → 커튼/그림자 오탐이 차단된다. 오늘보다 낫다.
   *   · 얼굴이 안 잡히는 환경(깜깜한 방, 폰이 천장을 봄) → 게이트가 아예 안 걸려 **오늘과 똑같이**
   *     동작한다. 침대에서 쓰는 핸즈프리를 조용히 죽이지 않는다.
   * 즉 어느 쪽으로도 지금보다 나빠지지 않는다. 이 안전장치 없이 "얼굴 없으면 무조건 차단"으로 두면,
   * 어두운 방에서 손짓이 통째로 죽는 걸 사용자는 원인도 모른 채 겪게 된다.
   */
  private fun shouldTrustHandSignal(now: Long): Boolean {
    if (faceDetector == null || !faceEverSeen) return true // 게이트 미적용(위 안전장치)
    return now - lastFaceSeenAtMs <= FACE_PRESENCE_GRACE_MS
  }

  /**
   * 사람이 자리를 비운 지 얼마나 됐나(ms). 판단 불가면 -1.
   *
   * 수면감지가 "무입력 시간"으로 **추측**하던 것을 이 값으로 **직접** 알 수 있다 — 자동넘김이
   * 켜져 있으면 깨어 있어도 아무 입력이 없다는 게 무입력 지표의 근본 한계였다(사장님 지적).
   * 얼굴을 한 번도 못 본 세션에서는 -1을 돌려준다 — "사람이 없다"와 "카메라가 사람을 못 본다"를
   * 구분하지 못하면 어두운 방에서 멀쩡히 보던 세션을 끊게 된다.
   */
  fun personAbsentForMs(): Long {
    if (!running || faceDetector == null || !faceEverSeen) return -1L
    return System.currentTimeMillis() - lastFaceSeenAtMs
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
    // 2026-08-15 — 렌즈 가림도 사람이 앞에 있을 때만 인정한다. 이불이 덮이거나 폰이 엎어져도
    // 밝기는 똑같이 급감하는데, 그건 "다음 영상"이 아니라 오히려 아무도 안 본다는 신호다.
    if (!shouldTrustHandSignal(now)) {
      Log.i(TAG, "WAVE 차단 ($reason) — 사람 없음(마지막 얼굴 ${now - lastFaceSeenAtMs}ms 전)")
      lastTriggerAtMs = now
      sizeHistory.clear(); lumaHistory.clear()
      return
    }
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
      // ⛔ 2026-08-05 되돌림 — 위 유예(HAND_LOST_GRACE_MS) 도입은 **오탐 회귀를 만들었다.**
      //   실기기 로그(16분간 WAVE 36회, 사용자는 흔들지 않음):
      //     s=0.580 g=1.0 v=0.0 / s=0.262 g=1.0 v=0.0 / s=2.307 g=1.0 v=0.0
      //   성장 1.0(=손 크기 그대로) + 속도 0.0(=안 움직임)인데 sweep만 임계를 넘었다. sweep이 2.3까지
      //   튄 것이 결정적 단서다 — 손 인식이 잠깐 끊겼다가 **다른 위치에서** 다시 잡히면, 이력을
      //   유지한 탓에 그 두 위치의 점프가 "가로로 크게 흔들었다"로 계산된다. 실제로는 안 움직였다.
      //   그 결과 triggerNext가 연달아 불려 영상이 제멋대로 넘어갔다(사장님: "왜 지맘대로 계속 넘어가").
      //   → 원래대로 손이 안 보이면 이력을 버린다. 첫 손짓이 덜 잡히는 것보다 오탐이 훨씬 나쁘다.
      //   ⚠️ "첫 손짓이 잘 안 된다"는 문제는 여전히 남아 있다. 다만 원인은 이 이력 초기화가 아니라
      //     발화 직후의 재무장/불응 구간(REFRACTORY_MS + awaitingRearm + sizeHistory.clear)일 가능성이
      //     크다 — 그쪽은 실측(rearmed after …ms 로그) 없이 건드리지 않는다.
      sizeHistory.clear()
      xHistory.clear() // 가로 이동 이력도 같은 이유로 버린다(손이 나갔다 들어오면 새로 재기 시작)
      sweepStreak = 0 // 연속 프레임 증거도 함께 버린다 — 안 그러면 손이 다시 들어오자마자 확정된다
      return
    }
    lastLandmarkAtMs = System.currentTimeMillis()
    val landmarks = result.landmarks()[0]
    if (landmarks.size <= 9) return
    val wrist = landmarks[0]
    val middleMcp = landmarks[9]
    val handSize = hypot((wrist.x() - middleMcp.x()).toDouble(), (wrist.y() - middleMcp.y()).toDouble())
    if (handSize < MIN_HAND_SIZE) {
      val nowMs = System.currentTimeMillis()
      if (nowMs - lastSmallHandLogAtMs >= SMALL_HAND_LOG_INTERVAL_MS) {
        lastSmallHandLogAtMs = nowMs
        Log.d(TAG, "손 감지됨이나 너무 작아 무시 handSize=$handSize (min=$MIN_HAND_SIZE) — 더 가까이 대야 함")
      }
      return
    }

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
    // ⚠️ xHistory 자체는 GROWTH_WINDOW_MS(2.5초)로 유지하되(다른 축이 그 길이를 쓴다),
    //   sweep은 **최근 SWEEP_WINDOW_MS(700ms) 구간만** 잘라서 잰다 — 위 SWEEP_WINDOW_MS 주석의 근거.
    //   이게 없으면 2.5초에 걸친 느린 드리프트가 빠른 손짓과 같은 값으로 나온다(실측: speed=0.0인데
    //   sweep=0.227로 발동).
    val sweepWindow = xHistory.filter { now - it.first <= SWEEP_WINDOW_MS }
    val sweepRatio = if (sweepWindow.size >= 2) {
      (sweepWindow.maxOf { it.second } - sweepWindow.minOf { it.second }) / handSize
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
    // 🔴 2026-08-09 사장님 지시("애플 어떻게 하는지도 봐") — Apple의 공식 방식을 확인해 반영했다.
    //   WWDC20 "Detect Body and Hand Pose with Vision"에서 애플이 제시하는 오탐 방지 규칙은
    //   임계값 조정이 아니라 **증거 누적(evidence accumulation)** 이다: 조건을 만족한 프레임이
    //   **연속 3프레임** 쌓여야 그 상태를 확정한다. 일반 CV 통설도 같다 — 오탐은 한 프레임에서만
    //   튀고 다음 프레임에서 사라지므로, 최소 지속시간(대략 0.1~0.8초) 동안 연속으로 나와야 인정한다.
    //   우리 감지기는 **단 한 프레임**이 문턱을 넘으면 바로 발동했다. 실측한 오탐 2건이 정확히
    //   그 모습이다(sweep=0.227 / 0.246, 문턱 0.22를 살짝 넘은 단발).
    //   → sweep 축에만 연속 프레임 요구를 건다. PROCESS_INTERVAL_MS(150ms) 기준 2프레임 = 300ms로,
    //     애플이 말하는 구간(0.1~0.8초) 안이고 실제 손짓(0.3~0.6초)보다는 짧아 회수를 안 깎는다.
    //   ⚠️ growth/growth+speed에는 안 건다 — 그쪽은 이미 두 축(크기·속도)의 AND라 단발 노이즈로
    //     동시에 만족되기 어렵고, 오탐 로그도 전부 sweep이었다. 필요 이상으로 조이면 2026-08-02처럼
    //     "안 잡힌다"로 되돌아간다.
    // 🔴 2026-08-15 실측 — 사장님 "검색해서 고른 양다일 영상이 조금 보이다 넘어간다". 범인은 sweep
    //   축 오탐 2건이었다:
    //     23:58:23 sweep=0.319 speed=0.897 handSize=0.131
    //     23:58:45 sweep=0.835 speed=0.049 handSize=0.096   ← 사실상 **멈춰 있는 손**
    //   두 번째가 이 축의 약점을 그대로 보여준다. 이 파일이 스스로 측정해 적어둔 대로
    //   "sweep은 평소 중앙 0.321 vs 손짓 0.353으로 거의 안 갈라져 원리적으로 구분이 불가능"한데,
    //   **세 축 중 sweep만 속도 조건이 없었다.** growth+speed는 이미 크기·속도의 AND다.
    //   → sweep에도 최소 속도를 건다. 실측 분포(평소 정지 중앙 -0.06 / p95 0.56, 성공 손짓 중앙 1.07)에
    //     비춰 정지 상태의 좌우 흔들림은 걸러지고 실제로 손을 젓는 동작은 남는다.
    //   ⚠️ 손 크기(MIN_HAND_SIZE)는 다시 올리지 않는다 — 오늘 저녁에 이미 틀린 손잡이로 판명났다
    //     (오탐 handSize 0.209는 못 막으면서 진짜 손짓 0.10~0.15만 잘라냈다).
    // 🔴 2026-08-16 원복 — 어제 여기에 peakSpeed AND를 걸었다가 **손짓이 통째로 죽었다.**
    //   사장님 "지금 기기 손짓 하나도 안 먹어". 로그가 그대로 증명한다: 카메라·얼굴은 정상인데
    //   (HB ... face=170ms전 gate=on) WAVE도 near-miss도 "너무 작아 무시"도 **한 줄도 없었다.**
    //   성공했던 sweep 손짓들의 실측 speed가 0.0 / 0.0 / 0.049 / 0.168로 전부 임계(0.25) 아래였다:
    //     22:17:07 WAVE by=sweep speed=0.0
    //     23:58:45 WAVE by=sweep speed=0.049
    //   이유는 명확하다 — peakSpeed는 **handSize 변화율**(카메라 쪽으로 다가오는 속도)이다.
    //   좌우로 흔드는 동작은 손이 가까워지지 않아 크기가 거의 안 변하고, 따라서 speed가 원래 0 근처다.
    //   크기 축에서 재는 속도를 좌우 흔들기에 요구한 것 자체가 틀렸다.
    //   게다가 오탐(23:58:45 speed=0.049)과 정탐(22:17:07 speed=0.0)이 이 축에서 겹친다 — 원리적으로
    //   분리가 안 되는 축이라 임계값을 어디에 두어도 정탐을 같이 잘라낸다.
    //   → 오탐은 다른 수단으로 막는다. 얼굴 게이트(사람 없으면 손 신호 무시)와 triggerNext()의
    //     "직접 고른 영상 보호"가 그 역할이고, 둘 다 이미 들어가 있다.
    val sweptNow = sweepRatio > SWEEP_RATIO_THRESHOLD
    sweepStreak = if (sweptNow) sweepStreak + 1 else 0
    val swept = sweepStreak >= SWEEP_CONFIRM_FRAMES
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
      // 2026-08-15 — 사람이 앞에 없으면 이건 손이 아니다(커튼/그림자/이불). shouldTrustHandSignal
      // 주석의 안전장치 참고. 차단해도 상태는 그대로 리셋한다 — 안 그러면 같은 프레임 이력으로
      // 다음 프레임에서 또 걸려 로그만 도배된다.
      if (!shouldTrustHandSignal(now)) {
        Log.i(TAG, "WAVE 차단 by=$by handSize=$handSize — 사람 없음(마지막 얼굴 ${now - lastFaceSeenAtMs}ms 전)")
        lastTriggerAtMs = now
        sizeHistory.clear(); xHistory.clear(); sweepStreak = 0
        return
      }
      Log.i(TAG, "WAVE detected by=$by growth=$growthRatio sweep=$sweepRatio speed=$peakSpeed handSize=$handSize")
      lastTriggerAtMs = now
      sizeHistory.clear()
      xHistory.clear()
      sweepStreak = 0
      awaitingRearm = true
      rearmBelowSize = handSize * REARM_SIZE_RATIO
      // PaceSnapDetector와 동일한 이유로 메인 Looper에서 후속 스와이프를 호출한다(백그라운드
      // 스레드에서 dispatchGesture 계열 호출 시 큐잉/지연되는 문제가 실기기에서 확인된 바 있음).
      Handler(Looper.getMainLooper()).post { onWave() }
    }
  }
}
