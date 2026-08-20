// React Native autolinking configuration.
//
// EdgeSpeech is a C++ TurboModule. On iOS the module is provided through the
// podspec + codegenConfig.ios.modulesProvider. On Android it is registered via
// RN's C++ autolinking: the app's native build compiles android/CMakeLists.txt
// (target `react-native-edgespeech`) and its generated autolinking provider
// constructs `facebook::react::NativeEdgeSpeech` from cpp/NativeEdgeSpeech.h.
module.exports = {
  dependency: {
    platforms: {
      android: {
        // Paths here are resolved by RN autolinking relative to the android/
        // source dir, so this is 'CMakeLists.txt' (which lives in android/), not
        // 'android/CMakeLists.txt' — the latter resolves to android/android/… .
        cxxModuleCMakeListsModuleName: 'react-native-edgespeech',
        cxxModuleCMakeListsPath: 'CMakeLists.txt',
        cxxModuleHeaderName: 'NativeEdgeSpeech',
      },
      ios: {
        podspecPath: __dirname + '/edgespeech.podspec',
      },
    },
  },
}
