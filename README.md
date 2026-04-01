# switchboard-voice-rn

React Native library for on-device voice processing with Switchboard SDK. Provides VAD, STT, and TTS through a simple JavaScript callback interface.

## Status

🚧 **Under Development** - Phase 1: Library Scaffolding

## Features (Planned)

- ✅ On-device Voice Activity Detection (VAD)
- ✅ On-device Speech-to-Text (Whisper)
- ✅ On-device Text-to-Speech (Silero)
- ✅ Barge-in/Interruption handling
- ✅ Simple event-based API
- ✅ iOS support (initial release)

## Installation

```bash
npm install switchboard-voice-rn
```

## Quick Start

```typescript
import { SwitchboardVoice } from 'switchboard-voice-rn';

// Configure
SwitchboardVoice.configure({
  appId: 'YOUR_APP_ID',
  appSecret: 'YOUR_APP_SECRET',
  vadSensitivity: 0.5,
});

// Set up event handlers
SwitchboardVoice.onTranscript = (text, isFinal) => {
  console.log('Transcript:', text, 'Final:', isFinal);
};

SwitchboardVoice.onInterrupted = () => {
  console.log('User interrupted!');
};

// Start listening
await SwitchboardVoice.start();

// Speak response
await SwitchboardVoice.speak('Hello world');
```

## API Reference

### Configuration

#### `SwitchboardVoice.configure(config: VoiceConfig)`

```typescript
interface VoiceConfig {
  appId: string;              // Switchboard app ID
  appSecret: string;          // Switchboard app secret
  sttModel?: string;          // Default: 'whisper-base-en'
  ttsVoice?: string;          // Default: 'silero-en-us'
  vadSensitivity?: number;    // 0.0 - 1.0, default: 0.5
}
```

### Methods

#### `SwitchboardVoice.start(): Promise<void>`
Start listening for voice input.

#### `SwitchboardVoice.stop(): Promise<void>`
Stop listening.

#### `SwitchboardVoice.speak(text: string): Promise<void>`
Speak the provided text using TTS.

#### `SwitchboardVoice.stopSpeaking(): Promise<void>`
Stop current TTS playback.

### Event Callbacks

#### `SwitchboardVoice.onTranscript`
```typescript
(text: string, isFinal: boolean) => void
```
Called when speech is transcribed. `isFinal` indicates if this is the final transcript.

#### `SwitchboardVoice.onStateChange`
```typescript
(state: 'idle' | 'listening' | 'processing' | 'speaking') => void
```
Called when voice state changes.

#### `SwitchboardVoice.onInterrupted`
```typescript
() => void
```
Called when user interrupts TTS by speaking.

#### `SwitchboardVoice.onError`
```typescript
(error: VoiceError) => void
```
Called when an error occurs.

## Requirements

- iOS 13.0+
- React Native 0.76+
- Node.js 18+

## Permissions

Add to your `ios/YourApp/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice interaction</string>
```

## Example App

See the `example/` directory for a complete working example.

```bash
cd example
npm install
cd ios && pod install && cd ..
npm run ios
```

## Development

### Setup

First, download the Switchboard SDK frameworks:

```bash
python3 scripts/setup.py --platform ios
```

This will download the required Switchboard SDK XCFrameworks to the `Frameworks/` directory.

### Building

```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

## License

MIT

## Credits

Built with [Switchboard SDK](https://switchboard.audio/)
