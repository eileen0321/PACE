Pod::Spec.new do |s|
  s.name           = 'PaceScreenTime'
  s.version        = '1.0.0'
  s.summary        = 'Pace iOS Screen Time control (FamilyControls / DeviceActivity / ManagedSettings)'
  s.description    = 'Local Expo module: blocks real short-form apps via Screen Time so Pace Feed can offer a healthy alternative.'
  s.author         = ''
  s.homepage       = 'https://github.com/eileen0321/PACE'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # FamilyControls / DeviceActivity / ManagedSettings are system frameworks (iOS 16+); linked via `import`.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
