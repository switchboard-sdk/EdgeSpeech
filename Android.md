# Android Support Plan — `@synervoz/edgespeech`

Plan for adding Android to the EdgeSpeech React Native library, modelled on the
already-shipped Android support in the sibling library **EdgeAudio**
(`@synervoz/openai-realtime-toolkit`, at `/Users/tjaved/Synervoz/EdgeAudio`).

> Status: **planning only** — no code written yet. Per `CLAUDE.md`, we check in
> with the user after each phase before proceeding.

---

## 1. Why this port is cheap

The recent "Turbomodules and JSONRPC API refactor" (commit `1edcee8`) already put
EdgeSpeech in the exact shape that makes EdgeAudio's Android support work:

- **The engine is a pure C++ TurboModule.** All Switchboard work lives in
  `cpp/NativeEdgeSpeech.{h,cpp}`, driven over a single JSON-RPC string channel
  (`processCommand`) plus one event stream (`onEventReceived`). The `.h` docstring
  already says *"The same source is intended to compile for iOS and Android."*
- **All voice-pipeline logic is TypeScript** (`src/VoiceEngine.ts` etc.), 100%
  shared across platforms. SDK init, graph building, the state machine and barge-in
  are JSON-RPC messages — none of it is platform code.
- **The native contract is tiny** — 4 members total: `processCommand`,
  `isSimulator`, `requestMicrophonePermission`, `onEventReceived`. (EdgeSpeech does
  *not* have EdgeAudio's `getDocumentsPath`/`writeFile`, so it's even smaller.)
- **`package.json` `codegenConfig` already declares the Android side:**
  `android.javaPackageName = "com.synervoz.edgespeech"` — there's just no native
  implementation behind it yet.
- **`react-native.config.js` already anticipates it** — its comment says the
  `cxxModule*` Android keys "are added when Android support lands — the shared cpp/
  is already structured for it."

So the port is: **add an Android platform layer under the existing shared C++ core**
— no engine rewrite. On Android the shared `cpp/` is compiled in the *consuming
app's* native build (RN C++ autolinking) and linked against Switchboard via
Prefab; the library's job is only to make the Maven AARs and Prefab available and
to keep a stub `ReactPackage` so autolinking recognises the `android/` dir.

---

## 2. Feasibility — verified, not assumed

The one real risk was whether the Switchboard extensions EdgeSpeech needs (Whisper
STT + Sherpa TTS — which EdgeAudio does **not** use) exist as Android artifacts.
**Verified against the public Maven repo** (`https://s3.amazonaws.com/synervoz-android-maven-repository`):

| Coordinate | Versions available | Needed by EdgeSpeech |
| --- | --- | --- |
| `com.synervoz.switchboard:switchboardsdk` | 3.2.1 – 3.2.4 | ✅ core |
| `com.synervoz.switchboard.extensions:onnx` | 3.2.1 – 3.2.4 | ✅ (underpins VAD) |
| `com.synervoz.switchboard.extensions:silerovad` | 3.2.1 – 3.2.4 | ✅ VAD |
| `com.synervoz.switchboard.extensions:whisper` | 3.2.1 – 3.2.4 | ✅ STT |
| `com.synervoz.switchboard.extensions:sherpa` | 3.2.1 – 3.2.4 | ✅ TTS |

**Prefab package names** (verified by unzipping the 3.2.3 AARs):
`SwitchboardSDK`, `SwitchboardOnnx`, `SwitchboardSileroVAD`, `SwitchboardWhisper`,
`SwitchboardSherpa`.

**ABIs in the AARs:** `arm64-v8a`, `armeabi-v7a`, `x86_64` — **no `x86`**. The
example/app must therefore exclude `x86` from `reactNativeArchitectures` (Prefab
link fails otherwise). This matches EdgeAudio.

Conclusion: **the full VAD → STT → TTS pipeline is available on Android with the
same architecture as EdgeAudio. No download script is needed on Android** — the
SDK comes from Maven + Prefab, unlike iOS which downloads xcframeworks via
`scripts/postinstall.js`.

---

## 3. Decisions locked in (from user)

1. **SDK version: 3.2.3 on Android** — match the version already proven on iOS.
   No iOS retest. Bump both to 3.2.4 later as a separate change if desired.
2. **Whisper compute: CPU-only on Android first.** iOS uses Metal
   (`useGPU = !isSimulator()`); Android has no Metal. Ship correctness first;
   revisit GPU (Vulkan/OpenCL, if the AAR supports it) as a later optimization.
   → `VoiceEngine.ts` must force `useGPU = false` on Android.
3. **Example app: `expo prebuild --platform android`** on the existing Expo (~54)
   example to generate its `android/` project.

---

## 4. What gets built (component inventory)

New files, all mirroring EdgeAudio with EdgeSpeech naming
(`com.synervoz.edgespeech`, spec `RNEdgeSpeechSpec`, JS module `EdgeSpeech`):

```
android/
├── build.gradle                        # library gradle: codegen + Switchboard Maven/Prefab wiring
├── CMakeLists.txt                      # compiles ../cpp, links Switchboard Prefab + codegen spec
├── gradle.properties                   # androidX + jvmargs (3 lines, copy from EdgeAudio)
└── src/main/
    ├── AndroidManifest.xml             # RECORD_AUDIO + MODIFY_AUDIO_SETTINGS
    └── java/com/synervoz/edgespeech/
        ├── EdgeSpeechPackage.kt        # BaseReactPackage stub (keeps android autolinking alive)
        └── EdgeSpeechAudioSessionModule.kt  # AudioManager comm-mode routing for hardware AEC
```

Modified files:

```
react-native.config.js                  # add the android { cxxModule* } platform block
package.json                            # add "android" to files[] (codegenConfig already Android-ready)
src/VoiceEngine.ts                      # Platform.OS === 'android' branches (see §6)
src/<mic-permission fn>                 # PermissionsAndroid.request(RECORD_AUDIO) on Android
example/…                               # expo prebuild android + arch/NDK tweaks (see §7)
```

**No JNI/C++ Android file is needed.** Like EdgeAudio, the mic-permission hook is
iOS-only (`ios/EdgeSpeechModuleProvider.mm`); on Android the C++
`requestMicrophonePermission` fallback resolves `true` and TS handles the real
request via `PermissionsAndroid`. `isSimulator()` already returns `false` on
non-Apple platforms.

---

## 5. File specifics (concrete drafts)

### `android/build.gradle`
Mirror of EdgeAudio's, with EdgeSpeech names and the 4 extensions it needs:

```groovy
apply plugin: "com.android.library"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

def safeExtGet(prop, fallback) {
    rootProject.ext.has(prop) ? rootProject.ext.get(prop) : fallback
}
def switchboardSdkVersion = "3.2.3"   // matches iOS (scripts/postinstall.js SDK_VERSION)

// Zero-config for the consuming app: our cpp compiles in the APP's native build,
// so inject the Switchboard Maven repo and force-enable Prefab there.
rootProject.allprojects {
    repositories { maven { url "https://s3.amazonaws.com/synervoz-android-maven-repository" } }
}
rootProject.subprojects { sp ->
    sp.plugins.withId("com.android.application") { sp.android.buildFeatures.prefab = true }
}

react {
    jsRootDir = file("../src/")
    libraryName = "RNEdgeSpeechSpec"                       // == codegenConfig.name
    codegenJavaPackageName = "com.synervoz.edgespeech"     // == codegenConfig.android.javaPackageName
}

android {
    namespace "com.synervoz.edgespeech"
    compileSdk safeExtGet("compileSdkVersion", 35)
    defaultConfig { minSdkVersion safeExtGet("minSdkVersion", 24) }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

repositories {
    mavenCentral(); google()
    maven { url "https://s3.amazonaws.com/synervoz-android-maven-repository" }
}

dependencies {
    implementation "com.facebook.react:react-android"
    // `api` so the AARs' Prefab packages are visible to the app's native build.
    api "com.synervoz.switchboard:switchboardsdk:${switchboardSdkVersion}"
    api "com.synervoz.switchboard.extensions:onnx:${switchboardSdkVersion}"
    api "com.synervoz.switchboard.extensions:silerovad:${switchboardSdkVersion}"
    api "com.synervoz.switchboard.extensions:whisper:${switchboardSdkVersion}"
    api "com.synervoz.switchboard.extensions:sherpa:${switchboardSdkVersion}"
}
```

### `android/CMakeLists.txt`
Compiles the shared `cpp/` and links the codegen spec + the 5 Prefab packages
(names verified from the AARs). Loaded into the app build via `react-native.config.js`.

```cmake
cmake_minimum_required(VERSION 3.13)
project(EdgeSpeech)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(EDGESPEECH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp")

# Module name must match react-native.config.js cxxModuleCMakeListsModuleName.
add_library(react-native-edgespeech SHARED "${EDGESPEECH_CPP_DIR}/NativeEdgeSpeech.cpp")
target_include_directories(react-native-edgespeech PUBLIC "${EDGESPEECH_CPP_DIR}")

find_package(SwitchboardSDK REQUIRED CONFIG)
find_package(SwitchboardOnnx REQUIRED CONFIG)
find_package(SwitchboardSileroVAD REQUIRED CONFIG)
find_package(SwitchboardWhisper REQUIRED CONFIG)
find_package(SwitchboardSherpa REQUIRED CONFIG)

target_link_libraries(react-native-edgespeech
    react_codegen_RNEdgeSpeechSpec          # provides RNEdgeSpeechSpecJSI.h / jsi / TurboModule
    SwitchboardSDK::SwitchboardSDK
    SwitchboardOnnx::SwitchboardOnnx
    SwitchboardSileroVAD::SwitchboardSileroVAD
    SwitchboardWhisper::SwitchboardWhisper
    SwitchboardSherpa::SwitchboardSherpa
)
```

> Note: the `cpp/NativeEdgeSpeech.cpp` `#include`s (`OnnxExtension.hpp`,
> `SileroVADExtension.hpp`, `WhisperExtension.hpp`, `SherpaExtension.hpp`) resolve
> from the Prefab include dirs — no header-search-path edits needed if the AAR
> Prefab modules export them (verify during Phase 1; add
> `target_include_directories` only if a header isn't found).

### `react-native.config.js` (add android block)

```js
android: {
  cxxModuleCMakeListsModuleName: 'react-native-edgespeech',
  cxxModuleCMakeListsPath: 'CMakeLists.txt',   // relative to android/, NOT 'android/CMakeLists.txt'
  cxxModuleHeaderName: 'NativeEdgeSpeech',
},
```

### `android/src/main/AndroidManifest.xml`
EdgeSpeech is fully on-device, so **no `INTERNET`** in the library manifest (unlike
EdgeAudio, which streams to OpenAI). Only:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
</manifest>
```

### `EdgeSpeechPackage.kt`
`BaseReactPackage` stub — its only jobs are (a) making autolinking keep the
`android/` config (and thus the Maven/Prefab wiring) and (b) registering the one
JVM module below. Direct rename of EdgeAudio's package to `com.synervoz.edgespeech`
/ `EdgeSpeechAudioSessionModule`.

### `EdgeSpeechAudioSessionModule.kt`
Direct port of EdgeAudio's `OpenAIRealtimeToolkitAudioSessionModule.kt` (rename
only; `NAME = "EdgeSpeechAudioSession"`). Puts `AudioManager` into
`MODE_IN_COMMUNICATION` and routes to headset-else-loudspeaker so the hardware AEC
engages — **required for reliable barge-in** (EdgeSpeech sets
`voiceProcessingEnabled = true` for exactly this). Exposes
`enableCommunicationRoute` / `disableCommunicationRoute` promises.

---

## 6. Shared TypeScript changes

The `src/` layer stays 100% shared; only add small `Platform.OS === 'android'`
branches (the same 2-branch pattern EdgeAudio uses):

1. **Whisper compute (decision #2).** In `VoiceEngine.ts` where the STT node is
   configured, currently `useGPU = !isSimulator()`. Change to
   `useGPU = Platform.OS !== 'android' && !isSimulator()` (i.e. CPU on Android).
2. **Mic permission.** In the mic-permission function, add:
   ```ts
   if (Platform.OS === 'android') {
     const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
     return g === PermissionsAndroid.RESULTS.GRANTED
   }
   // iOS: existing NativeEdgeSpeech.requestMicrophonePermission()
   ```
3. **Audio-session routing (for barge-in/AEC).** Around `listen()`/`speak()`
   start & stop, call the Android-only module when present:
   ```ts
   if (Platform.OS === 'android')
     await NativeModules.EdgeSpeechAudioSession?.enableCommunicationRoute()   // on start
   // …disableCommunicationRoute() on stop
   ```
   (Validate placement against the state machine; see Phase 4.)

No changes to the JSON-RPC layer, `SwitchboardClient`, provider, or hook.

---

## 7. Example app (Android)

The example is Expo ~54 / RN 0.81.5 with no `android/` today.

1. `cd example && npx expo prebuild --platform android` to generate `android/`.
2. `example/android/gradle.properties`: `newArchEnabled=true`, `hermesEnabled=true`,
   and `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64` (**omit `x86`** — the
   Switchboard AARs ship no x86; verified in §2).
3. `example/android/build.gradle` ext: `minSdkVersion 24`, `compileSdkVersion 35`,
   and **`ndkVersion` — likely r29** (see gotcha below).
4. App-side `RECORD_AUDIO` runtime permission (the provider already calls
   `requestMicrophonePermission`).
5. Decide whether to commit the generated `android/` or keep it `.gitignore`d as
   prebuild output (Expo convention is to gitignore; EdgeAudio committed its bare
   example's `android/`). **Open — confirm during Phase 5.**

---

## 8. Known gotchas (carried over from EdgeAudio)

- **NDK r29 may be required.** EdgeAudio found the prebuilt Switchboard `.so`
  references `__cxa_init_primary_exception`, a libc++ symbol absent from the NDK
  r27 `libc++_shared.so` bundled with newer RN — causing `dlopen` to fail at
  launch. RN 0.81 (this example) also defaults to r27. **Action:** verify at
  first run; if it crashes on load, pin `ndkVersion = "29.0.14206865"` in the
  example. Document the requirement in the README.
- **Exclude `x86`** from `reactNativeArchitectures` (verified: AARs have no x86).
- **Prefab compiles in the app build, not the library** — hence the
  `rootProject.allprojects`/`subprojects` injection in `build.gradle`. A consumer
  should need only `npm install` + import.
- **`isSimulator()` returns `false` on Android** already; don't rely on it for the
  GPU decision (handled in TS per §6).

---

## 9. Phased implementation plan

Aligned with the project's phase-based workflow — **check in after each phase.**

**Phase A — Android library scaffolding + build proves out.**
Create `android/` (build.gradle, CMakeLists.txt, gradle.properties, manifest,
`EdgeSpeechPackage.kt`, empty-but-present `EdgeSpeechAudioSessionModule.kt`), add
the `react-native.config.js` android block, add `"android"` to `package.json`
`files[]`. Goal: the shared `cpp/` **compiles and links** against the codegen spec
+ Switchboard Prefab in the example app; app launches with the TurboModule
registered (no pipeline yet). This is where NDK r29 / Prefab / header-path issues
surface.

**Phase B — Listening pipeline (VAD → STT) on Android.**
`expo prebuild android`, wire mic permission (`PermissionsAndroid`), set
`useGPU=false` on Android. Verify `onTranscript` fires end-to-end on a real device.

**Phase C — Speaking pipeline (TTS).**
Verify `speak()` / `stopSpeaking()` play Sherpa TTS through the Android speaker
and `onStateChange` transitions.

**Phase D — Barge-in / AEC.**
Port `EdgeSpeechAudioSessionModule.kt` fully, wire the
`enableCommunicationRoute`/`disableCommunicationRoute` lifecycle calls, and verify
speaking-while-listening interruption fires `onInterrupted` with AEC engaged (test
on Samsung + a Pixel; AEC behaviour differs).

**Phase E — Polish & docs.**
Error handling parity, README Android section (install, NDK note, permissions,
supported ABIs), decide example `android/` commit policy, run
`npm run check`/`lint`/`test`, update `PROGRESS.md`/`CHANGELOG.md`, bump minor
version.

---

## 10. Testing plan

- **JS/TS unit tests** stay platform-agnostic; add cases for the new
  `Platform.OS === 'android'` branches (mock `Platform`, `PermissionsAndroid`,
  `NativeModules.EdgeSpeechAudioSession`).
- **Device testing** on real Android hardware (arm64) — the emulator is x86_64
  (present in AARs) but mic/AEC behaviour is only trustworthy on device.
- **Matrix:** Pixel (clean AOSP audio) + Samsung (AEC quirk that motivated the
  comm-route module) at minSdk 24, a mid API (31, the `setCommunicationDevice`
  boundary), and latest.

---

## 11. Open items to confirm during implementation

1. **Whisper/Sherpa Prefab header export** — confirm the extension `.hpp`s resolve
   from Prefab include dirs; add explicit include dirs in CMake only if not
   (Phase A).
2. **NDK version** — confirm whether RN 0.81 + Switchboard 3.2.3 needs r29 or
   builds on r27 (Phase A).
3. **Example `android/` commit policy** — gitignore prebuild output vs. commit
   (Phase E).
4. **On-device Whisper model provisioning** — confirm how/where the Whisper model
   is delivered on Android vs iOS (iOS bundles via the SDK download; Android via
   the AAR/Prefab or a runtime fetch). Validate in Phase B.

---

## 12. Out of scope (this pass)

- Whisper GPU acceleration on Android (Vulkan/OpenCL) — deferred (decision #2).
- Bumping the SDK to 3.2.4 on either platform — separate change (decision #1).
- Any change to the iOS build, the JSON-RPC protocol, or the public JS API.
