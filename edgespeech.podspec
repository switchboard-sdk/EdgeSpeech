require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Fetch the Switchboard xcframeworks. Duplicates s.prepare_command below, which CocoaPods
# skips for a path pod on an incremental install — leaving the frameworks missing after
# `rm -rf node_modules && npm install`. Evaluation always runs; the script is idempotent.
system('bash', File.join(__dir__, 'scripts', 'download-ios-frameworks.sh')) or
  raise 'EdgeSpeech: could not download the Switchboard iOS frameworks — check your ' \
        'network connection and re-run pod install'

Pod::Spec.new do |s|
  s.name         = "edgespeech"
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "git@github.com:switchboard-sdk/EdgeSpeech.git", :tag => "v#{s.version}" }

  # Shared C++ TurboModule (cpp/) + the iOS provider glue (ios/).
  s.source_files = "cpp/**/*.{h,hpp,cpp}", "ios/**/*.{h,mm}"

  # Privacy manifest — required for App Store submissions (Apple policy, May 2024+)
  s.resource_bundles = { 'edgespeech_privacy' => ['ios/PrivacyInfo.xcprivacy'] }

  # The documented hook, normally a no-op after the call above. Keeps the binaries out of
  # git and out of the npm tarball.
  s.prepare_command = 'bash scripts/download-ios-frameworks.sh'

  # Link the downloaded xcframeworks (each carries the C++ headers we compile
  # against). Whisper nests everything under Release/, plus an extra
  # whisper.xcframework under Release/lib/. Explicit paths, not a glob: a partial
  # download then fails loudly.
  s.vendored_frameworks = [
    'ios/Frameworks/SwitchboardSDK/ios/SwitchboardSDK.xcframework',
    'ios/Frameworks/SwitchboardWhisper/ios/Release/SwitchboardWhisper.xcframework',
    'ios/Frameworks/SwitchboardWhisper/ios/Release/lib/whisper.xcframework',
    'ios/Frameworks/SwitchboardSileroVAD/ios/SwitchboardSileroVAD.xcframework',
    'ios/Frameworks/SwitchboardOnnx/ios/SwitchboardOnnx.xcframework',
    'ios/Frameworks/SwitchboardSherpa/ios/SwitchboardSherpa.xcframework',
  ]

  # C++ headers we compile against live in each package's include/ dir (Whisper's
  # under Release/include). These carry SwitchboardJSONRPC.hpp + the *Extension.hpp
  # headers that cpp/NativeEdgeSpeech.cpp includes.
  header_search_paths = [
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSDK/ios/include"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardWhisper/ios/Release/include"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSileroVAD/ios/include"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardOnnx/ios/include"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSherpa/ios/include"',
  ]

  framework_search_paths = [
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSDK/ios"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardWhisper/ios/Release"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardWhisper/ios/Release/lib"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSileroVAD/ios"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardOnnx/ios"',
    '"${PODS_TARGET_SRCROOT}/ios/Frameworks/SwitchboardSherpa/ios"',
  ]

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS'         => '$(inherited) ' + header_search_paths.join(' '),
    'FRAMEWORK_SEARCH_PATHS'      => '$(inherited) ' + framework_search_paths.join(' '),
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
  }

  s.frameworks = 'AVFoundation', 'AudioToolbox'

  # Pulls in React-Core and wires up the new architecture + codegen (generates
  # RNEdgeSpeechSpecJSI.h, which cpp/NativeEdgeSpeech.h includes).
  install_modules_dependencies(s)
end
