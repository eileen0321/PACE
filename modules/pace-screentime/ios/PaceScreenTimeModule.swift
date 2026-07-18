import ExpoModulesCore
import FamilyControls
import ManagedSettings
import DeviceActivity
import SwiftUI

// Pace iOS Screen Time 제어 모듈 (2026-07-18 iOS 전략 확정 — PACE_ARCHITECTURE.md 참고).
// 실제 숏폼(YouTube/Instagram)을 Screen Time으로 차단하고, 그 대체 출구로 JS 쪽 Pace Feed를 연다.
//
// ⚠️ 전제(빌드/실행): ① Apple "Family Controls (Distribution)" entitlement 승인, ② Dev Client 빌드,
//    ③ DeviceActivityMonitor / ShieldConfiguration Extension 타깃 추가. 이 파일은 메인 앱 모듈이고,
//    임계값 초과 시 실제 Shield 적용은 별도 App Extension(DeviceActivityMonitor 서브클래스)이 수행.
//
// 컴파일 안전성: 클래스 자체엔 @available을 붙이지 않는다(Expo autolinking provider가 이 클래스를
// 무조건 참조하므로 앱 최소버전 iOS 15.1에서 컴파일돼야 함). FamilyControls/DeviceActivity(iOS 16+)
// 호출은 각 함수 내부 `if #available(iOS 16.0, *)` 가드 + @available 헬퍼로 분리한다.

private let kAppGroup = "group.com.pace.screentime"
private let kShieldedKey = "pace.isShielded"

public class PaceScreenTimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PaceScreenTime")

    AsyncFunction("requestAuthorization") { () async -> Bool in
      guard #available(iOS 16.0, *) else { return false }
      return await ScreenTimeBridge.requestAuthorization()
    }

    Function("isAuthorized") { () -> Bool in
      guard #available(iOS 16.0, *) else { return false }
      return ScreenTimeBridge.isAuthorized()
    }

    AsyncFunction("presentAppPicker") { (promise: Promise) in
      guard #available(iOS 16.0, *) else { promise.resolve(nil); return }
      DispatchQueue.main.async {
        ScreenTimeBridge.presentPicker { promise.resolve(nil) }
      }
    }

    AsyncFunction("startMonitoring") { (dailyLimitMinutes: Int) throws in
      guard #available(iOS 16.0, *) else { return }
      try ScreenTimeBridge.startMonitoring(dailyLimitMinutes: dailyLimitMinutes)
    }

    AsyncFunction("stopMonitoring") {
      guard #available(iOS 16.0, *) else { return }
      ScreenTimeBridge.stopMonitoring()
    }

    // Extension이 앱 그룹에 기록한 Shield 플래그를 읽는다(앱 그룹 미설정 시 defaults=nil → false).
    Function("isShielded") { () -> Bool in
      return UserDefaults(suiteName: kAppGroup)?.bool(forKey: kShieldedKey) ?? false
    }
  }
}

// iOS 16+ FamilyControls/DeviceActivity/ManagedSettings 로직 — @available로 분리해 위 Module 본체가
// 최소버전에서 컴파일되도록 한다.
@available(iOS 16.0, *)
enum ScreenTimeBridge {
  static let store = ManagedSettingsStore()
  static let activityName = DeviceActivityName("pace.daily")
  static let eventName = DeviceActivityEvent.Name("pace.dailyLimit")
  static let selectionKey = "pace.familySelection"

  static func requestAuthorization() async -> Bool {
    do {
      try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
      return AuthorizationCenter.shared.authorizationStatus == .approved
    } catch {
      return false
    }
  }

  static func isAuthorized() -> Bool {
    return AuthorizationCenter.shared.authorizationStatus == .approved
  }

  // FamilyActivityPicker를 모달로 띄우고, 선택(FamilyActivitySelection, JS로 직렬화 불가)을 앱 그룹에 영속.
  static func presentPicker(onDone: @escaping () -> Void) {
    guard let root = topViewController() else { onDone(); return }
    let picker = FamilyActivityPickerHost { selection in
      persist(selection)
      root.dismiss(animated: true) { onDone() }
    }
    root.present(UIHostingController(rootView: picker), animated: true)
  }

  // DeviceActivity 스케줄 등록 — 하루 사용량이 임계(dailyLimitMinutes)를 넘으면 Extension이 Shield 적용.
  static func startMonitoring(dailyLimitMinutes: Int) throws {
    let selection = loadSelection()
    let schedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: 0, minute: 0),
      intervalEnd: DateComponents(hour: 23, minute: 59),
      repeats: true
    )
    let event = DeviceActivityEvent(
      applications: selection.applicationTokens,
      categories: selection.categoryTokens,
      webDomains: selection.webDomainTokens,
      threshold: DateComponents(minute: dailyLimitMinutes)
    )
    let center = DeviceActivityCenter()
    center.stopMonitoring([activityName])
    try center.startMonitoring(activityName, during: schedule, events: [eventName: event])
  }

  static func stopMonitoring() {
    DeviceActivityCenter().stopMonitoring([activityName])
    store.shield.applications = nil
    store.shield.applicationCategories = nil
  }

  static func persist(_ selection: FamilyActivitySelection) {
    guard let defaults = UserDefaults(suiteName: kAppGroup),
          let data = try? JSONEncoder().encode(selection) else { return }
    defaults.set(data, forKey: selectionKey)
  }

  static func loadSelection() -> FamilyActivitySelection {
    guard let defaults = UserDefaults(suiteName: kAppGroup),
          let data = defaults.data(forKey: selectionKey),
          let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return FamilyActivitySelection() }
    return selection
  }

  static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let keyWindow = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

@available(iOS 16.0, *)
private struct FamilyActivityPickerHost: View {
  @State private var selection = FamilyActivitySelection()
  let onDone: (FamilyActivitySelection) -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Block short-form")
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { onDone(selection) }
          }
        }
    }
  }
}
