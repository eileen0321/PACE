import ExpoModulesCore
import CoreMotion
import QuartzCore

// Pace iOS Flip Mode (스펙 §4-A, 2026-07-23). CMMotionManager로 기기를 엎어놓았는지(face-down) 감지해
// "내려놓은 시간(쉬는 시간)"을 측정할 수 있게 onFlip 이벤트를 쏜다.
//
// gravity.z 좌표: 기기 z축은 화면에서 밖(사용자 쪽)을 향한다.
//  - 화면이 위(테이블에 face-up): 중력이 기기 뒤로 향함 → gravity.z ≈ -1
//  - 화면이 아래(테이블에 face-down, "엎어놓음"): 중력이 화면 쪽으로 → gravity.z ≈ +1
// 따라서 face-down = gravity.z > 0.8. 손떨림/이동 중 순간값 오탐을 막으려고 "그 상태가 일정시간
// 유지"돼야만 상태 전이(엎어놓기 2s / 집어들기 1s)한다.
//
// ⚠️ 앱이 백그라운드로 가면 CoreMotion 업데이트가 끊긴다(iOS 플랫폼 제약) — JS 쪽 useFlipStore가
//    AppState와 조합해 "포그라운드에서 엎어놓은 순간 ~ 다시 켜서 집어든 순간"으로 실경과를 보정한다.
public class PaceFlipModule: Module {
  private let motion = CMMotionManager()
  private let queue = OperationQueue()

  private var faceDown = false
  private var candidateSince: CFTimeInterval = -1 // 현재 확정 상태의 "반대"가 시작된 시각(-1=후보 없음)
  private var lastZ: Double = 0                    // 최신 gravity.z 샘플(즉시 물리상태 조회용)
  private var hasSample = false                    // 첫 샘플 도착 여부(start 직후 stale 조회 방지)
  private let FACE_DOWN_THRESHOLD = 0.8
  private let FACE_UP_THRESHOLD = 0.5
  private let DOWN_HOLD: CFTimeInterval = 2.0 // 엎어놓기 확정까지 유지 시간
  private let UP_HOLD: CFTimeInterval = 1.0   // 집어들기 확정까지 유지 시간

  public func definition() -> ModuleDefinition {
    Name("PaceFlip")
    Events("onFlip")

    // 디바운스 확정된 상태(관찰 중일 때만 유효).
    Function("isFaceDown") { () -> Bool in
      return self.faceDown
    }

    // 디바운스 없이 "지금 이 순간 물리적으로 엎어져 있나"를 최신 샘플로 즉시 판정.
    // background 복귀 후 재조율(그동안 집어들었는지)에 사용. 아직 샘플 없으면 nil.
    Function("physicalFaceDown") { () -> Bool? in
      guard self.hasSample else { return nil }
      return self.lastZ > self.FACE_DOWN_THRESHOLD
    }

    AsyncFunction("start") { (promise: Promise) in
      guard self.motion.isDeviceMotionAvailable else {
        promise.resolve(nil)
        return
      }
      // 이미 관찰 중이면 중복 start 방지(핸들러 이중 등록 차단).
      if self.motion.isDeviceMotionActive {
        self.motion.stopDeviceMotionUpdates()
      }
      self.faceDown = false
      self.candidateSince = -1
      self.hasSample = false
      self.motion.deviceMotionUpdateInterval = 0.2 // 5Hz — 반응성/배터리 균형
      self.motion.startDeviceMotionUpdates(to: self.queue) { [weak self] data, _ in
        guard let self = self, let z = data?.gravity.z else { return }
        self.lastZ = z
        self.hasSample = true
        let now = CACurrentMediaTime()
        // 확정 상태의 "반대"를 감지 중인가? (down 확정이면 up 후보, up 확정이면 down 후보)
        let oppositeNow = self.faceDown ? (z < self.FACE_UP_THRESHOLD) : (z > self.FACE_DOWN_THRESHOLD)
        let hold = self.faceDown ? self.UP_HOLD : self.DOWN_HOLD
        if oppositeNow {
          if self.candidateSince < 0 {
            self.candidateSince = now
          } else if now - self.candidateSince >= hold {
            self.faceDown.toggle()
            self.candidateSince = -1
            self.sendEvent("onFlip", ["faceDown": self.faceDown])
          }
        } else {
          self.candidateSince = -1 // 후보 상태가 흔들리면 리셋
        }
      }
      promise.resolve(nil)
    }

    Function("stop") {
      self.motion.stopDeviceMotionUpdates()
      self.faceDown = false
      self.candidateSince = -1
    }
  }
}
