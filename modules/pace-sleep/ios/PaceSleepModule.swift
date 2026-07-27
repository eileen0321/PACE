import ExpoModulesCore
import CoreMotion
import AVFoundation
import QuartzCore

// Pace iOS 취침 감지 프리미티브 (스펙 §4-B, 2026-07-24). CMMotionManager userAcceleration(중력 제거된
// 순수 움직임)로 "마지막 움직임 이후 경과"를 재고, AVAudioSession 라우트 변경으로 이어폰/블루투스
// 탈착을 알린다. 몇 분을 재울지 판단은 JS(useSleepGuard)가 소유 — native는 raw 신호만 제공.
//
// iOS엔 OS 레벨 sleep/wake API가 없어(Apple 포럼 확인) userAcceleration 무진동이 정석.
// 2026-07-28 사장님 결정 — 무진동 "판정"을 여기 네이티브로 내렸다(이전엔 JS setInterval이 판정했는데
// JS 타이머는 백그라운드에서 throttle되고 AppState 가드에 막혀 "화면 켜고 조는" 경우만 잡혔다 → 실제 수면
// (전원 끄고 잠)은 0건이었음). 피드가 영상 오디오를 백그라운드 재생하는 동안엔 앱이 살아있어 CoreMotion
// 콜백(0.5s)이 계속 오므로, 그 콜백에서 무진동이 임계값을 넘으면 onSleepDetected를 발신 → 화면이 꺼져도 감지.
//
// 🔒 스레드 안전(pace-flip과 동일 원칙): 모션 콜백(백그라운드 큐) ↔ millisSinceMotion(JS 스레드) ↔
//    start/stop이 lastMotionAt을 공유 → lock 직렬화, 콜백 큐 직렬(1), 이벤트는 메인 스레드 발신.
public class PaceSleepModule: Module {
  private let motion = CMMotionManager()
  // 백그라운드 수면 감지용(방법 B, 2026-07-28 사장님 결정 — 리서치로 A안[백그라운드 오디오+CMMotionManager]이
  // iOS26 불안정+배터리↑+심사리스크로 확인돼 전환). 모션 "보조프로세서"가 stationary/walking 등 활동을 시스템
  // 차원에서 항상 저압 기록 → 앱이 밤새 죽어도 아침에 이력을 조회해 "언제부터 계속 정지(=잠듦)"를 산출한다.
  // CMMotionManager(실시간, 포그라운드 "보다 조는" 케이스)와 상호보완: 이건 백그라운드/재개용.
  private let activityManager = CMMotionActivityManager()
  private let activityQueue: OperationQueue = {
    let q = OperationQueue(); q.maxConcurrentOperationCount = 1; q.name = "com.pace.sleep.activity"; return q
  }()
  private let queue: OperationQueue = {
    let q = OperationQueue()
    q.maxConcurrentOperationCount = 1
    q.name = "com.pace.sleep.motion"
    return q
  }()
  private let lock = NSLock()

  private var observing = false
  private var lastMotionAt: CFTimeInterval = 0 // 마지막 "의미있는 움직임" 시각(CACurrentMediaTime)
  private var routeObserver: NSObjectProtocol?
  // userAcceleration 크기(g) 임계값 — 이 이상이면 "움직임"으로 보고 타이머 리셋. 호흡에 의한 미세운동
  // (~0.01~0.02g)은 넘고, 깨어서 스크롤할 때(>0.05g)는 확실히 넘게 0.03으로 잡음(센서 노이즈 ~0.01 위).
  // 2026-07-26 안드로이드 파리티: 안드는 TYPE_LINEAR_ACCELERATION에 1.0 m/s²(≈0.102 G)를 쓰는데 iOS는
  // 0.03 G라 3.4배 더 민감 → 작은 움직임에도 무진동 타이머가 리셋돼 "잠듦" 판정이 안드보다 훨씬 어려웠다.
  // 안드와 동일 민감도로 맞춘다(1.0 m/s² ÷ 9.81 ≈ 0.10 G). userAcceleration은 G 단위.
  private let MOTION_EPSILON = 0.10

  // 무진동 "판정"용 상태(모두 lock으로 보호). start()에서 JS가 넘긴 임계값을 받아 콜백에서 검사한다.
  private var stillnessMs: Double = 0     // 기본 임계값(ms)
  private var shortMs: Double = 0         // 오디오 라우트 끊김 후 단축 임계값(ms)
  private var audioLost = false           // 이어폰/BT 탈착 보조신호 → 임계값 단축
  private var fired = false               // 1회성 — 감지 후 재발신 방지(stop/재start 전까지)

  public func definition() -> ModuleDefinition {
    Name("PaceSleep")
    // onSleepDetected: 무진동이 임계값 초과 → {stillMs}(무진동 지속시간)와 함께 발신. JS는 Date.now()-stillMs로
    // "실제 잠든 시각"을 계산해 DB ended_at에 기록. (CACurrentMediaTime은 단조시계라 벽시계 변환은 JS에서.)
    Events("onAudioRouteLost", "onSleepDetected")

    // 마지막 움직임 이후 경과(ms). 관찰 중이 아니면 0(JS가 "정지 시간"으로 판단).
    Function("millisSinceMotion") { () -> Double in
      self.lock.lock(); defer { self.lock.unlock() }
      guard self.observing else { return 0 }
      return max(0, (CACurrentMediaTime() - self.lastMotionAt) * 1000.0)
    }

    // 백그라운드 수면 감지(방법 B) — sinceEpochMs(세션 시작)부터 지금까지 모션활동 이력을 조회해,
    // "가장 긴 연속 stationary 구간"(>= minStationaryMs)의 시작 시각(epoch ms)을 반환. 없으면 null.
    // 앱이 밤새 죽어도 보조프로세서 이력이 남아 "몇시부터 계속 정지=잠든 시각"을 아침에 산출할 수 있다.
    AsyncFunction("queryStationaryOnset") { (sinceEpochMs: Double, minStationaryMs: Double, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else { promise.resolve(nil); return }
      let from = Date(timeIntervalSince1970: sinceEpochMs / 1000.0)
      let to = Date()
      guard to > from else { promise.resolve(nil); return }
      self.activityManager.queryActivityStarting(from: from, to: to, to: self.activityQueue) { activities, error in
        guard error == nil, let acts = activities, !acts.isEmpty else { promise.resolve(nil); return }
        // 각 원소는 "활동이 바뀐 시점"(startDate). 세그먼트 i의 지속 = acts[i+1].startDate - acts[i].startDate,
        // 마지막 세그먼트는 to까지. confidence=.low는 노이즈라 정지로 안 침. 연속 stationary 런 중 최장을 고른다.
        var bestStart: Date? = nil
        var bestDur: TimeInterval = 0
        var runStart: Date? = nil
        var runEnd: Date? = nil
        func flush() {
          if let s = runStart, let e = runEnd, e.timeIntervalSince(s) > bestDur {
            bestDur = e.timeIntervalSince(s); bestStart = s
          }
          runStart = nil; runEnd = nil
        }
        for (i, a) in acts.enumerated() {
          let segEnd = (i + 1 < acts.count) ? acts[i + 1].startDate : to
          if a.stationary && a.confidence != .low {
            if runStart == nil { runStart = a.startDate }
            runEnd = segEnd
          } else {
            flush()
          }
        }
        flush()
        if let s = bestStart, bestDur * 1000.0 >= minStationaryMs {
          promise.resolve(s.timeIntervalSince1970 * 1000.0) // 잠든 시각(epoch ms)
        } else {
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("start") { (stillnessMs: Double, shortMs: Double, promise: Promise) in
      guard self.motion.isDeviceMotionAvailable else {
        promise.resolve(nil)
        return
      }
      if self.motion.isDeviceMotionActive {
        self.motion.stopDeviceMotionUpdates()
        self.queue.cancelAllOperations()
      }
      self.lock.lock()
      self.observing = true
      self.lastMotionAt = CACurrentMediaTime() // 시작 시점은 "방금 움직임 있음"으로 초기화
      self.stillnessMs = stillnessMs
      self.shortMs = shortMs > 0 ? shortMs : stillnessMs
      self.audioLost = false
      self.fired = false
      self.lock.unlock()

      self.motion.deviceMotionUpdateInterval = 0.5 // 2Hz — 무진동 판정엔 충분, 배터리 절약
      self.motion.startDeviceMotionUpdates(to: self.queue) { [weak self] data, _ in
        guard let self = self, let a = data?.userAcceleration else { return }
        let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
        let now = CACurrentMediaTime()
        self.lock.lock()
        if mag > self.MOTION_EPSILON {
          self.lastMotionAt = now // 움직임 → 무진동 타이머 리셋
        }
        // 무진동 판정을 여기서(콜백은 백그라운드 오디오 재생 중에도 0.5s마다 옴 → 화면 꺼져도 감지).
        let stillMs = (now - self.lastMotionAt) * 1000.0
        let threshold = self.audioLost ? self.shortMs : self.stillnessMs
        let shouldFire = self.observing && !self.fired && threshold > 0 && stillMs >= threshold
        if shouldFire { self.fired = true }
        self.lock.unlock()
        if shouldFire {
          // 이벤트는 메인 스레드에서 발신(Expo 규약). stillMs를 넘겨 JS가 벽시계 잠든 시각으로 환산.
          DispatchQueue.main.async { self.sendEvent("onSleepDetected", ["stillMs": stillMs]) }
        }
      }

      // 오디오 라우트 변경 관찰 — 이어폰/블루투스가 빠지면(.oldDeviceUnavailable) 보조 신호 발신.
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
      ) { [weak self] note in
        guard let self = self else { return }
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if reason == .oldDeviceUnavailable {
          self.lock.lock(); self.audioLost = true; self.lock.unlock() // 임계값 단축(네이티브 판정에 반영)
          self.sendEvent("onAudioRouteLost", [:]) // 이미 .main 큐(JS 로깅/보조용)
        }
      }
      promise.resolve(nil)
    }

    Function("stop") {
      self.motion.stopDeviceMotionUpdates()
      self.queue.cancelAllOperations()
      if let obs = self.routeObserver {
        NotificationCenter.default.removeObserver(obs)
        self.routeObserver = nil
      }
      self.lock.lock()
      self.observing = false
      self.lock.unlock()
    }

    OnDestroy {
      self.motion.stopDeviceMotionUpdates()
      self.queue.cancelAllOperations()
      if let obs = self.routeObserver {
        NotificationCenter.default.removeObserver(obs)
        self.routeObserver = nil
      }
    }
  }
}
