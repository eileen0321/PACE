import ExpoModulesCore
import AVFoundation
import SoundAnalysis
import ARKit
import Vision
import MediaPipeTasksVision

// 2026-08-02 사장님 지시 — 진단 NSLog을 Release 빌드에서 컴파일-아웃(제출용 콘솔 노이즈 제거).
// 손짓/오디오/카메라 로직은 한 줄도 바꾸지 않고, 로깅 호출만 NSLog→paceGLog로 대체한다.
// DEBUG: NSLogv로 기존과 100% 동일 출력. Release: no-op(로그 없음). 파일 스코프(모든 타입에서 호출).
#if DEBUG
private func paceGLog(_ format: String, _ args: CVarArg...) {
  withVaList(args) { NSLogv(format, $0) }
}
#else
@inline(__always) private func paceGLog(_ format: String, _ args: CVarArg...) {}
#endif

// Pace iOS 핸즈프리 "다음 영상 넘기기" 트리거 모듈 (2026-07-20, 사용자 지시).
// AirPods 블루투스 리모컨(구 useFeedRemoteControl.ios.ts)을 대체 — 두 가지 무접촉 신호로 넘긴다:
//   1) 핑거스냅 소리  → iOS SoundAnalysis 내장 분류기(version1)의 "finger_snapping" 클래스로 감지.
//      (macOS/iOS 내장 303개 사운드 모델에 finger_snapping 존재 확인함 — 커스텀 ML 불필요.)
//   2) 고개짓(턱 끄덕임) → ARKit ARFaceTrackingConfiguration의 얼굴 트래킹으로 머리 pitch를 읽어
//      "아래로 끄덕→복귀" 패턴을 감지. ⚠️ ARKit face tracking은 TrueDepth 기기 전용(시뮬레이터 불가).
//
// JS로는 onSnap / onHeadNod 이벤트를 emit한다. 실제 "무엇을 할지"(다음/이전/토글)와 임계값·디바운스는
// JS(useFeedRemoteControl.ios.ts)에서 결정 — 네이티브는 "신호 감지"만 담당(관심사 분리).
//
// 컴파일 안전성: 모듈 본체는 최소버전에서 컴파일돼야 하므로 SoundAnalysis(iOS 13+)/ARKit(iOS 11+)
// 호출은 런타임 가드(#available, isSupported)로 감싼다.

public class PaceGestureModule: Module {
  private var headDetector: HeadDetector?
  private var waveDetector: WaveDetector?

  public func definition() -> ModuleDefinition {
    Name("PaceGesture")

    Events("onSnap", "onHeadNod", "onHandWave", "onError", "onDiag")

    // mode: "snap" | "head" | "wave" | "both" — 어떤 감지기를 켤지. ("both" = 스냅+손짓, iOS 핸즈프리 2종.
    // 고개짓(head)은 2026-07-23 "비현실적" 판단으로 제외돼 명시 요청 시에만.)
    // 2026-07-21(2차): 핑거스냅 재활성 (사용자 지시 "핑거스냅도 제대로"). 예전에 "쇼츠 소리에 스냅이
    // 묻힌다"고 껐지만, Android가 AcousticEchoCanceler로 해결한 것처럼 iOS도 **Voice Processing 내장
    // AEC**(setVoiceProcessingEnabled)로 스피커→마이크 에코(=재생 중인 쇼츠 소리)를 상쇄해 스냅만
    // 남긴다(SnapDetector.begin 참고). 마이크 권한은 snap/both일 때만 요청.
    AsyncFunction("start") { (mode: String, promise: Promise) in
      DispatchQueue.main.async {
        if mode == "wave" || mode == "both" { self.startWave() }
        if mode == "head" { self.startHead() }
        promise.resolve(nil)
      }
    }

    Function("stop") {
      self.headDetector?.stop()
      self.headDetector = nil
      self.waveDetector?.stop()
      self.waveDetector = nil
    }

    // 디버그: JS(WebView) 문자열을 NSLog로만(콘솔). 파일 로깅은 제출 전 제거함.
    Function("nativeLog") { (msg: String) in
      paceGLog("PACEWV %@", msg)
    }

    // 카메라 권한 상태 — 손짓 토글이 "거부 시 disable + 설정 링크"를 판단하는 데 JS가 사용.
    Function("cameraPermissionStatus") { () -> String in
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "notDetermined"
      @unknown default: return "notDetermined"
      }
    }
    // 카메라 권한 요청(notDetermined일 때 시스템 프롬프트) — 손짓 토글 켤 때 호출. 결과(허용 여부) 반환.
    AsyncFunction("requestCameraPermission") { (promise: Promise) in
      AVCaptureDevice.requestAccess(for: .video) { granted in promise.resolve(granted) }
    }

    // 영상 전환(페이지 리로드, ~1.6s) 동안 손짓 추론을 잠깐 멈춰 CPU를 페이지 로드에 양보한다.
    // 카메라는 켠 채(재시작 비용 0)라 재개가 즉시다. 불응(1200ms)이 어차피 재발화를 막으므로 손짓 유실 없음.
    // ⚠️ JS는 반드시 안전 타임아웃으로 자동 재개해야 함(ready 이벤트 누락 대비) — false를 못 부르면 손짓이 죽음.
    Function("setWavePaused") { (paused: Bool) in
      self.waveDetector?.setPaused(paused)
    }

    // 고개짓 지원 기기인지(TrueDepth). JS가 UI 노출 여부 판단에 사용.
    Function("isHeadGestureSupported") { () -> Bool in
      if #available(iOS 11.0, *) { return ARFaceTrackingConfiguration.isSupported }
      return false
    }

    OnDestroy {
      self.headDetector?.stop()
      self.waveDetector?.stop()
    }
  }

  // 손짓(전면카메라 "손 흔들기/휘젓기")으로 다음 넘김 — 안드로이드 PaceHandWaveDetector(MediaPipe) 대응.
  // iOS는 Vision VNDetectHumanHandPoseRequest로 손 랜드마크를 얻고, "손이 카메라로 다가오는(=손 크기가
  // 짧은 창 안에서 급격히 커지는)" 모션을 감지한다(안드로이드와 동일한 모션-기반 휴리스틱, 특정 포즈
  // 분류 아님). Focus Session ON 동안만 켜져 게이팅됨(카메라 상시 구동 방지 — 배터리/프라이버시).
  private func startWave() {
    paceGLog("[pace-wave] startWave() called (SESSION ON→감지기 시작)")
    guard #available(iOS 14.0, *) else {
      sendEvent("onError", ["kind": "wave", "message": "Hand pose needs iOS 14+"])
      return
    }
    if waveDetector != nil { paceGLog("[pace-wave] startWave: 이미 실행중(skip)"); return }
    let d = WaveDetector(
      onWave: { [weak self] in self?.sendEvent("onHandWave", [:]) },
      onError: { [weak self] msg in self?.sendEvent("onError", ["kind": "wave", "message": msg]) },
      onDiag: { [weak self] text in self?.sendEvent("onDiag", ["kind": "wave", "text": text]) }
    )
    waveDetector = d
    d.start()
  }

  // 2026-08-15 — "리모컨 연결됨" 판정에 AVAudioSession.currentRoute를 썼던 이전 버전(isBluetoothAudioConnected)은
  // 삭제했다: 실기기 재확인 결과 저가 BT 클리커는 오디오 프로파일이 아니라 순수 HID로 붙어 애초에
  // 라우트에 안 잡히고(영원히 회색), 반대로 이름 모를 BT 오디오 기기는 리모컨이 아닌데도 초록이 되는
  // 정반대 오류도 있었다. iOS는 HID 기기 연결 상태를 서드파티 앱에 아예 안 준다(Apple Developer
  // Forums 확인, Android InputDevice.descriptor에 대응하는 API가 구조적으로 없음) — 대신
  // PaceVolumeKeyModule의 onVolumeButton(리모컨 키 입력) 발생 시각을 JS가 직접 기록해 "최근
  // 감지됨"으로 표시한다(bluetoothService.ios.ts 참고). 이 파일에서 오디오 라우트로 리모컨을
  // 판정하는 로직은 더 이상 없다.

  private func startHead() {
    guard #available(iOS 11.0, *), ARFaceTrackingConfiguration.isSupported else {
      sendEvent("onError", ["kind": "head", "message": "Head gesture needs a TrueDepth device (not simulator)"])
      return
    }
    if headDetector != nil { return }
    let d = HeadDetector(
      onNod: { [weak self] in self?.sendEvent("onHeadNod", [:]) },
      onError: { [weak self] msg in self?.sendEvent("onError", ["kind": "head", "message": msg]) }
    )
    headDetector = d
    d.start()
  }
}

// MARK: - 핑거스냅 감지 제거 (2026-08-03) — 애플 심사 90683(NSMicrophoneUsageDescription 누락).
// MD C6: 마이크 기반 핑거스냅은 애플 심사 불허 + 이미 비활성 결정(iOS는 useFeedRemoteControl가 'wave'만 start).
// 마이크 API(requestRecordPermission/.playAndRecord/AVAudioEngine.installTap)를 참조하던 SnapDetector/startSnap을
// 통째로 제거해 바이너리에서 마이크 참조 자체를 없앤다.

// MARK: - 고개짓(턱 끄덕임) 감지 (ARKit 얼굴 트래킹, TrueDepth 기기 전용)
@available(iOS 11.0, *)
private final class HeadDetector: NSObject, ARSessionDelegate {
  private let session = ARSession()
  private let onNod: () -> Void
  private let onError: (String) -> Void
  private var baselinePitch: Float?
  private var armed = true          // 끄덕임 상태머신: armed(중립) → 아래로 넘김 → 복귀 시 fire
  private var lastFire: TimeInterval = 0

  init(onNod: @escaping () -> Void, onError: @escaping (String) -> Void) {
    self.onNod = onNod
    self.onError = onError
  }

  func start() {
    let config = ARFaceTrackingConfiguration()
    config.isLightEstimationEnabled = false
    session.delegate = self
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }

  func stop() { session.pause() }

  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
    guard let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
    // 머리 pitch(위아래 끄덕임)를 face transform에서 추출. transform.columns.2가 얼굴 정면 방향.
    let m = face.transform
    // pitch ≈ asin(-forward.y) — 아래로 숙이면 값이 커진다(부호는 좌표계 기준, 상대 변화만 사용).
    let forwardY = m.columns.2.y
    let pitch = asin(max(-1, min(1, -forwardY)))

    if baselinePitch == nil { baselinePitch = pitch; return }
    let base = baselinePitch!
    let delta = pitch - base

    // 끄덕임: 중립에서 임계 이상 아래로 숙였다가(≈0.35rad, ~20°) 다시 중립 근처로 복귀하면 1회.
    let nodDownThreshold: Float = 0.35
    let recoverThreshold: Float = 0.15
    if armed && delta > nodDownThreshold {
      armed = false // 아래로 숙임 감지 — 복귀 대기
    } else if !armed && delta < recoverThreshold {
      armed = true  // 복귀 완료 → 끄덕임 1회 확정
      let now = CFAbsoluteTimeGetCurrent()
      if now - lastFire > 0.8 {
        lastFire = now
        DispatchQueue.main.async { self.onNod() }
      }
    }
    // 베이스라인을 천천히 따라가게(자세 변화 흡수) — armed 중립일 때만.
    if armed { baselinePitch = base * 0.9 + pitch * 0.1 }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onError("ARSession failed: \(error.localizedDescription)")
  }
}

// MARK: - 손짓 감지 (Vision 손 포즈 + 전면카메라, 모션-기반 "다가오는 손")
@available(iOS 14.0, *)
// 2026-07-27 사용자 결정(A) — Apple Vision → MediaPipe HandLandmarker 전환. 안드로이드 PaceHandWaveDetector와
// "동일한 모델(hand_landmarker.task) + 동일한 알고리즘"(손목↔중지뿌리 거리 growth 1.2배/700ms + 밝기 급감
// occlusion 안전망)을 그대로 이식한다 — Vision이 빠른 손짓/근접에서 손을 놓치던(실기기 로그 확정) 문제를
// 구글 전용 손 추적 ML로 해결. 카메라 캡처(AVCaptureSession)·워치독·인터럽션 복구는 그대로 유지.
private final class WaveDetector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, HandLandmarkerLiveStreamDelegate {
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "pace.wave.camera")
  private var landmarker: HandLandmarker?
  private let onWave: () -> Void
  private let onError: (String) -> Void
  private let onDiag: (String) -> Void

  // ── 안드로이드 PaceHandWaveDetector와 동일한 파라미터/상태 ──
  private var sizeHistory: [(t: Double, size: Double)] = []  // (ms, handSize=손목↔중지뿌리)
  private var lumaHistory: [(t: Double, luma: Double)] = []  // (ms, 평균밝기) — occlusion 안전망
  private var lastTriggerMs: Double = 0
  private var lastProcessedMs: Double = 0
  private var lastHandSeenMs: Double = 0 // 손이 마지막으로 보인 시각 — "부재→근접 등장" 안전망용
  private var paused = false // 영상 전환 중 추론 일시정지(카메라는 유지) — setPaused로 토글
  private var lastFrameAt: TimeInterval = 0 // 워치독용
  private var watchdog: Timer?
  private var logTick = 0
  private let processIntervalMs: Double = 80       // 안드 2026-08-21 실측값 이식(1899cf3 — 150ms는 빠른 손짓 프레임을 놓침)
  private let refractoryMs: Double = 1200           // 안드 REFRACTORY_MS
  // 🔴 2026-08-18 사장님 실기기 재현("동일 손짓에 안드만 넘어가고 애플은 아예 안 넘어가네 대부분")
  // — 안드는 그동안 실기기 실측으로 아홉 차례 튜닝돼(PaceHandWaveDetector.kt의 장문 주석들) 좌우
  // 휘젓기(sweep) 축까지 갖췄는데 iOS는 초기 이식본(접근 growth 단일 축, 짧은 창) 그대로였다.
  // 안드 최종값으로 정렬: growth 창 700→2500ms, 임계 1.2→1.3, 손 크기 하한 0.03→0.08,
  // + sweep 축 신규 이식(아래 sweep* 상수·xHistory — 안드 2026-08-16 실측 확정값 그대로).
  private let growthWindowMs: Double = 2500         // 안드 GROWTH_WINDOW_MS(2026 튜닝값)
  private let growthRatioThreshold: Double = 1.3    // 안드 GROWTH_RATIO_THRESHOLD(2026 튜닝값)
  private let minHandSize: Double = 0.08            // 안드 MIN_HAND_SIZE(2026 튜닝값)
  // sweep(좌우 휘젓기) — 안드 실측 주석 요약: 손목 x 이동폭을 손 크기로 정규화, 짧은 창(700ms —
  // "훠이" 한 번의 시간 규모)에서만 재야 느린 드리프트와 구분된다. 임계 0.16(놓친 시도 25퍼센타일
  // 실측 기반), 연속 2프레임 확인으로 단발 노이즈 차단.
  private let sweepWindowMs: Double = 700           // 안드 SWEEP_WINDOW_MS
  // 2026-08-18(3차) — 0.13 하향은 실수였다(안드 파일의 경고 "이 값을 만지려면 '가만히' 구간을 함께
  // 재라"를 정확히 어김). 실기기 재현: 손을 들고만 있어도 1~2초마다 오발화(가만히 든 손의 흔들림
  // 실측 최대 0.185 > 0.13). 안드 검증값 0.16으로 복원 — 약한 손짓(0.17~0.24)은 여전히 통과.
  private let sweepRatioThreshold: Double = 0.16
  private let sweepConfirmFrames: Int = 2           // 안드 SWEEP_CONFIRM_FRAMES(밴드 확정프레임이 우선)
  // 🔴 2026-08-21 안드 실측 이식(1899cf3 §1) — 거리 밴드: 신호(손의 물리 속도)는 거리 무관이지만
  // 노이즈(랜드마크 지터)는 1/handSize로 멀수록 폭증 → SNR이 거리마다 다른데 문턱이 하나였던 것이
  // "내리면 원거리 오탐 / 올리면 근거리 미탐" 왕복의 구조적 원인. 밴드별 배수·확정프레임 차등.
  private func bandOf(_ size: Double) -> (mul: Double, confirm: Int, name: String) {
    if size >= 0.20 { return (0.7, 1, "near") }   // ≈10~15cm — 관대
    if size >= 0.135 { return (1.0, 2, "mid") }   // ≈20cm 사거리 경계 — 기존과 동일(회귀 최소)
    return (1.8, 3, "far")                         // 안드 원값(FAR_BAND ×1.8·3f) — 파리티 복원
  }
  // glide(2D 순간속도) 축 — 안드 2026-08-21 이식: 기존 sweep은 x만 봐서 상하/대각 손짓이 원리적으로
  // 안 잡혔다. 인접 샘플 미분이라 "느린 드리프트=빠른 손짓" 혼동이 구조적으로 없다. 두 문턱 AND:
  // 상대(손너비/초, 물리 속도) + 절대(화면비율/초, 지터 바닥 — handSize로 안 나눠 멀수록 자동 보수화).
  // 🔴 2026-08-21 02:01 안드 실측 재조정 이식(edba5de) — "손 들고만 있어도 넘어감" 수정: 들고 있는
  // 손의 노이즈 상한(abs 0.22/rel 1.81)의 약 2배. 진짜 손짓(2.2/9.97)과 10배 차이라 여유 통과.
  private let glideRelMinPerSec: Double = 3.5
  private let glideAbsMinPerSec: Double = 0.45
  private let glideMaxSampleGapMs: Double = 400     // 놓쳤다 재포착 "순간이동" 오탐 차단
  private let glideInstantMargin: Double = 3.0      // 두 축 동시 3배 초과 = 1프레임 확정(안드 실측: 첫 프레임 5~10배가 2연속 요구에 버려짐)
  private var xHistory: [(t: Double, x: Double)] = []
  private var sweepStreak: Int = 0
  // 2026-08-18 사장님 재현("한 번 손짓에 4번 넘어감 연달아") — 한 손짓의 왕복 스트로크(2~3초,
  // 스트로크 간 0.3~0.6s)가 sweep/reappear로 계속 재발화했다. 안드의 "한 제스처=한 발화" 원칙
  // 이식: 발화 후 손이 프레임에서 1초 이상 사라져야 재무장. 왕복 중엔 절대 재무장 안 되고,
  // 손을 내렸다 다시 드는 진짜 다음 손짓만 무장된다.
  // 2026-08-18 사장님 지시("안드랑 같이 하라고, 니 맘대로 설정하지 말고") — iOS 임의 발명품
  // (재무장 게이트, reappear 경로)을 전부 제거하고 안드 PaceHandWaveDetector와 로직·값 완전 동일화.
  // 안드에 있는 속도 조건(growth는 속도 피크와 AND)도 이번에 이식 — 그동안 iOS만 growth 단독이었다.
  private let speedThresholdPerSec: Double = 0.25   // 안드 SPEED_THRESHOLD_PER_SEC
  private let speedPeakWindowMs: Double = 700       // 안드 SPEED_PEAK_WINDOW_MS
  // 🔴 2026-08-18(밤) 정정 — "재무장 게이트는 iOS 임의 발명품"이라며 지운 게 **틀렸다.** 안드
  // PaceHandWaveDetector.kt에 원래부터 있는 로직이다(awaitingRearm/rearmBelowSize, 2026-08-01
  // "손을 밀어낸 뒤 안 치우고 머물면 잔류 흔들림만으로 REFRACTORY_MS마다 재트리거" 실기기 확정).
  // 지운 결과가 바로 오늘 밤 유령 연발(1.2초 간격 리듬 발화)이다. 안드 확정값 그대로 복원:
  // 발화 시점 손 크기의 85% 이하로 작아지거나(=손을 물렸다는 증거) 1.5초 타임아웃이어야 재무장.
  private let rearmSizeRatio: Double = 0.85         // 안드 REARM_SIZE_RATIO
  private let rearmTimeoutMs: Double = 1500         // 안드 REARM_TIMEOUT_MS
  // 🔴 2026-08-19(새벽) 손 2개 독립 추적(델리게이트 주석 참고) — 트랙별 이력/재무장 상태.
  private struct HandTrack {
    var sizeHistory: [(t: Double, size: Double)] = []
    var xHistory: [(t: Double, x: Double, y: Double)] = [] // 2026-08-21 glide(2D) 위해 y 추가
    var sweepStreak = 0
    var glideStreak = 0
    // 2026-08-21 01:49 실측 — 문턱 언저리 손짓(rel 1.08→0.84→0.73→1.02 교대)이 "연속 N프레임"을
    // 영영 못 채움. 연속 대신 **0.6초 창 내 초과 횟수**로 계수(같은 증거량, 교대 패턴 허용).
    var glideHitTimes: [Double] = []
    var lastX: Double = 0, lastY: Double = 0
    var lastSeenMs: Double = 0
    var awaitingRearm = false
    var rearmBelowSize: Double = 0
    var rearmAnchorX: Double = 0, rearmAnchorY: Double = 0
  }
  private var tracks = [HandTrack(), HandTrack()]

  // 🔴 2026-08-25 사장님 사양 2건 — ① "멀어도 카메라를 손이 스쳐 지나가는 것" = 크로싱 축:
  //   트랙 생멸(250ms 소멸)과 무관한 **전역** 목격 기록으로, 1초 창 안에서 손 x의 순이동이 화면 폭
  //   45% 이상이면 발화. 거치(헬스장) 실측(22:06)에서 손이 3/33 틱만 잡혀 "연속 프레임 확정"이
  //   원리적으로 불가능했던 문제의 대응 — 크로싱은 창 안에 양끝 2번만 잡혀도 성립한다.
  //   ② "50센티까지만 본다" = 손 크기 하한 0.10으로 근사(실측: 거치 거리 손 0.10~0.19, 배경 타인 미달).
  //   순방향 비율(net/path ≥ 0.6): 왼손·오른손이 번갈아 잡혀 가짜 가로지름(L,R,L,R)이 되는 것 차단 —
  //   진짜 스침은 한 방향 이동이라 net≈path다.
  //   ⚠️ iOS 선행 구현(사장님 실기기 검증용) — 사양 확정되면 안드 동일 이식(PM MD 기록).
  // 창 2500ms(2026-08-25 사장님 "천천히 젓는 사람, 빨리 젓는 사람 다 다를 거 아냐 — 그래도 지나갔으면
  // 넘어가야") — 크로싱은 **속도 무관**이 원칙이다. 1초 창은 느린 스침(2초짜리 통과)을 놓쳤다.
  // 빠른 스침은 짧은 창에서도 성립하므로 창 확대는 느린 쪽만 살리고, 가짜 가로지름(양손 교차)은
  // 창 길이가 아니라 순방향비(directness)가 거른다.
  // 🔴 2026-08-25 사장님 최종 확정("흔들기는 넘어가면 안 되지 — 그럼 손이 움직일 때 다 넘어간다는 거") —
  // **통과 전용 모드**: 넘김 = 왼→오 통과(크로싱·근접 dip)뿐. 흔들기·빠른 움직임(속도 축)은 발화 안 함
  // (계산·로그는 유지 — 복원은 이 플래그만 false). 오→왼 차단 직후 잠금(speedSuppressUntilMs)은
  // 플래그를 끄더라도 유효한 별도 방어라 남겨둔다. ⚠️ 안드는 아직 흔들기 방식 — 사양 검증 후 동일 이식.
  private let passOnlyMode = true
  // 🔴 2026-08-25 사장님("왜 그 시간을 막냐 — 그래서 안 되는 거 아냐?") — 1.2s 불응은 흔들기 이중발화
  // 방지용이었다. 통과(스침)는 스트로크 단위로 딱 떨어지므로 0.5s면 충분 — 빠른 연속 스침이 먹히지 않게.
  private let passRefractoryMs: Double = 500
  private var speedSuppressUntilMs: Double = 0
  private let crossWindowMs: Double = 2500
  // 0.45→0.38(2026-08-25 "왼오일 때 안 되는 경우") — 스침 궤적의 일부만 추적돼도 성립하게.
  private let crossMinRangeX: Double = 0.38
  // 0.10→0.08(2026-08-25 실측): 사장님 실사용 거리에서 손이 0.095로 찍혀 0.005 차이로 컷됐다
  // ("계속 안 됐어" 구간, diag 22:18:22). 0.08은 감지기 자체 하한(minHandSize)과 같아 사실상
  // "감지되는 손은 모두 허용"이지만, 배경 타인(2m+, ~0.03)은 애초에 감지 하한 미달이라 차단 유지.
  private let crossMinHandSize: Double = 0.08
  private let crossMinDirectness: Double = 0.6
  private var crossHistory: [(t: Double, x: Double)] = []
  // 2026-08-21 사장님("손짓 한 번에 3번씩 넘어가는 건 아니잖아") — **전역** burst당 1회 발화.
  // 처음엔 트랙별로 뒀더니 트랙이 잠깐 끊겨 리셋될 때 burst 기억도 지워져 1.5초 간격 재발화가
  // 남았다(01:09 실측). 발화 후에는 **어느 손이든** 움직임이 600ms 이상 완전히 멎어야 다음 손짓.
  private var globalBurstFired = false
  private var lastGlobalMotionMs: Double = 0
  // 🔴 2026-08-21 01:23 실측 2연발 잔존 — 검출 공백이 "정지"로 오인돼 burst가 풀렸다. 안드 원칙
  // "모른다 ≠ 떠났다"를 적용: 해제는 **양성 증거**로만 — ①손이 보이면서 0.6초 연속 정지(abs≤0.04)
  // ②손이 프레임에서 완전히 떠남(전 트랙 소멸). 검출 공백(no-hand 프레임)은 정지 시계를 리셋한다.
  private var stillnessStartMs: Double = 0
  private var cameraStartedAtMs: Double = 0   // 웜업 판정(안드 WARMUP_* 이식 — captureOutput 주석)
  private var firstDetectionDone = false      // 첫 손 인식 후 웜업 종료
  // 🔴 2026-08-19 01:01 — "폰을 만지는 중" 손짓 발화 잠금(볼륨 모듈이 NotificationCenter로 알림).
  // 폰으로 손을 뻗어 볼륨키를 누르는 동작이 카메라에 손짓으로 오인돼 영상이 넘어가던 것 차단:
  // 폰이 손에 잡혀 있는 동안(PacePhoneHandled) + 볼륨키 눌림 후 1.5초(PaceVolumePressed)는 발화 금지.
  private var phoneHeldNow = false
  private var lastVolumePressMs: Double = 0
  private var handlingObserversInstalled = false
  private var pendingGrowthWork: DispatchWorkItem? = nil // 접근(growth) 발화 0.9초 보류(뻗은 손 취소용)
  private var lastNearHandMs: Double = 0 // near 밴드 손 최근 관측 — luma(가림) 문턱 완화 게이트(안드 이식)
  private func installHandlingObservers() {
    guard !handlingObserversInstalled else { return }
    handlingObserversInstalled = true
    NotificationCenter.default.addObserver(forName: Notification.Name("PacePhoneHandled"), object: nil, queue: nil) { [weak self] n in
      self?.phoneHeldNow = (n.userInfo?["held"] as? Bool) ?? false
    }
    NotificationCenter.default.addObserver(forName: Notification.Name("PaceVolumePressed"), object: nil, queue: nil) { [weak self] _ in
      self?.lastVolumePressMs = CFAbsoluteTimeGetCurrent() * 1000
    }
  }
  // 🔬 2026-08-18(밤) 유령 발화 채증 — 파라미터 추측 튜닝을 끝내기 위해 발화 순간의 카메라 프레임을
  // Documents/wave_debug/에 JPEG로 남긴다(발화 시에만, 최근 30장 유지). MediaPipe가 무엇을 score
  // 0.99짜리 "손"으로 보는지 눈으로 확정한 뒤 제거할 임시 진단 코드.
  private var lastPixelBuffer: CVPixelBuffer?
  private let ciContext = CIContext(options: nil)
  // iOS 전용 안전망(안드에 없음): 영상 리로드로 MediaPipe가 접근 초반(작을 때)을 굶기면 growth가 안 나와
  // "5번에 1번"으로 놓쳤다. 손이 잠깐(≥reappearGapMs) 사라졌다 곧바로 크게(≥reappearMinSize) 나타나면
  // = 폰 쪽으로 접근한 것으로 보고 발화한다.
  private let reappearGapMs: Double = 300
  private let reappearMinSize: Double = 0.10
  private let lumaWindowMs: Double = 400            // 안드 LUMA_WINDOW_MS
  private let lumaDropRatio: Double = 0.45          // 안드 LUMA_DROP_RATIO
  private let lumaDarkAbsMax: Double = 70           // 안드 LUMA_DARK_ABS_MAX

  init(onWave: @escaping () -> Void, onError: @escaping (String) -> Void, onDiag: @escaping (String) -> Void) {
    self.onWave = onWave
    self.onError = onError
    self.onDiag = onDiag
    super.init()
    setupLandmarker()
    installHandlingObservers()
  }

  private static func modelPath() -> String? {
    // podspec s.resources로 앱 번들에 포함됨. main 우선, 없으면 전체 번들/프레임워크 검색(정적 프레임워크 대비).
    if let p = Bundle.main.path(forResource: "hand_landmarker", ofType: "task") { return p }
    for b in Bundle.allBundles + Bundle.allFrameworks {
      if let p = b.path(forResource: "hand_landmarker", ofType: "task") { return p }
    }
    return nil
  }

  private func setupLandmarker() {
    guard let modelPath = Self.modelPath() else {
      paceGLog("[pace-wave] hand_landmarker.task 모델 못 찾음")
      onError("hand model not found"); return
    }
    let options = HandLandmarkerOptions()
    options.baseOptions.modelAssetPath = modelPath
    // CPU 추론 — GPU로 돌렸더니 WebView 영상 GPU 합성과 경쟁해 재생이 버벅였다. hand_landmarker는 150ms
    // 간격 추론이라 A16 CPU 한 코어로 충분(≈20~40ms)하고, GPU를 영상 디코딩/합성에 온전히 양보한다.
    options.baseOptions.delegate = .CPU
    options.runningMode = .liveStream
    // 🔴 2026-08-21 안드 실측 이식(1899cf3 §7-②) — 인식 실패의 주범은 임계값이 아니라 **검출률**이었다
    // (안드 실측: 전체 프레임의 84.5%에서 손 랜드마크 0개, 기본 신뢰도 0.5가 원인). 0.3으로 하향.
    // 오탐 방어는 판정 축(sweep/glide 문턱·밴드·재무장)이 맡으므로 검출은 관대하게 받는 게 맞다.
    options.minHandDetectionConfidence = 0.3
    options.minHandPresenceConfidence = 0.3
    options.minTrackingConfidence = 0.3
    // 🔴 2026-08-19(새벽) 1→2 — numHands=1은 상시 손(턱 괴기)이 추적을 선점하면 다른 손 손짓이
    // 인식 대상조차 안 되는 구조적 결함(델리게이트 주석). 두 손을 받아 트랙별로 독립 판정한다.
    options.numHands = 2
    options.handLandmarkerLiveStreamDelegate = self
    do {
      landmarker = try HandLandmarker(options: options)
      paceGLog("[pace-wave] MediaPipe HandLandmarker 로드 성공(CPU): %@", modelPath)
    } catch {
      paceGLog("[pace-wave] HandLandmarker init 실패: %@", String(describing: error))
      onError("hand landmarker init failed")
    }
  }

  func start() {
    let st = AVCaptureDevice.authorizationStatus(for: .video)
    paceGLog("[pace-wave] start() cam authStatus=%ld (0=notDet 1=restr 2=DENIED 3=authorized)", st.rawValue)
    switch st {
    case .authorized:
      queue.async { self.configureAndRun() }
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        guard let self = self else { return }
        paceGLog("[pace-wave] cam requestAccess granted=%@", granted ? "YES" : "NO")
        guard granted else { self.onError("camera permission denied"); return }
        self.queue.async { self.configureAndRun() }
      }
    default:
      paceGLog("[pace-wave] cam DENIED/RESTRICTED — 설정에서 카메라 켜야 함")
      onError("camera permission denied")
    }
  }

  // 영상 전환 중 추론 일시정지/재개. 재개 시 히스토리를 비워 전환 전의 낡은 손 크기 baseline이
  // 남아 growth를 오염시키지 않게 한다(재개 직후 새 접근을 깨끗한 기준으로 판정).
  func setPaused(_ p: Bool) {
    queue.async {
      self.paused = p
      if !p { self.tracks = [HandTrack(), HandTrack()]; self.lumaHistory.removeAll(); self.lastHandSeenMs = 0; self.stillnessStartMs = 0 } // 정지시계 리셋(01:30 낡은 시계로 burst 즉시해제 연발)
    }
  }

  private func configureAndRun() {
    session.beginConfiguration()
    session.sessionPreset = .vga640x480 // 손 모션 감지엔 저해상도로 충분(배터리/발열 절감)
    // ⚠️ 2026-07-28 롤백 — CIF(352×288)+YUV 최적화가 실기기에서 손짓을 깨뜨림(어젯밤 되던 게 안 됨). 어젯밤
    // 검증된 VGA+BGRA로 복구. 리서치상 정확도 무손실이라 했지만 실기기 미검증 상태로 넣은 게 원인. 재도입은 기기 A/B로.
    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      session.commitConfiguration()
      onError("front camera unavailable")
      return
    }
    session.addInput(input)

    // 🔴 2026-08-25 사장님("1번은 수정 안 해 그럼?") — 모션 블러 대응. 실측(22:11): 가까운 손(0.217)도
    // 흔드는 동안 추적이 절반씩 끊김 = 실내 조명의 긴 노출로 빠른 손이 뭉개져 랜드마커가 놓침.
    // 자동노출은 유지하되 **노출 시간 상한만 1/180초**로 캡 — 어두우면 ISO가 대신 올라간다(밝기 자동 보정).
    // setExposureModeCustom(고정 노출)이 아니라 activeMaxExposureDuration인 이유: 조명이 변하는 실사용에서
    // 고정값은 과노출/암전을 만든다 — 상한 캡은 AE를 살려둔 채 블러만 막는 안전한 형태다.
    // 🔴 2026-08-25 23:00 롤백 — 위 1/180s 상한이 밤 실내(어두움)에서 화면을 어둡게 만들어 손 인식
    // 자체를 실명시켰다(죽은 구간들의 hand=0/30 패턴과 시간 일치). 통과 전용 모드에선 속도 축이
    // 꺼져 있어 블러 대책의 이득도 없다 — 상한을 걸지 않는다(AE 원래대로).

    // 프레임레이트는 캡하지 않는다(안드로이드와 동일: 네이티브 ~30fps).
    // 15fps로 캡했더니 alwaysDiscardsLateVideoFrames와 겹쳐 부하 시 실효 fps가 더 떨어져,
    // 손이 접근하는 "초반의 작은 프레임"을 놓쳐 growth 기준점이 커지고 → 감지가 5번에 1번으로 들쭉날쭉했다.
    // 처리 자체는 여전히 150ms 간격(captureOutput에서 throttle)이라 추론 비용은 그대로다.

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    // ⚠️ 2026-07-28 롤백 — 420f YUV 최적화가 실기기에서 손짓을 깨뜨려 BGRA로 복구(어젯밤 검증된 포맷).
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else {
      session.commitConfiguration()
      onError("camera output unavailable")
      return
    }
    session.addOutput(output)

    // ⭐ 손짓 안 잡히던 #1 원인 = orientation(리서치 확인). 연결(connection)에서 세로+전면미러를 고정해
    // 픽셀버퍼가 똑바로 나오게 하고, Vision 핸들러엔 .up만 넘긴다(양쪽에서 이중 변환하면 다시 틀어짐).
    if let conn = output.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 } // 세로
      } else if conn.isVideoOrientationSupported {
        conn.videoOrientation = .portrait
      }
      if conn.isVideoMirroringSupported {
        conn.automaticallyAdjustsVideoMirroring = false
        conn.isVideoMirrored = true
      }
    }
    session.commitConfiguration()
    // ⭐ 손짓이 "2번째 영상부터 안 되는" 원인: 새 영상 WebView가 재생을 시작하면 시스템 압력/미디어로
    //   AVCaptureSession이 interrupted 되는데, 관찰자가 없어 자동 복구가 안 돼 카메라가 죽은 채 남는다.
    //   interruption 종료/런타임 에러 시 세션을 다시 startRunning 해 손짓 감지를 살린다.
    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(sessionInterrupted(_:)), name: .AVCaptureSessionWasInterrupted, object: session)
    nc.addObserver(self, selector: #selector(sessionInterruptionEnded(_:)), name: .AVCaptureSessionInterruptionEnded, object: session)
    nc.addObserver(self, selector: #selector(sessionRuntimeError(_:)), name: .AVCaptureSessionRuntimeError, object: session)
    session.startRunning()
    paceGLog("[pace-wave] camera started (front, portrait+mirror)")
    cameraStartedAtMs = CFAbsoluteTimeGetCurrent() * 1000 // 웜업 시계 시작(captureOutput 주석)
    firstDetectionDone = false
    // 워치독: 프레임이 2.5초 이상 안 오면(인터럽션이 안 끝나거나 조용히 정지) 원인 불문 카메라를 강제 재시작.
    // "잘되다가 갑자기 안되고 계속 안됨"의 근본 대응 — 인터럽션-종료 알림에만 의존하던 복구의 사각지대를 메운다.
    lastFrameAt = CFAbsoluteTimeGetCurrent()
    DispatchQueue.main.async {
      self.watchdog?.invalidate()
      self.watchdog = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
        guard let self = self else { return }
        let idle = CFAbsoluteTimeGetCurrent() - self.lastFrameAt
        if idle > 2.5 {
          paceGLog("[pace-wave] watchdog: no frames %.1fs → 카메라 강제 재시작", idle)
          self.onDiag("watchdog restart")
          self.queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            self.session.startRunning()
          }
          self.lastFrameAt = CFAbsoluteTimeGetCurrent() // 재시작 직후 재트리거 방지
        }
      }
    }
  }

  @objc private func sessionInterrupted(_ n: Notification) {
    let reason = (n.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int) ?? -1
    paceGLog("[pace-wave] session INTERRUPTED reason=%d", reason)
    onDiag("cam interrupted r=\(reason)")
  }
  @objc private func sessionInterruptionEnded(_ n: Notification) {
    paceGLog("[pace-wave] interruption ended → restart")
    onDiag("cam resume")
    queue.async { if !self.session.isRunning { self.session.startRunning() } }
  }
  @objc private func sessionRuntimeError(_ n: Notification) {
    paceGLog("[pace-wave] runtime error → restart")
    queue.async { if !self.session.isRunning { self.session.startRunning() } }
  }

  func stop() {
    NotificationCenter.default.removeObserver(self)
    DispatchQueue.main.async { self.watchdog?.invalidate(); self.watchdog = nil }
    queue.async {
      if self.session.isRunning { self.session.stopRunning() }
      for i in self.session.inputs { self.session.removeInput(i) }
      for o in self.session.outputs { self.session.removeOutput(o) }
      self.tracks = [HandTrack(), HandTrack()]
      self.lumaHistory.removeAll()
    }
  }

  // AVCaptureVideoDataOutputSampleBufferDelegate — 프레임을 MediaPipe에 흘리고, 밝기 occlusion도 여기서 본다.
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CFAbsoluteTimeGetCurrent()
    lastFrameAt = now // 워치독용(스로틀 전) — paused여도 갱신돼 워치독이 카메라를 죽었다고 오판·재시작하지 않음
    if paused { return } // 영상 전환(페이지 리로드) 중엔 추론을 멈춰 CPU를 페이지 로드에 양보(카메라는 켠 채)
    let nowMs = now * 1000
    // 🔴 2026-08-19 안드 웜업 패치 이식(안드 2026-08-18 실측 "세션 시작 후 첫 인식까지 27초") — 카메라
    // 직후엔 노출/초점이 안 잡혀 인식 가능한 프레임이 드문데 150ms 간격까지 겹치면 첫 인식이 수십 초
    // 밀린다(iOS 실측: 00:21:44 시작→00:22:57 첫 발화, 73초 공백 = "포커스 온 직후 손짓 안 됨").
    // 첫 손 인식 전까지만 60ms로 촘촘히 보고, 붙으면 원래 간격으로 복귀(배터리 특성 유지). 최대 20초.
    let warmingUp = !firstDetectionDone && (nowMs - cameraStartedAtMs) < 20000
    let interval = warmingUp ? 60.0 : processIntervalMs
    guard nowMs - lastProcessedMs >= interval else { return }
    lastProcessedMs = nowMs
    guard let lm = landmarker else { return }
    // occlusion 안전망 — Y(루마) 평면 평균 밝기(전부 camera queue라 상태 접근 안전)
    if let pb = CMSampleBufferGetImageBuffer(sampleBuffer) {
      let thirds = avgLumaThirds(pb)
      if thirds.l >= 0, thirds.m >= 0, thirds.r >= 0 {
        checkOcclusion((thirds.l + thirds.m + thirds.r) / 3, thirds.l, thirds.m, thirds.r, nowMs)
      }
      lastPixelBuffer = pb // 유령 채증용 최신 프레임(발화 시 JPEG 저장) — 같은 camera queue라 안전
    }
    // 2026-07-28 리서치(#4) — MPImage 생성/detectAsync를 autoreleasepool로 감싼다. liveStream에서 매 프레임
    // CMSampleBuffer→MPImage 래핑이 오토릴리즈 객체를 쌓아 장시간 세션에서 메모리 증가 보고가 있다(값싼 보험).
    autoreleasepool {
      do {
        let image = try MPImage(sampleBuffer: sampleBuffer, orientation: .up)
        try lm.detectAsync(image: image, timestampInMilliseconds: Int(nowMs))
      } catch {
        // 간헐 실패는 무시(다음 프레임)
      }
    }
  }

  // MediaPipe 결과 델리게이트.
  // 🔴 2026-08-19(새벽) 손 2개 독립 추적으로 전면 개편 — numHands=1이 오늘 밤 양대 증상의 공통 뿌리였다:
  //   얼굴 옆에 상시 있는 손(턱 괴기)이 단일 추적을 선점하면 ①그 손의 잔손질만 계속 평가돼 "혼자
  //   넘어감" ②**다른 손으로 하는 진짜 손짓은 인식 대상조차 아님** → "손짓 하나도 안 됨"(00:27 실측:
  //   카메라 시작 8ms 만에 상시 손 획득 후 손짓 발화 0건). numHands=2 + 손별 위치 매칭 트랙으로,
  //   어느 손이든 흔들면 발화한다. 위치 매칭 반경이 "끊겼다 다른 위치 재획득 점프"(안드 8/5 결함)를
  //   구조적으로 차단하므로 no-hand 즉시폐기는 트랙 소멸(250ms 미목격)로 완화해도 안전하다.
  func handLandmarker(_ handLandmarker: HandLandmarker, didFinishDetection result: HandLandmarkerResult?, timestampInMilliseconds: Int, error: Error?) {
    let nowMs = Double(timestampInMilliseconds)
    queue.async { // 상태(tracks/lastTriggerMs)를 camera queue 하나로 직렬화(occlusion과 공유)
      let allHands = result?.landmarks ?? []
      let handedness = result?.handedness ?? []
      // 후보 추출(손목·크기·신뢰도) — 너무 작은 손은 제외(안드 MIN_HAND_SIZE)
      var cands: [(x: Double, y: Double, size: Double, score: Double)] = []
      for (i, hand) in allHands.enumerated() where hand.count > 9 {
        let wrist = hand[0], mcp = hand[9]
        let size = Double(hypot(wrist.x - mcp.x, wrist.y - mcp.y))
        if size < self.minHandSize { continue }
        let score = Double(handedness.count > i ? (handedness[i].first?.score ?? -1) : -1)
        cands.append((Double(wrist.x), Double(wrist.y), size, score))
      }
      if cands.isEmpty {
        self.logTick += 1; if self.logTick % 10 == 0 { self.onDiag("no hand") }
      } else if !self.firstDetectionDone {
        self.firstDetectionDone = true // 웜업 종료 → 처리 간격 150ms 복귀(captureOutput 주석)
        paceGLog("[pace-wave] 첫 손 인식 — 웜업 종료(%.0fms 소요)", nowMs - self.cameraStartedAtMs)
      }
      // 트랙 배정 — 각 후보를 살아있는 트랙 중 가장 가까운 곳으로(그리디), 매칭 반경 0.3 밖이면 새 손.
      var assigned = [Int: Int]() // trackIdx → candIdx
      for (ci, c) in cands.enumerated() {
        var bestT = -1; var bestD = 0.30
        for ti in 0..<self.tracks.count where assigned[ti] == nil {
          guard self.tracks[ti].lastSeenMs > 0, nowMs - self.tracks[ti].lastSeenMs < 600 else { continue }
          let d = Double(hypot(c.x - self.tracks[ti].lastX, c.y - self.tracks[ti].lastY))
          if d < bestD { bestD = d; bestT = ti }
        }
        if bestT < 0 { // 새 손 — 빈/가장 오래된 트랙을 초기화해 차지
          var oldest = 0
          for ti in 1..<self.tracks.count where self.tracks[ti].lastSeenMs < self.tracks[oldest].lastSeenMs { oldest = ti }
          if assigned[oldest] != nil { continue } // 두 후보가 같은 빈 트랙을 원하면 후순위 버림(손 3개는 없음)
          self.tracks[oldest] = HandTrack() // 새 시작(이전 이력 폐기 — 점프 오염 방지)
          bestT = oldest
        }
        assigned[bestT] = ci
      }
      // 이번 프레임 미목격 트랙 — 250ms 넘게 안 보이면 소멸(이력 폐기 + 재무장 해제)
      for ti in 0..<self.tracks.count where assigned[ti] == nil {
        if self.tracks[ti].lastSeenMs > 0 && nowMs - self.tracks[ti].lastSeenMs > 250 {
          self.tracks[ti] = HandTrack()
        }
      }
      // 트랙별 판정(기존 단일 파이프라인과 동일 로직 — 상수 주석들 참고)
      // ⛔ 2026-08-21 안드 파리티 복원 — 전역 burst/정지시계 장치(iOS 창작) 제거. 재발화 방지는
      // 안드 원본(refractory 1.2s + 재무장 shrink/timeout)이 담당한다.
      if !assigned.isEmpty { self.lastHandSeenMs = nowMs }
      for (ti, ci) in assigned {
        _ = self.processTrack(ti, cands[ci], nowMs)
      }
    }
  }

  private func processTrack(_ ti: Int, _ c: (x: Double, y: Double, size: Double, score: Double), _ nowMs: Double) -> Double {
      // 폰 취급 중 발화 잠금(상단 installHandlingObservers 주석).
      // ⛔ 01:06 실기기 — phoneHeldNow(쥠 상태) 조건이 고착돼(해제 임계 미달 지속) 손짓 전체를 잠갔다
      // ("손짓 10번 안 됨" + 발화잠금 로그 연속). 쥠 상태는 오늘 내내 불안정했으므로 잠금 조건에서
      // 제외하고, 정확한 이벤트인 **볼륨키 눌림 후 1.5초**만 잠근다(뻗는 손 오인의 핵심 창).
      if CFAbsoluteTimeGetCurrent() * 1000 - self.lastVolumePressMs < 500 { // 1500→500ms(2026-08-21 사장님 지시)
        self.logTick += 1
        if self.logTick % 20 == 0 { paceGLog("[pace-wave] 발화잠금(볼륨눌림 직후)") }
        return 0.05 // 폰 취급 중 — 정지 아님으로 취급
      }
      let handSize = c.size
      let handScore = c.score
      // 트랙 갱신
      self.tracks[ti].lastX = c.x; self.tracks[ti].lastY = c.y; self.tracks[ti].lastSeenMs = nowMs
      // 재무장 게이트(트랙별) — 발화한 그 손이 그 자리에 그 크기로 있으면 잔류 흔들림을 새 제스처로
      // 세지 않는다. 해제: ①축소 0.85배 ②트랙 소멸 ③발화 지점서 1.5손폭 이상 이동(23:17 영구잠금 처방).
      // 다른 트랙(다른 손)은 이 게이트와 무관하게 자유롭다 — 손 2개 개편의 핵심 이득.
      if self.tracks[ti].awaitingRearm {
        // 안드 원본 그대로(2026-08-21 파리티 복원) — 해제: 축소 0.85배 또는 타임아웃 1.5초.
        // (이동 해제는 iOS 창작이라 제거. 영구 잠금은 안드처럼 타임아웃이 방지한다.)
        if handSize <= self.tracks[ti].rearmBelowSize || nowMs - self.lastTriggerMs > 1500 {
          paceGLog("[pace-wave] rearmed(T%d) after %.0fms by=%@ size=%.2f",
                   ti, nowMs - self.lastTriggerMs,
                   handSize <= self.tracks[ti].rearmBelowSize ? "shrink" : "timeout", handSize)
          self.tracks[ti].awaitingRearm = false
        } else {
          return 0.05 // 이 손은 아직 재무장 안 됨(다른 손은 별도 트랙에서 자유)
        }
      }
      // 거리 밴드(상수 주석 참고) — 이후 모든 문턱에 배수, 확정프레임에 밴드값 적용.
      let band = self.bandOf(handSize)
      if band.name == "near" { self.lastNearHandMs = nowMs } // 근접 luma 완화 게이트용(checkOcclusion)
      self.tracks[ti].sizeHistory.append((nowMs, handSize))
      while let f = self.tracks[ti].sizeHistory.first, nowMs - f.t > self.growthWindowMs { self.tracks[ti].sizeHistory.removeFirst() }
      // sweep 축(안드 이식) — 좌우 휘젓기: 짧은 창 안 손목 x 이동폭/손 크기.
      self.tracks[ti].xHistory.append((nowMs, c.x, c.y))
      while let f = self.tracks[ti].xHistory.first, nowMs - f.t > self.sweepWindowMs { self.tracks[ti].xHistory.removeFirst() }
      // 🔴 2026-08-21 안드 완전 파리티 — glide는 프레임당 순간값이 아니라 **최근 500ms 창 내 인접샘플
      // 속도의 최댓값**(안드 peakGlideAbsPerSec 그대로). 프레임당 값은 출렁여(1.08→0.84→0.73) 연속
      // 확정을 영영 못 채웠다 — 안드가 "먼 손짓도 잘만" 되는 이유가 피크 유지였다.
      var glideAbs = 0.0
      do {
        let recent = self.tracks[ti].xHistory.filter { nowMs - $0.t <= 500 }
        if recent.count >= 2 {
          for i in 1..<recent.count {
            let dtMs = recent[i].t - recent[i - 1].t
            if dtMs < 20 || dtMs > self.glideMaxSampleGapMs { continue }
            let v = Double(hypot(recent[i].x - recent[i - 1].x, recent[i].y - recent[i - 1].y)) / (dtMs / 1000.0)
            if v > glideAbs { glideAbs = v }
          }
        }
      }
      let glideRel = handSize > 0 ? glideAbs / handSize : 0
      // 2026-08-25 방향 일관성(사장님 "반대 방향은 또 되고 — 방향 정한 거 아냐?") — 크로싱만 방향을
      // 알고 속도 축(glide/sweep/growth)은 방향 무관이라, 오→왼 스침을 속도 축이 대신 잡아버렸다
      // (22:20:06 cross_skip 직후 glide 발화 실측). 왼쪽으로 확실히 이동 중(700ms 순이동 ≤ -0.30)이면
      // 속도 축 발화를 막는다 — 왕복 흔들기는 순이동≈0이라 안 걸린다.
      // 부호 실기기 확정(위 크로싱 주석) — 사용자 오→왼 = 이미지 x **증가**. 그쪽 이동 중이면 속도 축 억제.
      // 0.30→0.12(2026-08-25 "개판" 라운드 실측) — 빠른 오→왼 휙은 샘플이 성겨 700ms 순이동이 0.30을
      // 못 채운 채 glide가 먼저 발화했다(38:16 rel=14.8). 문턱을 낮춰 역방향 기미만 있어도 속도 축을 막는다.
      // 왕복 흔들기는 순이동≈0이라 여전히 안 걸린다.
      var reversePass = false
      var netDx700 = 0.0
      if let firstX = self.tracks[ti].xHistory.first(where: { nowMs - $0.t <= 700 }),
         let lastX = self.tracks[ti].xHistory.last {
        netDx700 = lastX.x - firstX.x
        if netDx700 >= 0.12 { reversePass = true }
      }
      // 크로싱 축(2026-08-25 사장님 사양, 상단 crossWindowMs 주석) — 50cm 상한 통과 목격만 전역 기록.
      if handSize >= self.crossMinHandSize {
        self.crossHistory.append((nowMs, c.x))
        while let f = self.crossHistory.first, nowMs - f.t > self.crossWindowMs { self.crossHistory.removeFirst() }
        if self.crossHistory.count >= 2 {
          // 🔴 2026-08-25 22:52 확진(hand=15·sweep=3.63인데 발화 0) — 2.5s 창 **전체** 순이동은 연속
          // 시도에 오염된다: 스침→복귀→스침이 서로 상쇄돼 net≈0, 패스 사이 점프가 path만 키워
          // directness도 죽는다. → **마지막 단조 구간**(끝에서부터 같은 방향으로 이어진 스트로크)만
          // 평가한다. 단조 구간은 왕복·연속 시도와 무관하고, 방향은 구간 부호가 곧 방향이다.
          // 부호 실기기 확정: 사용자 왼→오 = 이미지 x 감소(음수).
          let xs = self.crossHistory
          var segStart = xs.count - 1
          var dirSign = 0.0
          var i = xs.count - 1
          while i > 0 {
            let dx = xs[i].x - xs[i - 1].x
            if abs(dx) < 0.01 { i -= 1; segStart = i; continue }
            let s: Double = dx > 0 ? 1 : -1
            if dirSign == 0 { dirSign = s } else if s != dirSign { break }
            i -= 1
            segStart = i
          }
          let segNet = xs.last!.x - xs[segStart].x
          if abs(segNet) >= self.crossMinRangeX {
            self.crossHistory.removeAll()
            // 🔴 2026-08-25 23:00 재현("왼오 안 먹고 오왼에 바뀜") — 불응 중 완성된 스트로크가 기록에
            // 남았다가 불응이 풀리는 순간(=손을 되돌리는 타이밍) 뒤늦게 발화해 방향이 뒤집혀 보였다.
            // 불응 중 스트로크는 여기서 소비-폐기한다. 1.2s당 1회 상한은 유지, 타이밍 착시 제거.
            if nowMs - self.lastTriggerMs <= self.passRefractoryMs {
              paceGLog("[pace-wave] crossdrop refractory net=%+.2f", segNet)
              self.onDiag(String(format: "crossdrop net=%+.2f", segNet))
              return glideAbs
            }
            if segNet < 0 {
              self.fireTrigger(String(format: "T%d cross net=%+.2f size=%.2f", ti, segNet, handSize), nowMs, handSize: handSize, trackIdx: ti)
              return glideAbs
            }
            // 반대 방향(사용자 오→왼) — 무시하되 채증. 차단 직후 잔움직임 누수 방지 잠금(22:42 실측).
            self.speedSuppressUntilMs = nowMs + 800
            paceGLog("[pace-wave] crossskip net=%+.2f size=%.2f", segNet, handSize)
            self.onDiag(String(format: "crossskip net=%+.2f size=%.2f", segNet, handSize))
          }
        }
      }
      var sweep = 0.0
      if let mx = self.tracks[ti].xHistory.map({ $0.x }).max(), let mn = self.tracks[ti].xHistory.map({ $0.x }).min(), handSize > 0 {
        sweep = (mx - mn) / handSize
      }
      // 왕복 반전 조건(채증 사진 기반 — 턱 괸 손의 한 방향 드리프트 차단, 진짜 "훠이"는 반전 ≥1회)
      var reversals = 0
      if handSize > 0, self.tracks[ti].xHistory.count >= 3 {
        let minStroke = 0.12 * handSize
        var lastDir = 0
        var anchorX = self.tracks[ti].xHistory[0].x
        for p in self.tracks[ti].xHistory.dropFirst() {
          let dx = p.x - anchorX
          if abs(dx) >= minStroke {
            let dir = dx > 0 ? 1 : -1
            if lastDir != 0 && dir != lastDir { reversals += 1 }
            lastDir = dir
            anchorX = p.x
          }
        }
      }
      if sweep > self.sweepRatioThreshold * band.mul && reversals >= 1 { self.tracks[ti].sweepStreak += 1 } else { self.tracks[ti].sweepStreak = 0 }
      // glide 판정 — 두 문턱 AND(밴드 배수 적용). 문턱의 3배를 두 축 동시 초과하면 1프레임 확정.
      let relTh = self.glideRelMinPerSec * band.mul
      let absTh = self.glideAbsMinPerSec * band.mul
      // 🔴 안드 파리티(1899cf3 그대로) — 연속 프레임 확정 + 압도적 마진 1프레임. 임의 장치(윈도우 계수·
      // 전역 burst·접근 보류) 전부 제거. 재발화 방지는 안드처럼 refractory(1.2s)+재무장이 담당.
      let glidedNow = glideAbs > absTh && glideRel > relTh
      self.tracks[ti].glideStreak = glidedNow ? self.tracks[ti].glideStreak + 1 : 0
      let glideOverwhelming = glidedNow &&
        glideAbs > absTh * self.glideInstantMargin && glideRel > relTh * self.glideInstantMargin
      let glided = self.tracks[ti].glideStreak >= band.confirm || glideOverwhelming
      if glided && !self.passOnlyMode && !reversePass && nowMs > self.speedSuppressUntilMs && nowMs - self.lastTriggerMs > self.refractoryMs {
        self.tracks[ti].glideStreak = 0
        self.fireTrigger(String(format: "T%d glide band=%@ rel=%.2f abs=%.2f%@ size=%.2f netDx=%+.2f", ti, band.name, glideRel, glideAbs, glideOverwhelming ? " instant" : "", handSize, netDx700), nowMs, handSize: handSize, trackIdx: ti)
        return glideAbs
      }
      guard let oldest = self.tracks[ti].sizeHistory.first else { return glideAbs }
      // 안드 파리티 — growth 기준은 "창 내 최솟값"(가장 오래된 샘플 X): 손을 이미 든 채 흔들면 오래된
      // 샘플 기준으론 비율이 영영 안 올라 "첫 손짓 무조건 실패"가 됐다(안드 2026-08-02 실측 수정).
      if oldest.t == nowMs { return glideAbs } // 비교할 과거가 없음(안드 동일 가드)
      let baselineSize = self.tracks[ti].sizeHistory.map { $0.size }.min() ?? handSize
      let growth = baselineSize > 0 ? handSize / baselineSize : 1.0
      // 속도 피크(안드 파리티) — 최근 창 안 |크기 변화율| 최대.
      var speedPeak = 0.0
      let sh = self.tracks[ti].sizeHistory
      for si2 in 1..<sh.count {
        let a = sh[si2 - 1], b = sh[si2]
        if nowMs - b.t > self.speedPeakWindowMs { continue }
        let dt = (b.t - a.t) / 1000.0
        if dt > 0 { speedPeak = max(speedPeak, abs(b.size - a.size) / dt) }
      }
      self.logTick += 1
      if self.logTick % 4 == 0 { self.onDiag(String(format: "T%d hand=%.3f growth=%.2f sweep=%.2f", ti, handSize, growth, sweep)) }
      // 🔬 2026-08-19 01:00 진단("10번 중 2번만 발화") — 비발화 순간의 수치를 네이티브 로그로 노출.
      // sweep이 임계 근처(0.10+)일 때만 1줄 — 손짓 시도는 찍히고 정지 손은 안 찍히는 수준으로 스팸 억제.
      if sweep > 0.10 || glideRel > 0.4 {
        paceGLog("[pace-wave] 근접 T%d band=%@ glideR=%.2f glideA=%.2f gStreak=%d sweep=%.2f rev=%d sStreak=%d growth=%.2f size=%.2f refract=%.0f",
                 ti, band.name, glideRel, glideAbs, self.tracks[ti].glideStreak, sweep, reversals,
                 self.tracks[ti].sweepStreak, growth, handSize, nowMs - self.lastTriggerMs)
      }
      if self.tracks[ti].sweepStreak >= band.confirm && !self.passOnlyMode && !reversePass && nowMs > self.speedSuppressUntilMs && nowMs - self.lastTriggerMs > self.refractoryMs {
        self.tracks[ti].sweepStreak = 0
        self.fireTrigger(String(format: "T%d sweep=%.2f rev=%d y=%.2f size=%.2f score=%.2f netDx=%+.2f", ti, sweep, reversals, c.y, handSize, handScore, netDx700), nowMs, handSize: handSize, trackIdx: ti)
        return glideAbs
      }
      if growth > self.growthRatioThreshold && speedPeak > self.speedThresholdPerSec && !self.passOnlyMode && !reversePass && nowMs > self.speedSuppressUntilMs && nowMs - self.lastTriggerMs > self.refractoryMs {
        // 안드 파리티 — 즉시 발화(보류 없음). 뻗는 손의 오발은 볼륨눌림 후 1.5초 잠금(processTrack
        // 최상단)과 재무장(안드 원본)이 담당.
        self.fireTrigger(String(format: "T%d growth=%.2f speed=%.2f", ti, growth, speedPeak), nowMs, handSize: handSize, trackIdx: ti)
      }
      return glideAbs
  }

  // occlusion(렌즈 가림) — 안드 checkOcclusion과 동일: 창 안 최대밝기 대비 급감 + 절대 어두움.
  // 🔴 2026-08-21 사장님 설계("카메라를 손으로 가리고 볼륨 누르면 볼륨키 되게 하라") — 가림 상태를
  // 볼륨 모듈에 실시간 공유(PaceLensCovered)한다: 가림 중(+직후) 볼륨키 눌림 = 폰버튼 확정(볼륨만).
  // 기존 "가림=넘김" 제스처와의 공존: 가림 발화를 0.9초 보류하고, 그 사이 볼륨키가 눌리면
  // "볼륨 조절 의도의 가림"으로 보고 넘김을 취소한다. 가림만 하고 안 누르면 기존대로 넘김.
  private var pendingOcclusionWork: DispatchWorkItem? = nil
  private var lastLensCoveredPostMs: Double = 0
  // 🔴 2026-08-25 사장님("50cm까지 가까울 때 멀 때 다 되게", "가까이에서는 손 아니어도 넘어가게") —
  // 초근접(<15cm)은 손이 프레임을 넘쳐 랜드마커가 원리적으로 실명(실측 22:20 hand=0/61). 이 구간은
  // 손 모양 확인 없이 **밝기 dip**으로 본다: 뭔가 렌즈 앞을 스치면 밝기가 짧고 깊게 꺼졌다 돌아온다.
  // 지속 가림(0.9s+)은 기존 occlusion/볼륨 프로토콜 경로 그대로, 짧은 dip(80~800ms)+회복(80%)만
  // "근접 스침"으로 즉시 발화. 깊이 50%+회복 요구로 램프 점멸/그림자 오탐을 줄인다. 크기·사람 무관.
  // ⚠️ 기존 lumaHistory(400ms, 안드 파리티)는 안 건드리고 dip 전용 기록을 따로 쓴다.
  // 좌/우 반쪽 루마(2026-08-25 사장님 "반대 방향은 또 되고 — 방향 정한 거 아냐?") — dip에도 방향을 준다:
  // 왼쪽 반이 먼저 어두워지면 왼→오(발화), 오른쪽이 먼저면 오→왼(무시). 30ms 이내 동시는 모호 → 발화(관대).
  private let dipWindowMs: Double = 1200
  private var dipHistory: [(t: Double, luma: Double, l: Double, m: Double, r: Double)] = []
  // 🔴 22:52 확진 — dip의 "밝음" 기준을 1.2s 창 최대로 잡으면 연속 스침 중엔 기준 자체가 어두워져
  // dip이 영영 성립 안 한다. 천천히 감쇠하는 기준(프레임당 ×0.995 ≈ 수 초 유지)으로 교체 — 한 번
  // 밝았던 장면을 기억해 연속 시도 중에도 "지금 어두워졌다"를 판정할 수 있다.
  private var brightRefAll: Double = 0
  private var brightRefL: Double = 0
  private var brightRefM: Double = 0
  private var brightRefR: Double = 0
  private func checkOcclusion(_ luma: Double, _ lumaL: Double, _ lumaM: Double, _ lumaR: Double, _ nowMs: Double) {
    lumaHistory.append((nowMs, luma))
    while let f = lumaHistory.first, nowMs - f.t > lumaWindowMs { lumaHistory.removeFirst() }
    // 근접 스침(dip) — 상단 dipWindowMs 주석 참고.
    dipHistory.append((nowMs, luma, lumaL, lumaM, lumaR))
    while let f = dipHistory.first, nowMs - f.t > dipWindowMs { dipHistory.removeFirst() }
    brightRefAll = max(luma, brightRefAll * 0.995)
    brightRefL = max(lumaL, brightRefL * 0.995)
    brightRefM = max(lumaM, brightRefM * 0.995)
    brightRefR = max(lumaR, brightRefR * 0.995)
    // 🔴 2026-08-25 22:47 확진("왼오가 안 넘어간다", 중거리) — 움직이는 손은 랜드마크가 27틱 중 2틱만
    // 잡혀 크로싱(2회 포착 필요)이 성립 불가. **lumapass**: 세로 3분할 밝기가 순차로 얕게(15%) 꺼지는
    // 패턴 = 중거리 통과. 손 모양 인식 불요·추적 끊김 무관. 사용자 왼→오 = 이미지 오른쪽→가운데→왼쪽
    // (부호 실측). 전역 조명 변화(영상 밝기·AE)는 세 구간 동시 변동이라 순서 조건에서 걸러진다.
    if nowMs - lastTriggerMs > passRefractoryMs, dipHistory.count >= 6,
       let firstD = dipHistory.first, nowMs - firstD.t >= 500 {
      func onset(_ vals: [(t: Double, v: Double)], _ ref: Double) -> Double? {
        guard ref > 40 else { return nil }
        return vals.first(where: { $0.v <= ref * 0.85 })?.t
      }
      let tLo = onset(dipHistory.map { (t: $0.t, v: $0.l) }, brightRefL)
      let tMo = onset(dipHistory.map { (t: $0.t, v: $0.m) }, brightRefM)
      let tRo = onset(dipHistory.map { (t: $0.t, v: $0.r) }, brightRefR)
      if let tR3 = tRo, let tM3 = tMo, let tL3 = tLo {
        if tR3 < tM3, tM3 < tL3, tL3 - tR3 >= 80, tL3 - tR3 <= 900 {
          dipHistory.removeAll()
          fireTrigger(String(format: "lumapass span=%.0f", tL3 - tR3), nowMs)
          return
        }
        if tL3 < tM3, tM3 < tR3, tR3 - tL3 >= 80, tR3 - tL3 <= 900 {
          dipHistory.removeAll()
          speedSuppressUntilMs = nowMs + 800
          paceGLog("[pace-wave] lumaskip R->L span=%.0f", tR3 - tL3)
          onDiag(String(format: "lumaskip span=%.0f", tR3 - tL3))
        }
      }
    }
    if nowMs - lastTriggerMs > passRefractoryMs, dipHistory.count >= 5,
       let first = dipHistory.first, nowMs - first.t >= 600 {
      let bright = max(dipHistory.map { $0.luma }.max() ?? 0, brightRefAll)
      if bright > 40 {
        let dipCandidates = dipHistory.filter { nowMs - $0.t >= 80 && nowMs - $0.t <= 800 }
        if let dip = dipCandidates.min(by: { $0.luma < $1.luma }),
           dip.luma <= bright * 0.5, luma >= brightRefAll * 0.7 {
          // 방향 판정(2026-08-25 사장님 "가까이서 왼→오 안 넘어가는 게 문제") — "가장 어두운 시점"은
          // 가까우면 양쪽이 동시에 포화돼 항상 모호(dtLR=0)했다. **어두워지기 시작한 시점(onset)**이
          // 방향을 훨씬 잘 가른다: 손이 먼저 덮는 쪽이 먼저 떨어진다. 부호 실기기 확정 — 사용자
          // 왼→오 = 이미지 오른쪽 반 onset이 먼저(tR<tL). 우선순위는 왼→오 성공이 1순위이므로
          // **확실한 오→왼(이미지 왼쪽 onset이 40ms+ 먼저)만 차단**, 모호하면 발화.
          let onsetTh = brightRefAll * 0.55
          let tL = dipCandidates.first(where: { $0.l <= onsetTh })?.t ?? dip.t
          let tR = dipCandidates.first(where: { $0.r <= onsetTh })?.t ?? dip.t
          dipHistory.removeAll()
          if tR - tL >= 40 {
            speedSuppressUntilMs = nowMs + 800 // 근접 오→왼 차단 직후 잔움직임 누수도 동일하게 잠금
            paceGLog("[pace-wave] nearskip R->L dt=%.0f", tR - tL)
            onDiag(String(format: "nearskip dt=%+.0f", tL - tR))
          } else {
            pendingOcclusionWork?.cancel()
            pendingOcclusionWork = nil
            fireTrigger(String(format: "nearpass dip=%.0f bright=%.0f dtLR=%.0f", dip.luma, bright, tL - tR), nowMs)
            return
          }
        }
      }
    }
    guard let brightest = lumaHistory.map({ $0.luma }).max(), brightest > 0 else { return }
    // 2026-08-21 안드 이식(1899cf3 §1) — NEAR 밴드 손을 1.2초 안에 본 경우에만 문턱 완화
    // (0.45→0.68 / 70→130): "손이 렌즈 코앞"이라는 독립 증거가 있을 때만이라 조명 오탐은 안 는다.
    let nearRecent = nowMs - lastNearHandMs < 1200
    let dropR = nearRecent ? 0.68 : lumaDropRatio
    let darkMax = nearRecent ? 130.0 : lumaDarkAbsMax
    if luma / brightest <= dropR && luma <= darkMax {
      if nowMs - lastLensCoveredPostMs > 150 { // 가림 지속 알림(150ms 스로틀) — 볼륨 모듈이 수신
        lastLensCoveredPostMs = nowMs
        NotificationCenter.default.post(name: Notification.Name("PaceLensCovered"), object: nil)
      }
      if nowMs - lastTriggerMs > refractoryMs && pendingOcclusionWork == nil {
        let reason = String(format: "occlusion luma=%.0f%@(0.9s확정)", luma, nearRecent ? " near완화" : "")
        let work = DispatchWorkItem { [weak self] in
          guard let self = self else { return }
          self.pendingOcclusionWork = nil
          if CFAbsoluteTimeGetCurrent() * 1000 - self.lastVolumePressMs < 1500 {
            paceGLog("[pace-wave] occlusion 발화 취소 — 가림 중 볼륨키 눌림(볼륨 조절 의도)")
            return
          }
          self.fireTrigger(reason, CFAbsoluteTimeGetCurrent() * 1000)
        }
        pendingOcclusionWork = work
        lastTriggerMs = nowMs // 보류 중 재예약 방지(불응 공유)
        queue.asyncAfter(deadline: .now() + 0.9, execute: work)
      }
    }
  }

  // growth/occlusion 공유 발동 — 안드 fireTrigger와 동일(refractory·이력초기화·재무장·메인 dispatch).
  // handSize>0인 손 경로만 재무장 게이트를 건다(occlusion은 손 크기 개념이 없어 안드와 동일하게 제외).
  // 발화 시 모든 트랙 이력 초기화(같은 물리 제스처를 두 트랙이 나눠 본 경우의 이중 발화 방지),
  // 재무장은 발화한 트랙에만 건다(다른 손은 자유).
  private func fireTrigger(_ reason: String, _ nowMs: Double, handSize: Double = 0, trackIdx: Int = -1) {
    lastTriggerMs = nowMs
    lumaHistory.removeAll()
    // ⚠️ xHistory는 비우지 않는다(2026-08-21) — 비우면 발화 직후 글라이드 연속성이 끊겨 전역 burst의
    // "움직임 지속" 추적이 끊기고, 600ms 정지 판정이 손짓 도중 성립해 재발화한다(01:11 3연발 원인).
    // 재발화 방지는 globalBurstFired가 담당하므로 이력 유지가 안전하다.
    for i in 0..<tracks.count { tracks[i].sizeHistory.removeAll(); tracks[i].sweepStreak = 0; tracks[i].glideStreak = 0 }
    stillnessStartMs = 0 // 발화 후 정지 측정은 처음부터 다시(낡은 시계 오판 방지 — 01:30 실측)
    if handSize > 0, trackIdx >= 0, trackIdx < tracks.count {
      tracks[trackIdx].awaitingRearm = true
      tracks[trackIdx].rearmBelowSize = handSize * rearmSizeRatio
      tracks[trackIdx].rearmAnchorX = tracks[trackIdx].lastX
      tracks[trackIdx].rearmAnchorY = tracks[trackIdx].lastY
    }
    // 🔬 유령 채증(상단 lastPixelBuffer 주석) — 발화 순간 프레임을 JPEG로 저장. 발화당 1장이라 비용 미미.
    // ⚠️ DEBUG 전용 — 릴리즈 빌드에 사용자 카메라 사진 저장이 실려 나가면 안 된다(2026-08-19 출시 전 가드).
    #if DEBUG
    if let pb = lastPixelBuffer {
      let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("wave_debug", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let ci = CIImage(cvPixelBuffer: pb)
      if let data = ciContext.jpegRepresentation(of: ci, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [:]) {
        let name = String(format: "wave_%.0f.jpg", nowMs)
        try? data.write(to: dir.appendingPathComponent(name))
        paceGLog("[pace-wave] 📸 frame saved %@", name)
        // 최근 30장만 유지
        if let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil), files.count > 30 {
          for f in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).prefix(files.count - 30) {
            try? FileManager.default.removeItem(at: f)
          }
        }
      }
    }
    #endif
    paceGLog("[pace-wave] 👋 WAVE! %@", reason)
    onDiag("👋 WAVE! \(reason)")
    DispatchQueue.main.async { self.onWave() }
  }

  // Y(루마) 평면 평균 밝기(0~255) — occlusion/dip 판정용(ML 안 거치고 싸게 계산). 2026-07-28 리서치(#1) —
  // 420f YUV의 plane 0이 곧 루마라 바이트 평균만 하면 된다(예전 BGRA 가중합보다 싸고 정확). BGRA 폴백도 유지.
  // 2026-08-25 — 좌/우 반쪽을 따로 평균한다(dip 방향 판정, checkOcclusion 주석). 버퍼는 connection에서
  // 세로+미러 고정이라(setupCamera) 버퍼 x축 = 화면 x축 = 랜드마크 x축.
  private func avgLumaThirds(_ pb: CVPixelBuffer) -> (l: Double, m: Double, r: Double) {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let fmt = CVPixelBufferGetPixelFormatType(pb)
    let isYUV = (fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)
    if isYUV && CVPixelBufferGetPlaneCount(pb) > 0 {
      guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return (-1, -1, -1) }
      let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
      let bpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
      let ptr = base.assumingMemoryBound(to: UInt8.self)
      var sumL = 0, cntL = 0, sumM = 0, cntM = 0, sumR = 0, cntR = 0
      let t1 = w / 3, t2 = 2 * w / 3
      let sx = max(1, w / 24), sy = max(1, h / 24)
      var y = 0
      while y < h {
        var x = 0
        while x < w {
          let v = Int(ptr[y * bpr + x])
          if x < t1 { sumL += v; cntL += 1 } else if x < t2 { sumM += v; cntM += 1 } else { sumR += v; cntR += 1 }
          x += sx
        }
        y += sy
      }
      return (cntL > 0 ? Double(sumL) / Double(cntL) : -1, cntM > 0 ? Double(sumM) / Double(cntM) : -1, cntR > 0 ? Double(sumR) / Double(cntR) : -1)
    }
    // BGRA 폴백(포맷이 YUV가 아닐 때)
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return (-1, -1, -1) }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    let bpr = CVPixelBufferGetBytesPerRow(pb)
    let ptr = base.assumingMemoryBound(to: UInt8.self)
    var sumL = 0, cntL = 0, sumM = 0, cntM = 0, sumR = 0, cntR = 0
    let t1 = w / 3, t2 = 2 * w / 3
    let sx = max(1, w / 24), sy = max(1, h / 24)
    var y = 0
    while y < h {
      var x = 0
      while x < w {
        let o = y * bpr + x * 4
        let b = Int(ptr[o]), g = Int(ptr[o + 1]), r = Int(ptr[o + 2])
        let v = (r * 299 + g * 587 + b * 114) / 1000
        if x < t1 { sumL += v; cntL += 1 } else if x < t2 { sumM += v; cntM += 1 } else { sumR += v; cntR += 1 }
        x += sx
      }
      y += sy
    }
    return (cntL > 0 ? Double(sumL) / Double(cntL) : -1, cntM > 0 ? Double(sumM) / Double(cntM) : -1, cntR > 0 ? Double(sumR) / Double(cntR) : -1)
  }
}
