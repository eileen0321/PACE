import ActivityKit
import Foundation

// 앱(Activity.request/update 호출)과 위젯 익스텐션(렌더)이 공유하는 데이터 계약.
// ⚠️ Expo가 prebuild마다 ios/를 재생성하므로 Xcode "target membership" 대신 이 파일을 두 타깃 폴더에
//    동일하게 복제한다(modules/pace-live-activity/ios/PaceAttributes.swift 와 반드시 바이트 동일 유지).
@available(iOS 16.1, *)
public struct PaceAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // Focus Session 종료 시각. 위젯이 이 값으로 카운트다운을 스스로 애니메이션(앱이 매초 update 불필요).
    public var endDate: Date
    public var startDate: Date

    public init(startDate: Date, endDate: Date) {
      self.startDate = startDate
      self.endDate = endDate
    }
  }

  public var sessionTitle: String
  public init(sessionTitle: String) { self.sessionTitle = sessionTitle }
}
