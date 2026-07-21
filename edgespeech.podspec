require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

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

  # Switchboard SDK + extension xcframeworks — downloaded into ios/Frameworks/ by
  # scripts/postinstall.js. Whisper ships under a Release/ subdir with extra libs
  # (whisper.xcframework etc.), auto-discovered below.
  whisper_lib_frameworks = Dir[File.join(__dir__, 'ios/Frameworks/SwitchboardWhisper/ios/Release/lib/*.xcframework')].map { |f| f.sub("#{__dir__}/", '') }

  s.vendored_frameworks = [
    'ios/Frameworks/SwitchboardSDK/ios/SwitchboardSDK.xcframework',
    'ios/Frameworks/SwitchboardWhisper/ios/Release/SwitchboardWhisper.xcframework',
    'ios/Frameworks/SwitchboardSileroVAD/ios/SwitchboardSileroVAD.xcframework',
    'ios/Frameworks/SwitchboardOnnx/ios/SwitchboardOnnx.xcframework',
    'ios/Frameworks/SwitchboardSherpa/ios/SwitchboardSherpa.xcframework',
  ] + whisper_lib_frameworks

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
