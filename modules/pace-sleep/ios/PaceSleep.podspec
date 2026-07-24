Pod::Spec.new do |s|
  s.name           = 'PaceSleep'
  s.version        = '1.0.0'
  s.summary        = 'Pace iOS sleep detection (CoreMotion stillness + audio route change)'
  s.description    = 'Detects when the phone has been motionless (userAcceleration) and when audio route is lost, powering PACE sleep-detection kill pipeline (spec §4-B).'
  s.author         = ''
  s.homepage       = 'https://github.com/eileen0321/PACE'
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
