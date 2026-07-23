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
- [ ] `PermissionsAndroid.request(RECORD_AUDIO)` branch in mic-permission fn
- [ ] `useGPU = false` on Android in `VoiceEngine.ts`
- [ ] Confirm Whisper model provisioning on Android
- [ ] `onTranscript` fires end-to-end on device/emulator

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
