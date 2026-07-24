Pod::Spec.new do |s|
  s.name           = 'PaceLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Pace Live Activity (ActivityKit focus-session countdown)'
  s.description    = 'Bridges JS to ActivityKit to show a focus-session countdown on the Lock Screen + Dynamic Island (spec §1-E).'
  s.author         = ''
  s.homepage       = 'https://github.com/eileen0321/PACE'
  # 앱과 동일 15.1 유지 — ActivityKit 사용은 전부 #available(iOS 16.1)로 게이트, 타입은 @available로
  # 표시해 15.1에서도 컴파일/링크되고 16.1+에서만 동작(구버전 사용자 안 버림).
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
