Pod::Spec.new do |s|
  s.name           = 'PaceVolumeKey'
  s.version        = '1.0.0'
  s.summary        = 'Pace iOS volume-button remote (AVAudioSession outputVolume observation)'
  s.description    = 'Observes system output volume changes so AirPods/Buds volume buttons and Bluetooth remotes can trigger "next Short".'
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
