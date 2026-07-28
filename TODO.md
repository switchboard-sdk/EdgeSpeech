# TODO — Android support

Task checklist for adding Android to `@synervoz/edgespeech`. See `Android.md` for
the full plan and locked decisions.

## Phase A — Library scaffolding + build proves out
- [x] `android/build.gradle` (codegen + Switchboard Maven/Prefab wiring)
- [x] `android/CMakeLists.txt` (compile `../cpp`, link Prefab + codegen spec)
- [x] `android/gradle.properties`
- [x] `android/src/main/AndroidManifest.xml` (RECORD_AUDIO + MODIFY_AUDIO_SETTINGS)
- [x] `EdgeSpeechPackage.kt` (BaseReactPackage stub)
- [x] `EdgeSpeechAudioSessionModule.kt` (AudioManager comm-route)
- [x] `react-native.config.js` android block
- [x] `package.json` files[] ships `android`
- [x] `expo prebuild --platform android` on example
- [x] Gradle build proves cpp/ compiles + links against Switchboard Prefab (arm64-v8a) — BUILD SUCCESSFUL, app-debug.apk produced
- [ ] Check in with user

## Phase B — Listening pipeline (VAD → STT)
- [x] `PermissionsAndroid.request(RECORD_AUDIO)` branch in mic-permission fn
- [x] `useGPU = false` on Android in `VoiceEngine.ts`
- [x] Android-branch unit tests (useGPU + permission), 77 tests pass, tsc + eslint clean
- [x] `dist/` rebuilt with Android branches
- [x] Example buildable for device: x86 excluded (durable) + NDK r29 pinned (app module)
- [x] Confirmed model provisioning: AARs ship NO model (iOS bundles in xcframework);
      Whisper.STT loads from absolute `modelPath` (verified in the .so strings)
- [x] Model provisioning implemented (bundle-via-script; both base+tiny):
      `scripts/download-android-models.js`, `EdgeSpeechModelsModule.kt` (asset→filesDir)
- [x] Whisper loads via `loadModel` action (param `modelPath`), Android-only, in
      `createEngine()` — verified from .so; no `initializeModel` key exists; iOS
      auto-loads its bundled model (untouched). 81 tests pass, tsc/eslint clean
- [x] Models downloaded into example assets
- [x] Whisper ggml backends load on device — needed `extractNativeLibs=true` +
      Kotlin `Switchboard.initialize` (registers PlatformInfoProvider → nativeLibraryDir)
- [x] **STT verified on device** — Whisper transcribes (user confirmed "it worked")

## Phase C — Speaking pipeline (TTS)
- [x] Reverse-engineered Sherpa TTS load API from the extension source:
      `ttsNode` `loadModel` action takes `{ modelPath, tokensPath, dataPath }`
      (Android auto-resolver uses cwd → unusable, so explicit load required)
- [x] Provisioning: `download-android-models.js` fetches `en_GB.zip` into assets;
      `EdgeSpeechModelsModule.prepareArchive()` unzips it to filesDir on first run
- [x] `VoiceEngine.ensureAndroidTtsModel()` loads the voice via `loadModel` lazily
      on first `speak()` (Android); iOS auto-loads framework voice. 84 tests pass
- [x] **TTS verified on device** — `[SherpaTTSNode] TTS model loaded successfully`,
      audible speech (user confirmed). Explicit `loadModel` w/ filesDir paths works
- [ ] (optional) bundle de_DE voice too (currently en_GB only in the example)

## Phase D — Barge-in / AEC
- [ ] Wire `enableCommunicationRoute`/`disableCommunicationRoute` lifecycle calls
- [ ] Verify `onInterrupted` with AEC engaged (Samsung + Pixel)

## Phase E — Polish & docs
- [x] **Mic-permission gate before engine `start`** — `listen()`/`speak()` now call
      `ensureAndroidMicPermission()` (Android-only) which `PermissionsAndroid.check`s
      `RECORD_AUDIO` and throws a clean `PERMISSION_DENIED` before the engine opens the
      mic (was: SDK SIGSEGV in `AudioEngineOboe::initInputStream`). Checks (never
      prompts) — caller uses `requestMicrophonePermission()` first; iOS is a no-op.
      Example already compatible (requests first + wrapped calls surface errors).
      3 new unit tests; 87 pass, tsc/eslint/build clean. Device re-test pending.
- [x] README Android section (Expo + bare-RN paths, Maven repo, NDK, x86, models)
- [x] Durable Android config authored — `expo-build-properties` block
      (`extraMavenRepos` + `useLegacyPackaging` + `buildArchs`) in example `app.json`
      + `expo-build-properties@~1.0.10` in `package.json`. NDK is a **documented**
      `app/build.gradle` edit (no config plugin — EBP has no `ndkVersion` key).
      Ownership split + decisions in `RN.md`; README both paths synced.
- [x] Verified via `npm install` + `expo prebuild -p android --clean` (Node 26 —
      clears RN/Metro's `>=20.19.4` floor). Clean regen landed the 3 EBP settings:
      `reactNativeArchitectures` + `expo.useLegacyPackaging` in `gradle.properties`, and
      the Maven repo as `android.extraMavenRepos` (injected at **settings scope** by
      `useExpoModules()`, settings.gradle:32 — correctly timed under
      `--configure-on-demand`, unlike the library's subproject injection). NDK is **not**
      auto-pinned by prebuild (documented manual edit, by design).
- [x] On-device build/install confirmed (SM_G780G, clean caches → prebuild → NDK pin →
      `expo run:android`): BUILD SUCCESSFUL, `app-debug.apk` installed. Verified in the APK:
      all 3 models under `assets/models/…` (merged from library assets), Switchboard libs +
      ggml CPU backends in `lib/arm64-v8a/`. Live-exercised: EBP Maven injection
      (`Adding extra maven repository` at build), useLegacyPackaging, x86 dropped, NDK r29.
- [ ] Interactive STT/TTS + mic-gate voice-loop check on device (needs Metro running)
- [x] Auto-provision Android models via `postinstall` (like iOS frameworks) — downloads
      into the **library's** `android/src/main/assets/models/` (asset-merged into the APK,
      works Expo + bare RN); warn-don't-fail, `EDGESPEECH_SKIP_ANDROID_MODELS` opt-out.
      `files` excludes the models from publish; `.gitignore` already covers them.
- [x] `download-android-models.js` decoupled from `example/` — default target is now the
      library's own assets; exports `downloadAndroidModels()`, CLI-guarded, shipped in `files`.
- [ ] `[AssetsManager] Failed to create assets directory at path: output` warning
- [ ] iOS regression check (`npx expo run:ios`) — init path is Platform-gated
- [ ] Example `android/` commit policy; CHANGELOG + version bump
