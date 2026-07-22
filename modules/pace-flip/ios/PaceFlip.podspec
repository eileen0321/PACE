Pod::Spec.new do |s|
  s.name           = 'PaceFlip'
  s.version        = '1.0.0'
  s.summary        = 'Pace iOS Flip Mode (CoreMotion face-down detection for "put-down time")'
  s.description    = 'Detects when the phone is placed face-down via CMMotionManager gravity.z, powering PACE Flip Mode (rest/put-down time measurement).'
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
