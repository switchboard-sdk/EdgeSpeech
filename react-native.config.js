// React Native autolinking configuration.
//
// EdgeSpeech is a bare (non-Expo) C++ TurboModule. On iOS the module is provided
// through the podspec + codegenConfig.ios.modulesProvider. Android wiring
// (cxxModule* keys) is added when Android support lands — the shared cpp/ is
// already structured for it.
module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: __dirname + '/edgespeech.podspec',
      },
    },
  },
}
