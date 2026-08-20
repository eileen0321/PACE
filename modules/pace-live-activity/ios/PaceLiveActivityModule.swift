import ExpoModulesCore
import ActivityKit
import Foundation

// JS overlayService.ios.ts → ActivityKit 브릿지 (스펙 §1-E, iOS 오버레이 대체). Focus Session 남은시간을
// 잠금화면/다이나믹아일랜드 Live Activity로 표시. 실행 중 Activity 핸들을 들고 있어 update/end가 지목 가능.
// 모든 ActivityKit 심볼은 #available(iOS 16.1)로 게이트 → 낮은 타깃에서도 컴파일/링크(구버전은 no-op).
public class PaceLiveActivityModule: Module {
  // 타입 소거 저장 — 프로퍼티 자체엔 availability 주석 불필요.
  private var currentActivity: Any?

  public func definition() -> ModuleDefinition {
    Name("PaceLiveActivity")

    // JS: start({ title, endEpochMs }) — Live Activity 시작. 남은시간은 endDate로 넘겨 위젯이 스스로 틱.
    AsyncFunction("start") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.1, *) else { promise.resolve(false); return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        NSLog("[PACELA] start blocked: areActivitiesEnabled=false (설정에서 꺼짐)")
        promise.resolve(false); return // 설정에서 Live Activities 꺼둠
      }
      let title = (params["title"] as? String) ?? "Focus"
      let endMs = (params["endEpochMs"] as? Double) ?? 0
      let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

      let attributes = PaceAttributes(sessionTitle: title)
      let state = PaceAttributes.ContentState(startDate: Date(), endDate: endDate)
      // staleDate는 nil로 요청(초기 요청에 staleDate 주면 일부 iOS에서 로딩스피너 stuck되는 알려진 이슈).
      let content = ActivityContent(state: state, staleDate: nil)
      do {
        let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
        self.currentActivity = activity
        NSLog("[PACELA] started id=%@ end=%@", activity.id, endDate as NSDate)
        promise.resolve(true)
      } catch {
        NSLog("[PACELA] request FAILED: %@", String(describing: error))
        promise.resolve(false)
      }
    }

    // JS: update(remainingMinutes) — 위젯이 Text(timerInterval:)로 스스로 틱하므로 보통 no-op(일시정지/연장 등
    // 실제 상태 변화 때만 종료시각 재계산). 예산 throttle 회피.
    AsyncFunction("update") { (remainingMinutes: Double, promise: Promise) in
      guard #available(iOS 16.1, *), let activity = self.currentActivity as? Activity<PaceAttributes> else {
        promise.resolve(false); return
      }
      let newEnd = Date().addingTimeInterval(remainingMinutes * 60)
      let state = PaceAttributes.ContentState(startDate: Date(), endDate: newEnd)
      Task {
        await activity.update(ActivityContent(state: state, staleDate: newEnd))
        promise.resolve(true)
      }
    }

    // JS: end() — 즉시 종료.
    AsyncFunction("end") { (promise: Promise) in
      guard #available(iOS 16.1, *), let activity = self.currentActivity as? Activity<PaceAttributes> else {
        promise.resolve(true); return
      }
      let final = PaceAttributes.ContentState(startDate: Date(), endDate: Date())
      Task {
        await activity.end(ActivityContent(state: final, staleDate: nil), dismissalPolicy: .immediate)
        self.currentActivity = nil
        promise.resolve(true)
      }
    }

    // 앱 재시작 시 시스템에 남아있는 이전 Activity 정리(강제종료로 end() 못 부른 경우 대비).
    AsyncFunction("endAll") { (promise: Promise) in
      guard #available(iOS 16.1, *) else { promise.resolve(true); return }
      Task {
        let list = Activity<PaceAttributes>.activities
        if !list.isEmpty { NSLog("[PACELA] endAll: ending %d activities", list.count) }
        for activity in list {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
        self.currentActivity = nil
        promise.resolve(true)
      }
    }
  }
}
