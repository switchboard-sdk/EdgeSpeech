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
- [x] Models downloaded into example assets; app build sets `noCompress += ['bin']`
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
- [ ] **Mic-permission gate before engine `start`** — SDK segfaults
      (`AudioEngineOboe::initInputStream`) if `RECORD_AUDIO` not granted. Gate
      `listen()`/`speak()` on permission; example must request before starting.
- [x] README Android section (Expo + bare-RN paths, Maven repo, NDK, x86, models)
- [ ] Durable Android config via `expo-build-properties` (Maven `extraMavenRepos`,
      NDK) — example config currently git-ignored, not clean-clone reproducible
- [ ] Parameterize `download-android-models.js` (drop `example/` default coupling)
- [ ] `[AssetsManager] Failed to create assets directory at path: output` warning
- [ ] iOS regression check (`npx expo run:ios`) — init path is Platform-gated
- [ ] Example `android/` commit policy; CHANGELOG + version bump
