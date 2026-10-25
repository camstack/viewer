require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name           = 'camstack-device-key'
  s.version        = package['version']
  s.summary        = 'Hardware-backed device key (Secure Enclave) for device certificates'
  s.description    = 'Generates and signs with a non-exportable P-256 key; the private key never leaves the chip.'
  s.license        = package['license'] || 'MIT'
  s.authors        = package['author'] || 'CamStack'
  s.homepage       = package['homepage'] || 'https://github.com/camstack/camstack'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { :git => 'https://github.com/example/camstack-device-key.git', :tag => "#{s.version}" }
  s.static_framework = true
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.requires_arc   = true

  s.dependency "ExpoModulesCore"
end
