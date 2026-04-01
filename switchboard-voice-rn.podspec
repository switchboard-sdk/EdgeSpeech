require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "switchboard-voice-rn"
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => package['repository']['url'], :tag => "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Only include Swift source files (Expo modules don't need Obj-C bridge)
  s.source_files = 'ios/*.swift'

  # Switchboard SDK frameworks - downloaded automatically via postinstall script
  # Auto-discover Whisper lib frameworks (layout changed between SDK versions)
  whisper_lib_frameworks = Dir[File.join(__dir__, 'ios/Frameworks/SwitchboardWhisper/ios/Release/lib/*.xcframework')].map { |f| f.sub("#{__dir__}/", '') }

  s.vendored_frameworks = [
    'ios/Frameworks/SwitchboardSDK/ios/SwitchboardSDK.xcframework',
    'ios/Frameworks/SwitchboardWhisper/ios/Release/SwitchboardWhisper.xcframework',
    'ios/Frameworks/SwitchboardSileroVAD/ios/SwitchboardSileroVAD.xcframework',
    'ios/Frameworks/SwitchboardOnnx/ios/SwitchboardOnnx.xcframework',
    'ios/Frameworks/SwitchboardSherpa/ios/SwitchboardSherpa.xcframework',
  ] + whisper_lib_frameworks

  # Framework search paths
  s.pod_target_xcconfig = {
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSDK/ios" "${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardWhisper/ios/Release" "${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSileroVAD/ios" "${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardOnnx/ios" "${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSherpa/ios" "${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardWhisper/ios/Release/lib"'
  }

  s.frameworks = 'AVFoundation', 'AudioToolbox'
  s.swift_version = '5.0'
end
