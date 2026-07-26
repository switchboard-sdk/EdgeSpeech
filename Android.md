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

---

## 13. App-side configuration reference (Expo vs Bare RN)

Verified during on-device bring-up (Samsung SM-G780G). This supersedes the
"likely r29 / may be required" hedging in §7–§8 — every item below is confirmed.

EdgeSpeech is a **C++ TurboModule** that autolinks into either an Expo or a bare
React Native app; it does **not** use the Expo Modules API. Autolinking makes the
library a **Gradle subproject of the consuming app's build**, and the C++ compiles
in the *app's* native build (Prefab-linking the Switchboard AARs) — so the app, not
the library, must be able to resolve and package those native deps.

### Ownership principle

The split follows a standards-based line (not "force everything from the library"):

- **The library owns its dependency source of truth** — the Switchboard Maven repo
  URL and the setup instructions live in the library/README. On bare RN the library
  injects it automatically; on Expo the app declares it in one documented line
  (transparent, and what Expo's docs recommend — see the decision below).
- **The app owns its build toolchain** — NDK version, target ABIs, packaging. A
  library imposes *requirements* on these, but it should **document** them, not seize
  them. Silently pinning a consumer's NDK or restricting their ABIs can conflict with
  their other native deps. This is exactly what `expo-build-properties` is for.

We deliberately do **not** force NDK / ABIs / packaging from a library config plugin
— that's beyond ecosystem norms; libraries in this position document toolchain
requirements rather than override them.

### What the library owns (no app action needed)

- **C++ TurboModule compile + Prefab link wiring** (`react-native.config.js`
  `cxxModule*` keys + `android/CMakeLists.txt`).
- **`RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`** — declared in the library manifest,
  merged into every app. Request `RECORD_AUDIO` at runtime via
  `requestMicrophonePermission()`; nothing to declare app-side.
- **Switchboard Maven repo — bare RN only.** The `rootProject.allprojects` injection
  in the library's `android/build.gradle` reaches the consumer (bare RN doesn't use
  `--configure-on-demand`, and RN's default repo mode honors project repositories). No
  app step. *(Verified on Expo; bare RN is "should work," untested in this repo.)* On
  **Expo** the app declares the repo instead — see the table and decision below.

### App-side settings (the app's own build config)

Each row shows how the **app** satisfies a requirement the library imposes.

| Setting | Required? | **Expo** | **Bare RN** (committed `android/`) |
|---|---|---|---|
| New Architecture | hard | `newArchEnabled: true` in `app.json` (default) | `newArchEnabled=true` in `gradle.properties` (default RN 0.76+) |
| Switchboard Maven repo | hard | `expo-build-properties` → `extraMavenRepos` (one line, folds into the EBP block; see decision) | **nothing** — autolink injects it, unless the app uses `FAIL_ON_PROJECT_REPOS` → declare in `android/build.gradle` |
| `useLegacyPackaging` / `extractNativeLibs` | hard (`ggml_abort` — Whisper `dlopen`s its ggml CPU backends off disk) | `expo-build-properties` → `useLegacyPackaging: true` | `packagingOptions { jniLibs { useLegacyPackaging true } }` in `app/build.gradle` |
| Drop 32-bit `x86` | hard (AARs ship `arm64-v8a`/`armeabi-v7a`/`x86_64` only) | `expo-build-properties` → `buildArchs` | `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64` in `gradle.properties` |
| NDK r29 (`29.0.14206865`) | hard (`dlopen` fails at launch — the prebuilt `.so` needs `__cxa_init_primary_exception`, absent from the r27 default) | **small app-side config plugin** (`expo-build-properties` has no `ndkVersion` key) + `sdkmanager --install "ndk;29.0.14206865"` | `ndkVersion "29.0.14206865"` in `app/build.gradle` + `sdkmanager` install |
| `noCompress += ['bin']` | optional (cheaper filesDir copy + reliable `openFd` size-check; copy still works without it) | same small app-side config plugin | `androidResources { noCompress += ['bin'] }` in `app/build.gradle` |
| Models into `assets/` | hard (not bundled in the AARs — iOS bakes them into the xcframeworks) | `download-android-models.js` → `android/app/src/main/assets` (run **after** `expo prebuild`) | `download-android-models.js` → `android/app/src/main/assets` |
| Mic permission | hard | **nothing to declare** (library merges); request at runtime | **nothing to declare** (library merges); request at runtime |

### Things to notice across the bases

1. **Bare RN's surface is simplest** — no plugins anywhere: the repo comes free from
   autolinking, and a few committed edits to `gradle.properties` + `app/build.gradle`
   cover the rest.
2. **The only Expo-specific custom code is the app-side NDK plugin.** It exists purely
   because `prebuild` wipes manual `android/` edits and `expo-build-properties` has no
   `ndkVersion` / `noCompress` key. It's *app-owned* (in `example/plugins/`), tiny, and
   touches only what has no declarative path — the app pinning its own toolchain.
3. **Everything else on Expo is declarative** via `expo-build-properties` (repo,
   packaging, ABIs) — no library config plugin (see decision).

### Concrete artifacts per base

**Expo** (this repo's example) — `app.json`:

```json
"plugins": [
  ["expo-build-properties", {
    "android": {
      "extraMavenRepos": ["https://s3.amazonaws.com/synervoz-android-maven-repository"],
      "useLegacyPackaging": true,
      "buildArchs": ["armeabi-v7a", "arm64-v8a", "x86_64"]
    }
  }],
  "./plugins/withEdgeSpeechNdk"    // app-owned → ndkVersion + noCompress
]
```

Plus `expo-build-properties` in `package.json` and the model-download step. Because
Expo regenerates `android/` on every `prebuild`, all of this must live in `app.json` /
the plugin to be clean-clone reproducible (this is the "durable Android config" task).

**Bare RN** (documented in the README; no bare example shipped) — committed edits:

```gradle
// android/gradle.properties
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64

// android/app/build.gradle → android { }
ndkVersion "29.0.14206865"
packagingOptions { jniLibs { useLegacyPackaging true } }
androidResources { noCompress += ['bin'] }
// Maven repo: nothing (autolinked) unless the app uses FAIL_ON_PROJECT_REPOS
```

Plus `sdkmanager --install "ndk;29.0.14206865"` and the model-download step.

### Decision — Maven repo on Expo: declare `extraMavenRepos` (no library config plugin)

We considered shipping a library Expo config plugin
(`@synervoz/edgespeech/app.plugin.js`) to inject the repo, and **rejected it** in
favour of documenting `extraMavenRepos`. Rationale:

- **No net simplification for the consumer.** They already need an
  `expo-build-properties` block (for `useLegacyPackaging` + `buildArchs`); the repo is
  one more key in it. A library plugin would instead add a *separate* `plugins`
  entry — same or more surface, just relocating the URL.
- **Cost to the library.** A maintained `app.plugin.js` + an `@expo/config-plugins`
  dependency + compat risk across Expo SDK versions — all to move a single stable URL.
- **Transparency.** An explicit `extraMavenRepos` line is visible to the consumer and
  compatible with `FAIL_ON_PROJECT_REPOS` setups; silently injecting a remote repo is
  what those setups guard against. Expo's docs recommend documenting the repo for
  libraries with custom dependencies.
- **A config plugin earns its keep for *many/complex* native edits** (permissions +
  entitlements + manifest + gradle deps). One repo URL doesn't clear that bar — and we
  deliberately removed the things that would have (forcing NDK/ABIs/packaging).

Bare RN is unchanged (autolink injection). The `withEdgeSpeechNdk` app-side plugin is
unaffected — it's the app pinning its own toolchain, the one thing with no declarative
path on Expo.

The example app in this repo is the **Expo** column; the bare-RN column is what a
README-following consumer does — this repo ships no bare-RN example.
