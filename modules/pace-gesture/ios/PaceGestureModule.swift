import ExpoModulesCore
import AVFoundation
import SoundAnalysis
import ARKit

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

  public func definition() -> ModuleDefinition {
    Name("PaceGesture")

    Events("onSnap", "onHeadNod", "onError")

    // mode: "snap" | "head" | "both" — 어떤 감지기를 켤지.
    AsyncFunction("start") { (mode: String, promise: Promise) in
      DispatchQueue.main.async {
        if mode == "snap" || mode == "both" {
          self.startSnap()
        }
        if mode == "head" || mode == "both" {
          self.startHead()
        }
        promise.resolve(nil)
      }
    }

    Function("stop") {
      self.snapDetector?.stop()
      self.snapDetector = nil
      self.headDetector?.stop()
      self.headDetector = nil
    }

    // 고개짓 지원 기기인지(TrueDepth). JS가 UI 노출 여부 판단에 사용.
    Function("isHeadGestureSupported") { () -> Bool in
      if #available(iOS 11.0, *) { return ARFaceTrackingConfiguration.isSupported }
      return false
    }

    OnDestroy {
      self.snapDetector?.stop()
      self.headDetector?.stop()
    }
  }

  private func startSnap() {
    guard #available(iOS 13.0, *) else {
      sendEvent("onError", ["kind": "snap", "message": "SoundAnalysis requires iOS 13+"])
      return
    }
    if snapDetector != nil { return }
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
      let format = input.outputFormat(forBus: 0)
      let analyzer = SNAudioStreamAnalyzer(format: format)
      self.analyzer = analyzer

      let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
      // 짧은 창으로 순간적 스냅을 잘 잡도록(기본 1.5s → 0.5s). windowDuration/overlapFactor는 iOS 15+.
      if #available(iOS 15.0, *) {
        request.windowDuration = CMTimeMakeWithSeconds(0.5, preferredTimescale: 48_000)
        request.overlapFactor = 0.5
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
    // 신뢰도 임계 — 오탐 방지. JS에서 confidence를 받아 추가 필터 가능.
    guard top.confidence > 0.7 else { return }
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
