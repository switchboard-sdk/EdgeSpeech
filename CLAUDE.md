MOST IMPORTANT: Don't make any assumptions without asking my opinion.

## Environment Requirements

- **Node.js 20+** required (use `nvm use 20` before running npm/expo commands)
- **Don't call `pod install` directly** - use `npx expo run:ios` instead (CocoaPods is deprecated in React Native)

## Process Management

- Keep a log of your work in `PROGRESS.md` (session-based chronological log)
- Maintain TODO list in `TODO.md` (task checklist organized by phase)
- Don't work in /tmp, use ./tmp and git ignore it
- Check in with the user after completing each phase before moving to the next phase

# Switchboard Voice Toolkit for React Native

## Project Goal

Build a **React Native library** (npm package) that wraps Switchboard SDK's on-device voice processing into a simple text-based callback interface. Ship with an example app that demonstrates usage.

**Platform:** iOS only (initial release)
**Language:** English only (initial release)

## Repository Purpose

**The primary deliverable is the React Native module** - not the example app. The example exists only to demonstrate how to use the module.

**User workflow:**

1. Clone this repo
2. Run setup scripts (to download SDK frameworks)
3. Build and run the example app to verify everything works
4. Use the module in their own React Native app

The module must be usable independently of the example app. Users should be able to import it into their own projects.

## Deliverables

1. **`switchboard-voice-rn`** - The React Native library (npm package) - **PRIMARY**
2. **`example/`** - A minimal app that demonstrates the library

## Core Value Proposition

Voice AI developers work entirely in text. The library handles all audio complexity:

- On-device VAD (Voice Activity Detection)
- On-device STT (Speech-to-Text via Whisper)
- On-device TTS (Text-to-Speech via Silero)
- Simple JavaScript callbacks and methods

## Target API

```typescript
import { SwitchboardVoice } from 'switchboard-voice-rn'

// Configuration
SwitchboardVoice.configure({
  sttModel: 'whisper-base-en',
  ttsVoice: 'silero-en-us',
  vadSensitivity: 0.5,
})

// Event handlers
SwitchboardVoice.onTranscript = (text: string, isFinal: boolean) => {}
SwitchboardVoice.onInterrupted = () => {}
SwitchboardVoice.onError = (error: VoiceError) => {}
SwitchboardVoice.onStateChange = (state: VoiceState) => {}

// Actions
await SwitchboardVoice.start()
await SwitchboardVoice.stop()
await SwitchboardVoice.speak(text)
await SwitchboardVoice.stopSpeaking()
```

## Project Structure

```
switchboard-voice-rn/
├── CLAUDE.md
├── package.json                     # Library package config
├── tsconfig.json
├── switchboard-voice-rn.podspec    # CocoaPods spec for iOS native code
├── src/                             # JS/TS source for the library
│   ├── index.ts                     # Main export
│   ├── SwitchboardVoice.ts          # JS API wrapper
│   └── types.ts                     # TypeScript definitions
├── ios/                             # Native iOS implementation
│   ├── SwitchboardVoiceModule.swift
│   ├── SwitchboardVoiceModule.m     # RN bridge header
│   ├── AudioGraphManager.swift      # Manages Switchboard graphs
│   └── Bridging-Header.h
└── example/                         # Example app (separate RN project)
    ├── package.json                 # Depends on parent library
    ├── App.tsx
    ├── ios/
    │   └── Podfile                  # Links to parent library
    └── ...
```

## Library vs App Separation

### The Library (`/src`, `/ios`)

- No UI code
- Exposes `SwitchboardVoice` API
- Handles all Switchboard SDK integration
- Published to npm

### The Example App (`/example`)

- Imports library via `"switchboard-voice-rn": "link:.."`
- Demonstrates the full voice loop
- Minimal UI: start button, transcript display, text input for TTS

## Reference Implementations

### Primary Reference: daw-react-native

```
git@github.com:switchboard-sdk/daw-react-native.git
```

Use this as the structural reference for:

- React Native library structure (not app structure)
- Podspec configuration for Switchboard extensions
- Native module bridging patterns
- How to link an example app to the parent library

Pull apart and adapt patterns from this codebase freely.

### Secondary Reference: voice-app-control-example-ios

```
https://github.com/switchboard-sdk/voice-app-control-example-ios
```

Native iOS example showing VAD + Whisper STT pipeline. Key patterns:

- JSON-based AudioGraph configuration
- Silero VAD → Whisper STT node connections
- Event listener setup for transcription callbacks

## AudioGraph Configurations

### Node Types (SDK 3.1.0)

| Extension   | Node Type       | Action                                |
| ----------- | --------------- | ------------------------------------- |
| SileroVAD   | `SileroVAD.VAD` | -                                     |
| Whisper STT | `Whisper.STT`   | `transcribe` (params: `start`, `end`) |
| Sherpa TTS  | `Sherpa.TTS`    | `synthesize` (param: `text`)          |

Note: Engine type is `"Realtime"` (not `"RealTimeGraphRenderer"`).

### Event Names (IMPORTANT)

For `SileroVAD.VAD` node:

- **Events**: `speechStarted`, `speechEnded` (NOT `start`/`end`)
- **Data connection format**: `vadNode.speechEnded` → `sttNode.transcribe`

For `Whisper.STT` node:

- **Events**: `transcription` (returns transcript text)
- **Actions**: `transcribe` (params: `start`, `end` sample positions from VAD)

The `speechEnded` event provides `start` and `end` timestamps that are automatically passed to the STT `transcribe` action via the data connection.

### Listening Graph (VAD → STT)

```json
{
  "type": "Realtime",
  "config": {
    "microphoneEnabled": true,
    "graph": {
      "config": {
        "sampleRate": 16000,
        "bufferSize": 512
      },
      "nodes": [
        { "id": "multiChannelToMonoNode", "type": "MultiChannelToMono" },
        { "id": "busSplitterNode", "type": "BusSplitter" },
        { "id": "vadNode", "type": "SileroVAD.VAD", "config": { "minSilenceDurationMs": 100 } },
        {
          "id": "sttNode",
          "type": "Whisper.STT",
          "config": { "initializeModel": true, "useGPU": true }
        }
      ],
      "connections": [
        { "sourceNode": "inputNode", "destinationNode": "multiChannelToMonoNode" },
        { "sourceNode": "multiChannelToMonoNode", "destinationNode": "busSplitterNode" },
        { "sourceNode": "busSplitterNode", "destinationNode": "vadNode" },
        { "sourceNode": "busSplitterNode", "destinationNode": "sttNode" },
        { "sourceNode": "vadNode.speechEnded", "destinationNode": "sttNode.transcribe" }
      ]
    }
  }
}
```

### TTS Graph

```json
{
  "type": "Realtime",
  "config": {
    "speakerEnabled": true,
    "graph": {
      "config": {
        "sampleRate": 16000,
        "bufferSize": 512
      },
      "nodes": [{ "id": "ttsNode", "type": "Sherpa.TTS", "config": { "voice": "en_GB" } }],
      "connections": [{ "sourceNode": "ttsNode", "destinationNode": "outputNode" }]
    }
  }
}
```

## Implementation Phases

### Phase 1: Library Scaffolding

1. Set up library structure based on daw-react-native patterns
2. Configure podspec with Switchboard SDK dependencies
3. Create example app that links to parent library
4. Verify the linking works (empty native module)

### Phase 2: Listening Pipeline (VAD → STT)

1. Implement native iOS module with Switchboard SDK init
2. Build VAD → STT audio graph
3. Bridge `onTranscript` events to JS
4. Implement `start()` and `stop()` methods
5. Test in example app

### Phase 3: Speaking Pipeline (TTS)

1. Build TTS audio graph
2. Implement `speak(text)` method
3. Implement `stopSpeaking()` method
4. Bridge `onStateChange` events

### Phase 4: Interruption Handling

1. Detect VAD activity during TTS playback
2. Implement barge-in logic
3. Bridge `onInterrupted` events

### Phase 5: Polish

1. Error handling and `onError` events
2. Microphone permission handling
3. Configuration validation
4. TypeScript types export
5. README and documentation

## Key Behaviours

### State Machine

```
idle → listening → processing → idle
                ↘            ↗
                  speaking
```

### Transcript Events

- `isFinal: false` - Interim result, may change
- `isFinal: true` - Final transcript, VAD detected end of speech

### Interruption (Barge-in)

When VAD detects speech during TTS playback:

1. Stop TTS immediately
2. Fire `onInterrupted()`
3. Route audio to STT
4. Fire `onTranscript()` when ready

### TTS Queue Behaviour

Default: Queue sequential `speak()` calls. Play in order.

## Switchboard SDK Dependencies

### iOS Extensions Required

- SwitchboardSDK (core)
- SwitchboardWhisper (STT)
- SwitchboardSileroVAD (VAD)
- SwitchboardSilero (TTS) - verify extension name

### Initialization

```swift
SBSwitchboardSDK.initialize(withAppID: "YOUR_APP_ID", appSecret: "YOUR_APP_SECRET")
SBWhisperExtension.initialize(withConfig: [:])
SBSileroVADExtension.initialize(withConfig: [:])
// + TTS extension init
```

## Development Practices

### Test-Driven Development

1. Write tests before implementation where practical
2. Unit test the JS/TS layer independently of native code
3. Create mock native modules for JS testing
4. Test edge cases: rapid start/stop, speak during speak, empty strings

### Code Quality

1. Use TypeScript strict mode
2. ESLint + Prettier for JS/TS
3. SwiftLint for iOS native code
4. No `any` types - define explicit interfaces
5. Document public API with JSDoc/TSDoc comments

### Git Practices

1. Small, focused commits with clear messages
2. Conventional commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
3. Keep native and JS changes in separate commits where possible
4. Tag releases with semantic versioning

### Error Handling

1. Never swallow errors silently
2. Provide actionable error messages
3. Use typed error codes, not just strings
4. Log errors with context (what was happening, what state)

### API Design Principles

1. Fail fast with clear errors rather than silent degradation
2. Sensible defaults for all optional config
3. Async methods return Promises, not callbacks
4. Events use a consistent naming pattern
5. No breaking changes without major version bump

### Documentation

1. README with quick start, installation, API reference
2. Inline code comments for non-obvious logic
3. Example app serves as living documentation
4. CHANGELOG maintained with each release

### Dependency Management

1. Pin exact versions in package.json
2. Minimal dependencies - only what's necessary
3. Audit dependencies for security
4. Document why each dependency exists

## Notes for Claude Code

1. Clone daw-react-native first to understand the library structure
2. The library ships native code - this is a native module, not a JS-only package
3. Whisper STT requires 16000 Hz sample rate
4. App ID and App Secret should be passed via `configure()` or use placeholders
5. Test the native module in isolation before wiring up all events
6. Microphone permission must be requested before `start()`
7. Run tests frequently - don't let them pile up
8. Prefer explicit over clever - this is a public API

## Example App Behaviour

Minimal demo showing the round trip:

1. User taps "Start Listening"
2. User speaks: "Hello world"
3. Transcript appears on screen
4. User types response text, taps "Speak"
5. TTS plays the response
6. Loop continues

This proves VAD → STT → (developer logic) → TTS without any cloud dependencies.
