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

    Events("onSnap", "onHeadNod", "onHandWave", "onError")

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
      onError: { [weak self] msg in self?.sendEvent("onError", ["kind": "wave", "message": msg]) }
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
      onError: { [weak self] msg in self?.sendEvent("onError", ["kind": "snap", "message": msg]) }
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

// MARK: - 핑거스냅 감지 (SoundAnalysis 내장 분류기)
@available(iOS 13.0, *)
private final class SnapDetector: NSObject, SNResultsObserving {
  private let audioEngine = AVAudioEngine()
  private var analyzer: SNAudioStreamAnalyzer?
  private let queue = DispatchQueue(label: "pace.snap.analysis")
  private let onSnap: (Double) -> Void
  private let onError: (String) -> Void
  private var lastFire: TimeInterval = 0

  init(onSnap: @escaping (Double) -> Void, onError: @escaping (String) -> Void) {
    self.onSnap = onSnap
    self.onError = onError
  }

  func start() {
    AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
      guard let self = self else { return }
      guard granted else { self.onError("microphone permission denied"); return }
      self.queue.async { self.begin() }
    }
  }

  private func begin() {
    do {
      let session = AVAudioSession.sharedInstance()
      // .playAndRecord: WebView(YouTube) 소리가 나면서 동시에 마이크 입력을 받아야 하므로 mixWithOthers.
      try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
      try session.setActive(true)

      let input = audioEngine.inputNode
      // ⭐ Apple 내장 AEC(Voice Processing) — "쇼츠 소리에 스냅이 묻힌다"를 해결하는 핵심.
      // 스피커로 나가는 재생음이 마이크로 되돌아온 에코 성분을 하드웨어/DSP로 제거해, 마이크 탭에는
      // 재생음이 빠지고 스냅 같은 근접 소리만 남는다(Android AcousticEchoCanceler 대응, WWDC19/23).
      // ⚠️ 엔진이 '정지' 상태일 때 켜야 하고(여기서는 prepare/start 전이라 OK), 켜면 입출력 노드가
      // 함께 VP 모드로 전환된다. 실패해도(구형/미지원) 치명적이지 않으므로 AEC 없이 계속 진행.
      if #available(iOS 13.0, *) {
        do { try input.setVoiceProcessingEnabled(true) }
        catch { onError("voice processing(AEC) 활성 실패 — AEC 없이 진행: \(error.localizedDescription)") }
      }

      let format = input.outputFormat(forBus: 0) // VP 활성 이후의 실제 입력 포맷(모노로 바뀔 수 있음)
      let analyzer = SNAudioStreamAnalyzer(format: format)
      self.analyzer = analyzer

      let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
      // 짧은 창으로 순간적 스냅을 잘 잡도록(기본 1.5s → 0.5s). windowDuration/overlapFactor는 iOS 15+.
      // windowDuration 0.5s = 응답성/정확도 균형(Apple 권장), overlapFactor 0.75 = 창을 촘촘히 겹쳐
      // 순간적 스냅이 어느 한 창의 중앙 근처에 반드시 잡히게(0.5보다 놓침 감소). Focus Session 중에만
      // 도는 기능이라 늘어난 연산은 감수. (웹 리서치: overlap↑ = 정확도↑·연산↑.)
      if #available(iOS 15.0, *) {
        request.windowDuration = CMTimeMakeWithSeconds(0.5, preferredTimescale: 48_000)
        request.overlapFactor = 0.75
      }
      try analyzer.add(request, withObserver: self)

      input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, when in
        self?.queue.async { self?.analyzer?.analyze(buffer, atAudioFramePosition: when.sampleTime) }
      }
      audioEngine.prepare()
      try audioEngine.start()
    } catch {
      onError("audio start failed: \(error.localizedDescription)")
    }
  }

  func stop() {
    audioEngine.inputNode.removeTap(onBus: 0)
    if audioEngine.isRunning { audioEngine.stop() }
    analyzer?.removeAllRequests()
    analyzer = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // SNResultsObserving
  func request(_ request: SNRequest, didProduce result: SNResult) {
    guard let result = result as? SNClassificationResult,
          let top = result.classification(forIdentifier: "finger_snapping") else { return }
    // 신뢰도 임계 — 오탐 방지. AEC로 재생음이 빠져 신호가 깨끗해진 만큼 0.7→0.65로 약간 민감하게
    // (Android가 "lower snap sensitivity threshold" 한 방향과 동일). 실기기 오탐/미탐 보고 튜닝.
    guard top.confidence > 0.65 else { return }
    let now = CFAbsoluteTimeGetCurrent()
    guard now - lastFire > 0.8 else { return } // 디바운스(연속 스냅 1회로)
    lastFire = now
    DispatchQueue.main.async { self.onSnap(top.confidence) }
  }

  func request(_ request: SNRequest, didFailWithError error: Error) {
    onError("analysis failed: \(error.localizedDescription)")
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

  // 최근 (시각, 손 크기) 샘플 — 500ms 창에서 크기가 1.5배 이상 커지면 "다가오는 손짓"으로 판정.
  private var samples: [(t: TimeInterval, size: CGFloat)] = []
  private var lastFire: TimeInterval = 0
  private var lastAnalyze: TimeInterval = 0
  private let windowSec: TimeInterval = 0.5
  private let growthRatio: CGFloat = 1.5
  private let analyzeIntervalSec: TimeInterval = 0.15 // 안드로이드와 동일하게 ~150ms마다만 추론(배터리)

  init(onWave: @escaping () -> Void, onError: @escaping (String) -> Void) {
    self.onWave = onWave
    self.onError = onError
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
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else {
      session.commitConfiguration()
      onError("camera output unavailable")
      return
    }
    session.addOutput(output)
    session.commitConfiguration()
    session.startRunning()
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

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .leftMirrored, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return // 개별 프레임 실패는 무시(다음 프레임에서 재시도)
    }
    guard let obs = request.results?.first else {
      // 손이 안 보이면 창을 비워 오탐 방지(손이 사라졌다 다시 크게 나타나는 걸 성장으로 오인 X).
      samples.removeAll()
      return
    }

    // 손 "크기" = 손목 ↔ 중지뿌리(MCP) 거리(안드로이드와 동일 지표). 신뢰도 낮은 점은 버린다.
    guard
      let wrist = try? obs.recognizedPoint(.wrist), wrist.confidence > 0.3,
      let mcp = try? obs.recognizedPoint(.middleMCP), mcp.confidence > 0.3
    else { return }
    let dx = wrist.location.x - mcp.location.x
    let dy = wrist.location.y - mcp.location.y
    let size = CGFloat((dx * dx + dy * dy).squareRoot())
    guard size > 0 else { return }

    let t = now
    samples.append((t, size))
    // 창(500ms) 밖 샘플 제거.
    samples.removeAll { t - $0.t > windowSec }
    guard samples.count >= 3 else { return }

    // 창 안 최소 크기 대비 현재 크기가 growthRatio 이상이면 "손이 급히 다가옴 = 손짓"으로 판정.
    let minSize = samples.map { $0.size }.min() ?? size
    if size >= minSize * growthRatio {
      guard now - lastFire > 0.8 else { return } // 디바운스
      lastFire = now
      samples.removeAll() // 연속 오탐 방지
      DispatchQueue.main.async { self.onWave() }
    }
  }
}
