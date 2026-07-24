import ActivityKit
import WidgetKit
import SwiftUI

// Pace Focus Session 카운트다운을 잠금화면 배너 + 다이나믹아일랜드에 표시.
// Text(timerInterval:)를 쓰면 OS가 매초 카운트다운을 스스로 애니메이션 → 앱이 update를 안 쏴도 되고
// (업데이트 예산 문제 회피), 앱이 background/종료돼도 시스템이 알아서 틱을 굴린다.
@available(iOS 16.2, *)
struct PaceWidgetLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PaceAttributes.self) { context in
      // ── 잠금화면 / 배너 ──
      HStack {
        PaceMark()
        Text(context.attributes.sessionTitle)
          .font(.system(.subheadline, design: .rounded).weight(.semibold))
          .foregroundStyle(.white)
        Spacer()
        Text(timerInterval: Date()...context.state.endDate, countsDown: true)
          .font(.system(.title2, design: .rounded).monospacedDigit())
          .foregroundStyle(.white)
          .frame(maxWidth: 96)
          .multilineTextAlignment(.trailing)
      }
      .padding()
      .activityBackgroundTint(Color.black.opacity(0.55))
      .activitySystemActionForegroundColor(.white)

    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          PaceMark()
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(timerInterval: Date()...context.state.endDate, countsDown: true)
            .font(.system(.title3, design: .rounded).monospacedDigit())
            .foregroundStyle(.white)
            .frame(maxWidth: 84)
            .multilineTextAlignment(.trailing)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.attributes.sessionTitle)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      } compactLeading: {
        PaceMark()
      } compactTrailing: {
        Text(timerInterval: Date()...context.state.endDate, countsDown: true)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(.white)
          .frame(maxWidth: 44)
      } minimal: {
        Text(timerInterval: Date()...context.state.endDate, countsDown: true)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(paceAccent)
          .frame(maxWidth: 36)
      }
      .keylineTint(paceAccent)
    }
  }
}

// Pace 브랜드 보라(앱 테마 primary ≈ #5856D6).
private let paceAccent = Color(red: 0.345, green: 0.337, blue: 0.839)

struct PaceMark: View {
  var body: some View {
    Text("Pace")
      .font(.system(.caption, design: .rounded).weight(.bold))
      .foregroundStyle(paceAccent)
  }
}
