import ExpoModulesCore
import CoreMotion
import AVFoundation
import QuartzCore

// Pace iOS 취침 감지 프리미티브 (스펙 §4-B, 2026-07-24). CMMotionManager userAcceleration(중력 제거된
// 순수 움직임)로 "마지막 움직임 이후 경과"를 재고, AVAudioSession 라우트 변경으로 이어폰/블루투스
// 탈착을 알린다. 몇 분을 재울지 판단은 JS(useSleepGuard)가 소유 — native는 raw 신호만 제공.
//
// iOS엔 OS 레벨 sleep/wake API가 없어(Apple 포럼 확인) userAcceleration 무진동이 정석. background로 가면
// CoreMotion이 끊기므로 "포그라운드에서 잠든" 케이스만 감지(정직한 설계 — 피드 시청 중 잠드는 케이스가 대상).
//
// 🔒 스레드 안전(pace-flip과 동일 원칙): 모션 콜백(백그라운드 큐) ↔ millisSinceMotion(JS 스레드) ↔
//    start/stop이 lastMotionAt을 공유 → lock 직렬화, 콜백 큐 직렬(1), 이벤트는 메인 스레드 발신.
public class PaceSleepModule: Module {
  private let motion = CMMotionManager()
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
  private let MOTION_EPSILON = 0.03

  public func definition() -> ModuleDefinition {
    Name("PaceSleep")
    Events("onAudioRouteLost")

    // 마지막 움직임 이후 경과(ms). 관찰 중이 아니면 0(JS가 "정지 시간"으로 판단).
    Function("millisSinceMotion") { () -> Double in
      self.lock.lock(); defer { self.lock.unlock() }
      guard self.observing else { return 0 }
      return max(0, (CACurrentMediaTime() - self.lastMotionAt) * 1000.0)
    }

    AsyncFunction("start") { (promise: Promise) in
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
      self.lock.unlock()

      self.motion.deviceMotionUpdateInterval = 0.5 // 2Hz — 무진동 판정엔 충분, 배터리 절약
      self.motion.startDeviceMotionUpdates(to: self.queue) { [weak self] data, _ in
        guard let self = self, let a = data?.userAcceleration else { return }
        let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
        if mag > self.MOTION_EPSILON {
          self.lock.lock()
          self.lastMotionAt = CACurrentMediaTime()
          self.lock.unlock()
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
          self.sendEvent("onAudioRouteLost", [:]) // 이미 .main 큐
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
