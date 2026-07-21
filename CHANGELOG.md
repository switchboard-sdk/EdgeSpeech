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

### Added

- Initial project scaffolding
- TurboModule architecture for React Native bridge
- iOS native module setup
- TypeScript types and configuration

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
