import WidgetKit
import SwiftUI

// 위젯 익스텐션 진입점. Live Activity만 제공(홈스크린 위젯은 없음).
@main
struct PaceWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      PaceWidgetLiveActivity()
    }
  }
}
