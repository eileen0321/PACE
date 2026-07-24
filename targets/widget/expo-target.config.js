/** @type {import('@bacons/apple-targets/app.plugin').Config} */
// Pace Live Activity 위젯 익스텐션(스펙 §1-E, iOS 오버레이 대체). @bacons/apple-targets가 prebuild 때
// 이 폴더를 실제 Widget Extension 타깃으로 .xcodeproj에 주입한다(--clean에도 유지). ActivityKit +
// WidgetKit + SwiftUI로 Focus Session 카운트다운을 잠금화면/다이나믹아일랜드에 표시.
module.exports = {
  type: 'widget',
  name: 'PaceWidget',
  displayName: 'Pace',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  deploymentTarget: '16.2', // 다이나믹아일랜드 16.2 / Live Activity 16.1
};
