import ActivityKit
import WidgetKit
import SwiftUI

// Pace Focus Session 카운트다운을 잠금화면 배너 + 다이나믹아일랜드에 표시.
// Text(timerInterval:)를 쓰면 OS가 매초 카운트다운을 스스로 애니메이션 → 앱이 update를 안 쏴도 되고
// (업데이트 예산 문제 회피), 앱이 background/종료돼도 시스템이 알아서 틱을 굴린다.

/// 🔴 2026-08-20 사장님 신고 — "앱을 죽였는데 맥/애플워치에서 Pace 시간이 계속 가는 게 보인다."
///
/// 원인이 둘인데 하나는 이 파일에 있었다. 기존 코드는 매 렌더마다
///     Text(timerInterval: Date()...context.state.endDate, countsDown: true)
/// 로 **하한을 "지금"으로 새로 만들었다.** 두 가지가 잘못된다:
///
///  ① 세션 종료시각이 이미 지난 상태에서 다시 렌더되면 `Date() > endDate`가 되어
///     ClosedRange의 lowerBound > upperBound — Swift에서 이건 **런타임 트랩(크래시)** 이다.
///     (update()가 remainingMinutes를 음수로 넘기는 경로에서도 똑같이 터진다.)
///  ② 하한이 계속 "지금"으로 밀리므로 이 타이머 텍스트는 **끝이 없다.** Live Activity는 앱
///     프로세스와 분리돼 살아남는데(애플의 의도된 설계, 강제종료해도 최대 8시간 유지 + watchOS
///     Smart Stack 미러링), 그동안 시스템이 이 타이머를 계속 굴린다 = "앱을 죽였는데 시간이 계속 감".
///
/// → 범위를 **고정된 startDate...endDate**로 바꾼다. 이러면 세션 종료시각에서 타이머가 멈춘다.
///   앱이 죽어 정리(endAll)를 못 했더라도 최소한 "아직 진행 중"으로 보이지는 않는다.
///   실제 제거는 앱이 다시 켜질 때가 유일한 기회이고, 그쪽은 _layout.tsx의
///   endOrphanedOverlays() 콜드스타트 정리가 담당한다(두 곳을 같이 고쳐야 증상이 사라진다).
@available(iOS 16.2, *)
struct PaceCountdown: View {
  let state: PaceAttributes.ContentState

  private var range: ClosedRange<Date> {
    // 방어: update()가 음수 remainingMinutes로 들어오면 end < start가 될 수 있다(위 ① 크래시).
    let start = state.startDate
    let end = max(state.endDate, start)
    return start...end
  }

  var body: some View {
    if state.endDate <= Date() {
      // 이미 끝난 세션 — 굴러가는 시계 대신 끝났다는 사실을 보여준다.
      Text("0:00").monospacedDigit()
    } else {
      Text(timerInterval: range, countsDown: true).monospacedDigit()
    }
  }
}

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
        PaceCountdown(state: context.state)
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
          PaceCountdown(state: context.state)
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
        PaceCountdown(state: context.state)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(.white)
          .frame(maxWidth: 44)
      } minimal: {
        PaceCountdown(state: context.state)
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
