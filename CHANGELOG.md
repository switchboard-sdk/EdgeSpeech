# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

Internal re-architecture to a bare React Native **C++ TurboModule** driven over a single
**JSON-RPC 2.0** channel, replacing the Expo Modules (Swift) implementation. All voice-pipeline
logic (VAD → STT → TTS graph, state machine, barge-in) now lives in TypeScript; the native layer
is a thin delegate over the Switchboard SDK's `SwitchboardJSONRPC`.

**The public JavaScript API is unchanged** — `EdgeSpeech`, `EdgeSpeechProvider`, and
`useEdgeSpeech` behave exactly as in 1.0.x. This is a build/architecture change, not an API change.

### Changed

- Native bridge is now a C++ TurboModule (`processCommand` JSON-RPC channel + event emitter).
- Voice graph, state machine, barge-in, and event handling ported from Swift to TypeScript.

### Removed

- Expo Modules API dependency (`expo-modules-core`) and the Swift Expo module.

### Build requirements (action needed when upgrading from 1.0.x)

- **New Architecture is now required** (Fabric/TurboModules must be enabled).
- Minimum **React Native raised to 0.81** (was 0.74).
- No longer depends on `expo-modules-core`; works in both Expo (prebuild) and bare RN apps.

## [Unreleased]

### Changed — BREAKING

- `VoiceState` now separates "the SDK is not up" from "the SDK is up and waiting":
  `'idle' | 'initializing' | 'ready' | 'listening' | 'processing' | 'speaking'`.
  **`'idle'` has changed meaning** — it no longer means "ready and waiting", it means the SDK is
  not initialized (either `initialize()` has not run, or it failed). The initialized-and-waiting
  state is now `'ready'`. Code that gates on `voiceState === 'idle'` must move to `'ready'`;
  because both are valid `VoiceState` values, TypeScript will **not** flag the change for you.
- A failed `initialize()` now reports `'idle'` instead of looking indistinguishable from a ready
  engine; the cause still arrives via `onError` / the hook's `error`.
- `stopListening()` and a `stopSpeaking()` with no listening session now emit `'ready'`
  (previously `'idle'`).
- **One STT model and one TTS voice on both platforms.** Whisper `base.en` and the `en_GB` Piper
  voice — the same ones the iOS frameworks bake in — are now fixed, so the two platforms behave
  identically.

### Added

- `'initializing'` state, covering SDK startup and the Android STT/TTS model staging. A
  `listen()`/`speak()` issued during it waits rather than failing.
- `useEdgeSpeech().voiceState` is seeded from the engine's current state, so a component that
  mounts mid-initialization reads `'initializing'` rather than a stale value.
- Initial project scaffolding
- TurboModule architecture for React Native bridge
- iOS native module setup
- TypeScript types and configuration

### Removed

- `useEdgeSpeech().isInitializing` — replaced by `voiceState === 'initializing'`.
- `sttModel` config option (`EdgeSpeechProvider` prop, `EdgeSpeech.configure()`, `VoiceConfig`).
  It only ever did anything on Android; iOS ships `base.en` alone inside
  `SwitchboardWhisper.framework`, with no CoreML encoder for any other model.
- `ttsVoice` config option. Same asymmetry: `Sherpa.TTS` hardcodes English in its constructor, so
  on iOS the value was silently ignored while on Android a typo threw `TTS_VOICE_UNAVAILABLE`.
- `edgespeechModels` Gradle property — the model set is fixed, so there is nothing to override.

## [0.1.0] - TBD

### Added

- On-device VAD (Voice Activity Detection) with Silero VAD
- On-device STT (Speech-to-Text) with Whisper
- On-device TTS (Text-to-Speech) with Silero
- Barge-in/interruption handling
- Event-based callback API
- Example application
- iOS support

[Unreleased]: https://github.com/yourusername/switchboard-voice-rn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/switchboard-voice-rn/releases/tag/v0.1.0
