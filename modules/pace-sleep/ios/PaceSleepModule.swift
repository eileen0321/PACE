import ExpoModulesCore
import CoreMotion
import AVFoundation
import UIKit

// Pace iOS 취침 감지 프리미티브 (스펙 §4-B). 2026-08-04 안드로이드 2단계 재설계(PaceOverlayService.kt
// evaluateSleepStages, 커밋 c6481e4/1917234) 패리티 포팅 — "폰이 안 움직임"(가속도계) 축을 폐기하고
// "사용자 입력 부재"를 판정 주 축으로 옮겼다(이유는 useSleepGuard.ios.ts 참고, 거기가 새 상태기계를
// 소유). native는 그 판정에 필요한 raw 보조신호 3개만 제공한다:
//  - gravityZ(): 기기가 눕혀졌는가(중력 Z축). Android TYPE_GRAVITY와 동등, deviceMotion.gravity 재사용.
//  - isCharging(): 충전 중인가(UIDevice.batteryState).
//  - onAudioRouteLost: 이어폰/블루투스 탈착(AVAudioSession 라우트 변경) — Android의 BT 탈착 보조신호와 동등.
// ⚠️ Android는 조도(TYPE_LIGHT)도 보조신호로 쓰지만 iOS엔 서드파티 앱이 쓸 수 있는 공개 주변광 센서
// API가 없다(private API만 존재, 심사 리스크) — 그 신호는 포팅하지 않는다. 나머지 3개 중 1개 이상이면
// 확정하는 Android 규칙(4개 중 1개 이상)을 3개 기준으로 그대로 유지 — "몇 개 중 1개"의 정신은 같다.
//
// 판정 타이머(무입력 경과, 단계 전이, 팝업 타임아웃)는 전부 JS(useSleepGuard.ios.ts)가 소유한다 —
// 사용자 입력 이벤트(탭/스와이프/손짓/볼륨키) 자체가 JS(feed/index.tsx)에서 발생하므로 그쪽이
// "마지막 입력 시각"의 소스오브트루스를 갖는 게 자연스럽다(Android는 반대로 네이티브가 세션 전체를
// 포그라운드서비스로 들고 있어 네이티브가 판정 주체 — 플랫폼 아키텍처 차이, 결과 동작은 동일).
//
// 🔒 스레드 안전(pace-flip과 동일 원칙): 모션 콜백(백그라운드 큐) ↔ gravityZ()(JS 스레드)가 lastGravityZ를
//    공유 → lock 직렬화, 콜백 큐 직렬(1), 이벤트는 메인 스레드 발신.
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
  private var routeObserver: NSObjectProtocol?
  // 중력 Z축(단위 벡터, G) — deviceMotion.gravity에서 매 콜백 갱신. "기기가 눕혀졌는가"만 보므로
  // Android의 TYPE_LINEAR_ACCELERATION 움직임-크기 감지와 달리 거치대/책상 오탐과 무관하다.
  private var lastGravityZ: Double = 0

  public func definition() -> ModuleDefinition {
    Name("PaceSleep")
    Events("onAudioRouteLost")

    // 마지막으로 관측된 중력 Z축(G, -1..1). 관찰 중이 아니면 0. |값| >= SLEEP_FLAT_GRAVITY_RATIO
    // (useSleepGuard.ios.ts, Android SLEEP_FLAT_GRAVITY_Z=7.5/9.81의 비율 환산)면 "눕혀짐"으로 판정.
    Function("gravityZ") { () -> Double in
      self.lock.lock(); defer { self.lock.unlock() }
      return self.observing ? self.lastGravityZ : 0
    }

    // 충전 중인가 — Android의 isCharging()(BatteryManager)과 동등한 보조 신호. 별도 권한 불필요.
    Function("isCharging") { () -> Bool in
      let state = UIDevice.current.batteryState
      return state == .charging || state == .full
    }

    // 백그라운드 수면 감지(방법 B) — sinceEpochMs(세션 시작)부터 지금까지 모션활동 이력을 조회해,
    // "가장 긴 연속 stationary 구간"(>= minStationaryMs)의 시작 시각(epoch ms)을 반환. 없으면 null.
    // 앱이 밤새 죽어도 보조프로세서 이력이 남아 "몇시부터 계속 정지=잠든 시각"을 아침에 산출할 수 있다.
    AsyncFunction("queryStationaryOnset") { (sinceEpochMs: Double, minStationaryMs: Double, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else { promise.resolve(nil); return }
      // Motion & Fitness 미허용이면 이력이 안 와 조용히 실패 → 그냥 nil(앱 사용엔 지장 없음). NSMotionUsageDescription은 존재.
      let auth = CMMotionActivityManager.authorizationStatus()
      guard auth == .authorized || auth == .notDetermined else { promise.resolve(nil); return }
      let to = Date()
      // 활동 이력은 7일만 보관(그 이전은 데이터 없음) → from을 max(요청, now-7d)로 클램프.
      let earliest = to.addingTimeInterval(-7 * 24 * 3600)
      let requested = Date(timeIntervalSince1970: sinceEpochMs / 1000.0)
      let from = requested < earliest ? earliest : requested
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
          // 첫 세그먼트는 from 이전에 시작된 활동일 수 있어 startDate가 from보다 과거일 수 있다 → from으로 클램프
          // (잠든 시각이 세션 시작 전으로 기록되지 않게).
          let onset = max(s, from)
          promise.resolve(onset.timeIntervalSince1970 * 1000.0) // 잠든 시각(epoch ms)
        } else {
          promise.resolve(nil)
        }
      }
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
      self.lastGravityZ = 0
      self.lock.unlock()

      UIDevice.current.isBatteryMonitoringEnabled = true

      self.motion.deviceMotionUpdateInterval = 0.5 // 2Hz — 분 단위 판정이라 초 단위 정밀도 불필요, 배터리 절약
      self.motion.startDeviceMotionUpdates(to: self.queue) { [weak self] data, _ in
        guard let self = self, let gravity = data?.gravity else { return }
        self.lock.lock()
        self.lastGravityZ = gravity.z
        self.lock.unlock()
      }

      // 오디오 라우트 변경 관찰 — 이어폰/블루투스가 빠지면(.oldDeviceUnavailable) 보조 신호 발신.
      // 판정 자체(무입력 경과·단계 전이·타임아웃)는 JS가 소유하므로 여기선 그대로 전달만 한다.
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
      UIDevice.current.isBatteryMonitoringEnabled = false
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
      UIDevice.current.isBatteryMonitoringEnabled = false
    }
  }
}
