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

    // 실명 채증(테스트 빌드 전용) — WaveDetector.diagCaptureEnabled 주석 참고. JS가 test 플래그일 때만 켠다.
    Function("setDiagCapture") { (on: Bool) in
      self.waveDetector?.setDiagCapture(on)
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
  // 🔴 2026-09-06(6차) 안드 NEAR_BAND_HAND_SIZE=0.20 이식 — 안드는 밝기 축(격자/lumapass) 게이트를
  //   "아무 손"이 아니라 **가까운(큰) 손(≥0.20)** 최근 관측으로만 연다(lastNearHandAtMs). iOS는 아무 손/
  //   얼굴 옆 작은 손에도 열려 "손만 들어도/얼굴 보여도 넘어감"이 났다. 게이트를 NEAR 손으로 조인다.
  private let nearBandHandSize: Double = 0.20
  private var lastNearHandSeenMs: Double = 0
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
  private let sweepRatioThreshold: Double = 0.8  // 🔴 2026-09-06 채증: 손짓 sweep 1.3~1.6 / 손들고가만히 0.3~0.5 사이
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
    // 🔴 2026-08-25 23:08 실측(skip 14연발/1.4s) — 크로싱 기록이 전역이라 두 트랙이 번갈아 기록되며
    // 가짜 ±0.2 스트로크(유령)를 만들었다. 트랙별 분리로 원천 차단.
    var crossHistory: [(t: Double, x: Double)] = []
    var crossArmed = true
    var crossLastX: Double = 0
    // 🔴 재무장 기준(2026-08-25 안드 세션). 구 기준 "직전 프레임 대비 x +0.02"는 손을 **든 채
    // 천천히** 되돌리면 프레임당 증가분이 0.02를 못 넘어 영영 안 풀렸다 — 크로싱이 1회 발화 뒤
    // 세션 내내 죽는다. 추적이 촘촘할수록 프레임당 증가분이 작아져 기기가 좋을수록 잘 죽었다.
    // → 발화 지점 기준 **누적** 복귀 / 손 소실. (시뮬 18·19)
    var crossFireX: Double = 0
    var crossLastT: Double = 0
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
  // 🔴 2026-08-25 사장님 재확정("흔들기에서 **가만있는 흔들기**는 미발화가 맞고 **이전 손짓은 남겨두고**")
  // — 통과 전용(속도 축 전면 미발화)은 지시를 넓게 잡은 것이었다. 껐어야 할 건 흔들기 축 전체가
  // 아니라 **제자리 떨림**이다. 그래서 false로 되돌리고, 떨림은 아래 glide 진폭 게이트로 거른다.
  private let passOnlyMode = false
  // 🔴 2026-09-03 안드 발화 축 전수 정렬 — 안드 PaceHandWaveDetector.kt fireTrigger는 딱 3곳:
  //   ① lumapass(항상 발화)  ② gross-motion/격자(GROSS_MOTION_STANDALONE=true)  ③ occlusion(OCCLUSION_STANDALONE=false=꺼짐)
  //   즉 안드가 실제 발화하는 축은 **lumapass + 격자 둘뿐**. cross/glide/sweep/nearpass는 안드에 아예 없는
  //   iOS 전용 추가분이라 안드엔 대응 발화가 없다. 실기기 채증(diag 12:53:34~59, 격자 수정 후에도 자동 전진
  //   5회)이 전부 cross/glide/sweep(사장님 "카메라 스쳐 지나간 적 없는데/손짓 안 했는데 넘어감").
  //   → iOS도 안드와 동일하게 lumapass+격자만 발화. 나머지 5축은 단독 발화만 끈다(계산·재무장·streak·로그는
  //   유지 — 복원은 각 플래그 true). 손짓 넘김은 lumapass+격자로 동작(안드 상용과 동일 메커니즘).
  // 🔴 2026-09-06(5차) 사장님 "몸만 틀면 손없어도 넘어가 / 한 손짓에 4번" — 격자(luma) 축은 손짓과
  //   몸/조명/장면 변화를 원리적으로 구분 못 한다(로그 전부 dir=0 = 손 방향 미검출인데 발화). 실제 손을
  //   추적하는 cross 축만이 "몸 틀면 안 됨/손 없으면 안 됨"을 보장한다. cross ON(추적손+가로변위+속도+
  //   returndrop 내장), grid OFF. cross는 crossMinHandSize·속도·범위 게이트라 몸턴/조명엔 발화 안 함.
  // 🔴 2026-09-06 채증 모드 — true면 발화(넘김) 전부 차단하고 프레임별 수치만 로깅(라벨 튜닝용). 튜닝 후 false.
  private let captureMode = false
  private let crossStandalone = true   // 🔴 2026-09-06 채증: 사장님 손짓=단방향 스와이프 → cross 축
  private let crossWaveDir: Double = 0  // 방향 게이트 OFF(부호 뒤집힘)
  private let crossReturndropEnabled = false  // 🔴 2026-09-06 단방향 스와이프엔 리턴이 없어 returndrop이 왼오를 오인 억제 — OFF
  private let glideStandalone = false
  private let sweepStandalone = false  // 🔴 2026-09-06 채증 재확인: 손짓이 단방향(반전0)이라 sweep 축(반전≥1 요구)은 부적합 → cross로 전환
  private let nearpassStandalone = false   // 안드에 없는 iOS 전용 dip 축 — 안드 정렬로 발화 차단
  private let occlusionStandalone = false  // 안드 OCCLUSION_STANDALONE=false 미러
  private let lumapassStandalone = false  // 🔴 2026-09-06 채증 — luma 축은 사장님 손(0.15~0.17) NEAR게이트에 대부분 막히고 얼굴/몸 리스크. sweep 축으로 일원화.
  // 🔴 2026-08-26 — 방향 무관 발화로 열면서 "갔다 돌아오는 손이 2번 넘김"이 생긴다(시뮬이 잡음).
  // 절대 부호는 자세에 따라 뒤집히므로(오늘 확진) **상대 방향**으로 막는다: 직전 발화와 반대 방향
  // 스트로크가 2초 안에 오면 복귀로 보고 무시. 2초 지나 오는 역방향은 의도적 통과로 인정.
  private var crossLastFireDir: Double = 0
  // 🔴 2026-08-25 사장님("왜 그 시간을 막냐 — 그래서 안 되는 거 아냐?") — 1.2s 불응은 흔들기 이중발화
  // 방지용이었다. 통과(스침)는 스트로크 단위로 딱 떨어지므로 0.5s면 충분 — 빠른 연속 스침이 먹히지 않게.
  // 500→1200(2026-08-28 "두세 개씩 넘어가") — 한 물리 동작(접근+본동작+복귀 ≈1.2s)이 여러 축에
  // 12발화/15s로 찍혔다. 통합 불응을 동작 봉투 길이로 되돌린다(안드 REFRACTORY와 동일).
  private let passRefractoryMs: Double = 1200
  private var speedSuppressUntilMs: Double = 0
  private let crossWindowMs: Double = 2500
  // (crossMinRangeX(0.38 고정 화면비)는 needRange = min/max/비례로 대체돼 제거 — 남겨두면 어느 쪽이
  //  실제 문턱인지 헷갈린다. 이력은 아래 needRange 주석에 있다.)
  // 0.10→0.08(2026-08-25 실측): 사장님 실사용 거리에서 손이 0.095로 찍혀 0.005 차이로 컷됐다
  // ("계속 안 됐어" 구간, diag 22:18:22). 0.08은 감지기 자체 하한(minHandSize)과 같아 사실상
  // "감지되는 손은 모두 허용"이지만, 배경 타인(2m+, ~0.03)은 애초에 감지 하한 미달이라 차단 유지.
  private let crossMinHandSize: Double = 0.08
  // (crossMinDirectness는 "마지막 단조 구간"만 평가하는 방식으로 대체돼 어디서도 쓰이지 않았다.
  //  남겨두면 방향 일관성 게이트가 있는 것처럼 오독된다. 흔들림 방어는 단조 구간 + needRange + segSteps + 속도.)
  // (크로싱 기록/재무장 상태는 HandTrack 안으로 이동 — 맥 6b5c668, 두 트랙 교대가 만들던 유령 스트로크 차단)
  private let crossRearmReturnX: Double = 0.08  // 발화 지점 기준 **누적** 복귀(아래 재무장 주석)
  private let crossRearmAbsentMs: Double = 600  // 손 소실 — 안 보였으면 그 스트로크는 끝난 것
  private let crossNeedMin: Double = 0.07       // needRange 하한(먼 손도 이만큼은 지나가야)
  private let crossNeedMax: Double = 0.10       // needRange 상한 — 근거리가 원리적으로 불가능해지지 않게
  private let crossNeedK: Double = 0.5          // 손폭 대비 비례 계수(제자리 흔들림 차단 근거)
  // 0.20→0.40(2026-08-26 07:28 실측 "5번 중 1번") — 이동 0.08·속도 0.23짜리 잔발화가 불응을 선점해
  // 진짜 스트로크(속도 0.7~1.4 실측)를 죽였다. 큰 이동(crossBigNetX)의 느린 통과는 별도 통과 유지.
  private let crossMinSegSpeed: Double = 0.40   // 화면폭/초 — 표류·잔움직임 차단
  private let crossBigNetX: Double = 0.30       // 이만큼 지나갔으면 속도 무관 통과
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
  // 🔴 2026-08-26 07:05 — "됐다/실명" 반복(같은 자리에서 0/59 무감지 ↔ 11/31 정상)의 최종 채증:
  // 테스트 빌드에서만(JS가 setDiagCapture(true) — EXPO_PUBLIC_AD_TEST_DEVICES 게이트) 감지기 가동 중
  // 3초마다 프레임을 저장한다. 실명 순간 카메라가 실제로 뭘 보는지 눈으로 확정하기 위함.
  // ⚠️ 출시 빌드에는 JS 게이트가 꺼져 있어 절대 저장되지 않는다(프레임 저장 금지 원칙 유지).
  private var diagCaptureEnabled = false
  private var lastDiagCaptureMs: Double = 0
  private var didLogPixelSize = false // 첫 프레임 버퍼 크기 1회 보고(campixel) — 회전 적용 여부의 원격 검증
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
  func setDiagCapture(_ on: Bool) {
    queue.async { self.diagCaptureEnabled = on }
  }

  func setPaused(_ p: Bool) {
    queue.async {
      self.paused = p
      if !p { self.tracks = [HandTrack(), HandTrack()]; self.lumaHistory.removeAll(); self.lastHandSeenMs = 0; self.lastNearHandSeenMs = 0; self.stillnessStartMs = 0 } // 정지시계 리셋(01:30 낡은 시계로 burst 즉시해제 연발)
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
    // 🔴 2026-08-26 해상도 상향 2차(probe+자동 폴백) — 사장님 "너보다 안드가 더 잘돼": 안드는 1080×1440
    // (VGA의 4.5배 픽셀)로 돌고 그게 인식률 격차의 최대 변수(f57afbc 실측). 1차 시도는 회전이 조용히
    // 풀리며 실패 → 이번엔 포맷 변경 **후** 회전을 재적용·검증하고, 안 되면 그 자리에서 VGA로 복귀
    // (지금보다 나빠질 수 없음). 실제 적용 결과는 camprobe/campixel로 물증 로그에 남는다.
    var fmtDesc = "vga-default"
    do {
      try device.lockForConfiguration()
      let wanted: [(Int32, Int32)] = [(1440, 1080), (1080, 1440), (1280, 960), (960, 1280)]
      var picked: AVCaptureDevice.Format? = nil
      outer: for (w, h) in wanted {
        for f in device.formats {
          let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
          if (d.width == w && d.height == h) || (d.width == h && d.height == w) {
            picked = f
            break outer
          }
        }
      }
      if let f = picked {
        device.activeFormat = f
        let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
        fmtDesc = "\(d.width)x\(d.height)"
      }
      device.unlockForConfiguration()
    } catch {
      fmtDesc = "lockFail-vga"
    }
    if let conn = output.connection(with: .video) {
      var rotOK = false
      if #available(iOS 17.0, *) {
        if conn.isVideoRotationAngleSupported(90) {
          conn.videoRotationAngle = 90
          rotOK = true
        }
      } else if conn.isVideoOrientationSupported {
        conn.videoOrientation = .portrait
        rotOK = true
      }
      if conn.isVideoMirroringSupported {
        conn.automaticallyAdjustsVideoMirroring = false
        conn.isVideoMirrored = true
      }
      if !rotOK {
        // 이 포맷에선 세로 회전 불가(1차 실패의 정황) — 검증된 VGA로 복귀.
        session.sessionPreset = .vga640x480
        fmtDesc += " rotFail->vga"
        if #available(iOS 17.0, *), conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
        else if conn.isVideoOrientationSupported { conn.videoOrientation = .portrait }
      }
    }
    onDiag("camprobe \(fmtDesc)")
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
      let lg = avgLumaGrid(pb)
      if lg.l >= 0, lg.m >= 0, lg.r >= 0 {
        checkOcclusion((lg.l + lg.m + lg.r) / 3, lg.l, lg.m, lg.r, nowMs)
        checkGridMotion(lg.grid, nowMs)
      }
      lastPixelBuffer = pb // 유령 채증용 최신 프레임(발화 시 JPEG 저장) — 같은 camera queue라 안전
      if !didLogPixelSize {
        didLogPixelSize = true
        // 세로 정상이면 height > width — 이 한 줄이 회전 적용의 원격 물증(campixel).
        onDiag("campixel \(CVPixelBufferGetWidth(pb))x\(CVPixelBufferGetHeight(pb))")
      }
      // 실명 채증(상단 diagCaptureEnabled 주석) — 3초마다 1장, 최근 30장 유지.
      if diagCaptureEnabled {
        let nowCap = CFAbsoluteTimeGetCurrent() * 1000
        if nowCap - lastDiagCaptureMs >= 3000 {
          lastDiagCaptureMs = nowCap
          let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("wave_diag_frames", isDirectory: true)
          try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
          let ci = CIImage(cvPixelBuffer: pb)
          if let data = ciContext.jpegRepresentation(of: ci, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [:]) {
            try? data.write(to: dir.appendingPathComponent(String(format: "f_%.0f.jpg", nowCap)))
            if let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil), files.count > 30 {
              for f in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).prefix(files.count - 30) {
                try? FileManager.default.removeItem(at: f)
              }
            }
          }
        }
      }
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
      // NEAR 손 게이트(안드 NEAR_BAND_HAND_SIZE) — 가까운 큰 손일 때만 밝기 축 게이트를 연다(얼굴/작은손 배제).
      if handSize >= self.nearBandHandSize { self.lastNearHandSeenMs = nowMs }
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
      // 직진성(순이동/총이동) — 한 방향 통과와 왕복 흔들기를 가르는 측정치. 크로싱 축에서 이미 쓰고 있다.
      var straight700 = 0.0
      let win700 = self.tracks[ti].xHistory.filter { nowMs - $0.t <= 700 }
      if let firstX = win700.first, let lastX = self.tracks[ti].xHistory.last {
        netDx700 = lastX.x - firstX.x
        if netDx700 >= 0.12 { reversePass = true }
        var gross700 = 0.0
        for i in 1..<max(1, win700.count) { gross700 += abs(win700[i].x - win700[i - 1].x) }
        straight700 = gross700 > 1e-6 ? abs(netDx700) / gross700 : 0.0
      }
      // 크로싱 축(2026-08-25 사장님 사양, 상단 crossWindowMs 주석) — 50cm 상한 통과 목격만 전역 기록.
      if handSize >= self.crossMinHandSize {
        // 재무장 판정(스트로크당 1발화) — HandTrack.crossFireX 주석의 두 경로. 둘 다 "스트로크가
        // 끝났다"는 증거이고, 스트로크 진행 중에는 어느 쪽도 성립하지 않는다(x 감소 중 + 손 계속 보임).
        // 그래서 시뮬 s4가 잡았던 "스트로크 중간 공백에 재무장 → 이중발화"는 원리적으로 재발하지 않는다.
        // ⚠️ 여기서 tracks[ti].lastSeenMs를 쓰면 안 된다 — 이 블록 위(709행)에서 이미 nowMs로
        //    갱신돼 공백이 항상 0이다. 크로싱 전용 시각(crossLastT)을 따로 둔다.
        if !self.tracks[ti].crossArmed {
          // 방향 무관(2026-08-26 부호 뒤집힘 확진) — 발화 지점에서 어느 쪽으로든 누적 이탈이면 복귀로 본다.
          let returned = abs(c.x - self.tracks[ti].crossFireX) >= self.crossRearmReturnX
          let reappeared = nowMs - self.tracks[ti].crossLastT >= self.crossRearmAbsentMs
          if returned || reappeared {
            self.tracks[ti].crossArmed = true
            paceGLog("[pace-wave] crossrearm T%d by=%@ x=%.2f fireX=%.2f gap=%.0fms", ti,
                     returned ? "return" : "reappear", c.x, self.tracks[ti].crossFireX,
                     nowMs - self.tracks[ti].crossLastT)
          }
        }
        self.tracks[ti].crossLastX = c.x
        self.tracks[ti].crossLastT = nowMs
        self.tracks[ti].crossHistory.append((nowMs, c.x))
        while let f = self.tracks[ti].crossHistory.first, nowMs - f.t > self.crossWindowMs { self.tracks[ti].crossHistory.removeFirst() }
        if self.tracks[ti].crossHistory.count >= 2 {
          // 🔴 2026-08-25 22:52 확진(hand=15·sweep=3.63인데 발화 0) — 2.5s 창 **전체** 순이동은 연속
          // 시도에 오염된다: 스침→복귀→스침이 서로 상쇄돼 net≈0, 패스 사이 점프가 path만 키워
          // directness도 죽는다. → **마지막 단조 구간**(끝에서부터 같은 방향으로 이어진 스트로크)만
          // 평가한다. 단조 구간은 왕복·연속 시도와 무관하고, 방향은 구간 부호가 곧 방향이다.
          // 부호 실기기 확정: 사용자 왼→오 = 이미지 x 감소(음수).
          let xs = self.tracks[ti].crossHistory
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
          let segSteps = xs.count - 1 - segStart
          let segMs = xs.last!.t - xs[segStart].t
          // 🔴 2026-08-25 23:02 실측(hand 49/61 추적인데 발화 0 — 이동폭 화면 12% vs 기준 38%) —
          // 사장님 실제 동작은 손목 플릭. 고정 화면비 기준은 중간 거리에서 원리적으로 미달한다.
          //
          // 🔴 그 뒤 max(0.12, handSize*0.85)로 고쳤더니 사장님: "가까운 손 중간 손 다 인식 안 돼".
          // 계산이 그대로 맞는다 — 같은 실측(이동폭 0.12) 대비:
          //     가까운 손 handSize 0.25  → 0.21 요구 = 실측의 **두 배**, 구조적으로 영영 미달
          //     중간   손 handSize 0.135 → 0.12 요구 = 실측과 **동률**, 사실상 미달
          // 상향 비례가 물리와 반대다: 가까울수록 손이 프레임을 크게 채워 **더 빨리 프레임 밖으로
          // 나가므로 관측 가능한 이동폭은 오히려 줄어드는데**, 문턱만 올라간다.
          //
          // 다만 비례 자체를 버리면 안 된다 — 제자리 흔들림을 거르는 근거가 바로 비례이기 때문이다.
          // 흔들림은 자기 손폭의 몇 분의 일을 오갈 뿐이고, 통과는 손폭의 몇 배를 지나간다.
          // → 두 힘이 싸우므로 **비례 하한 + 절대 상한**으로 묶는다. 상한이 있어야 근거리가
          //   원리적으로 불가능해지지 않고, 비례가 있어야 잔떨림이 안 뚫린다.
          //   중간(0.135)→0.07 = 실측 0.12 대비 1.7배 여유, 가까움(0.20 이상)→0.10 고정.
          let needRange = min(self.crossNeedMax, max(self.crossNeedMin, handSize * self.crossNeedK))
          // 흔들림 방어 둘째 겹 — 통과는 여러 프레임에 걸쳐 찍힌다. 단 한 스텝짜리 점프는 추적
          // 노이즈일 확률이 높다. 성긴 추적에서 빠른 플릭이 2점만 남는 경우가 있어 막지는 않되,
          // 그때는 이동폭을 두 배 요구해 노이즈와 구별한다.
          let rangeOk = segSteps >= 2 ? abs(segNet) >= needRange : abs(segNet) >= needRange * 2
          // 사장님 "가만히 있으면서 흔들리는 건 안 넘어가게" — 이동폭만으로는 **느린 표류**를 못 거른다
          // (구 시뮬 s15가 "알려진 한계: 1회 발화"로 기록해 둔 그것). 표류와 통과를 실제로 가르는 건
          // 이동폭이 아니라 **속도**다. 합성 시나리오 실측:
          //     느린 표류 0.16/1.5s = 0.11/초   ← 막아야 함
          //     느린 통과 0.57/2.0s = 0.29/초   ← 살려야 함
          //     손목 플릭 0.13/0.3s = 0.43/초
          // 0.20/초를 가른다. 단, 추적이 성겨 구간 시간이 부풀면 속도가 과소평가되므로, 이동폭이
          // 충분히 크면(0.30) 속도 무관하게 통과시킨다 — 그 크기는 표류로 설명되지 않는다.
          let segSpeed = segMs > 0 ? abs(segNet) / (segMs / 1000) : .greatestFiniteMagnitude
          let speedOk = segSpeed >= self.crossMinSegSpeed || abs(segNet) >= self.crossBigNetX
          if rangeOk, speedOk, self.tracks[ti].crossArmed {
            // 🔴 2026-09-06 채증 방향 확정 — 사장님 왼→오 = segNet 양수(+)(diag 13:07:33 netdx +0.10~+0.23,
            //   x 증가), 오→왼 = 음수(-)(13:08:01 netdx -0.10~-0.17). "오왼도 넘어감" 수정: 왼→오(양수)만 발화.
            //   ⚠️ 자세 바뀌면 부호 뒤집힐 수 있음(안드 경고) — 그때 crossWaveDir만 -1로. 0=양방향.
            if self.crossWaveDir != 0, (segNet > 0 ? 1 : -1) != self.crossWaveDir {
              self.tracks[ti].crossHistory.removeAll()
              self.onDiag(String(format: "crossdir skip(오왼) net=%+.2f", segNet))
              return glideAbs
            }
            self.tracks[ti].crossHistory.removeAll()
            // 🔴 2026-08-25 23:00 재현("왼오 안 먹고 오왼에 바뀜") — 불응 중 완성된 스트로크가 기록에
            // 남았다가 불응이 풀리는 순간(=손을 되돌리는 타이밍) 뒤늦게 발화해 방향이 뒤집혀 보였다.
            // 불응 중 스트로크는 여기서 소비-폐기한다. 1.2s당 1회 상한은 유지, 타이밍 착시 제거.
            if nowMs - self.lastTriggerMs <= self.passRefractoryMs {
              paceGLog("[pace-wave] crossdrop refractory net=%+.2f", segNet)
              self.onDiag(String(format: "crossdrop net=%+.2f", segNet))
              return glideAbs
            }
            // 🔴 2026-08-26 07:00 확진 — 같은 왼→오가 어젯밤 net=-0.42, 오늘(케이블 거치) net=+0.17로
            // **부호가 사용 자세에 따라 뒤집힌다.** 한쪽 부호 고정 규칙이 자세가 바뀔 때마다 정방향을
            // 차단해온 것("왼오 안 되고 오왼이 됨" 반전 보고 전부와 일치). 자세 감지로 부호를 풀 때까지
            // **통과는 방향 무관 발화**(사장님 원칙 "지나갔으면 넘어가야") — 오발화 방어(스트로크 단위·
            // 속도 게이트·트랙 분리)는 그대로다.
            let dir: Double = segNet > 0 ? 1 : -1
            // 🔴 2026-09-06 returndrop OFF — 실기기 로그(diag 13:28)로 확인: 이게 사장님 왼→오(net 양수)를
            //   직전 오→왼(net 음수)의 "리턴"으로 오인해 죽였다("왼오 안되고 오왼됨"). 사장님은 단방향
            //   스와이프를 하나씩 하셔서(straight=1.0) 리턴 스트로크 자체가 없어 returndrop이 해만 된다.
            //   각 스와이프가 그대로 발화하게 끈다. (왕복 웨이브 사용자면 복원: crossReturndropEnabled true)
            if self.crossReturndropEnabled, dir == -self.crossLastFireDir && nowMs - self.lastTriggerMs < 2000 {
              // 복귀 스트로크(직전 발화의 반대 방향, 2초 내) — **1회만** 무시하고 기억을 비운다.
              // 🔴 2026-08-26 07:4x 사장님("왼오에서 안 되고 오→왼으로 손 돌릴 때 넘어간다") — 기억을
              //   안 비우면 복귀 방향에 한 번 잘못 물렸을 때 진짜 스트로크가 전부 '복귀'로 오인돼
              //   영구 반전 잠금이 된다. 1회 소비 후 초기화 → 다음 스트로크는 방향 불문 발화(자가 복구).
              self.crossLastFireDir = 0
              paceGLog("[pace-wave] returndrop net=%+.2f", segNet)
              self.onDiag(String(format: "returndrop net=%+.2f", segNet))
              return glideAbs
            }
            self.crossLastFireDir = dir
            self.tracks[ti].crossArmed = false // 스트로크당 1발화 — 재무장은 누적 복귀 / 손 소실에서
            self.tracks[ti].crossFireX = c.x
            if self.crossStandalone {
              self.fireTrigger(String(format: "T%d cross net=%+.2f size=%.2f need=%.2f spd=%.2f", ti, segNet, handSize, needRange, segSpeed), nowMs, handSize: handSize, trackIdx: ti)
            } else {
              self.onDiag(String(format: "cross(안드정렬 차단) T%d net=%+.2f spd=%.2f", ti, segNet, segSpeed))
            }
            return glideAbs
          }
        }
      }
      var sweep = 0.0
      if let mx = self.tracks[ti].xHistory.map({ $0.x }).max(), let mn = self.tracks[ti].xHistory.map({ $0.x }).min(), handSize > 0 {
        sweep = (mx - mn) / handSize
      }
      // 🔴 2026-09-06 채증 모드 — 라벨 튜닝용 프레임별 손 수치(발화 없음). netDx700 부호가 방향.
      if self.captureMode {
        self.onDiag(String(format: "capH size=%.2f x=%.2f netdx=%+.2f sweep=%.2f straight=%.2f score=%.2f near=%d",
                            handSize, c.x, netDx700, sweep, straight700, handScore, handSize >= self.nearBandHandSize ? 1 : 0))
      }
      // 🔴 2026-09-06 격자 returndrop용 — 손의 최근 x 순이동 방향 기록(리턴 스트로크 판별).
      if let firstX = self.tracks[ti].xHistory.first?.x, let lastX = self.tracks[ti].xHistory.last?.x, handSize > 0 {
        let netX = (lastX - firstX) / handSize
        if abs(netX) >= self.gridDirMinNetX { self.handDirSign = netX > 0 ? 1 : -1; self.handDirAtMs = nowMs }
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
      // 🔴 2026-08-26 사장님("맥으로 하는데 오른쪽에서 왼쪽으로 가도 영상이 바뀌는데") —
      //   내가 오늘 passOnlyMode를 false로 되돌리면서(사장님 "이전 손짓은 남겨두고") 되살아난 누수다.
      //   이전 손짓 축(glide/sweep/growth)은 **방향을 모른다** — 어느 쪽으로 움직이든 발화한다.
      //   기존 방어 reversePass는 700ms 순이동 0.12를 요구하는데, **빠른 오→왼 휙은 샘플이 성겨
      //   그 0.12를 못 채운 채 glide가 먼저 발화한다**(맥이 f26d3d2 주석에 이미 적어둔 현상).
      //
      //   가르는 기준은 이동량이 아니라 **한 방향으로 갔는가**다:
      //     · 흔들기(= 이전 손짓)는 좌우로 오간다 → 총이동은 큰데 순이동이 작다 = 직진성 낮음
      //     · 통과는 한 방향으로 지나간다        → 순이동 ≈ 총이동 = 직진성 높음
      //   그래서 "직진성 높게 오른쪽(+x = 사용자 오→왼)으로 순이동"이면 속도 축을 막는다.
      //   흔들기는 직진성이 낮아 안 걸리므로 사장님 지시("이전 손짓은 남겨두고")와 충돌하지 않는다.
      //
      //   ⚠️ 처음엔 reversals == 0으로 썼다가 되돌렸다. 안드 파일이 실측 1,134프레임으로
      //     "reversals는 **평소에도 2가 나와** 오탐 축이었다"고 이미 기록해 뒀다(GROWTH 주석).
      //     iOS도 minStroke = 0.12 × handSize라 중간 거리에서 화면의 1.6%만 움직여도 스트로크로
      //     세므로 같은 성질이다 — 그 조건은 거의 성립하지 않아 아무것도 못 막았을 것이다.
      //     직진성은 문턱에 민감한 카운터가 아니라 비율이라 그 문제가 없다.
      //   ⚠️ 아직 실기기 미검증이다. 발화 로그의 netDx=/straight= 값으로 문턱(0.06/0.7)을 확정할 것.
      // 🔴 2026-08-26 — **차단을 끈다(부호 미확정).** 같은 로직을 안드에 넣었다가 실기기에서
      //   되어야 할 방향을 막아 손짓이 통째로 죽었다(00:35:40 net=+0.0655를 차단했는데 그 순간
      //   사장님은 왼→오를 하고 계셨다).
      //   iOS는 부호가 더 의심스럽다 — 이 파일 516~527행이 카메라 연결에 isVideoMirrored = true
      //   (셀피 반전)를 걸고 있다. 반전된 버퍼에서는 사용자 왼→오가 이미지 x **증가**여야 하는데,
      //   크로싱 축은 x **감소**에 발화하면서 주석은 그것을 "사용자 왼→오"라고 적어놨다 — 둘이
      //   반대다. 사장님이 겪으신 "왼오는 안 되고 오왼은 되는" 증상과도 맞는다.
      //   → 확정 전까지 끈다. 판정 재료(netDx/straight)는 계속 로그에 남으므로 방향을 지정해
      //     한 번만 해보면 부호가 확정된다. 그 전에 켜면 또 되던 방향을 막는다.
      let reverseBlockEnabled = false
      let oneWayReverse = reverseBlockEnabled && netDx700 >= 0.06 && straight700 >= 0.7
      if oneWayReverse {
        paceGLog("[pace-wave] 속도축 차단(오→왼 통과) T%d netDx=%+.2f straight=%.2f rev=%d", ti, netDx700, straight700, reversals)
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
      // 🔴 "가만있는 흔들기 미발화" — 흔들기 축 셋 중 glide만 **순수 속도**라 진폭 조건이 없었다.
      // 제자리 떨림은 진폭이 작아도 순간속도가 높다: 진폭 0.02·5Hz면 최대속도 2πfA ≈ 0.63/초로
      // 문턱(0.45~0.47/초)을 넘는다. 그래서 손이 제자리에 있어도 glide가 뚫렸다.
      // → glide에도 **좌우 이동폭**을 요구한다. 새 숫자를 지어내지 않고 sweep 축이 이미 쓰는
      //   실측 문턱을 그대로 재사용한다(실기기 발화 시 sweep 0.20~0.60, 제자리 떨림은 그 아래).
      //   glide는 2D(hypot)라 세로 흔들기도 잡았지만, 사양이 "왼→오 스쳐 지나감"이므로 가로 이동폭을
      //   요구하는 편이 사양에 맞다.
      let glideSpanOk = sweep > self.sweepRatioThreshold * band.mul
      if glided && !glideSpanOk {
        paceGLog("[pace-wave] glidedrop span T%d sweep=%.2f need=%.2f rel=%.2f size=%.2f",
                 ti, sweep, self.sweepRatioThreshold * band.mul, glideRel, handSize)
      }
      if glided && glideSpanOk && !self.passOnlyMode && !reversePass && !oneWayReverse && nowMs > self.speedSuppressUntilMs && nowMs - self.lastTriggerMs > self.refractoryMs {
        self.tracks[ti].glideStreak = 0
        if self.glideStandalone {
          self.fireTrigger(String(format: "T%d glide band=%@ rel=%.2f abs=%.2f%@ size=%.2f netDx=%+.2f straight=%.2f", ti, band.name, glideRel, glideAbs, glideOverwhelming ? " instant" : "", handSize, netDx700, straight700), nowMs, handSize: handSize, trackIdx: ti)
        } else {
          self.onDiag(String(format: "glide(안드정렬 차단) T%d rel=%.2f abs=%.2f", ti, glideRel, glideAbs))
        }
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
      if self.tracks[ti].sweepStreak >= band.confirm && !self.passOnlyMode && !reversePass && !oneWayReverse && nowMs > self.speedSuppressUntilMs && nowMs - self.lastTriggerMs > self.refractoryMs {
        self.tracks[ti].sweepStreak = 0
        if self.sweepStandalone {
          self.fireTrigger(String(format: "T%d sweep=%.2f rev=%d y=%.2f size=%.2f score=%.2f netDx=%+.2f straight=%.2f", ti, sweep, reversals, c.y, handSize, handScore, netDx700, straight700), nowMs, handSize: handSize, trackIdx: ti)
        } else {
          self.onDiag(String(format: "sweep(안드정렬 차단) T%d sweep=%.2f rev=%d", ti, sweep, reversals))
        }
        return glideAbs
      }
      // 🔴 2026-08-26 06:50 실측(사장님 "왼오 안 되고 오왼에서 되는 게 많은데") — 30초 창 발화 11건 중
      // growth 3건. 접근(growth) 축은 방향을 원리적으로 모르는데, 오→왼 근접 통과에서 위치 샘플이
      // 성겨 oneWayReverse 방향 게이트가 성립 불가한 순간에 크기 팽창만으로 발화했다(로그: growth
      // 발화 직후 진짜 왼→오가 불응에 먹히는 패턴). 흔들기(glide/sweep)는 유지 — 끄는 건 접근 축 하나.
      let growthAxisEnabled = false
      if growthAxisEnabled && growth > self.growthRatioThreshold && speedPeak > self.speedThresholdPerSec && !self.passOnlyMode && !reversePass && !oneWayReverse && nowMs > self.speedSuppressUntilMs && nowMs - self.lastTriggerMs > self.refractoryMs {
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
  // 🟢 2026-08-27 안드 gross-motion(격자) 축 이식 — 수평 거치(카메라가 천장)에서 손이 화각 가장자리만
  // 스치는 경우의 전용 축. 안드가 조건 108개 전수 스윕으로 확정한 구조·수치 그대로:
  //   16×16 격자, |Δ|≥30 변화 셀의 비율 ∈ [0.012, 0.5] + 일관성(max(d,1-d)) ≥ 0.8 + 밀도 ≥ 0.55.
  //   밀도(변화 셀이 경계상자 안에 뭉침)가 자동노출/조명 오탐을 가르는 유일한 선 — 빼지 말 것.
  private let gridN = 16
  private let gridWindowMs: Double = 700
  private let gridLagMs: Double = 180
  private let gridCellDelta: Double = 30
  // 🔴 2026-08-28 안드 실기기 실측 확정치 이식(fb915c0) — 손이 카메라 위를 지나도 2칸만 변한다(실측
  // frac=0.0078·일관성 1.0·밀도 1.0). 잡음 2칸(합성 60초 ×4종, 4671회)은 일관성·밀도에서 전부 갈렸다.
  // 밀도는 칸 수 2단: 작은 이벤트(≤3칸)는 딱 붙어야(0.9), 큰 이벤트는 느슨하게(0.30) — 단일 0.55는
  // 5~8칸 진짜 손짓의 절반을 떨어뜨렸다("2번 중 1번"의 원인).
  // 🔴 2026-09-03 안드 현재값(PaceHandWaveDetector.kt GROSS_MOTION_*) verbatim 이식 —
  //   실기기 채증(diag 16:17~16:18) 재확정: iOS가 08-28 스냅샷(하한 2칸 0.0078)에 멈춰 있어
  //   사장님 실사용(폰 쥠/턱 괴기)에서 2~5칸 미세 변화·폰 움직임(23·29칸)에 오발화 → 자동 전진.
  //   안드는 08-30/08-31에 같은 문제(2칸 오발화 + 얼굴/폰움직임)를 겪고 ①하한 0.0078→0.05(13칸)
  //   ②큰이벤트 밀도 0.30→0.15 ③가로세로비 게이트(aspect ≤ 0.9 — 손은 세로로 길다, 얼굴/정면접근은
  //   가로세로 비슷)로 고쳤다. iOS도 셋을 그대로 이식(안드에 없는 손-부재 게이트·비활성 플래그는 제거).
  private let gridFracMin: Double = 0.05      // 안드 GROSS_MOTION_CELL_FRACTION (256칸 중 13칸)
  private let gridFracMax: Double = 0.30      // 안드 GROSS_MOTION_CELL_FRACTION_MAX
  // 🔴 2026-09-06 실기기 채증(diag 06:07 사장님 스윕: cons 0.5~0.79 섞인 밝기, 0.8 문턱에 간발 미달로
  //   손짓 전혀 안 됨) — iOS는 화면 불빛 받은 손이 밝은 배경 앞을 지나 밝아짐/어두워짐이 섞인다(안드 0.8과
  //   환경 다름). 손확인+가로이동+aspect 게이트가 discrimination을 담당하므로 일관성은 0.6으로 낮춘다.
  private let gridDarkenRatio: Double = 0.6   // 안드 0.8 → iOS 실측 0.6(섞인 밝기 스윕 통과)
  private let gridSmallCells: Int = 3         // 안드 GROSS_MOTION_SMALL_CELLS
  private let gridMinDensitySmall: Double = 0.9  // 안드 GROSS_MOTION_MIN_DENSITY_SMALL
  private let gridMinDensityBig: Double = 0.15   // 안드 GROSS_MOTION_MIN_DENSITY_BIG
  // 🔴 2026-09-03 실기기 채증(diag 13:06:46~49 사장님 손짓 실패) — **iOS 전면카메라 Y버퍼가 안드 대비
  //   90° 전치**다. 안드는 같은 "훠이" 손짓을 세로로 긴 띠(aspect 0.45~0.80)로 잡아 aspect≤0.9로 통과시켰는데,
  //   iOS는 같은 손짓이 **가로로 긴 띠(aspect 2.4~4.3, cons 0.88~1.00)** 로 잡힌다. 안드 값(≤0.9)을 그대로
  //   쓰면 진짜 손짓이 전부 막힌다. → 안드의 의도(얼굴/정면접근=정사각을 배제)는 유지하되, iOS 좌표계에 맞게
  //   **정사각 근처(0.9~1.111)만 차단**하고 가로·세로 어느 쪽으로든 긴 띠(손 스윕)는 통과시킨다.
  private let gridMaxAspect: Double = 0.9         // 안드 GROSS_MOTION_MAX_ASPECT (aspect=bh/bw ≤ 0.9, iOS 전치 반영)
  private var gridHistory: [(t: Double, g: [Double])] = []
  // 🔴 2026-09-06 안드 이식(fe2c279 LUMAPASS_HAND_RECENT_MS) — 밝기 기반 축(lumapass·격자)은 판별
  //   기준이 "밝기 변화 크기" 하나뿐이라 손 없이도(차·조명·얼굴) 발화한다. **실제 손을 최근 3초 내
  //   본 적 있을 때만** 인정한다. 차/조명 방어는 안드처럼 이 게이트가 담당(내 지속모션·가로이동 게이트 제거).
  private let lumapassHandRecentMs: Double = 3000
  // 🔴 2026-09-06(4차) 사장님 "안드는 오왼 반응 안 하는데 넌 왜 넘어가냐" — 격자는 방향 무관이라 왕복
  //   둘 다 발화(리턴 스트로크도 넘어감). 안드 cross의 returndrop 이식: 손 x 이동 방향을 추적해 **직전
  //   발화의 반대 방향 스트로크(=되돌아오는 손)를 1회 무시**한다(상대 방향이라 절대 부호 추측 불필요,
  //   1회 소비 후 리셋=자가복구). "한 동작 한 발화". 랜드마크 손 x변위 사용(격자 중심 방향은 안드도 불신).
  private let gridReturnWindowMs: Double = 2500
  private let gridDirMinNetX: Double = 0.4   // 방향 확정에 필요한 손 x순이동(손크기 정규화) — 실측 스윕 maxSweep 0.65
  private var handDirSign: Int = 0
  private var handDirAtMs: Double = 0
  private var lastGridFireDir: Int = 0
  // 🔴 2026-09-06(5차) 격자 단독 발화 OFF — 몸/조명/장면 변화 오발화의 근원(로그 dir=0 발화). 손 추적하는
  //   cross 축으로 대체(위 crossStandalone 주석). 계산·진단은 유지(복원은 true).
  private let gridStandaloneEnabled = false  // 🔴 2026-09-06 채증 — 격자(luma)는 손짓 판별 부적합, sweep 축으로 대체

  private let dipWindowMs: Double = 1200
  private var dipHistory: [(t: Double, luma: Double, l: Double, m: Double, r: Double)] = []
  // 🔴 22:52 확진 — dip의 "밝음" 기준을 1.2s 창 최대로 잡으면 연속 스침 중엔 기준 자체가 어두워져
  // dip이 영영 성립 안 한다. 천천히 감쇠하는 기준(프레임당 ×0.995 ≈ 수 초 유지)으로 교체 — 한 번
  // 밝았던 장면을 기억해 연속 시도 중에도 "지금 어두워졌다"를 판정할 수 있다.
  private var brightRefAll: Double = 0
  private var brightRefL: Double = 0
  // 느린 EMA 기준(2026-08-27) — max-감쇠 기준은 밝아짐을 즉시 흡수해 밝은 통과를 못 봤다(시뮬 s26이 잡음).
  private var baseEmaL: Double = -1
  private var baseEmaM: Double = -1
  private var baseEmaR: Double = -1
  private var brightRefM: Double = 0
  private var brightRefR: Double = 0
  // 안드 checkGrossMotion 이식(2026-08-27) — 구조·수치 동일. 오탐 방어 = 상한 0.5 + 일관성 0.8 + 밀도 0.55.
  // 🔴 2026-09-06(3차) 안드 verbatim 복귀 — 사장님 "안드처럼 하라니까". 방향 비대칭(오→왼만 되고 왼→오
  //   안 됨)은 내가 넣은 가로이동 게이트(랜드마크 sweep이 방향별 추적품질에 의존)가 원인. 안드는 방향
  //   게이트를 포기(방향 무관=대칭)했다. 내 발명품(지속모션 억제·가로이동 게이트·양방향 notSquare) 전부
  //   제거하고 안드 checkGrossMotion 로직/값을 그대로 미러한다. iOS 하드웨어 실측 차이 2곳만 보정:
  //   ① aspect = bh/bw (iOS 전면버퍼가 안드 대비 90° 전치 — 안드 bw/bh≤0.9에 대응), ② 일관성 0.6
  //   (안드 0.8이나 iOS는 화면빛 받은 손이 밝기 섞임, 실측 0.79 — diag 06:07). 나머지는 안드 그대로.
  private func checkGridMotion(_ grid: [Double], _ nowMs: Double) {
    gridHistory.append((nowMs, grid))
    while let f = gridHistory.first, nowMs - f.t > gridWindowMs { gridHistory.removeFirst() }
    guard nowMs - lastTriggerMs > passRefractoryMs else { return }
    guard let ref = gridHistory.last(where: { nowMs - $0.t >= gridLagMs }) else { return }
    var changed = 0, darkened = 0
    var minX = Int.max, maxX = -1, minY = Int.max, maxY = -1
    for i in 0..<grid.count where grid[i] >= 0 && ref.g[i] >= 0 {
      let d = grid[i] - ref.g[i]
      if abs(d) >= gridCellDelta {
        let gy = i / gridN, gx = i % gridN
        minX = min(minX, gx); maxX = max(maxX, gx)
        minY = min(minY, gy); maxY = max(maxY, gy)
        changed += 1
        if d < 0 { darkened += 1 }
      }
    }
    guard changed > 0 else { return }
    let fraction = Double(changed) / Double(grid.count)
    let darkenRatio = Double(darkened) / Double(changed)
    let bw = maxX - minX + 1, bh = maxY - minY + 1
    let density = Double(changed) / max(1, Double(bw * bh))
    let aspect = bw > 0 ? Double(bh) / Double(bw) : 0  // iOS 전치: 안드 bw/bh에 대응하도록 bh/bw (손 스윕=가로로 길어 <1)
    let consistency = max(darkenRatio, 1 - darkenRatio)
    let densityTh = changed <= gridSmallCells ? gridMinDensitySmall : gridMinDensityBig
    // 손-확인 게이트(안드 fe2c279) — 최근 손 관측 없으면 밝기만으로 발화 금지(차·조명·얼굴). 차 방어는 안드처럼 이것으로.
    let handSeen = lastNearHandSeenMs > 0 && nowMs - lastNearHandSeenMs <= lumapassHandRecentMs
    // 🔴 2026-09-06 채증 모드 — 프레임별 그리드 수치(라벨 튜닝용). 활동 있을 때만(frac≥floor절반).
    if captureMode, fraction >= gridFracMin * 0.5 {
      onDiag(String(format: "capG cells=%d frac=%.3f cons=%.2f dens=%.2f asp=%.2f near=%d", changed, fraction, consistency, density, aspect, handSeen ? 1 : 0))
    }
    if fraction >= gridFracMin, fraction <= gridFracMax, consistency >= gridDarkenRatio, density >= densityTh, aspect <= gridMaxAspect, handSeen {
      // returndrop — 직전 발화의 반대 방향(=되돌아오는 손)이면 1회 무시(안드 cross 이식). 1회 소비 후 리셋.
      let curDir = (nowMs - handDirAtMs <= 600) ? handDirSign : 0
      if curDir != 0, curDir == -lastGridFireDir, nowMs - lastTriggerMs < gridReturnWindowMs {
        lastGridFireDir = 0
        gridHistory.removeAll()
        onDiag(String(format: "gridreturn(리턴 스트로크 무시) dir=%d cells=%d", curDir, changed))
        return
      }
      gridHistory.removeAll()
      if curDir != 0 { lastGridFireDir = curDir }
      if gridStandaloneEnabled {
        fireTrigger(String(format: "gridpass cells=%d frac=%.3f cons=%.2f dens=%.2f asp=%.2f dir=%d", changed, fraction, consistency, density, aspect, curDir), nowMs)
      } else {
        onDiag(String(format: "grid(off·cross대체) cells=%d frac=%.3f asp=%.2f dir=%d", changed, fraction, aspect, curDir))
      }
    } else if !handSeen, fraction >= gridFracMin, fraction <= gridFracMax, consistency >= gridDarkenRatio, density >= densityTh, aspect <= gridMaxAspect {
      onDiag(String(format: "gridblock(근접손 미관측 %.0fms전) cells=%d frac=%.3f asp=%.2f", lastNearHandSeenMs > 0 ? nowMs - lastNearHandSeenMs : -1, changed, fraction, aspect))
    } else if fraction >= gridFracMin * 0.5 {
      onDiag(String(format: "gridnear frac=%.3f cons=%.2f dens=%.2f asp=%.2f cells=%d", fraction, consistency, density, aspect, changed))
    }
  }

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
    baseEmaL = baseEmaL < 0 ? lumaL : baseEmaL * 0.98 + lumaL * 0.02
    baseEmaM = baseEmaM < 0 ? lumaM : baseEmaM * 0.98 + lumaM * 0.02
    baseEmaR = baseEmaR < 0 ? lumaR : baseEmaR * 0.98 + lumaR * 0.02
    // 🔴 2026-08-25 22:47 확진("왼오가 안 넘어간다", 중거리) — 움직이는 손은 랜드마크가 27틱 중 2틱만
    // 잡혀 크로싱(2회 포착 필요)이 성립 불가. **lumapass**: 세로 3분할 밝기가 순차로 얕게(15%) 꺼지는
    // 패턴 = 중거리 통과. 손 모양 인식 불요·추적 끊김 무관. 사용자 왼→오 = 이미지 오른쪽→가운데→왼쪽
    // (부호 실측). 전역 조명 변화(영상 밝기·AE)는 세 구간 동시 변동이라 순서 조건에서 걸러진다.
    // 손-확인 게이트(안드 fe2c279) — lumapass도 밝기만 보는 축이라 최근 손 관측 없으면 발화 금지.
    if nowMs - lastTriggerMs > passRefractoryMs, dipHistory.count >= 6,
       lastNearHandSeenMs > 0, nowMs - lastNearHandSeenMs <= lumapassHandRecentMs,
       let firstD = dipHistory.first, nowMs - firstD.t >= 500 {
      // 🔴 2026-08-27 안드 실측 이식(0984254 — "손은 어두워지지 않는다, 밝아진다"): 어두운 배경(천장)
      // 앞을 화면 불빛 받은 손이 지나가면 밝기가 **올라간다**. 어두워짐만 보던 기존 onset은 그 통과를
      // 통째로 못 봤다(우리 프레임 사진의 자세가 정확히 이 조건). 판정은 방향이 아니라 **일관성**:
      // 세 구간이 같은 방향으로(전부 밝아짐 또는 전부 어두워짐) 순차 변화하면 물체 통과, 섞이면 잡음.
      // 숫자가 아니라 구조 이식 — 문턱(15%)은 iOS 자체 값 유지.
      func onset(_ vals: [(t: Double, v: Double)], _ ref: Double) -> (at: Double, dir: Double)? {
        guard ref > 40 else { return nil }
        if let e = vals.first(where: { abs($0.v - ref) >= ref * 0.15 }) {
          return (e.t, e.v > ref ? 1.0 : -1.0)
        }
        return nil
      }
      let oL = onset(dipHistory.map { (t: $0.t, v: $0.l) }, baseEmaL)
      let oM = onset(dipHistory.map { (t: $0.t, v: $0.m) }, baseEmaM)
      let oR = onset(dipHistory.map { (t: $0.t, v: $0.r) }, baseEmaR)
      if let eR = oR, let eM = oM, let eL = oL, eR.dir == eM.dir, eM.dir == eL.dir {
        let tR3 = eR.at, tM3 = eM.at, tL3 = eL.at
        if tR3 < tM3, tM3 < tL3, tL3 - tR3 >= 80, tL3 - tR3 <= 900 {
          dipHistory.removeAll()
          if lumapassStandalone { fireTrigger(String(format: "lumapass span=%.0f", tL3 - tR3), nowMs) }
          return
        }
        if tL3 < tM3, tM3 < tR3, tR3 - tL3 >= 80, tR3 - tL3 <= 900 {
          // 방향 무관 발화(2026-08-26 부호 뒤집힘 확진) — 역순도 통과로 인정.
          dipHistory.removeAll()
          if lumapassStandalone { fireTrigger(String(format: "lumapass(rev) span=%.0f", tR3 - tL3), nowMs) }
          return
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
          // 방향 무관 발화(2026-08-26 부호 뒤집힘 확진) — 어느 순서든 근접 통과로 인정.
          pendingOcclusionWork?.cancel()
          pendingOcclusionWork = nil
          if nearpassStandalone {
            fireTrigger(String(format: "nearpass dip=%.0f bright=%.0f dtLR=%.0f", dip.luma, bright, tL - tR), nowMs)
          } else {
            onDiag(String(format: "nearpass(안드정렬 차단) dip=%.0f bright=%.0f", dip.luma, bright))
          }
          return
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
          if self.occlusionStandalone {
            self.fireTrigger(reason, CFAbsoluteTimeGetCurrent() * 1000)
          } else {
            self.onDiag("occlusion(안드정렬 차단) " + reason)
          }
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
    // 🔴 2026-09-06 채증 모드 — 발화(넘김)는 안 하고 "무엇이 발화할 뻔했는지"만 로깅한다(라벨 튜닝용).
    if captureMode { onDiag("capFIRE " + reason); return }
    lastTriggerMs = nowMs
    lumaHistory.removeAll()
    // ⚠️ xHistory는 비우지 않는다(2026-08-21) — 비우면 발화 직후 글라이드 연속성이 끊겨 전역 burst의
    // "움직임 지속" 추적이 끊기고, 600ms 정지 판정이 손짓 도중 성립해 재발화한다(01:11 3연발 원인).
    // 재발화 방지는 globalBurstFired가 담당하므로 이력 유지가 안전하다.
    for i in 0..<tracks.count { tracks[i].sizeHistory.removeAll(); tracks[i].sweepStreak = 0; tracks[i].glideStreak = 0; tracks[i].crossHistory.removeAll() }
    // 🔴 2026-08-28 — 같은 동작의 잔재가 다른 축으로 0.8~1s 뒤 재발화하던 것 차단(격자·밝기 이력 초기화).
    gridHistory.removeAll()
    dipHistory.removeAll()
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
  private func avgLumaGrid(_ pb: CVPixelBuffer) -> (l: Double, m: Double, r: Double, grid: [Double]) {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let fmt = CVPixelBufferGetPixelFormatType(pb)
    let isYUV = (fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)
    var sum = [Double](repeating: 0, count: gridN * gridN)
    var cnt = [Int](repeating: 0, count: gridN * gridN)
    func accumulate(w: Int, h: Int, luma: (Int, Int) -> Int) {
      let sx = max(1, w / 96), sy = max(1, h / 96) // 격자당 ~6×6 표본
      var y = 0
      while y < h {
        let gy = min(gridN - 1, y * gridN / h)
        var x = 0
        while x < w {
          let gx = min(gridN - 1, x * gridN / w)
          let i = gy * gridN + gx
          sum[i] += Double(luma(x, y)); cnt[i] += 1
          x += sx
        }
        y += sy
      }
    }
    if isYUV && CVPixelBufferGetPlaneCount(pb) > 0 {
      guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return (-1, -1, -1, []) }
      let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
      let bpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
      let ptr = base.assumingMemoryBound(to: UInt8.self)
      accumulate(w: w, h: h) { x, y in Int(ptr[y * bpr + x]) }
    } else {
      guard let base = CVPixelBufferGetBaseAddress(pb) else { return (-1, -1, -1, []) }
      let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
      let bpr = CVPixelBufferGetBytesPerRow(pb)
      let ptr = base.assumingMemoryBound(to: UInt8.self)
      accumulate(w: w, h: h) { x, y in
        let o = y * bpr + x * 4
        return (Int(ptr[o + 2]) * 299 + Int(ptr[o + 1]) * 587 + Int(ptr[o]) * 114) / 1000
      }
    }
    var grid = [Double](repeating: -1, count: gridN * gridN)
    for i in 0..<grid.count where cnt[i] > 0 { grid[i] = sum[i] / Double(cnt[i]) }
    // thirds는 격자 열 밴드에서 유도(안드와 동일 — 한 번의 스캔으로 세 축 공용)
    func band(_ from: Int, _ to: Int) -> Double {
      var t = 0.0; var n = 0
      for gy in 0..<gridN { for gx in from..<to where grid[gy * gridN + gx] >= 0 { t += grid[gy * gridN + gx]; n += 1 } }
      return n > 0 ? t / Double(n) : -1
    }
    let third = gridN / 3
    return (band(0, third), band(third, gridN - third), band(gridN - third, gridN), grid)
  }
}
