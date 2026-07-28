const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// 2026-07-29 — EAS 클라우드 빌드는 prebuild로 ios/를 재생성하므로 로컬 Podfile 수정이 유실된다. 로컬에서
// 검증된 두 수정(MediaPipe 손짓 통합에 필수)을 config plugin으로 재현한다:
//  1) use_modular_headers! — MediaPipeTasksVision가 끌어온 GoogleUtilities/RecaptchaInterop 모듈맵이 안 만들어져
//     AppCheckCore(Swift) 정적 통합이 실패하는 CocoaPods 이슈 해결.
//  2) 앱/pod 링크 플래그에서 -l"GTMSessionFetcher" 제거 — MediaPipeTasksCommon.framework가 GTMSessionFetcher를
//     내부에 통째로 정적 임베드(642 심볼)해서 GoogleSignIn용 별도 .a와 중복(Xcode26에서 -ld_classic 불가).
//     헤더는 살려두되 별도 .a만 안 링크(심볼은 MediaPipe 프레임워크가 제공).
const GTM_PATCH = `
    # PACE(config plugin) — MediaPipe+GoogleSignIn GTMSessionFetcher 중복심볼 해결
    pace_support = File.join(installer.sandbox.root.to_s, 'Target Support Files')
    Dir.glob(File.join(pace_support, '**', '*.xcconfig')).each do |xc|
      c = File.read(xc)
      next unless c.include?('-l"GTMSessionFetcher"')
      File.write(xc, c.gsub('-l"GTMSessionFetcher"', ''))
    end`;

const withPacePods = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let c = fs.readFileSync(podfile, 'utf8');

      // 1) use_modular_headers! (use_expo_modules! 바로 뒤). 이미 있으면 스킵.
      if (!c.includes('use_modular_headers!')) {
        c = c.replace(/use_expo_modules!\s*\n/, (m) => `${m}  use_modular_headers!\n`);
      }

      // 2) react_native_post_install(...) 호출 뒤에 GTM 패치 삽입. 이미 있으면 스킵.
      if (!c.includes("-l\"GTMSessionFetcher\"")) {
        c = c.replace(/(react_native_post_install\([\s\S]*?\)\s*\n)/, (m) => `${m}${GTM_PATCH}\n`);
      }

      fs.writeFileSync(podfile, c);
      return cfg;
    },
  ]);
};

module.exports = withPacePods;
