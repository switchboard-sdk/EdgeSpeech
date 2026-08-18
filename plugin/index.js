const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withGradleProperties,
  createRunOncePlugin,
} = require('@expo/config-plugins')

const pkg = require('../package.json')

const MAVEN_URL = 'https://s3.amazonaws.com/synervoz-android-maven-repository'

// The Switchboard native libraries reference __cxa_init_primary_exception, which
// only NDK 29's libc++_shared.so exports. An app packages exactly one
// libc++_shared.so — its own NDK's — so on the RN/Expo template default (27.x)
// the app builds and installs but dies at launch with `dlopen failed: cannot
// locate symbol "__cxa_init_primary_exception" referenced by libSwitchboardSDK.so`.
const MIN_NDK_VERSION = '29.0.14206865'

// Declare the Switchboard Maven repo from the app's own root build.gradle so it
// is registered during root configuration — before :app resolves its classpath.
function withSwitchboardMavenRepo(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg
    if (cfg.modResults.contents.includes(MAVEN_URL)) return cfg
    cfg.modResults.contents += `\nallprojects { repositories { maven { url "${MAVEN_URL}" } } }\n`
    return cfg
  })
}

// Prefab must be enabled in the app module — that is where RN's C++ autolinking
// compiles our CMakeLists and find_package()s the Switchboard AARs. There is no
// first-party Expo knob for this, so the plugin sets it directly.
function withPrefab(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg
    if (/buildFeatures\s*\{[^}]*prefab\s+true/.test(cfg.modResults.contents)) {
      return cfg
    }
    cfg.modResults.contents += `\nandroid { buildFeatures { prefab true } }\n`
    return cfg
  })
}

// Apply android/edgespeech-app.gradle into the app module. That file carries the app-side Gradle
// wiring the library can't declare from its own project — currently ordering the app's CMake
// configure after our codegen; see its header for why. Bare React Native apps apply the same file
// by hand, so both paths share one source of truth.
//
// The path comes from `node --print require.resolve(...)` rather than a relative ../node_modules
// walk so it survives monorepos, pnpm and hoisting; providers.exec keeps it configuration-cache safe.
const APPLY_ANCHOR = "require.resolve('@synervoz/edgespeech/package.json')"

function withAppGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg
    if (cfg.modResults.contents.includes(APPLY_ANCHOR)) return cfg
    cfg.modResults.contents += `
// EdgeSpeech: app-side Gradle wiring shipped with the library (see its header).
apply from: new File(
  providers.exec {
    workingDir(rootDir)
    commandLine("node", "--print", "${APPLY_ANCHOR}")
  }.standardOutput.asText.get().trim()
).parentFile.toPath().resolve("android/edgespeech-app.gradle").toFile()
`
    return cfg
  })
}

// Raise the app's ndkVersion (see MIN_NDK_VERSION above for why). Expo has no
// first-party knob for this — expo-build-properties exposes min/compile/targetSdk,
// buildTools, cmake and kotlin versions, but not the NDK — so the plugin edits
// `ext { ndkVersion = … }` in the app's root build.gradle, which expo-root-project
// propagates to the Android modules. An app already on a newer major is left alone.
function withNdkVersion(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg

    const declaration = /(ndkVersion\s*=\s*)(["'])([\d.]+)\2/
    const match = cfg.modResults.contents.match(declaration)

    if (!match) {
      // The Expo template declares no ndkVersion, so insert one — but it must land
      // BEFORE `apply plugin: "expo-root-project"`, which defaults it to 27.x via
      // setIfNotExist; appended is too late. Prepending isn't an option either
      // (Gradle wants buildscript {} first), so anchor on the first plugin apply.
      const block = `ext { ndkVersion = "${MIN_NDK_VERSION}" }\n\n`
      const anchor = cfg.modResults.contents.indexOf('apply plugin:')
      if (anchor === -1) {
        // No anchor (non-standard template): append and let the [ExpoRootProject]
        // banner printed by every Android build reveal whether it took effect.
        cfg.modResults.contents += `\n${block}`
        return cfg
      }
      cfg.modResults.contents =
        cfg.modResults.contents.slice(0, anchor) + block + cfg.modResults.contents.slice(anchor)
      return cfg
    }

    if (parseInt(match[3], 10) >= parseInt(MIN_NDK_VERSION, 10)) return cfg

    cfg.modResults.contents = cfg.modResults.contents.replace(
      declaration,
      `$1$2${MIN_NDK_VERSION}$2`
    )
    return cfg
  })
}

function findProperty(modResults, key) {
  return modResults.find((item) => item.type === 'property' && item.key === key)
}

// Whisper's ggml backends are dlopen()ed at runtime, which needs the native libs
// extracted to the filesystem rather than loaded straight from the APK. The Expo
// app template drives this off the `expo.useLegacyPackaging` gradle property.
function withLegacyPackaging(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'expo.useLegacyPackaging'
    const existing = findProperty(cfg.modResults, key)
    if (existing) {
      existing.value = 'true'
      return cfg
    }
    cfg.modResults.push({ type: 'property', key, value: 'true' })
    return cfg
  })
}

// The Switchboard Maven repo publishes no 32-bit x86 AAR, so a build that targets
// it fails to resolve. Drop just that ABI and leave the rest of the app's list
// (including x86_64, which emulators use) untouched.
function withoutX86(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'reactNativeArchitectures'
    const existing = findProperty(cfg.modResults, key)
    if (!existing) {
      cfg.modResults.push({
        type: 'property',
        key,
        value: 'armeabi-v7a,arm64-v8a,x86_64',
      })
      return cfg
    }
    existing.value = existing.value
      .split(',')
      .map((abi) => abi.trim())
      .filter((abi) => abi && abi !== 'x86')
      .join(',')
    return cfg
  })
}

// Only the Android wiring Expo can't do on its own. Permissions ship in the
// library's AndroidManifest (auto-merged); set the iOS microphone string with the
// built-in `ios.infoPlist.NSMicrophoneUsageDescription`.
const withEdgeSpeech = (config) => {
  config = withSwitchboardMavenRepo(config)
  config = withPrefab(config)
  config = withAppGradle(config)
  config = withNdkVersion(config)
  config = withLegacyPackaging(config)
  config = withoutX86(config)
  return config
}

module.exports = createRunOncePlugin(withEdgeSpeech, pkg.name, pkg.version)
