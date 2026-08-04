import ExpoModulesCore
import AVFoundation
import MediaPlayer
import UIKit

// Pace iOS 볼륨키 리모컨 (2026-07-21 사용자 지시, 2026-07-27 재확인).
// 시스템 출력 볼륨(AVAudioSession.outputVolume)을 KVO로 관찰 → 볼륨 버튼이 눌리면 실제 볼륨을 바꾸지 않고
// "onVolumeButton" 이벤트만 쏜다(→ RN이 다음/이전 Short로 넘김).
//
// ⚠️ 2026-07-27 iOS 플랫폼 한계 확인(웹 리서치): 사람들이 실제로 쓰는 싸구려 중국산 카메라 BT 리모컨은
// AVRCP next/prev가 아니라 "볼륨 업/다운" HID 키를 보낸다 → MPRemoteCommandCenter로는 못 잡고, 오직 이
// outputVolume KVO로만 잡힌다. 그런데 iOS는 볼륨 변화의 "출처"를 공개 API로 알려주지 않아(안드로이드
// KeyEvent.getDevice()에 해당하는 게 없음) "폰 물리 볼륨버튼"과 "리모컨 볼륨키"를 구분할 수 없다. 게다가
// 이 리모컨은 Consumer-Control HID라 GCKeyboard로 연결 감지도 안 된다. 따라서 iOS에선 "리모컨만 스킵,
// 폰 볼륨은 유지"가 불가능 → 상위(JS)에서 "핸즈프리 모드 ON + 피드 화면"일 때만 이 훅을 enable해서,
// 하이재킹 범위를 그 상황으로 국한한다(평소 폰 볼륨은 항상 정상, 핸즈프리로 피드 볼 때만 볼륨키=스킵).
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
  private var nextTarget: Any?
  private var prevTarget: Any?

  public func definition() -> ModuleDefinition {
    Name("PaceVolumeKey")
    Events("onVolumeButton")

    AsyncFunction("start") { (promise: Promise) in
      DispatchQueue.main.async {
        // ⭐ 2026-08-04 사장님 지적("볼륨 2로 하고 포커스 온하면 5로 튄다") — 원인: baseline 캡처를
        // setActive(true)/MPVolumeView 생성 "직후"에 하면 session.outputVolume이 iOS18 stale 버그로
        // 사용자 실제 볼륨(2=0.125) 대신 0.5 기본값을 반환해 baseline=0.5로 잡히고 볼륨이 5로 강제됐다.
        // → 세션 활성화·뷰 생성 전에 "먼저" 현재 시스템 볼륨을 읽어 baseline으로 삼는다(사용자 2가 그대로 유지).
        let cur = self.session.outputVolume
        do {
          try self.session.setCategory(.playback, options: [.mixWithOthers])
          try self.session.setActive(true)
        } catch {}

        // ── 방식 A: outputVolume KVO — 싸구려 카메라 BT 리모컨(볼륨키 HID)을 잡는 유일한 길 ──
        if self.volumeView == nil {
          let mv = MPVolumeView(frame: CGRect(x: -3000, y: -3000, width: 1, height: 1))
          Self.topWindow()?.addSubview(mv)
          self.volumeView = mv
        }
        // 위에서 세션 활성화 전에 읽은 사용자 현재 볼륨(cur)을 baseline으로 "그대로" 쓴다 — 클램프/강제 금지.
        // 2026-08-04 사장님 지적("볼륨 다 줄이고 포커스 온했는데 볼륨이 커져") — 기존 [0.125,0.875] 클램프가
        // 사용자가 0(무음)으로 둔 볼륨을 0.125(2칸)로 끌어올려 "볼륨이 커지는" 문제였다. "사용자 볼륨을 절대
        // 안 건드린다"가 감지 여지 확보보다 우선이므로 클램프 제거 — baseline = 사용자 실제 볼륨. iOS 볼륨은
        // 1/16 스텝이라 스텝 정렬만 유지(이미 스텝이라 사실상 no-op). 극단값(0/최대)에선 한 방향 감지가 안 될
        // 수 있으나, 사용자가 맞춘 볼륨을 바꾸는 것보다 낫다.
        self.baseline = (cur * 16).rounded() / 16
        self.setSystemVolume(self.baseline)
        NSLog("PACEVOL start OK — baseline=\(self.baseline) (현재볼륨 \(cur))") // 진단(테스트 후 제거)
        self.observer = self.session.observe(\.outputVolume, options: [.new]) { [weak self] s, _ in
          guard let self = self else { return }
          let v = s.outputVolume
          // 우리가 baseline으로 되돌린 것 때문에 생긴 KVO면 무시(값이 baseline과 거의 같음 = 같은 스텝).
          // 사용자 눌림은 baseline에서 한 스텝(±0.0625) 벗어나므로 확실히 구분된다. 예전 ignoreNext 플래그
          // 방식은 리셋 KVO가 타이밍/정렬 문제로 안 오면 다음 눌림을 잡아먹어 "두 번 눌러야 넘어감" 버그가
          // 났다 — 상태 없는 값 비교로 대체.
          if abs(v - self.baseline) < 0.03 { return }
          let direction = v >= self.baseline ? "up" : "down"
          NSLog("PACEVOL onVolumeButton(KVO) dir=\(direction) v=\(v)") // 진단(테스트 후 제거)
          self.sendEvent("onVolumeButton", ["direction": direction])
          self.setSystemVolume(self.baseline)
        }

        // ── 방식 B: MPRemoteCommandCenter — 에어팟/버즈 등 AVRCP 전송버튼(next/prev)을 추가로 잡음(하이브리드) ──
        // YouTube WKWebView가 전송명령을 선점하면 그냥 안 불릴 뿐이라 방식 A엔 무해(둘 중 하나라도 잡히면 됨).
        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        if self.nextTarget == nil {
          self.nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
            NSLog("PACEVOL onVolumeButton(MRC) next") // 진단(테스트 후 제거)
            self?.sendEvent("onVolumeButton", ["direction": "up"])
            return .success
          }
        }
        if self.prevTarget == nil {
          self.prevTarget = center.previousTrackCommand.addTarget { [weak self] _ in
            NSLog("PACEVOL onVolumeButton(MRC) prev") // 진단(테스트 후 제거)
            self?.sendEvent("onVolumeButton", ["direction": "down"])
            return .success
          }
        }
        promise.resolve(nil)
      }
    }

    Function("stop") {
      self.observer?.invalidate()
      self.observer = nil
      let center = MPRemoteCommandCenter.shared()
      if let t = self.nextTarget { center.nextTrackCommand.removeTarget(t); self.nextTarget = nil }
      if let t = self.prevTarget { center.previousTrackCommand.removeTarget(t); self.prevTarget = nil }
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
