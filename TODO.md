# TODO

Task checklist for the TurboModule + JSON-RPC refactor. See `TURBO.md` for the plan.

## Phase 0 — Verification ✅
- [x] Confirm 3.2.3 ships `SwitchboardJSONRPC.hpp` + `createEngine`
- [x] Verify Whisper/Sherpa/SileroVAD/Onnx extension headers + namespaces
- [x] Resolve node addressing (bare names) + graph createEngine shape

## Phase 1 — TurboModule scaffold (iOS) ✅ (JS verified; native build pending)
- [x] `src/NativeEdgeSpeech.ts` codegen spec
- [x] `src/RPCClient.ts`, `NativeModuleRPCClient.ts`, `SwitchboardClient.ts`
- [x] `src/VoiceEngine.ts` (port of AudioGraphManager.swift)
- [x] Rewrite `src/SwitchboardVoiceModule.ts` façade (public API unchanged)
- [x] `cpp/NativeEdgeSpeech.{h,cpp}` + `ios/EdgeSpeechModuleProvider.{h,mm}`
- [x] `react-native.config.js`, podspec, `package.json` codegenConfig + version 1.1.0
- [x] Delete Swift files, `expo-module.config.json`, `shared/`
- [x] `src/__mocks__/NativeEdgeSpeech.ts`
- [x] tsc clean, jest green (76), build clean, lint clean
- [ ] **iOS example build & load** (`npx expo run:ios`) — needs framework download; verify a real processCommand round-trip on device/simulator

## Phase 2 — Listening pipeline (VAD → STT) — verify on device
- [ ] Confirm live STT transcripts in the example
- [ ] Confirm real event JSON shape (objectURI / data.text) matches dispatch()

## Phase 3 — Speaking + barge-in — verify on device
- [ ] Confirm TTS playback + `onTTSComplete`
- [ ] Confirm barge-in interrupts TTS on real speech

## Phase 4 — Polish
- [ ] Expand VoiceEngine unit tests as needed
- [ ] Error-code mapping review
- [ ] README + CHANGELOG (flag: New Arch required, RN ≥0.81, Expo removed)

## Phase 5 — Android (deferred)
- [ ] CMakeLists, build.gradle, Kotlin package, Prefab AARs, mic module
