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
  private let processIntervalMs: Double = 150      // 안드 PROCESS_INTERVAL_MS (⚠️ 2026-07-28 100ms 롤백 — 어젯밤 검증값으로 복구)
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
  private let sweepConfirmFrames: Int = 2           // 안드 SWEEP_CONFIRM_FRAMES
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
  private var awaitingRearm = false
  private var rearmBelowSize: Double = 0
  private var rearmAnchorX: Double = 0, rearmAnchorY: Double = 0 // 발화 순간 손목 위치(이동 해제 판정용)
  private var lastWristX: Double = 0, lastWristY: Double = 0     // 매 프레임 갱신 → fireTrigger가 앵커로 복사
  private var cameraStartedAtMs: Double = 0   // 웜업 판정(안드 WARMUP_* 이식 — captureOutput 주석)
  private var firstDetectionDone = false      // 첫 손 인식 후 웜업 종료
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
    options.numHands = 1
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
      if !p { self.sizeHistory.removeAll(); self.lumaHistory.removeAll(); self.xHistory.removeAll(); self.sweepStreak = 0; self.lastHandSeenMs = 0; self.awaitingRearm = false }
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
      self.sizeHistory.removeAll()
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
      let luma = avgLuma(pb)
      if luma >= 0 { checkOcclusion(luma, nowMs) }
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

  // MediaPipe 결과 델리게이트 — 안드 onResult와 동일: 손목(0)↔중지뿌리(9) 거리 growth가 창 안에서 임계 이상이면 발화.
  func handLandmarker(_ handLandmarker: HandLandmarker, didFinishDetection result: HandLandmarkerResult?, timestampInMilliseconds: Int, error: Error?) {
    let nowMs = Double(timestampInMilliseconds)
    queue.async { // 상태(sizeHistory/lastTriggerMs)를 camera queue 하나로 직렬화(occlusion과 공유)
      guard let hand = result?.landmarks.first, hand.count > 9 else {
        // 🔴 안드 onResult 파리티(2026-08-18 밤) — 손이 안 잡힌 프레임에서 **즉시** 이력을 버리고
        // 재무장한다. 안드가 2026-08-05 실측으로 확정한 결함: 이력을 유지하면 손 인식이 잠깐 끊겼다
        // **다른 위치에서** 다시 잡힐 때 그 점프가 "가로로 크게 흔들었다"(sweep 0.2~2.3)로 계산돼
        // 안 움직였는데도 연발한다 — 오늘 밤 유령 발화(sweep 0.2~0.5, score 1.0 리듬 연발)의 서명과
        // 정확히 일치한다. iOS는 지금까지 no-hand에서 이력을 안 버리고 있었다(파리티 누락).
        self.awaitingRearm = false // 손이 화면에서 사라짐 = 확실히 물러난 것(안드와 동일)
        self.sizeHistory.removeAll(); self.xHistory.removeAll(); self.sweepStreak = 0
        self.logTick += 1; if self.logTick % 10 == 0 { self.onDiag("no hand") }
        return
      }
      // 2026-08-18 — 유령 손(책상면 오인) vs 진짜 손 판별용: MediaPipe 손 신뢰도 점수.
      let handScore = Double(result?.handedness.first?.first?.score ?? -1)
      let wrist = hand[0], mcp = hand[9]
      let handSize = Double(hypot(wrist.x - mcp.x, wrist.y - mcp.y))
      if handSize < self.minHandSize { return }
      // ⛔ 2026-08-18(밤) 하단 y게이트(>0.85 무시) 제거 — 실기기 로그로 폐기 확정. 사장님의 거치
      // 각도에서는 **진짜 손짓이 y=0.82~0.93(프레임 하단)에서 잡힌다**: 22:37:45 정상 발화(y=0.82,
      // 전환 성공) 직후의 진짜 손짓들이 전부 gate-reject(y=0.86~0.93, score 0.96~0.99)로 차단돼
      // "손짓 하나도 안 됨"이 됐다. 게이트는 안드에 없는 iOS 임의 발명품이었고(파리티 위반),
      // 오발 연발 방지는 안드와 동일한 재무장 게이트 + 손 소실 시 이력 폐기가 맡는다.
      // 부재→근접 등장 안전망: 이전에 손을 본 적이 있고(lastHandSeenMs>0), 그 뒤 ≥reappearGapMs 동안
      // 손이 안 보이다가 지금 ≥reappearMinSize로 크게 나타났다면 폰 쪽으로 접근한 것 → 발화.
      // (growth 경로는 접근 "초반의 작은 프레임"이 있어야 하는데 부하 시 그걸 놓치므로 이 경로로 보완.)
      let gap = nowMs - self.lastHandSeenMs
      let prevSeen = self.lastHandSeenMs
      self.lastHandSeenMs = nowMs
      self.lastWristX = Double(wrist.x); self.lastWristY = Double(wrist.y) // 재무장 이동판정 앵커용
      if !self.firstDetectionDone {
        self.firstDetectionDone = true // 웜업 종료 → 처리 간격 150ms 복귀(captureOutput 주석)
        paceGLog("[pace-wave] 첫 손 인식 — 웜업 종료(%.0fms 소요)", nowMs - self.cameraStartedAtMs)
      }

      // (제거됨 2026-08-18) reappear 경로 — 안드에 없는 iOS 임의 발명품이었고 한 손짓의 스트로크
      // 사이 손 이탈/복귀를 새 손짓으로 오인해 연발("한 손짓에 4번")의 공범이었다. 안드 파리티로 삭제.
      _ = gap; _ = prevSeen;
      // 안드 파리티 — 재무장 게이트(상수 주석 참고): 발화 후 손이 그대로 머물러 있으면 잔류 흔들림을
      // 새 제스처로 세지 않는다. 축소(shrink) 또는 타임아웃으로만 재무장. 어느 쪽으로 풀렸는지 로그
      // 1줄(안드 "rearmed after …ms by=" 와 동일) — 이후 튜닝은 이 실측으로만 한다.
      if self.awaitingRearm {
        // 🔴 2026-08-18(밤) 타임아웃 재무장 제거 — 발화 순간 프레임 채증으로 확정된 사용 자세(얼굴 근처에
        // 손을 상시 두는 턱 괴기·머리 만지기)에서는 손이 화면을 떠나지 않으므로, 1.5초 타임아웃이
        // 있으면 그 손의 일상 흔들림이 1.5~3초마다 재발화하는 폭주가 된다(22:52~53 실측: 머리 만지는
        // 손이 반전 게이트까지 통과해 연발). 재무장 해제는 세 가지뿐:
        //   ① 축소(0.85배) — 손을 뒤로 뺌  ② 화면에서 사라짐(no-hand 경로)
        //   ③ 이동 — 발화 지점에서 1.5 손폭 이상 떨어진 곳에서 손이 잡힘(23:17 실기기 재현 "발화 1회 후
        //      하나도 안 됨"의 처방: 제자리 턱 괸 손이 같은 크기로 계속 잡히면 ①②가 영영 안 성립해
        //      영구 잠금이 됐다. 제자리 꼼지락(±0.3 손폭)은 잠금 유지, 옆에서 들어오는 새 손짓은 즉시 해제).
        let moved = Double(hypot(Double(wrist.x) - self.rearmAnchorX, Double(wrist.y) - self.rearmAnchorY))
        if handSize <= self.rearmBelowSize || moved > 1.5 * max(handSize, 0.08) {
          paceGLog("[pace-wave] rearmed after %.0fms by=%@ size=%.2f moved=%.2f",
                   nowMs - self.lastTriggerMs,
                   handSize <= self.rearmBelowSize ? "shrink" : "moved",
                   handSize, moved)
          self.awaitingRearm = false
        } else {
          return // 손이 여전히 그 자리에 그 크기로 있음 — 새 제스처가 아니다
        }
      }
      self.sizeHistory.append((nowMs, handSize))
      while let f = self.sizeHistory.first, nowMs - f.t > self.growthWindowMs { self.sizeHistory.removeFirst() }
      // 🔴 sweep 축(2026-08-18 안드 이식) — 좌우 휘젓기: 짧은 창 안 손목 x 이동폭/손 크기.
      self.xHistory.append((nowMs, Double(wrist.x)))
      while let f = self.xHistory.first, nowMs - f.t > self.sweepWindowMs { self.xHistory.removeFirst() }
      var sweep = 0.0
      if let mx = self.xHistory.map({ $0.x }).max(), let mn = self.xHistory.map({ $0.x }).min(), handSize > 0 {
        sweep = (mx - mn) / handSize
      }
      // 🔴 2026-08-18(밤) 발화 순간 프레임 채증으로 확정된 진짜 원인 — "유령"은 턱을 괸 사장님 본인의
      // 손이었다(3장 전부 얼굴 옆 턱받침 손, score 1.0). 그 손을 고쳐 잡는 **한 방향 드리프트**가
      // sweep 0.36~0.39로 임계(0.16)를 넘어 연발했다. 진짜 "훠이" 손짓은 좌우 **왕복**이므로,
      // sweep 발화에 "유의미한 방향 반전 ≥1회"를 요구한다(스트로크 최소폭 = 손 크기의 12% —
      // 정지 손 관측 잡음 최대 0.185*size보다 낮고, 왕복 스트로크는 크게 상회). 드리프트는 반전
      // 0회라 차단, 왕복 손짓은 700ms 창 안에 1~3회 반전이라 통과. 채증 사진 기반 최소 수정.
      var reversals = 0
      if handSize > 0, self.xHistory.count >= 3 {
        let minStroke = 0.12 * handSize
        var lastDir = 0
        var anchorX = self.xHistory[0].x
        for p in self.xHistory.dropFirst() {
          let dx = p.x - anchorX
          if abs(dx) >= minStroke {
            let dir = dx > 0 ? 1 : -1
            if lastDir != 0 && dir != lastDir { reversals += 1 }
            lastDir = dir
            anchorX = p.x
          }
        }
      }
      if sweep > self.sweepRatioThreshold && reversals >= 1 { self.sweepStreak += 1 } else { self.sweepStreak = 0 }
      guard let oldest = self.sizeHistory.first else { return }
      let growth = handSize / oldest.size
      // 안드 파리티 — 속도 피크: 최근 speedPeakWindowMs 안의 |크기 변화율| 최대(초당). 손짓 초반은
      // 빠르지만 작고 후반은 크지만 느려 같은 프레임 AND는 못 걸므로 창 내 최댓값으로 본다(안드 주석).
      var speedPeak = 0.0
      for si2 in 1..<self.sizeHistory.count {
        let a = self.sizeHistory[si2 - 1], b = self.sizeHistory[si2]
        if nowMs - b.t > self.speedPeakWindowMs { continue }
        let dt = (b.t - a.t) / 1000.0
        if dt > 0 { speedPeak = max(speedPeak, abs(b.size - a.size) / dt) }
      }
      self.logTick += 1
      if self.logTick % 4 == 0 { self.onDiag(String(format: "hand=%.3f growth=%.2f sweep=%.2f", handSize, growth, sweep)) }
      if self.sweepStreak >= self.sweepConfirmFrames && nowMs - self.lastTriggerMs > self.refractoryMs {
        self.sweepStreak = 0
        // 2026-08-18 오발화 원인 판별용 — 손의 화면 위치(y: 0=상단 1=하단)와 크기를 함께 남긴다.
        // 타이핑 손(거치 폰 앞 키보드)은 하단 가장자리, 진짜 손짓은 중앙 높이라는 가설 검증.
        self.fireTrigger(String(format: "sweep=%.2f rev=%d y=%.2f size=%.2f score=%.2f", sweep, reversals, Double(wrist.y), handSize, handScore), nowMs, handSize: handSize)
        return
      }
      if growth > self.growthRatioThreshold && speedPeak > self.speedThresholdPerSec && nowMs - self.lastTriggerMs > self.refractoryMs {
        self.fireTrigger(String(format: "growth=%.2f speed=%.2f", growth, speedPeak), nowMs, handSize: handSize)
      }
    }
  }

  // occlusion(렌즈 가림) — 안드 checkOcclusion과 동일: 창 안 최대밝기 대비 급감 + 절대 어두움.
  private func checkOcclusion(_ luma: Double, _ nowMs: Double) {
    lumaHistory.append((nowMs, luma))
    while let f = lumaHistory.first, nowMs - f.t > lumaWindowMs { lumaHistory.removeFirst() }
    guard let brightest = lumaHistory.map({ $0.luma }).max(), brightest > 0 else { return }
    if luma / brightest <= lumaDropRatio && luma <= lumaDarkAbsMax && nowMs - lastTriggerMs > refractoryMs {
      fireTrigger(String(format: "occlusion luma=%.0f", luma), nowMs)
    }
  }

  // growth/occlusion 공유 발동 — 안드 fireTrigger와 동일(refractory·이력초기화·재무장·메인 dispatch).
  // handSize>0인 손 경로만 재무장 게이트를 건다(occlusion은 손 크기 개념이 없어 안드와 동일하게 제외).
  private func fireTrigger(_ reason: String, _ nowMs: Double, handSize: Double = 0) {
    lastTriggerMs = nowMs
    sizeHistory.removeAll(); lumaHistory.removeAll(); xHistory.removeAll(); sweepStreak = 0
    if handSize > 0 {
      awaitingRearm = true
      rearmBelowSize = handSize * rearmSizeRatio
      rearmAnchorX = lastWristX; rearmAnchorY = lastWristY
    }
    // 🔬 유령 채증(상단 lastPixelBuffer 주석) — 발화 순간 프레임을 JPEG로 저장. 발화당 1장이라 비용 미미.
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
    paceGLog("[pace-wave] 👋 WAVE! %@", reason)
    onDiag("👋 WAVE! \(reason)")
    DispatchQueue.main.async { self.onWave() }
  }

  // Y(루마) 평면 평균 밝기(0~255) — occlusion 판정용(ML 안 거치고 싸게 계산). 2026-07-28 리서치(#1) —
  // 420f YUV의 plane 0이 곧 루마라 바이트 평균만 하면 된다(예전 BGRA 가중합보다 싸고 정확). BGRA 폴백도 유지.
  private func avgLuma(_ pb: CVPixelBuffer) -> Double {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let fmt = CVPixelBufferGetPixelFormatType(pb)
    let isYUV = (fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)
    if isYUV && CVPixelBufferGetPlaneCount(pb) > 0 {
      guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return -1 }
      let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
      let bpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
      let ptr = base.assumingMemoryBound(to: UInt8.self)
      var sum = 0, cnt = 0
      let sx = max(1, w / 24), sy = max(1, h / 24)
      var y = 0
      while y < h {
        var x = 0
        while x < w { sum += Int(ptr[y * bpr + x]); cnt += 1; x += sx }
        y += sy
      }
      return cnt > 0 ? Double(sum) / Double(cnt) : -1
    }
    // BGRA 폴백(포맷이 YUV가 아닐 때)
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return -1 }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    let bpr = CVPixelBufferGetBytesPerRow(pb)
    let ptr = base.assumingMemoryBound(to: UInt8.self)
    var sum = 0, cnt = 0
    let sx = max(1, w / 24), sy = max(1, h / 24)
    var y = 0
    while y < h {
      var x = 0
      while x < w {
        let o = y * bpr + x * 4
        let b = Int(ptr[o]), g = Int(ptr[o + 1]), r = Int(ptr[o + 2])
        sum += (r * 299 + g * 587 + b * 114) / 1000; cnt += 1
        x += sx
      }
      y += sy
    }
    return cnt > 0 ? Double(sum) / Double(cnt) : -1
  }
}
