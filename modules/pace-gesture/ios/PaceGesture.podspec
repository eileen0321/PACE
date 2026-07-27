Pod::Spec.new do |s|
  s.name           = 'PaceGesture'
  s.version        = '1.0.0'
  s.summary        = 'Pace iOS hands-free next-video triggers (hand wave + finger snap)'
  s.description    = 'Local Expo module: detects a hand wave (MediaPipe HandLandmarker, same model as Android) and finger snaps (SoundAnalysis) to advance the Pace Feed hands-free.'
  s.author         = ''
  s.homepage       = 'https://github.com/eileen0321/PACE'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # 2026-07-27 사용자 결정(A) — iOS 손짓을 안드로이드와 동일한 MediaPipe HandLandmarker로 전환.
  # Apple Vision(VNDetectHumanHandPoseRequest)이 빠른 손짓/근접에서 손을 놓쳐(실기기 로그 확정) 손짓이
  # 불안정했다 — 안드가 쓰는 구글 전용 손 추적 ML로 통일해 감지 품질을 맞춘다.
  s.dependency 'MediaPipeTasksVision'

  # 안드로이드와 동일한 모델 파일(hand_landmarker.task, 7.8MB)을 앱 번들에 포함해 런타임에 로드한다.
  s.resources = 'hand_landmarker.task'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
