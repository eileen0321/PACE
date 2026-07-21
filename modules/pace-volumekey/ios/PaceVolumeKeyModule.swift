import ExpoModulesCore
import AVFoundation
import MediaPlayer
import UIKit

// Pace iOS 볼륨키 리모컨 (2026-07-21 사용자 지시 (2)(3)).
// 시스템 출력 볼륨(AVAudioSession.outputVolume)을 KVO로 관찰 → 볼륨 버튼(에어팟/버즈/다이소 BT 리모컨)이
// 눌리면 실제 볼륨을 바꾸지 않고 "onVolumeButton" 이벤트만 쏜다(→ RN이 다음 Short로 넘김).
//
// 방식: 볼륨이 변할 때마다 방향(up/down)을 판정해 이벤트를 보내고, 화면 밖 MPVolumeView 슬라이더로
// 볼륨을 다시 baseline(0.5)으로 되돌려 다음 눌림도 계속 감지되게 한다(0/1 천장에 걸리지 않게).
// 내가 되돌린 것 때문에 생기는 KVO 콜백은 ignoreNext 플래그로 건너뛴다.
//
// ⚠️ 시뮬레이터엔 물리 볼륨 버튼이 없어 검증 불가 → 실기기 필요. MPVolumeView 슬라이더 접근은 iOS
//    버전별로 취약할 수 있어 실기기 튜닝 여지 있음(핵심 개념=outputVolume KVO는 안정적).
public class PaceVolumeKeyModule: Module {
  private let session = AVAudioSession.sharedInstance()
  private var observer: NSKeyValueObservation?
  private var volumeView: MPVolumeView?
  private let baseline: Float = 0.5
  private var ignoreNext = false

  public func definition() -> ModuleDefinition {
    Name("PaceVolumeKey")
    Events("onVolumeButton")

    AsyncFunction("start") { (promise: Promise) in
      DispatchQueue.main.async {
        do {
          try self.session.setCategory(.playback, options: [.mixWithOthers])
          try self.session.setActive(true)
        } catch {}

        if self.volumeView == nil {
          let mv = MPVolumeView(frame: CGRect(x: -3000, y: -3000, width: 1, height: 1))
          Self.topWindow()?.addSubview(mv)
          self.volumeView = mv
        }
        self.setSystemVolume(self.baseline)

        self.observer = self.session.observe(\.outputVolume, options: [.new]) { [weak self] s, _ in
          guard let self = self else { return }
          if self.ignoreNext { self.ignoreNext = false; return }
          let v = s.outputVolume
          let direction = v >= self.baseline ? "up" : "down"
          self.sendEvent("onVolumeButton", ["direction": direction])
          // 볼륨을 baseline으로 복원(내 조작으로 생기는 다음 KVO는 무시).
          self.ignoreNext = true
          self.setSystemVolume(self.baseline)
        }
        promise.resolve(nil)
      }
    }

    Function("stop") {
      self.observer?.invalidate()
      self.observer = nil
      DispatchQueue.main.async {
        self.volumeView?.removeFromSuperview()
        self.volumeView = nil
      }
    }
  }

  private func setSystemVolume(_ value: Float) {
    guard let slider = self.volumeView?.subviews.compactMap({ $0 as? UISlider }).first else { return }
    DispatchQueue.main.async { slider.value = value }
  }

  private static func topWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.flatMap { $0.windows }.first
  }
}
