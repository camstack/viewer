require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name           = 'camstack-webrtc-audio'
  s.version        = package['version']
  s.summary        = 'WebRTC receive-only audio without orange mic indicator'
  s.description    = 'Uses AUAudioUnitRTCAudioDevice for receive-only streaming'
  s.license        = package['license'] || 'MIT'
  s.authors        = package['author'] || 'CamStack'
  s.homepage       = package['homepage'] || 'https://github.com/camstack/camstack'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { :git => 'https://github.com/example/camstack-webrtc-audio.git', :tag => "#{s.version}" }
  s.static_framework = true
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.requires_arc   = true

  s.dependency "React-Core"
  s.dependency "ExpoModulesCore"
  s.dependency "react-native-webrtc"

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_ROOT)/react-native-webrtc/ios/RCTWebRTC" "$(PODS_ROOT)/../node_modules/react-native-webrtc/ios/RCTWebRTC"',
  }
end
