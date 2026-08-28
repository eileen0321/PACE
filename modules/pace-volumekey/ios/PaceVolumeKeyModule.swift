import ExpoModulesCore
import AVFoundation
import AudioToolbox
import MediaPlayer
import QuartzCore
import UIKit
import CoreMotion
import GameController

// Pace iOS 볼륨키 리모컨 (2026-07-21 사용자 지시, 2026-07-27 재확인).
// 시스템 출력 볼륨(AVAudioSession.outputVolume)을 KVO로 관찰 → 볼륨 버튼이 눌리면 실제 볼륨을 바꾸지 않고
// "onVolumeButton" 이벤트만 쏜다(→ RN이 다음/이전 Short로 넘김).
//
// ⚠️ 2026-07-27 iOS 플랫폼 한계 확인(웹 리서치): 사람들이 실제로 쓰는 싸구려 중국산 카메라 BT 리모컨은
// AVRCP next/prev가 아니라 "볼륨 업/다운" HID 키를 보낸다 → MPRemoteCommandCenter로는 못 잡고, 오직 이
// outputVolume KVO로만 잡힌다. 그런데 iOS는 볼륨 변화의 "출처"를 공개 API로 알려주지 않아(안드로이드
// KeyEvent.getDevice()에 해당하는 게 없음) "폰 물리 볼륨버튼"과 "리모컨 볼륨키"를 확정적으로는 구분할 수
// 없다. 게다가 이 리모컨은 Consumer-Control HID라 GCKeyboard로 연결 감지도 안 된다.
// → 상위(JS)에서 "핸즈프리 모드 ON + 피드 화면"일 때만 이 훅을 enable해서 하이재킹 범위를 그 상황으로
// 국한하고(평소 폰 볼륨은 항상 정상), 그 상황 안에서도 2026-08-05에 휴리스틱을 하나 더 추가했다 —
// 지금 연결된 오디오 기기가 유명 브랜드(에어팟/버즈/JBL 등)면 하이재킹을 건너뛴다(isKnownAudioAccessory
// Connected 참고). 확정적 판별은 여전히 불가능하지만, 가장 흔한 불만 케이스(그런 헤드폰을 낀 채 폰
// 자체 버튼을 누름)는 이걸로 해결된다.
//
// 방식: 볼륨이 변할 때마다 방향(up/down)을 판정해 이벤트를 보내고, 화면 밖 MPVolumeView 슬라이더로 볼륨을
// baseline(0.5)으로 되돌려 다음 눌림도 계속 감지되게 한다(0/1 천장에 안 걸리게). 내가 되돌린 것 때문에 생기는
// KVO 콜백은 ignoreNext로 건너뛴다. 시뮬레이터엔 물리 볼륨버튼이 없어 실기기 필요.
public class PaceVolumeKeyModule: Module {
  private let session = AVAudioSession.sharedInstance()
  private var observer: NSKeyValueObservation?
  private var volumeView: MPVolumeView?
  // baseline: 사용자가 맞춰둔 실제 볼륨을 캡처해 그 값으로 유지한다(예전엔 0.5로 강제해 영상 볼륨이 사용자
  // 설정과 무관하게 0.5로 고정/들쑥날쑥해지는 문제가 있었음 — 사용자 실기기 지적). start()에서 현재 볼륨으로
  // 세팅하되, 양극단(0/1)이면 눌림 감지 여지가 없어 [0.1, 0.9]로만 살짝 클램프한다.
  private var baseline: Float = 0.5
  // 2026-08-18 사장님 사양 확정(3연속 지시 종합: "볼륨 0이면 이전 안 간다는 거야" → "무음에서 소리
  // 나잖아" → "4,5로 올리면 4,5, 0까지 줄이면 최저 1이지만 0인 것처럼", "무음에서도 볼륨키면 소리
  // 들리기로 했잖아") — 리모컨 세션 중 볼륨키는 영상 넘김과 **동시에 실제 볼륨도 조절**한다(유튜브/
  // 인스타 관행: 볼륨키는 항상 제 역할). 업=볼륨 한 칸↑, 다운=한 칸↓(바닥 1/16 — 0까지 내리면 KVO
  // 감지가 죽으므로), 바닥에서 또 다운이면 "가상 0"(emulatedZero — JS가 영상을 muted로 잠가 무음),
  // 가상 0에서 업이면 소리 복귀. 세션 종료 시 가상 0이었으면 진짜 0으로 되돌린다(그 외엔 사용자가
  // 세션 중 만든 볼륨이 곧 최종 볼륨이라 복원 안 함).
  private var emulatedZero = false
  private var nextTarget: Any?
  private var prevTarget: Any?

  // 2026-08-07 무음스위치 감지("Mute" 라이브러리와 동일 기법 — 웹리서치로 정확한 알고리즘 확인 후 이식).
  // WKWebView는 <video> 오디오를 재생할 때 물리 무음 스위치를 원천적으로 무시하는 유명한 iOS 버그다
  // (rdar://28716885, WebKit bug 167788 — AVAudioSession 카테고리를 뭘로 설정해도 소용없음, 애플이
  // 수년째 안 고침). 그래서 "우리가 카테고리를 잘 관리하면 해결된다"는 접근 자체가 원천적으로 안 된다 —
  // 대신 무음스위치 "상태"를 직접 감지해서, 무음이면 JS 쪽에서 video.muted를 강제로 켜는 우회가 필요하다.
  // 감지 원리: AudioServicesPlaySystemSoundWithCompletion으로 정확히 0.2초짜리 시스템 사운드를 재생시켜
  // 실제 걸린 시간을 잰다. 시스템 사운드는(일반 AVAudioSession 재생과 달리) 무음스위치를 그대로 따르므로,
  // 무음이면 iOS가 소리 없이 즉시(0.2초보다 훨씬 빠르게) 완료 콜백을 준다. 안 무음이면 실제로 0.2초가
  // 걸린다 — 그 차이로 스위치 상태를 역산한다.
  private var muteCheckSoundId: SystemSoundID = 0
  private var lastMuteVerdict: Bool? = nil // 진단 로그 스팸 방지(판정 변경시만 기록)
  private var muteCheckStartedAt: CFTimeInterval = 0
  private var muteCheckPending: Promise?

  // 2026-08-08 사장님 지시 — "무음으로 시작해도, 볼륨키를 누르면(올리든 내리든) 소리가 나야 한다"
  // (유튜브/인스타그램 실제 동작과 동일한 관행 — 웹서치로 확인: "when you press the volume up or down
  // button the audio should be unmuted"). 위 볼륨키 리모컨(start/stop)은 "핸즈프리 모드+토글 ON"일
  // 때만 켜지는 opt-in 기능이라 평소(토글 OFF)엔 물리 볼륨키 입력을 우리가 아예 못 본다 — 그래서 별도
  // 감시자를 둔다: Shorts 재생 중엔 토글과 무관하게 항상 이 watch를 켜서, 볼륨이 조금이라도 바뀌면(방향
  // 무관) "무음 해제 신호"로만 이벤트를 쏜다. 리모컨(next/prev)과 달리 **볼륨을 되돌리지 않는다** — 진짜
  // 볼륨 조절이 목적이므로 그대로 둔다.
  private var unmuteObserver: NSKeyValueObservation?
  private var unmuteBaselineVolume: Float = -1
  // 리모컨 기능(remoteActive)과 이 watch(unmuteWatchActive)가 같은 공유 AVAudioSession을 쓴다 — 세션을
  // 활성 상태로 유지할지/기본값으로 되돌릴지는 "둘 다 꺼졌을 때만" 판단해야 서로를 안 밟는다.
  private var remoteActive = false
  private var unmuteWatchActive = false
  // 🔴 2026-08-18 사장님 지적("리모컨 처음은 볼륨으로 되다가 영상으로 넘어가. 처음부터 체크 못해?") —
  // KVO/세션 준비를 포커스 온 순간에 시작하니 켜자마자 누른 첫 눌림이 감시가 붙기 전에 새어나갔다.
  // 2단계로 분리: start()=무장(피드 진입 시 — 세션/뷰/KVO/모션을 미리 데움, 볼륨은 추적만),
  // setEngaged(true)=개입(포커스 온 — baseline 클램프 + 하이재킹 시작, 지연 0). 개입 전 눌림은
  // 평소처럼 볼륨만 바뀌고 baseline 추적으로 따라간다.
  private var engaged = false
  // 🔴 2026-08-18 사장님 설계 지시("손으로 폰을 잡고 누를 때는 흔들림이 있고, 블루투스 리모컨은 폰이
  // 정지된 상태에서 누를 것") — 웹서치+독립 AI 검토로 타당성 확정(선행연구: 하드웨어 버튼 누름은
  // 0.05~0.3g 충격, 손에 쥔 폰은 생리적 손떨림으로 RMS 0.01~0.03g가 상시 존재, 거치된 폰은
  // 0.002~0.02g 바닥 노이즈 — "쥠/거치"를 연속 상태로 분류 가능). 판정 트리:
  //   ① 충전 중 = 거치 확정 → 리모컨(넘김)   ② 모션 RMS가 거치 수준 → 리모컨(넘김)
  //   ③ 쥠 상태 + 눌림 직전 450ms 내 충격 스파이크 → 폰 물리버튼 → 볼륨만 조절(넘김 없음)
  //   ④ 쥠 상태지만 스파이크 없음(한 손에 폰, 다른 손에 리모컨) → 리모컨(넘김)
  // 가속도계 raw 100Hz만 쓴다(자이로/deviceMotion은 전력 수 mA로 비쌈 — 검토 권고).
  private let motionManager = CMMotionManager()
  private var motionStarted = false
  private var motionPrimed = false
  private var gLpX = 0.0, gLpY = 0.0, gLpZ = 0.0 // ~1Hz 저역 = 중력 추정(고역 성분 추출용)
  private var accRmsSq = 0.0                     // 고역 가속도 제곱의 EMA(대략 2초 창)
  private var motionHeld = false                 // true=손에 쥠 / false=거치 (히스테리시스 전환)
  private var lastSpikeAtMs: Double = 0          // 마지막 임계 초과 충격 시각
  private var lastSpikeMag: Double = 0           // 그 충격의 크기(g) — 임계 튜닝용 로그
  private var lastBigSpikeAtMs: Double = 0       // 폰 직접 누름 수준(>0.12g) 충격 시각 — 판정용
  private var lastBigSpikeMag: Double = 0
  // 2026-08-19(자정 2차) 융합 판정용 샘플 링버퍼(핸들러 내 cls 주석 참고) — 가속도·자이로 각 3초.
  // motion 큐(쓰기)와 메인(판정 시 읽기)이 공유하므로 락으로 보호.
  private let samplesLock = NSLock()
  private var accSamples: [(t: Double, m: Double)] = []
  private var gyroSamples: [(t: Double, m: Double)] = []
  private var keyboardPresent = false // HID 키보드(=BT 리모컨 추정) 연결 상태 — 알림 캐시(coalesced 직접 폴링 금지, 크래시 회피)
  private var kbObserversInstalled = false
  private var lastPhonePressAtMs: Double = 0 // 폰버튼 확정 시각 — 자동반복/연타 상속용(핸들러 주석)
  private var lastLensCoveredMs: Double = 0  // 렌즈 가림 신호 최근 수신(PaceLensCovered — 2026-08-21 사장님 설계)
  private var lensObserverInstalled = false
  // 🔴 2026-08-28 사장님 재현("무료 소진→광고→포커스온 쇼츠에서 볼륨 눌러도 안 켜짐") — 광고(AdMob)가
  // 공유 AVAudioSession을 가로챈 뒤 .notifyOthersOnDeactivation으로 반납하면 우리 outputVolume KVO가
  // 비활성 세션에 남아 볼륨키 변화를 못 잡는다. 인터럽션 종료/앱 복귀 때 세션을 되찾는 관찰자.
  private var interruptObserversInstalled = false

  /// 눌림창([now-400ms, now])의 피크를 직전 배경([now-2900, now-450])의 μ/σ 대비 z-점수로 환산.
  /// 고정 임계 3연속 실패(그립마다 절대값이 다름)의 처방 — 본인 손 노이즈 대비 상대 돌출만 본다.
  private func spikeZ(_ samples: inout [(t: Double, m: Double)], _ now: Double) -> (Double, Double) {
    samplesLock.lock(); let snap = samples; samplesLock.unlock()
    var base: [Double] = []; var peak = 0.0
    for s in snap {
      let age = now - s.t
      if age <= 400 { peak = max(peak, s.m) }
      else if age < 2900 { base.append(s.m) }
    }
    guard base.count >= 20, peak > 0 else { return (0, peak) }
    // 🔴 2026-08-19 실기기("첫 눌림만 폰버튼, 연타부터 리모컨 오판" — z가 6.8→0.8로 추락) — 평균/σ는
    // 직전 눌림의 충격(0.17g)이 배경 통계에 섞여 기준을 부풀린다(스파이크 오염). 중앙값/MAD(강건
    // 통계)로 교체 — 배경의 절반 이상이 오염되지 않는 한 기준이 흔들리지 않아 연타에도 판정 유지.
    let sorted = base.sorted()
    let med = sorted[sorted.count / 2]
    let devs = base.map { abs($0 - med) }.sorted()
    let mad = max(devs[devs.count / 2] * 1.4826, 0.002) // 1.4826 = 정규분포 σ 환산계수, 바닥은 무한 z 방지
    return ((peak - med) / mad, peak)
  }

  private func startMotion() {
    guard motionManager.isAccelerometerAvailable, !motionStarted else { return }
    motionStarted = true
    UIDevice.current.isBatteryMonitoringEnabled = true
    motionPrimed = false
    accRmsSq = 0; motionHeld = false; lastSpikeAtMs = 0
    motionManager.accelerometerUpdateInterval = 1.0 / 100.0
    let q = OperationQueue(); q.maxConcurrentOperationCount = 1
    motionManager.startAccelerometerUpdates(to: q) { [weak self] data, _ in
      guard let self = self, let a = data?.acceleration else { return }
      if !self.motionPrimed { // 첫 샘플로 중력 추정을 시드(초기 1g가 스파이크로 오인되는 것 방지)
        self.gLpX = a.x; self.gLpY = a.y; self.gLpZ = a.z; self.motionPrimed = true; return
      }
      self.gLpX = self.gLpX * 0.99 + a.x * 0.01
      self.gLpY = self.gLpY * 0.99 + a.y * 0.01
      self.gLpZ = self.gLpZ * 0.99 + a.z * 0.01
      let dx = a.x - self.gLpX, dy = a.y - self.gLpY, dz = a.z - self.gLpZ
      let mag = (dx * dx + dy * dy + dz * dz).squareRoot()
      self.accRmsSq = self.accRmsSq * 0.995 + mag * mag * 0.005
      // z-점수 판정용 샘플 축적(3초 링버퍼 — spikeZ 주석 참고)
      let tMs = CACurrentMediaTime() * 1000
      self.samplesLock.lock()
      self.accSamples.append((tMs, mag))
      while let f = self.accSamples.first, tMs - f.t > 3000 { self.accSamples.removeFirst() }
      self.samplesLock.unlock()
      let rms = self.accRmsSq.squareRoot()
      // 히스테리시스 — 경계값 근처에서 파닥거리지 않게 진입/이탈 임계를 분리.
      // 🔴 2026-08-19 00:51 실측("거치되어 있는데" 판정은 쥠) — 거치 후에도 이탈 임계(0.007)에 못 내려가
      // 쥠이 고착, 4초 상속이 살아남아 리모컨을 볼륨으로 삼켰다(충전 진동 등 주변 노이즈로 추정).
      // 이탈 0.007→0.012, 진입 0.012→0.018로 상향(실측 쥠 떨림 0.024~0.058이라 진입 여유 충분).
      if self.motionHeld {
        if rms < 0.012 {
          self.motionHeld = false
          NotificationCenter.default.post(name: Notification.Name("PacePhoneHandled"), object: nil, userInfo: ["held": false])
        }
      } else if rms > 0.018 {
        self.motionHeld = true
        // 손짓 모듈에 "폰을 만지는 중" 신호 — 폰으로 손을 뻗거나 쥐고 있는 동안 그 손이 카메라에
        // 손짓으로 오인되는 것을 잠그기 위함(2026-08-19 01:01 사장님 재현 "손으로 누를 때 영상 넘어감").
        NotificationCenter.default.post(name: Notification.Name("PacePhoneHandled"), object: nil, userInfo: ["held": true])
      }
      // 내려놓기/집어들기 수준의 대형 충격(0.35g+, 실측 내려놓기 0.728g)은 볼륨 조절 세션을 즉시
      // 종료시킨다 — "손으로 볼륨한 뒤 두고 리모컨" 시퀀스에서 상속이 리모컨을 삼키는 것을 행위
      // 수준에서 차단(정상 폰버튼 누름이 0.35g를 넘는 경우엔 그 눌림의 판정이 다시 앵커를 세운다).
      if mag > 0.35 { self.lastPhonePressAtMs = 0 }
      if mag > 0.03 { // 진단용 소충격 추적(판정엔 미사용 — 아래 bigSpike만 판정에 쓴다)
        self.lastSpikeAtMs = CACurrentMediaTime() * 1000
        self.lastSpikeMag = mag
      }
      // 폰 버튼 직접 누름의 충격만 잡는 강한 임계 — 실측 위계: 쥔 손 떨림 0.03~0.06g < 책상 전달
      // 리모컨 진동 0.03~0.044g < 직접 누름 0.12~0.135g(23:29 실측, 살짝 누르면 더 낮음).
      // 0.12는 턱걸이라 약한 누름을 놓쳐 "폰버튼인데 넘어감"이 남았다 → 위계의 빈 구간(0.06~0.12)
      // 중앙인 0.085로 하향(양쪽 모두 여유).
      if mag > 0.085 {
        self.lastBigSpikeAtMs = CACurrentMediaTime() * 1000
        self.lastBigSpikeMag = mag
      }
    }
    // 자이로(회전) — 폰 버튼 직접 누름의 토크 서명 감지(핸들러 내 cls 주석 ②). z축(화면 비틀림)은
    // 제외하고 x/y(측면 버튼 누름이 만드는 기울임 회전)만 본다.
    if motionManager.isGyroAvailable {
      motionManager.gyroUpdateInterval = 1.0 / 100.0
      motionManager.startGyroUpdates(to: q) { [weak self] data, _ in
        guard let self = self, let r = data?.rotationRate else { return }
        let m = (r.x * r.x + r.y * r.y).squareRoot()
        let tMs = CACurrentMediaTime() * 1000
        self.samplesLock.lock()
        self.gyroSamples.append((tMs, m))
        while let f = self.gyroSamples.first, tMs - f.t > 3000 { self.gyroSamples.removeFirst() }
        self.samplesLock.unlock()
      }
    }
  }
  private func stopMotion() {
    if motionStarted {
      motionManager.stopAccelerometerUpdates()
      motionManager.stopGyroUpdates()
      motionStarted = false
      samplesLock.lock(); accSamples.removeAll(); gyroSamples.removeAll(); samplesLock.unlock()
    }
  }

  private func ensureSessionActive() {
    do {
      try session.setCategory(.ambient, options: [.mixWithOthers])
      try session.setActive(true)
    } catch {}
  }

  // 오디오 인터럽션/앱 복귀/미디어리셋 관찰자 설치(멱등) — start(무장)과 startSilentUnmuteWatch
  // 양쪽에서 부른다. 리모컨 토글이 꺼진 일반 사용자는 start()가 안 불리므로 워치 쪽에서도 걸어야 한다.
  private func installInterruptObserversIfNeeded() {
    guard !interruptObserversInstalled else { return }
    interruptObserversInstalled = true
    NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let self = self else { return }
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
      self.reclaimSessionIfNeeded()
    }
    NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.reclaimSessionIfNeeded()
    }
    NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      self?.reinstallVolumeObserversAfterReset()
    }
  }

  // 인터럽션(광고 등) 종료 후 세션을 되찾는다 — 감시/개입이 켜져 있을 때만. KVO 기준을 현재
  // 시스템 볼륨으로 다시 잡아, 인터럽션 동안 벌어진 차이를 "사용자 눌림"으로 오탐하지 않게 한다.
  private func reclaimSessionIfNeeded() {
    guard unmuteWatchActive || remoteActive else { return }
    ensureSessionActive()
    let cur = session.outputVolume
    unmuteBaselineVolume = cur
    if !engaged { baseline = (cur * 16).rounded() / 16 }
    NSLog("PACEVOL 인터럽션 종료 — 세션 재활성화, baseline=\(cur)")
  }

  // 미디어 서비스 리셋 시 KVO 관찰자가 무효화된다 — 활성화 후 관찰자를 다시 건다(애플 문서 권고).
  private func reinstallVolumeObserversAfterReset() {
    ensureSessionActive()
    if unmuteWatchActive {
      unmuteObserver?.invalidate()
      unmuteBaselineVolume = session.outputVolume
      unmuteObserver = session.observe(\.outputVolume, options: [.new]) { [weak self] s, _ in
        guard let self = self else { return }
        let v = s.outputVolume
        if abs(v - self.unmuteBaselineVolume) < 0.01 { return }
        if self.remoteActive && abs(v - self.baseline) < 0.03 { self.unmuteBaselineVolume = v; return }
        self.unmuteBaselineVolume = v
        self.sendEvent("onSilentUnmute", [:])
      }
    }
    NSLog("PACEVOL 미디어서비스 리셋 — 관찰자 재설치")
  }

  private func deactivateSessionIfIdle() {
    guard !remoteActive && !unmuteWatchActive else { return }
    do {
      try session.setCategory(.soloAmbient)
      try session.setActive(false, options: .notifyOthersOnDeactivation)
    } catch {}
  }

  public func definition() -> ModuleDefinition {
    Name("PaceVolumeKey")
    Events("onVolumeButton", "onSilentUnmute")

    AsyncFunction("start") { (promise: Promise) in
      DispatchQueue.main.async {
        // ⭐ 2026-08-04 사장님 지적("볼륨 2로 하고 포커스 온하면 5로 튄다") — 원인: baseline 캡처를
        // setActive(true)/MPVolumeView 생성 "직후"에 하면 session.outputVolume이 iOS18 stale 버그로
        // 사용자 실제 볼륨(2=0.125) 대신 0.5 기본값을 반환해 baseline=0.5로 잡히고 볼륨이 5로 강제됐다.
        // → 세션 활성화·뷰 생성 전에 "먼저" 현재 시스템 볼륨을 읽어 baseline으로 삼는다(사용자 2가 그대로 유지).
        let cur = self.session.outputVolume
        // 2026-08-08 사장님 지적("무음이라도 볼륨키를 누르면 소리가 커진다") — 웹서치로 확정: outputVolume
        // KVO는 .playback이 아니어도 동작한다("you can set the audio session category to
        // AVAudioSessionCategoryAmbient, which allows you to detect volume changes without requiring
        // audio playback" — 대표 오픈소스 구현체들의 관행). .playback은 물리 무음 스위치를 무시하고
        // 하드웨어 볼륨을 "진짜 미디어 볼륨"으로 취급하는 카테고리라, 리모컨 기능이 켜져 있는 동안은
        // (a) 무음 스위치가 통째로 무시되고 (b) 폰 볼륨키를 누르면 그 순간 실제 출력이 커졌다(리셋 전
        // 찰나) — 지금까지의 무음스위치 강제(video.muted)와 근본적으로 상충하는 카테고리였다. .ambient는
        // KVO 감지는 그대로 유지하면서 무음 스위치를 존중하고, "진짜 미디어 세션"으로 취급되지 않아
        // 볼륨키가 실제 출력을 올리지도 않는다.
        // 🔴 2026-08-18(밤) 회귀 수정("왜 소리가 하나도 안 키워지냐") — 무장 단계에서 세션을 활성화했더니
        // 포커스 오프 중의 무음스위치 감지(0.2초 타이밍 트릭)가 교란돼 영상이 무음으로 잠겼다.
        // 무장은 KVO 인프라(뷰/옵저버/모션)만 준비하고, 세션 활성화(remoteActive 포함)는 개입
        // (setEngaged(true))으로 미룬다 — 포커스 오프의 오디오 경로가 이전과 완전히 동일해진다.
        self.startMotion() // 폰버튼/리모컨 모션 판별(위 주석) — 가속도계+자이로 100Hz
        if !self.lensObserverInstalled { // 렌즈 가림 신호 수신(가림+볼륨=폰버튼 확정 — 핸들러 주석)
          self.lensObserverInstalled = true
          NotificationCenter.default.addObserver(forName: Notification.Name("PaceLensCovered"), object: nil, queue: nil) { [weak self] _ in
            self?.lastLensCoveredMs = CACurrentMediaTime() * 1000
          }
        }
        // HID 키보드(=BT 셔터 리모컨류) 존재 감지 — cls 주석 ④. GCKeyboard.coalesced를 수시로 폴링하면
        // bg/fg 전환 중 크래시 사례(iPadOS 18.6+)가 있어, 연결/해제 알림으로 불리언만 캐시한다.
        if !self.kbObserversInstalled {
          self.kbObserversInstalled = true
          NotificationCenter.default.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] n in
            self?.keyboardPresent = true
            NSLog("PACEVOL HID키보드 연결 — 리모컨 존재 신호 ON")
            // 실증 테스트(검토 AI 권고) — 일부 리모컨은 keyboard-page 키를 병행 송신한다. 이벤트가
            // 하나라도 찍히면 그 모델은 눌림 출처를 100% 확정 가능(차기 확정 판정 경로 후보).
            if let kb = n.object as? GCKeyboard {
              kb.keyboardInput?.keyChangedHandler = { _, _, keyCode, pressed in
                NSLog("PACEVOL HID키 이벤트 keyCode=\(keyCode.rawValue) pressed=\(pressed)")
              }
            }
          }
          NotificationCenter.default.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { [weak self] _ in
            self?.keyboardPresent = false
            NSLog("PACEVOL HID키보드 해제 — 리모컨 존재 신호 OFF")
          }
        }
        self.installInterruptObserversIfNeeded()
        self.keyboardPresent = GCKeyboard.coalesced != nil // 시작 시 1회 조회(앱 활성·메인 큐 — 안전 조건)
        if self.keyboardPresent { NSLog("PACEVOL HID키보드 이미 연결(리모컨 추정)") }

        // ── 방식 A: outputVolume KVO — 싸구려 카메라 BT 리모컨(볼륨키 HID)을 잡는 유일한 길 ──
        // ⚠️ MPVolumeView는 여기(무장)서 만들지 않는다 — 2026-08-18 사장님 재현("포커스 오프인데 볼륨
        // HUD가 안 떠"): 이 뷰가 화면에 존재하는 것만으로 iOS가 시스템 볼륨 HUD를 숨긴다. 뷰는 볼륨을
        // "쓸 때"(하이재킹)만 필요하므로 setEngaged(true)에서 만들고 (false)에서 제거한다. KVO 감시는
        // 뷰 없이도 동작한다.
        // 위에서 세션 활성화 전에 읽은 사용자 현재 볼륨(cur)을 baseline으로 "그대로" 쓴다 — 클램프/강제 금지.
        // 2026-08-04 사장님 지적("볼륨 다 줄이고 포커스 온했는데 볼륨이 커져") — 기존 [0.125,0.875] 클램프가
        // 사용자가 0(무음)으로 둔 볼륨을 0.125(2칸)로 끌어올려 "볼륨이 커지는" 문제였다. "사용자 볼륨을 절대
        // 안 건드린다"가 감지 여지 확보보다 우선이므로 클램프 제거 — baseline = 사용자 실제 볼륨. iOS 볼륨은
        // 1/16 스텝이라 스텝 정렬만 유지(이미 스텝이라 사실상 no-op). 극단값(0/최대)에선 한 방향 감지가 안 될
        // 수 있으나, 사용자가 맞춘 볼륨을 바꾸는 것보다 낫다.
        // 무장 단계에서는 볼륨을 건드리지 않는다 — baseline은 추적용으로만 잡는다(클램프는 setEngaged에서).
        self.baseline = (cur * 16).rounded() / 16
        self.engaged = false
        NSLog("PACEVOL start(무장) OK — baseline추적=\(self.baseline) (현재볼륨 \(cur))") // 진단(테스트 후 제거)
        self.observer = self.session.observe(\.outputVolume, options: [.new]) { [weak self] s, _ in
          guard let self = self else { return }
          let v = s.outputVolume
          if !self.engaged { // 무장(감시)만 — 개입 전 볼륨 변경은 그대로 두고 기준만 따라간다
            NSLog("PACEVOL 볼륨변화 수신(비개입) v=\(v)") // 진단 — 눌림이 네이티브까지 오는지 추적
            self.baseline = (v * 16).rounded() / 16
            return
          }
          // 우리가 baseline으로 되돌린 것 때문에 생긴 KVO면 무시(값이 baseline과 거의 같음 = 같은 스텝).
          // 사용자 눌림은 baseline에서 한 스텝(±0.0625) 벗어나므로 확실히 구분된다. 예전 ignoreNext 플래그
          // 방식은 리셋 KVO가 타이밍/정렬 문제로 안 오면 다음 눌림을 잡아먹어 "두 번 눌러야 넘어가" 버그가
          // 났다 — 상태 없는 값 비교로 대체.
          if abs(v - self.baseline) < 0.03 { return }
          // 볼륨키가 눌렸다 = 폰 근처에 손이 있다 → 손짓 모듈에 억제 신호(위 PacePhoneHandled 주석 참고)
          NotificationCenter.default.post(name: Notification.Name("PaceVolumePressed"), object: nil)
          // 2026-08-05 사장님 지시 — "연결된 블루투스가 에어팟/버즈/JBL 등 알려진 이름이면 그냥 볼륨으로
          // 인식하자". 눌림의 "출처"(폰 물리버튼 vs 리모컨)는 여전히 iOS가 앱에 안 알려주지만(리서치로
          // 확인됨 — AVAudioSession은 오디오 라우팅만 노출, 입력 이벤트 소스는 별개 체계라 연결 안 됨),
          // "지금 연결된 오디오 기기가 유명 헤드폰/스피커 브랜드"라는 건 확인 가능한 약한 신호다. 그런
          // 기기가 붙어 있으면 (a) 그 기기 자체엔 물리 볼륨버튼이 없는 게 보통이라(에어팟 등) 지금 눌린 건
          // 십중팔구 폰 자체 버튼이고, (b) 문제의 그 저가 클리커 리모컨은 이런 유명 브랜드 이름을 쓰지
          // 않는다 — 그래서 하이재킹을 건너뛰고 실제 볼륨이 바뀌게 둔다. 완벽한 판별은 아니지만(리모컨과
          // 유명 브랜드 기기가 동시에 연결된 극히 드문 경우는 놓침) 가장 흔한 불만 케이스(에어팟 끼고 폰
          // 버튼 누름)를 해결한다.
          if self.isKnownAudioAccessoryConnected() {
            NSLog("PACEVOL skip hijack — known audio accessory connected, treating as real volume v=\(v)")
            self.baseline = (v * 16).rounded() / 16 // 다음 비교 기준을 실제 볼륨으로 갱신(리셋 안 함)
            return
          }
          // 🔴 2026-08-21 사장님 설계 — **카메라(전면 렌즈)를 가린 채 볼륨키 = 폰버튼(볼륨만) 확정.**
          // 손짓 카메라의 가림 감지(PaceLensCovered, 150ms 주기)를 수신해 0.8초 내 가림이면 최우선 적용.
          // 센서 추정이 아니라 사용자가 의도를 직접 신호하는 확정 규칙이라 다른 모든 판정에 우선한다.
          if CACurrentMediaTime() * 1000 - self.lastLensCoveredMs < 800 {
            NSLog("PACEVOL cls=폰버튼(렌즈가림 신호) v=\(v)")
            self.baseline = (v * 16).rounded() / 16
            self.lastPhonePressAtMs = CACurrentMediaTime() * 1000 // 가림 후 연타도 상속 보호
            // 폰버튼 확정 = 소리 조절 의도 확정 → 무음 잠금 해제 신호(source로 JS 억제조건 우회 —
            // 2026-08-21 사장님 "가리고 눌렀는데 소리 안 됨": 8/15 억제는 "리모컨과 구분 불가" 전제였는데
            // 이제 구분되므로 폰버튼 눌림에는 적용하지 않는다)
            self.sendEvent("onSilentUnmute", ["source": "phonebutton"])
            self.sendEvent("onVolumeButton", ["direction": v >= self.baseline ? "up" : "down", "emulatedZero": self.emulatedZero, "navigate": false])
            return
          }
          // 모션 기반 폰버튼/리모컨 판별(위 startMotion 주석) — 2026-08-18 사장님 지적("거치대에 놓고
          // 손으로 볼륨키를 누를 수도 있잖아")으로 단순화: 폰 버튼을 직접 누르면 쥠/거치와 무관하게
          // 폰에 충격이 전달되므로 **눌림과 시간 동기화된 충격 = 폰 버튼(볼륨만), 없으면 = 리모컨(넘김)**.
          // 리모컨은 손에 들고 누르는 게 보통이라 폰엔 충격이 없다. (같은 책상에 리모컨을 놓고 누르면
          // 책상 진동이 전달될 수 있으나 직접 누름보다 훨씬 약함 — 0.05g 임계로 구분, 실측 튜닝 대상.)
          // 🔴 2026-08-18(3차) 사장님 실기기("지금 블루투스로 볼륨만 되잖아") — 스파이크 경로가 리모컨을
          // 폰버튼으로 오판했다. 실측: 리모컨 클릭 진동이 책상→거치대를 타고 폰에 0.030~0.044g로 전달돼
          // 눌림과 시간동기(4~111ms전)로 찍힌다 — 독립 AI 검토가 경고한 바로 그 케이스("같은 책상 리모컨
          // 클릭은 시간상관 진동을 만든다, 상태 분류를 1차로 쓰라")를 임계 하향(0.05→0.03)이 다시 열었다.
          // → 스파이크는 판정에서 제외(진단 로그만). **판정은 순수 쥠/거치 상태(손떨림 RMS)로만**:
          //   쥠(생리적 손떨림 상시 존재) → 폰버튼(볼륨만) / 거치(정지) → 리모컨(넘김).
          //   거치 상태에서 폰 버튼을 손가락으로 누르는 경우는 리모컨으로 오판되는 한계가 남지만(넘어감),
          //   리모컨이 볼륨만 되는 것(핵심 기능 사망)보다 훨씬 낫다. rms를 로그에 남겨 쥠 고착도 검증.
          // 🔴 2026-08-18(4차·최종) 실기기 rms=0.05 실측 — 사장님은 **폰을 쥔 채 리모컨을 누른다**.
          // "쥠=폰버튼" 규칙이 그 리모컨을 죽였다("리모컨 하나도 안 되잖아"). 실측 충격 위계가 답을 줬다:
          //   쥔 손 떨림 0.03~0.06g < 책상 전달 리모컨 진동 0.03~0.044g < 폰 버튼 직접 누름 0.1g+
          // → 판정 규칙 하나로 통일: **눌림과 시간동기(450ms)된 강한 충격(>0.12g) = 폰버튼(볼륨만),
          //   그 외 전부 = 리모컨(넘김)**. 쥠/거치 상태는 판정에서 제외(진단 로그만 유지).
          // ⛔ 2026-08-18(자정) 폰버튼/리모컨 구분 기능 보류 — 오늘 밤 세 규칙이 전부 실기기에서 반증됐다:
          //   ① 쥠 상태 판정 → 쥔 채 리모컨을 누르는 실사용에서 리모컨 사망 (rms=0.05 실측)
          //   ② 약충격(0.03~0.085) → 책상 전달 리모컨 진동(0.030~0.044g)이 폰버튼으로 오판
          //   ③ 강충격(0.085~0.12) → 살살 누른 폰버튼이 임계 아래로 새어 리모컨으로 오판
          // 물리 신호가 겹치는 구간이 있어 단일 임계로는 신뢰선 미달 — 출시 버전은 원래 확정 사양
          // (개입 중 눌림 = 넘김 + 볼륨 1칸, 출처 무관)으로 두고, 아래 판정 로그만 계속 수집해
          // 다음 업데이트에서 실측 기반으로 다시 켠다.
          // 🔴 2026-08-19(자정 2차) 사장님 지시("센서 다 확인해봐 웹서치하고") — 전 센서 조사 + 독립 AI
          // 검토로 확정한 융합 판정(연타 방식은 사장님 반려로 폐기):
          //   ① 거치(손떨림 RMS 낮음) → 리모컨. 책상 전달 진동은 아예 안 본다(실측 오판원 차단).
          //   ② 쥠 → **가속도(충격) + 자이로(회전) 2축 z-점수 동시** 스파이크만 폰버튼. 물리 근거:
          //      쥔 손은 충격(병진)은 흡수해도 옆면 버튼을 누르는 힘의 **회전(토크)**은 못 숨긴다
          //      (연구 실측: 화면 탭만으로 0.2~0.7 rad/s). 반대로 다른 손의 리모컨 클릭·책상 진동은
          //      회전 성분이 거의 없다 → 가속도만으로 겹치던 두 부류가 (가속도×자이로) 평면에서 갈라짐.
          //   ③ 임계는 고정값이 아니라 **직전 2.5초 본인 손 노이즈 대비 z-점수 ≥4**(쥠새·그립마다
          //      절대값이 달라 고정 임계가 3연속 실패한 것의 근본 처방).
          //   ④ HID 키보드 연결 감지(GameController) — 싸구려 BT 리모컨은 키보드로 등록됨 → "리모컨
          //      존재" 세션 신호. 존재 시 폰버튼 판정 문턱을 z≥6으로 올려 리모컨 눌림 보호. 애매(한 축만
          //      스파이크)하면 리모컨 우선(오판 시 넘김 실수가 볼륨 실수보다 복구 쉬움 — 검토 AI 권고).
          let nowK = CACurrentMediaTime() * 1000
          var verdict = "리모컨"
          var why = "거치"
          // 🔴 2026-08-19 00:58 재추가(사장님 재현 "거치인데 손으로 볼륨 누르면 넘어감") — 00:46에
          // 지시로 제거했던 거치 직접충격 예외를 **상하한 밴드**로 되살린다: 0.08~0.35g(또는 회전
          // 0.12~0.45rad)만 폰버튼. 하한은 책상 전달 진동(≤0.044g) 차단, 상한은 내려놓기/집어들기
          // (0.7g+, 00:46 사고 원인) 차단. + 대형 충격의 상속 앵커 차단(motion 핸들러)과 상속의
          // 쥠 게이트가 이미 들어가 있어 00:46의 "내려놓은 직후 리모컨 삼킴" 재발 경로는 막혀 있다.
          if !self.motionHeld {
            let (_, ap) = self.spikeZ(&self.accSamples, nowK)
            let (_, gp) = self.spikeZ(&self.gyroSamples, nowK)
            // 회전 하한 0.12→0.06rad(01:04 실측: 살살 누른 폰버튼 gp 0.09~0.15가 0.12 문턱에 걸려 샘.
            // 거치대가 회전을 억제해 책상 진동으로는 회전이 거의 안 생기므로 0.06으로도 안전).
            if (ap >= 0.08 && ap < 0.35) || (gp >= 0.06 && gp < 0.45) {
              verdict = "폰버튼"; why = String(format: "거치·직접충격 %.3fg/%.2frad", ap, gp)
            } else {
              why = String(format: "거치 ap=%.3f gp=%.2f", ap, gp) // 미달 수치 채증(튜닝용)
            }
          }
          if self.motionHeld {
            let (az, ap) = self.spikeZ(&self.accSamples, nowK)
            let (gz, gp) = self.spikeZ(&self.gyroSamples, nowK)
            let zTh = self.keyboardPresent ? 6.0 : 4.0
            // ⛔ 00:49 상한(0.35g) 철회 — 세게 누르는 실사용 충격이 0.35g를 넘어 볼륨이 통째로 죽었다
            // ("손으로 볼륨하는데 하나도 안 되네"). 내려놓기 오인의 실제 해결은 "상속은 쥔 상태에서만"
            // 규칙(아래)이며, 내려놓으면 motionHeld가 풀려 어차피 리모컨 판정이라 상한이 불필요했다.
            let accHit = az >= zTh
            let gyroHit = gz >= zTh && gp >= 0.06
            // 🔴 2026-08-19 00:19 실측 — "둘 다 z≥4"(AND)는 살살 누른 폰버튼(az4.2/gz2.9, az1.2/gz4.7,
            // az5.3/gz0.2 — 한 축만 넘음)을 흘렸다. 쥔 채 리모컨의 실측 최대는 az2.1/gz3.2로 4 미만이라
            // **한 축이라도 z≥4면 폰버튼**(OR)으로 완화해도 리모컨과 안 겹친다(여유 얇음 — kbd 감지 시
            // 임계 6으로 상향하는 기존 방어 유지).
            if accHit || gyroHit { verdict = "폰버튼"; why = String(format: "az%.1f/%.3fg gz%.1f/%.2frad", az, ap, gz, gp) }
            else { why = String(format: "쥠·무스파이크 az%.1f gz%.1f", az, gz) }
          }
          // 🔴 2026-08-19 실기기("계속 손으로 넘어가") — 버튼을 꾹/연타하면 첫 접촉만 물리 충격이 있고
          // iOS 자동반복 이벤트들은 무충격이라 리모컨으로 새어 넘어갔다(로그: 폰버튼↔리모컨 0.5초 교차).
          // 충격으로 확정된 폰버튼 누름 후 600ms 내 눌림은 같은 손가락의 연속 입력으로 상속한다.
          // 리모컨 클릭은 애초에 충격 확정이 없어 이 상속의 기점이 될 수 없다(영향 없음).
          // 🔴 2026-08-19 00:38 실측("손 위치 바꾸니까 몇 개 넘어감") — 그립에 따라 누름 충격이 완전히
          // 흡수돼 센서 무신호(az0.2~3.3)인 경우가 존재 → 센서 한계. 행동 맥락으로 보완: 폰버튼 확정
          // 후 4초는 "볼륨 조절 행위 계속"으로 상속(볼륨 조절은 수 초간 연타하는 행위, 그 틈에 리모컨
          // 전환은 드묾. 샌 3건도 직전 폰버튼 3.2초 뒤라 이 창이면 커버). 900ms→4000ms.
          if verdict == "리모컨" && self.motionHeld && nowK - self.lastPhonePressAtMs < 1000 { // 2000→1000ms(2026-08-21 사장님 "그 버퍼 아냐" — 가림+볼륨 확정 경로가 생겨 보호 필요성 반감)
            verdict = "폰버튼"; why = "연속누름 상속 \(Int(nowK - self.lastPhonePressAtMs))ms"
          }
          if verdict == "폰버튼" { self.lastPhonePressAtMs = nowK }
          NSLog("PACEVOL cls=\(verdict) (\(why)) kbd=\(self.keyboardPresent) v=\(v)")
          if verdict == "폰버튼" {
            self.baseline = (v * 16).rounded() / 16 // 실제 볼륨 변경을 그대로 인정(하이재킹 없음)
            self.sendEvent("onSilentUnmute", ["source": "phonebutton"]) // 위 렌즈가림 분기와 동일한 이유
            return
          }
          let direction = v >= self.baseline ? "up" : "down"
          // 🔴 2026-08-19 사장님 확정("리모컨으로 볼륨 안 움직이기로 했는데") — 리모컨 판정 눌림은
          // **넘김만** 하고 볼륨은 baseline으로 원위치 복원한다(한 칸 반영하던 2026-08-18 동작 폐기).
          // 볼륨 조절은 폰 버튼(충격 판정 → 위 폰버튼 분기, 실제 볼륨 그대로 인정)이 담당.
          // emulatedZero(개입 시작 시 볼륨 0 클램프)는 상태만 유지·전달 — 눌림으로 바뀌지 않는다.
          NSLog("PACEVOL onVolumeButton(KVO) dir=\(direction) v=\(v) base유지=\(self.baseline) emu0=\(self.emulatedZero)") // 진단(테스트 후 제거)
          self.sendEvent("onVolumeButton", ["direction": direction, "emulatedZero": self.emulatedZero])
          self.setSystemVolume(self.baseline)
        }

        // ── 방식 B: MPRemoteCommandCenter — 에어팟/버즈 등 AVRCP 전송버튼(next/prev)을 추가로 잡음(하이브리드) ──
        // YouTube WKWebView가 전송명령을 선점하면 그냥 안 불릴 뿐이라 방식 A엔 무해(둘 중 하나라도 잡히면 됨).
        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        if self.nextTarget == nil {
          self.nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
            guard self?.engaged == true else { return .success } // 개입 전엔 무시(무장만)
            NSLog("PACEVOL onVolumeButton(MRC) next") // 진단(테스트 후 제거)
            self?.sendEvent("onVolumeButton", ["direction": "up"])
            return .success
          }
        }
        if self.prevTarget == nil {
          self.prevTarget = center.previousTrackCommand.addTarget { [weak self] _ in
            guard self?.engaged == true else { return .success } // 개입 전엔 무시(무장만)
            NSLog("PACEVOL onVolumeButton(MRC) prev") // 진단(테스트 후 제거)
            self?.sendEvent("onVolumeButton", ["direction": "down"])
            return .success
          }
        }
        // 2026-08-18 사장님 지적("아니 그럼 무음에서 소리가 나잖아") — 볼륨 0에서 클램프하면 1칸
        // 소리가 나는 문제. 클램프 사실을 JS에 알려주면 JS가 영상 자체를 muted로 잠가 "소리는 0
        // 그대로 + 눌림 감지는 가능" 둘 다 만족시킨다(이 앱의 유일한 소리원이 영상이므로).
        promise.resolve(["clampedFromZero": false]) // 무장 단계 — 클램프는 setEngaged(true)가 한다
      }
    }

    // 개입 on/off — 포커스 세션 토글에 맞춰 하이재킹만 켜고 끈다(감시 인프라는 start/stop이 관리).
    AsyncFunction("setEngaged") { (on: Bool, promise: Promise) in
      DispatchQueue.main.async {
        if on {
          // 세션 활성화는 여기서(위 무장 주석) — iOS18 stale 볼륨 버그 대비, 활성화 "전"에 현재 볼륨을 읽는다.
          let cur = self.session.outputVolume
          self.remoteActive = true
          self.ensureSessionActive()
          if self.volumeView == nil { // 개입 동안만 존재(무장 중엔 시스템 볼륨 HUD를 가리지 않도록)
            let mv = MPVolumeView(frame: CGRect(x: -3000, y: -3000, width: 1, height: 1))
            Self.topWindow()?.addSubview(mv)
            self.volumeView = mv
          }
          var base = (cur * 16).rounded() / 16
          self.emulatedZero = base < 0.03
          if base < 0.0625 { base = 0.0625 }
          if base > 0.9375 { base = 0.9375 }
          self.baseline = base
          self.setSystemVolume(self.baseline)
          self.engaged = true
          NSLog("PACEVOL engage ON — baseline=\(self.baseline) (현재볼륨 \(cur), emulatedZero=\(self.emulatedZero))")
          promise.resolve(["clampedFromZero": cur < 0.03])
        } else {
          self.engaged = false
          if self.emulatedZero { // 가상 0인 채 개입 종료 → 사용자 의도(무음)대로 진짜 0 복원
            if let slider = self.volumeView?.subviews.compactMap({ $0 as? UISlider }).first {
              slider.value = 0
            }
            self.emulatedZero = false
          }
          self.remoteActive = false
          self.deactivateSessionIfIdle() // 개입 종료 = 세션도 반납(무음스위치 감지 등 기존 경로 원복)
          let mvToRemove = self.volumeView // HUD 정상화(위 주석) — 값 전파 시간을 주고 0.3초 뒤 제거
          self.volumeView = nil
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { mvToRemove?.removeFromSuperview() }
          NSLog("PACEVOL engage OFF")
          promise.resolve(["clampedFromZero": false])
        }
      }
    }

    Function("stop") {
      self.observer?.invalidate()
      self.observer = nil
      let center = MPRemoteCommandCenter.shared()
      if let t = self.nextTarget { center.nextTrackCommand.removeTarget(t); self.nextTarget = nil }
      if let t = self.prevTarget { center.previousTrackCommand.removeTarget(t); self.prevTarget = nil }
      DispatchQueue.main.async {
        // 가상 0 상태로 세션을 끝냈으면 진짜 0으로 되돌린다(사용자 의도가 무음이었으므로). 그 외엔
        // 세션 중 사용자가 볼륨키로 만든 볼륨이 곧 최종 볼륨이라 아무것도 안 건드린다. volumeView
        // 제거 "전"에 동기로 슬라이더에 쓰고, 값이 시스템에 전파될 시간을 주기 위해 제거는 0.3초 뒤.
        if self.emulatedZero {
          if let slider = self.volumeView?.subviews.compactMap({ $0 as? UISlider }).first {
            slider.value = 0
          }
          self.emulatedZero = false
        }
        let mvToRemove = self.volumeView
        self.volumeView = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          mvToRemove?.removeFromSuperview()
        }
        // 2026-08-07 사용자 지적("무음일 때 쇼츠 소리가 왜 나, 유튜브랑 정책 맞추라고") — 예전엔 이 stop()이
        // 세션 카테고리를 원래대로 안 되돌려서, 리모컨(opt-in, 기본 OFF)을 단 한 번이라도 켰다 껐으면 그
        // 뒤로 앱이 살아있는 내내 무음 스위치가 무시됐다. 2026-08-08 — startSilentUnmuteWatch(항상 켜짐)와
        // 세션을 공유하게 되며 무조건 되돌리면 그 watch를 밟으므로, 둘 다 꺼졌을 때만 되돌린다.
        self.remoteActive = false
        self.stopMotion()
        self.deactivateSessionIfIdle()
      }
    }

    // 무음스위치가 지금 켜져 있는지(=무음 모드인지) 감지. true=무음, false=무음 아님. 위 클래스 주석의
    // 0.2초 타이밍 트릭 — WKWebView 자체는 이 스위치를 못 보므로(플랫폼 버그), 매번 직접 재는 수밖에
    // 없다. 호출부(JS)가 주기적으로 불러 video.muted를 그 결과에 맞춰 강제한다.
    AsyncFunction("checkSilentSwitch") { (promise: Promise) in
      DispatchQueue.main.async {
        // 동시 호출 방지 — 이전 체크가 아직 안 끝났으면 무시(JS가 폴링 주기를 짧게 잡아도 안전).
        if self.muteCheckPending != nil { promise.resolve(false); return }
        if self.muteCheckSoundId == 0 {
          guard let url = Bundle.main.url(forResource: "mute_check", withExtension: "caf") else {
            promise.resolve(false); return // 파일이 번들에 없으면 항상 "무음 아님"으로 안전하게 폴백
          }
          var soundId: SystemSoundID = 0
          AudioServicesCreateSystemSoundID(url as CFURL, &soundId)
          self.muteCheckSoundId = soundId
        }
        self.muteCheckPending = promise
        self.muteCheckStartedAt = CACurrentMediaTime()
        AudioServicesPlaySystemSoundWithCompletion(self.muteCheckSoundId) { [weak self] in
          guard let self = self else { return }
          DispatchQueue.main.async {
            let elapsed = CACurrentMediaTime() - self.muteCheckStartedAt
            let isMuted = elapsed < 0.19 // 0.2초 파일보다 확실히 빠르면 무음(여유 10ms — 콜백 디스패치 지연 흡수)
            // 2026-08-18(밤) 진단 — "왜 소리가 안 나" 추적: 판정이 바뀔 때만 1줄(2초 폴링 스팸 방지).
            if isMuted != self.lastMuteVerdict {
              self.lastMuteVerdict = isMuted
              NSLog("PACEVOL silentCheck 판정변경 → \(isMuted ? "무음(스위치ON 추정)" : "소리남") elapsed=\(Int(elapsed * 1000))ms")
            }
            self.muteCheckPending?.resolve(isMuted)
            self.muteCheckPending = nil
          }
        }
      }
    }

    // 2026-08-08 — "무음으로 시작해도 볼륨키를 누르면 소리 나야 한다" 감지. 리모컨(start/stop)과 달리
    // opt-in 토글과 무관하게 Shorts 재생 중엔 항상 켜둔다(JS쪽에서 playing일 때 호출). 볼륨을 되돌리지
    // 않고(진짜 볼륨 조절이 목적) 변화 자체만 "무음 해제" 신호로 보고한다.
    Function("startSilentUnmuteWatch") {
      DispatchQueue.main.async {
        if self.unmuteWatchActive { return }
        self.unmuteWatchActive = true
        self.installInterruptObserversIfNeeded() // 광고 인터럽션 복구(리모컨 토글 무관 — 위 헬퍼 주석)
        self.ensureSessionActive()
        self.unmuteBaselineVolume = self.session.outputVolume
        self.unmuteObserver = self.session.observe(\.outputVolume, options: [.new]) { [weak self] s, _ in
          guard let self = self else { return }
          let v = s.outputVolume
          if abs(v - self.unmuteBaselineVolume) < 0.01 { return } // 노이즈/리모컨 리셋 왕복 흡수
          // 2026-08-18 — 리모컨 세션의 클램프/리셋(우리가 프로그램적으로 baseline에 맞춘 것)은 사용자
          // 눌림이 아니다. 이걸 "무음 해제 신호"로 오인하면 볼륨 0으로 두고 포커스 켠 사용자의 무음이
          // 풀린다 — remoteActive 중 baseline과 같은 스텝으로의 변경은 무시.
          if self.remoteActive && abs(v - self.baseline) < 0.03 {
            self.unmuteBaselineVolume = v
            return
          }
          self.unmuteBaselineVolume = v
          NSLog("PACEVOL onSilentUnmute v=\(v)") // 진단(테스트 후 제거)
          self.sendEvent("onSilentUnmute", [:])
        }
      }
    }

    Function("stopSilentUnmuteWatch") {
      self.unmuteObserver?.invalidate()
      self.unmuteObserver = nil
      DispatchQueue.main.async {
        self.unmuteWatchActive = false
        self.deactivateSessionIfIdle()
      }
    }
  }

  private func setSystemVolume(_ value: Float) {
    guard let slider = self.volumeView?.subviews.compactMap({ $0 as? UISlider }).first else { return }
    DispatchQueue.main.async { slider.value = value }
    // 🔴 2026-08-18 사장님 실기기 재현("볼륨만큼만 이전으로 가고 그 뒤로 키 눌러도 안 됨", "볼륨 1이
    // 유지 안 되는 것 같은데") — 볼륨이 정확히 0으로 떨어진 직후의 슬라이더 복원(0→1/16)이 실기기에서
    // 간헐적으로 무시된다(볼륨 HUD 표시 중 MPVolumeView 세트가 씹히는 iOS 특성으로 추정). 복원이
    // 실패하면 바닥 감지 여지가 사라져 리모컨이 통째로 죽으므로, 250ms 뒤 실제 outputVolume을 재확인해
    // 어긋나 있으면 한 번 더 쓴다.
    // 🔴 2026-08-18(밤) 실기기 로그로 확정된 재앙 — 이 재시도가 **예약 당시의 낡은 value**를 쓰는 바람에,
    // 사용자가 연타로 baseline을 이동시킨 뒤 낡은 값으로 볼륨을 되돌렸고, 그 한 스텝 변화가 KVO에서
    // "반대 방향 버튼 눌림"으로 잡혀 위/아래 스와이프 무한 핑퐁이 났다(22:52:43~47 restore-retry→dir=up
    // →dir=down 반복, 사장님 "리모컨 키에 왜 영상이 계속 바껴"). 세대 카운터로 고친다: 새
    // setSystemVolume이 불리면 이전에 예약된 재시도는 전부 무효(최신 목표의 재시도만 산다).
    restoreGen += 1
    let gen = restoreGen
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      guard let self = self, gen == self.restoreGen else { return } // 더 새 목표가 생겼으면 이 재시도 폐기
      if abs(self.session.outputVolume - value) > 0.03,
         let s2 = self.volumeView?.subviews.compactMap({ $0 as? UISlider }).first {
        NSLog("PACEVOL restore-retry v=\(self.session.outputVolume) → \(value)")
        s2.value = value
      }
    }
  }
  private var restoreGen = 0

  // 2026-08-05 사장님 지시 — A2DP는 그 자체로 "볼륨"으로 판단하고(아래 isKnownAudioAccessoryConnected의
  // A2DP 조기 반환 참고 — 이름 대조 불필요, 프로파일 자체가 순수 오디오 전용이라 리모컨일 수가 없음),
  // HFP/LE는 통화용·범용이라 리모컨과 섞일 여지가 있어 이름 화이트리스트로 한 번 더 좁힌다.
  // portName은 "eileen's AirPods Pro"처럼 소유자명이 붙어 나와서 정확히 일치가 아니라 부분일치로 비교.
  private static let KNOWN_AUDIO_BRANDS = [
    "airpods", "beats", "galaxy buds", "buds", "jbl", "bose", "sony", "soundcore",
    "anker", "powerbeats", "echo", "sonos",
  ]

  // 지금 연결된 오디오 기기가 "유명 브랜드"인지 3중으로 확인한다. 단일 조건 하나만 보면 놓치는
  // 경우가 있어서 겹겹이 확인한다:
  //  ① 포트 타입 — A2DP(음악 스트리밍)/HFP(통화)/LE(블루투스 LE 오디오, 최신 에어팟·이어폰류)까지
  //     블루투스 오디오 프로파일 전부를 본다. HFP·LE만 쓰는 기기를 A2DP만 보면 놓친다.
  //  ② 포트 이름 — portName을 화이트리스트(에어팟/버즈/JBL 등)와 대조. 브랜드 확인의 핵심 신호.
  //  ③ 라우트 방향 — outputs(재생)뿐 아니라 inputs(마이크)도 같이 본다. HFP는 통화용이라 기기에 따라
  //     이 순간 마이크 쪽(inputs)에만 잡히고 outputs엔 아직 안 잡히는 상태가 있을 수 있다 — outputs만
  //     보면 그 찰나에 놓친다.
  // AVAudioSession은 여전히 "이 볼륨 버튼이 어디서 눌렸는지"는 안 알려준다(리서치로 확인됨, 완전히
  // 별개 체계) — 그래서 이건 확정적 판별이 아니라 휴리스틱이다. 세 조건을 다 만족하는 유명 브랜드
  // 오디오 기기가 연결돼 있으면, 그 기기 자체엔 물리 볼륨버튼이 없거나(에어팟) 있어도 눌렀다면 진짜
  // 볼륨 의도인 경우(비츠 인라인 리모컨 등)라 하이재킹을 건너뛴다.
  private static let BT_AUDIO_PORT_TYPES: Set<AVAudioSession.Port> = [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE]

  private func isKnownAudioAccessoryConnected() -> Bool {
    let route = session.currentRoute
    let ports = route.outputs + route.inputs
    for port in ports {
      // 2026-08-05 사장님 지시 — A2DP는 이름 대조 없이 그 자체로 충분하다. A2DP는 "고음질 스트리밍
      // 전용" 프로파일이라 그 카테고리 자체에 리모컨 성격(HID 버튼)이 섞일 수가 없다(HFP는 통화용이라
      // 일부 기기가 인라인 컨트롤을 같이 얹기도 하지만, A2DP 전용 기기는 구조적으로 순수 오디오 전용).
      // 그래서 이름 모를 A2DP 기기여도 화이트리스트 없이 바로 볼륨으로 판단한다.
      if port.portType == .bluetoothA2DP { return true }
      guard Self.BT_AUDIO_PORT_TYPES.contains(port.portType) else { continue }
      let name = port.portName.lowercased()
      if Self.KNOWN_AUDIO_BRANDS.contains(where: { name.contains($0) }) { return true }
    }
    return false
  }

  private static func topWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.flatMap { $0.windows }.first
  }
}
