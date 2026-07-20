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
- [x] **iOS example builds, loads, and runs** — TurboModule registers, processCommand
      round-trips, SDK inits (Onnx/Silero/Whisper/Sherpa), app renders (Status: idle)
- [x] Fix: expose `./package.json` in `exports` (clean-build codegen discovery)
- [x] Fix: Silero extension name + `Silero.VAD` node type (C++ vs Obj-C naming)
- [x] Fix: graceful "already been initialized" handling across JS reloads
- [x] From-scratch clean build (`rm -rf example/ios && expo run:ios`) — first-build
      provider map now includes EdgeSpeech; runtime registers + SDK inits cleanly
- [x] On-device (physical iPhone 13 Pro): **live STT and TTS confirmed working**
- [ ] On-device: confirm barge-in (interrupt TTS by speaking)

## Phase 2 — Listening pipeline (VAD → STT) — verify on device
- [ ] Confirm live STT transcripts in the example
- [ ] Confirm real event JSON shape (objectURI / data.text) matches dispatch()

## Phase 3 — Speaking + barge-in — verify on device
- [ ] Confirm TTS playback + `onTTSComplete`
- [ ] Confirm barge-in interrupts TTS on real speech

## Tech debt (see TECH_DEBT.md)
- [ ] #1: replace the "already initialized" error-string match in `VoiceEngine.initialize`
      with a stable code / init-state check

## Phase 4 — Polish
- [ ] Expand VoiceEngine unit tests as needed
- [ ] Error-code mapping review
- [ ] README + CHANGELOG (flag: New Arch required, RN ≥0.81, Expo removed)

## Phase 5 — Android (deferred)
- [ ] CMakeLists, build.gradle, Kotlin package, Prefab AARs, mic module
