import ExpoModulesCore
import AVFoundation
import SoundAnalysis
import ARKit
import Vision

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
  private var snapDetector: SnapDetector?
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
        if mode == "snap" || mode == "both" { self.startSnap() }
        if mode == "wave" || mode == "both" { self.startWave() }
        if mode == "head" { self.startHead() }
        promise.resolve(nil)
      }
    }

    Function("stop") {
      self.snapDetector?.stop()
      self.snapDetector = nil
      self.headDetector?.stop()
      self.headDetector = nil
      self.waveDetector?.stop()
      self.waveDetector = nil
    }

    // 디버그: JS(WebView 등) 문자열을 NSLog로 흘려 devicectl --console로 캡처. (임시 진단용)
    Function("nativeLog") { (msg: String) in
      NSLog("PACEWV %@", msg)
    }

    // 고개짓 지원 기기인지(TrueDepth). JS가 UI 노출 여부 판단에 사용.
    Function("isHeadGestureSupported") { () -> Bool in
      if #available(iOS 11.0, *) { return ARFaceTrackingConfiguration.isSupported }
      return false
    }

    OnDestroy {
      self.snapDetector?.stop()
      self.headDetector?.stop()
      self.waveDetector?.stop()
    }
  }

  // 손짓(전면카메라 "손 흔들기/휘젓기")으로 다음 넘김 — 안드로이드 PaceHandWaveDetector(MediaPipe) 대응.
  // iOS는 Vision VNDetectHumanHandPoseRequest로 손 랜드마크를 얻고, "손이 카메라로 다가오는(=손 크기가
  // 짧은 창 안에서 급격히 커지는)" 모션을 감지한다(안드로이드와 동일한 모션-기반 휴리스틱, 특정 포즈
  // 분류 아님). Focus Session ON 동안만 켜져 게이팅됨(카메라 상시 구동 방지 — 배터리/프라이버시).
  private func startWave() {
    guard #available(iOS 14.0, *) else {
      sendEvent("onError", ["kind": "wave", "message": "Hand pose needs iOS 14+"])
      return
    }
    if waveDetector != nil { return }
    let d = WaveDetector(
      onWave: { [weak self] in self?.sendEvent("onHandWave", [:]) },
      onError: { [weak self] msg in self?.sendEvent("onError", ["kind": "wave", "message": msg]) },
      onDiag: { [weak self] text in NSLog("PACEWAVE %@", text); self?.sendEvent("onDiag", ["kind": "wave", "text": text]) }
    )
    waveDetector = d
    d.start()
  }

  // 2026-07-23 사용자 지시 — 핑거스냅(AVAudioSession .playAndRecord + Voice Processing)이 블루투스
  // 리모컨의 오디오 세션과 충돌할 수 있다는 QA 지적(볼륨키 모듈과 category 다툼, 재생 ducking/reroute
  // 가능성) 반영: 블루투스 오디오 출력이 이미 연결돼 있으면 핑거스냅을 아예 켜지 않는다 — 리모컨이
  // 이미 같은 역할(다음 넘김)을 하므로 상호 배타적으로 둔다. Android(PaceOverlayService.kt
  // isBluetoothAudioConnected)와 동일한 결정, 이쪽은 AVAudioSession.currentRoute로 판단.
  // ⚠️ 실기기(Xcode) 미검증 — Mac 세션에서 실기기로 빌드/확인 필요.
  private func isBluetoothAudioConnected() -> Bool {
    let bluetoothPortTypes: Set<AVAudioSession.Port> = [.bluetoothA2DP, .bluetoothLE, .bluetoothHFP]
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains {
      bluetoothPortTypes.contains($0.portType)
    }
  }

  private func startSnap() {
    guard #available(iOS 13.0, *) else {
      sendEvent("onError", ["kind": "snap", "message": "SoundAnalysis requires iOS 13+"])
      return
    }
    if snapDetector != nil { return }
    if isBluetoothAudioConnected() {
      sendEvent("onError", ["kind": "snap", "message": "Bluetooth audio connected — snap detection skipped, use the remote instead"])
      return
    }
    let d = SnapDetector(
      onSnap: { [weak self] conf in self?.sendEvent("onSnap", ["confidence": conf]) },
      onError: { [weak self] msg in self?.sendEvent("onError", ["kind": "snap", "message": msg]) },
      onDiag: { [weak self] text in self?.sendEvent("onDiag", ["kind": "snap", "text": text]) }
    )
    snapDetector = d
    d.start()
  }

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

// MARK: - 핑거스냅 감지 (raw 오디오 DSP — 안드로이드 PaceSnapDetector 이식, SoundAnalysis 미사용)
// SoundAnalysis(SNClassifySoundRequest)는 iOS18+ 백그라운드 GPU 차단 등으로 Swift try/catch가 못 잡는
// ObjC NSException/추상화 이전 크래시가 구조적이라(실기기 로그 025855/030709.ips) 폐기하고, 안드로이드
// PaceSnapDetector와 동일한 raw DSP로 감지한다: 적응형 noiseFloor 대비 RMS 스파이크 + Goertzel 고/저역
// 마그니튜드 비율 + ZCR + 불응(refractory). AVAudioEngine 탭으로 PCM Float 버퍼를 받아 분석.
// AEC(VoiceProcessing)는 포맷 변형/덕킹/크래시 이슈로 끄고 .measurement 모드로 순간 스파이크를 보존한다.
@available(iOS 13.0, *)
private final class SnapDetector {
  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "pace.snap.dsp")
  private let onSnap: (Double) -> Void
  private let onError: (String) -> Void
  private let onDiag: (String) -> Void

  // 안드로이드 상수 이식. RMS 절대치는 16-bit(±32768) 기준 → Float(±1)로 ÷32768 환산, 나머지(Goertzel
  // 비율/ZCR/스파이크 배수)는 스케일 불변이라 그대로.
  private var noiseFloor: Float = 0.004
  private var lastFire: TimeInterval = 0
  // 실기기 로그로 튜닝(2026-07-26): 평소 rms~0.002, 스냅 rms~0.013~0.017(floor의 6~8배)로 아주
  // 깨끗이 분리됨. Goertzel 고/저역·ZCR 게이트는 이 셋업(AEC OFF, 피크 윈도우)에서 안 맞아(zcr이
  // 항상 0, hilo도 스냅에서 낮게 나옴) → RMS 스파이크 단독으로 판정. spikeMult 4배 + 절대하한 0.008.
  private let spikeMult: Float = 4.0
  private let minAbsRms: Float = 0.008
  private let floorGate: Float = 3.0        // rms < floor*3.0 일 때만 floor 갱신
  private let highHz: Float = 2500, lowHz: Float = 500
  private let freqRatio: Float = 1.2        // high > low*1.2
  private let zcrMin: Float = 0.08
  private let refractory: TimeInterval = 0.45
  private var logTick = 0
  private var retryCount = 0

  init(onSnap: @escaping (Double) -> Void, onError: @escaping (String) -> Void, onDiag: @escaping (String) -> Void) {
    self.onSnap = onSnap; self.onError = onError; self.onDiag = onDiag
  }

  func start() {
    NSLog("PACESNAP start() called")
    AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
      guard let self = self else { return }
      NSLog("PACESNAP mic permission granted=%@", granted ? "YES" : "NO")
      guard granted else { self.onError("microphone permission denied"); return }
      self.queue.async { self.begin() }
    }
  }

  private func scheduleRetry(_ why: String) {
    NSLog("PACESNAP retry(%d) after: %@", retryCount, why)
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    guard retryCount < 5 else { onError("snap start gave up: \(why)"); return }
    retryCount += 1
    queue.asyncAfter(deadline: .now() + 0.7) { [weak self] in self?.begin() }
  }

  private func begin() {
    NSLog("PACESNAP begin() enter")
    let session = AVAudioSession.sharedInstance()
    do {
      // .measurement: AGC 최소화(순간 스파이크 보존). .mixWithOthers로 유튜브 소리와 공존.
      // ⭐ 리서치 정답(2026-07-26): 다른 오디오(WebView 영상)를 죽이지 않으려면 mode는 .default(NOT
      // .measurement — 그건 출력 볼륨을 죽임), options는 .mixWithOthers(앱 세션을 협조적으로 만들어
      // WebView 세션을 인터럽트 안 함) + .defaultToSpeaker(수화부 저볼륨 라우팅 회피) + .allowBluetoothA2DP.
      try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP])
      try session.setActive(true)
    } catch {
      scheduleRetry("session config: \(error.localizedDescription)"); return
    }
    NSLog("PACESNAP session active (sr=%.0f)", session.sampleRate)
    let input = engine.inputNode

    // ⭐ 핵심: AVAudioEngine.start()/installTap은 WebView 오디오와 충돌 시 Swift가 못 잡는 ObjC
    // NSException(-10868)을 던져 앱을 죽였다(실기기 확인) → PaceExceptionCatcher(@try/@catch)로 감싸
    // 크래시 대신 Swift 에러로 받는다. VoiceProcessing(AEC=노이즈캔슬)로 재생음 에코를 상쇄(안드
    // AcousticEchoCanceler 대응). 탭 포맷 nil + 샘플레이트는 버퍼에서 읽어 sr=0 이슈 회피.
    do {
      try PaceExceptionCatcher.catchExceptions {
        // VoiceProcessing(AEC)은 iOS에서 입력 탭이 버퍼를 안 주는 이슈가 있어(실기기 확인, "started"는
        // 되나 rms 콜백이 안 옴) 쓰지 않는다. 대신 적응형 noiseFloor가 영상 소리 레벨을 추적하고 스냅이
        // 그 위로 6~8배 튀는 걸로 감지(=소프트웨어 노이즈 게이팅). .measurement 모드로 순간 스파이크 보존.
        input.removeTap(onBus: 0)                     // 재시도 시 기존 탭 제거(중복설치 크래시 방지)
        self.engine.prepare()
        input.installTap(onBus: 0, bufferSize: 2048, format: nil) { [weak self] buffer, _ in
          self?.process(buffer, sampleRate: Float(buffer.format.sampleRate))
        }
        do { try self.engine.start() }
        catch { NSLog("PACESNAP engine.start swift-err %@", error.localizedDescription) }
      }
    } catch {
      // ObjC NSException을 여기서 안전하게 받음(크래시 X) → 재시도.
      scheduleRetry("start exception: \(error.localizedDescription)"); return
    }

    if engine.isRunning {
      retryCount = 0
      NSLog("[pace-snap] started (AEC) sr=%.0f", session.sampleRate)
    } else {
      scheduleRetry("engine not running after start")
    }
  }

  private func process(_ buffer: AVAudioPCMBuffer, sampleRate: Float) {
    guard sampleRate > 0, let ch = buffer.floatChannelData?[0] else { return }
    let n = Int(buffer.frameLength)
    guard n >= 64 else { return }

    // ⭐ 핵심 수정: 스냅은 <10ms 순간 transient인데 iOS 탭 버퍼는 보통 ~100ms(4800샘플)라, 버퍼 전체
    // RMS로 재면 스냅 에너지가 희석돼 스파이크로 안 잡힌다. 작은 윈도우(≈5ms)로 쪼개 "피크 RMS"를
    // 잡아 순간 스파이크를 보존한다(안드로이드 20ms 프레임 대응). 주파수/ZCR도 그 피크 윈도우에서 계산.
    let win = min(256, n)
    var peakRms: Float = 0
    var peakStart = 0
    var i = 0
    while i + win <= n {
      var sum: Float = 0
      for j in i..<(i + win) { let s = ch[j]; sum += s * s }
      let r = (sum / Float(win)).squareRoot()
      if r > peakRms { peakRms = r; peakStart = i }
      i += win
    }
    let rms = peakRms

    if rms < noiseFloor * floorGate { noiseFloor = noiseFloor * 0.95 + rms * 0.05 } // 스파이크 아닐 때만 갱신

    logTick += 1
    if logTick % 12 == 0 {
      onDiag(String(format: "rms=%.4f fl=%.4f", rms, noiseFloor)) // 주기적 상태
      NSLog("PACESNAP rms=%.4f fl=%.4f", Double(rms), Double(noiseFloor))
    }

    guard rms > noiseFloor * spikeMult, rms > minAbsRms else { return }        // 스파이크(피크 기준)
    let base = ch + peakStart
    let high = goertzel(base, win, highHz, sampleRate)
    let low = goertzel(base, win, lowHz, sampleRate)
    let hilo = high / max(low, 1e-6)
    var cross = 0
    for j in 1..<win { if (base[j-1] >= 0) != (base[j] >= 0) { cross += 1 } }
    let zcr = Float(cross) / Float(win)
    // 스파이크가 잡히면(게이트 통과 여부와 무관) 진단으로 보여줘 임계 튜닝 근거를 만든다.
    // hilo/zcr은 참고용으로만 로그 — 게이트로는 안 씀(이 셋업에서 신뢰 못 함, 실기기 로그로 확인).
    onDiag(String(format: "SPIKE rms=%.3f hi/lo=%.2f", rms, hilo))
    NSLog("PACESNAP SPIKE rms=%.4f hilo=%.2f zcr=%.3f", Double(rms), Double(hilo), Double(zcr))

    let now = CACurrentMediaTime()
    guard now - lastFire > refractory else { return }
    lastFire = now
    onDiag("🫰 SNAP!")
    NSLog("PACESNAP 🫰 FIRED")
    DispatchQueue.main.async { self.onSnap(Double(rms)) }
  }

  // Goertzel 단일-빈 마그니튜드(정규화 안 함) — 스케일 불변, 안드로이드와 동일.
  private func goertzel(_ x: UnsafePointer<Float>, _ n: Int, _ targetHz: Float, _ sr: Float) -> Float {
    let k = Int(0.5 + Float(n) * targetHz / sr)
    let w = (2.0 * Float.pi / Float(n)) * Float(k)
    let coeff = 2.0 * cos(w)
    var q1: Float = 0, q2: Float = 0
    for i in 0..<n { let q0 = coeff * q1 - q2 + x[i]; q2 = q1; q1 = q0 }
    return (q1 * q1 + q2 * q2 - q1 * q2 * coeff).squareRoot()
  }

  func stop() {
    engine.inputNode.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

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
private final class WaveDetector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "pace.wave.camera")
  private let request = VNDetectHumanHandPoseRequest()
  private let onWave: () -> Void
  private let onError: (String) -> Void
  private let onDiag: (String) -> Void

  // 최근 (시각, 손 크기) 샘플 — 500ms 창에서 크기가 1.5배 이상 커지면 "다가오는 손짓"으로 판정.
  private var samples: [(t: TimeInterval, size: CGFloat)] = []
  private var lastFire: TimeInterval = 0
  private var lastAnalyze: TimeInterval = 0
  private var logTick = 0
  private var lockedOri: CGImagePropertyOrientation? = nil // 손이 처음 잡힌 orientation 고정(자동 탐색)
  private let windowSec: TimeInterval = 0.6
  private let growthRatio: CGFloat = 1.4          // 조금 더 잘 잡히게(안드 1.5보다 완화)
  private let minHandSize: CGFloat = 0.03         // 안드 MIN_HAND_SIZE
  private let refractorySec: TimeInterval = 1.2   // 안드 REFRACTORY_MS=1200
  private let analyzeIntervalSec: TimeInterval = 0.1 // 100ms마다 추론(더 촘촘히 → 빠른 손짓도 잡게)

  init(onWave: @escaping () -> Void, onError: @escaping (String) -> Void, onDiag: @escaping (String) -> Void) {
    self.onWave = onWave
    self.onError = onError
    self.onDiag = onDiag
    super.init()
    request.maximumHandCount = 1
  }

  func start() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      queue.async { self.configureAndRun() }
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        guard let self = self else { return }
        guard granted else { self.onError("camera permission denied"); return }
        self.queue.async { self.configureAndRun() }
      }
    default:
      onError("camera permission denied")
    }
  }

  private func configureAndRun() {
    session.beginConfiguration()
    session.sessionPreset = .vga640x480 // 손 모션 감지엔 저해상도로 충분(배터리/발열 절감)
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

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA] // Vision이 확실히 처리하는 포맷
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
    session.startRunning()
    NSLog("[pace-wave] camera started (front, portrait+mirror)")
  }

  func stop() {
    queue.async {
      if self.session.isRunning { self.session.stopRunning() }
      for i in self.session.inputs { self.session.removeInput(i) }
      for o in self.session.outputs { self.session.removeOutput(o) }
      self.samples.removeAll()
    }
  }

  // AVCaptureVideoDataOutputSampleBufferDelegate
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CFAbsoluteTimeGetCurrent()
    guard now - lastAnalyze >= analyzeIntervalSec else { return } // 프레임 스로틀
    lastAnalyze = now
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    // ⭐ orientation 자동 탐색: 실기기 로그에서 .up이 손을 전혀 못 잡음(no hand 100%). 어느 방향이 맞는지
    //    모르므로 8개 orientation을 순서대로 시도해 손이 잡히는 첫 방향을 쓰고, 한 번 성공하면 그 방향을 고정
    //    (lockedOri)해 이후 프레임은 그 방향만 — 8회 perform 비용은 손 찾기 전까지만.
    let allOri: [CGImagePropertyOrientation] = [.up, .right, .left, .down, .upMirrored, .rightMirrored, .leftMirrored, .downMirrored]
    let tryOri: [CGImagePropertyOrientation] = lockedOri != nil ? [lockedOri!] : allOri
    logTick += 1
    var obsOpt: VNHumanHandPoseObservation? = nil
    var usedOri: CGImagePropertyOrientation = .up
    for ori in tryOri {
      let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: ori, options: [:])
      if (try? handler.perform([request])) == nil { continue }
      if let r = request.results?.first { obsOpt = r; usedOri = ori; break }
    }
    guard let obs = obsOpt else {
      samples.removeAll()
      if logTick % 6 == 0 { onDiag(lockedOri != nil ? "no hand(locked)" : "no hand(all ori)") }
      return
    }
    if lockedOri == nil { lockedOri = usedOri; onDiag("HAND FOUND ori=\(usedOri.rawValue)") } // 첫 감지 방향 고정+로그

    // 손 "크기" = 손목 ↔ 중지뿌리(MCP) 거리(안드로이드와 동일 지표). 신뢰도 낮은 점은 버린다.
    guard
      let wrist = try? obs.recognizedPoint(.wrist),
      let mcp = try? obs.recognizedPoint(.middleMCP)
    else { onDiag("hand? no wrist/mcp"); return }
    if wrist.confidence <= 0.3 || mcp.confidence <= 0.3 {
      onDiag(String(format: "hand low-conf w=%.2f m=%.2f", wrist.confidence, mcp.confidence)); return
    }
    let dx = wrist.location.x - mcp.location.x
    let dy = wrist.location.y - mcp.location.y
    let size = CGFloat((dx * dx + dy * dy).squareRoot())
    onDiag(String(format: "hand=%.3f n=%d", Double(size), samples.count + 1)) // 손 잡힘 + 크기
    guard size >= minHandSize else { return } // 너무 작으면(먼 배경) 무시 — 안드 MIN_HAND_SIZE=0.03

    let t = now
    samples.append((t, size))
    samples.removeAll { t - $0.t > windowSec } // 창(500ms) 밖 제거
    guard samples.count >= 2, let oldest = samples.first else { return }

    // 창 안 최고령(가장 오래된) 크기 대비 현재 크기가 growthRatio 이상 = "손이 급히 다가옴"(안드와 동일).
    if size >= oldest.size * growthRatio {
      guard now - lastFire > refractorySec else { return }
      lastFire = now
      samples.removeAll() // 트리거 후 이력 초기화
      onDiag("👋 WAVE!")
      DispatchQueue.main.async { self.onWave() }
    }
  }
}
