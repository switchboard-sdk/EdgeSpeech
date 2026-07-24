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
- [ ] `onTranscript` fires end-to-end on device (USER to test on phone)

## Phase C — Speaking pipeline (TTS)
- [ ] Sherpa TTS plays through Android speaker; `onStateChange` transitions

## Phase D — Barge-in / AEC
- [ ] Wire `enableCommunicationRoute`/`disableCommunicationRoute` lifecycle calls
- [ ] Verify `onInterrupted` with AEC engaged (Samsung + Pixel)

## Phase E — Polish & docs
- [ ] Durable NDK r29 + arch (x86-excluded) via `expo-build-properties`
- [ ] README Android section (install, NDK note, permissions, ABIs)
- [ ] Example `android/` commit policy (gitignore vs commit)
- [ ] Android-branch JS unit tests; `npm run check`/`lint`/`test`
- [ ] CHANGELOG + version bump
