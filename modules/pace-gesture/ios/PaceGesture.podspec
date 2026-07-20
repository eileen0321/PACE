Pod::Spec.new do |s|
  s.name           = 'PaceGesture'
  s.version        = '1.0.0'
  s.summary        = 'Pace iOS hands-free next-video triggers (finger snap + head nod)'
  s.description    = 'Local Expo module: detects finger snaps (SoundAnalysis built-in classifier) and head nods (ARKit face tracking) to advance the Pace Feed hands-free.'
  s.author         = ''
  s.homepage       = 'https://github.com/eileen0321/PACE'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # SoundAnalysis / ARKit / AVFoundation are system frameworks; linked via `import`.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
