# Android Bring-up Fixes

Concise record of what it took to get EdgeSpeech (a C++ TurboModule wrapping the
Switchboard SDK) running on Android, and why each fix was needed. STT (Whisper) +
TTS (Sherpa) verified on-device, fully local.

## Fixes

1. **Maven repo not found** (`Could not find com.synervoz.switchboard:*`).
   `expo run:android` builds Gradle with `--configure-on-demand`, so `:app` resolves
   its classpath *before* the library subproject applies its `allprojects` repo
   injection. → Declare the Switchboard Maven repo in the **app** (`extraMavenRepos`
   / root `build.gradle`). A library can't reliably inject a repo into its consumer.

2. **Prefab link fails for x86.** The Switchboard AARs ship `arm64-v8a`,
   `armeabi-v7a`, `x86_64` only. → Drop 32-bit `x86` from `reactNativeArchitectures`
   (`buildArchs` on Expo).

3. **`dlopen` crash at launch.** The prebuilt Switchboard `.so` needs a libc++
   symbol (`__cxa_init_primary_exception`) missing from the default NDK r27. → Pin
   **NDK r29** (`android.ndkVersion` on the app module).

4. **Models not on device.** Android AARs bundle no model (iOS bakes them into the
   xcframeworks). → Ship the models in the app's `assets/`, copy/unzip them to
   `filesDir` natively on first use, and load them explicitly: Whisper `loadModel
   {modelPath}`, Sherpa `loadModel {modelPath, tokensPath, dataPath}`. Whisper runs
   **CPU-only** on Android (no Metal).

5. **ggml abort** (`ggml_backend_dev_backend_reg` → `abort`). Whisper `dlopen`s its
   ggml CPU backends (`libggml-cpu-*.so`) from a directory, found via two things
   that were both missing:
   - **`extractNativeLibs=true`** (`useLegacyPackaging=true`) so the `.so`s exist on
     disk instead of packed inside the APK.
   - **`PlatformInfo::getNativeLibraryPath()`** — populated only by the SDK's Kotlin
     `PlatformInfoProvider`, which is registered inside `Switchboard.initialize(context)`.
     Our C++-only init has no `Context`, so it was empty. → On Android, initialize
     the SDK through **Kotlin `Switchboard.initialize(context, …)`**; use the C++
     JSON-RPC channel for everything else.

6. **`AudioEngineOboe::initInputStream` SIGSEGV.** Starting the combined mic+speaker
   engine opens the mic; the SDK segfaults (null deref) when `RECORD_AUDIO` isn't
   granted. → Grant mic permission **before** the engine `start` (gate `listen()`/
   `speak()` on it; request it in the app before starting).

## What we learned about React Native

- **Autolinking makes a library a *subproject* of the consuming app's Gradle build**
  — not its own build. It's a guest in the app's build graph (`project :app >
  project :synervoz_edgespeech`), which is why the library can *influence* but not
  *own* the app's configuration.
- **A library cannot reliably add a Maven repository to its consumer.** Gradle
  doesn't propagate repositories transitively, and the `allprojects` injection hack
  is timing-fragile — it breaks under `--configure-on-demand` (which the Expo CLI
  uses, but the RN CLI doesn't). Custom repos are a documented consumer install step.
- **Expo vs bare RN differ mostly in tooling, not the library.** Same autolinking,
  same injection — but `expo run:android` adds `--configure-on-demand`, and Expo
  git-ignores/regenerates `android/`+`ios/` (source of truth = `app.json` +
  config plugins / `expo-build-properties`). Bare RN commits native dirs.
- **C++ (Cxx) TurboModules compile in the *app's* native build**, not the library's
  (`react-native.config.js` `cxxModule*` keys + a `CMakeLists.txt`), linking native
  deps via **Prefab**. So the app must be able to resolve those AARs.
- **New Architecture is bridgeless** — synchronous/blocking legacy-module methods
  are unreliable; prefer async (Promises).
- **Native libs are packed in the APK by default** (`extractNativeLibs=false`). Any
  native code that `dlopen`s sibling `.so`s at runtime needs `extractNativeLibs=true`.
- **Some setup can only happen in Kotlin/native**, not JS. Things needing an Android
  `Context` (native-lib dir, asset dirs, permissions) can't be done over a JS/JSON-RPC
  `setValue` — they need a real native entry point.
- **Debug native crashes from the tombstone.** `SIGABRT`/`SIGSEGV` + the *lower*
  backtrace frames name the culprit `.so`; the "Abort message" often names the cause.
  A JS-thread crash (`mqt_v_js`) with `libhermes`/`libreactnative` at the top is a
  native call *from JS* failing — keep reading down to the real frame.
