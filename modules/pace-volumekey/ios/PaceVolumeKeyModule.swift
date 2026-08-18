import ExpoModulesCore
import AVFoundation
import AudioToolbox
import MediaPlayer
import QuartzCore
import UIKit

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

  private func ensureSessionActive() {
    do {
      try session.setCategory(.ambient, options: [.mixWithOthers])
      try session.setActive(true)
    } catch {}
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
        self.remoteActive = true
        self.ensureSessionActive()

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
        var base = (cur * 16).rounded() / 16
        // 위 emulatedZero 주석 참고 — 양극단이면 한 방향 감지가 원천 불가라 [1/16, 15/16] 안쪽 유지.
        self.emulatedZero = base < 0.03
        if base < 0.0625 { base = 0.0625 }
        if base > 0.9375 { base = 0.9375 }
        self.baseline = base
        self.setSystemVolume(self.baseline)
        NSLog("PACEVOL start OK — baseline=\(self.baseline) (현재볼륨 \(cur), emulatedZero=\(self.emulatedZero))") // 진단(테스트 후 제거)
        self.observer = self.session.observe(\.outputVolume, options: [.new]) { [weak self] s, _ in
          guard let self = self else { return }
          let v = s.outputVolume
          // 우리가 baseline으로 되돌린 것 때문에 생긴 KVO면 무시(값이 baseline과 거의 같음 = 같은 스텝).
          // 사용자 눌림은 baseline에서 한 스텝(±0.0625) 벗어나므로 확실히 구분된다. 예전 ignoreNext 플래그
          // 방식은 리셋 KVO가 타이밍/정렬 문제로 안 오면 다음 눌림을 잡아먹어 "두 번 눌러야 넘어가" 버그가
          // 났다 — 상태 없는 값 비교로 대체.
          if abs(v - self.baseline) < 0.03 { return }
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
          let direction = v >= self.baseline ? "up" : "down"
          // 2026-08-18 사양 — 눌림을 실제 볼륨 한 칸 조절로도 반영(위 emulatedZero 주석). 예전처럼
          // baseline으로 "되돌리는" 게 아니라 baseline 자체를 한 칸 이동시키고 거기로 맞춘다.
          if direction == "up" {
            if self.emulatedZero {
              self.emulatedZero = false // 가상 0에서 업 = 소리 복귀(볼륨은 바닥 1/16부터)
            } else {
              self.baseline = min(self.baseline + 0.0625, 0.9375)
            }
          } else {
            if self.baseline <= 0.0625 + 0.001 {
              self.emulatedZero = true // 바닥에서 다운 = 가상 0(무음 잠금, 시스템 볼륨은 1/16 유지)
            } else {
              self.baseline = max(self.baseline - 0.0625, 0.0625)
            }
          }
          NSLog("PACEVOL onVolumeButton(KVO) dir=\(direction) v=\(v) base→\(self.baseline) emu0=\(self.emulatedZero)") // 진단(테스트 후 제거)
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
        // 2026-08-18 사장님 지적("아니 그럼 무음에서 소리가 나잖아") — 볼륨 0에서 클램프하면 1칸
        // 소리가 나는 문제. 클램프 사실을 JS에 알려주면 JS가 영상 자체를 muted로 잠가 "소리는 0
        // 그대로 + 눌림 감지는 가능" 둘 다 만족시킨다(이 앱의 유일한 소리원이 영상이므로).
        promise.resolve(["clampedFromZero": cur < 0.03])
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
  }

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
