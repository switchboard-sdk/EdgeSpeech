# EdgeSpeech: Switchboard for Voice AI for React Native

**On-device voice processing for React Native apps. Work entirely in text.**

Build voice AI applications without digging deep into low-level audio. This library handles Voice Activity Detection (VAD), Speech-to-Text (STT), and Text-to-Speech (TTS) entirely on-device using the [Switchboard SDK](https://switchboard.audio/), giving you simple text callbacks to work with.

## The Problem

Building voice AI is complex. You need to:
- Capture and process audio streams
- Detect when users start and stop speaking
- Convert speech to text
- Generate speech from text
- Handle interruptions ("barge-in")
- Manage audio sessions, permissions, and device quirks

Most developers just want to send text to an LLM and speak the response.

## The Solution

Switchboard Voice abstracts all audio complexity into a text-based interface:

```typescript
import { SwitchboardVoiceModule, initialize, start, speak } from 'switchboard-voice-rn';

initialize('YOUR_APP_ID', 'YOUR_APP_SECRET');

// Get transcripts as text
SwitchboardVoiceModule.addListener('onTranscript', async ({ text, isFinal }) => {
  if (isFinal) {
    // Send to your LLM
    const response = await chat(text);
    // Speak the response
    await speak(response);
  }
});

await start();
```

That's it. No audio buffers, no sample rates, no codecs.

## Cost Savings: 99% Cheaper Than Cloud Speech-to-Speech

The real advantage of on-device voice processing is **cost**.

### The Math

Consider a voice AI assistant handling 1,000 conversations per day, each lasting 5 minutes.

**OpenAI Realtime API (cloud speech-to-speech):**
| Component | Calculation | Cost |
|-----------|-------------|------|
| Audio input | 150 sec × 80 tokens/sec × $100/1M | $1.20 |
| Audio output | 150 sec × 80 tokens/sec × $200/1M | $2.40 |
| **Per conversation** | | **$3.60** |
| **1,000 conversations/day** | | **$3,600/day** |
| **Monthly (30 days)** | | **$108,000** |

**This library + ChatGPT API (text only):**
| Component | Calculation | Cost |
|-----------|-------------|------|
| Text input | ~750 tokens × $5/1M | $0.004 |
| Text output | ~750 tokens × $20/1M | $0.015 |
| **Per conversation** | | **$0.02** |
| **1,000 conversations/day** | | **$20/day** |
| **Monthly (30 days)** | | **$600** |

### The Savings

| Metric | Realtime API | This Library + Text API |
|--------|--------------|------------------------|
| Cost per conversation | $3.60 | $0.02 |
| Daily cost (1K convos) | $3,600 | $20 |
| Monthly cost | $108,000 | $600 |
| **Annual savings** | - | **$1,288,800** |

**On-device STT/TTS with a text-based LLM API is 1/180th the price of cloud speech-to-speech.**

### Why This Works

1. **Audio tokens are expensive** - Cloud APIs charge premium rates for audio processing
2. **Text is cheap** - LLM APIs charge a fraction of the cost for text
3. **On-device is free** - Switchboard SDK runs locally with no per-request costs
4. **Same quality** - Whisper STT and Silero TTS are production-grade models

## Features

- **Voice Activity Detection (VAD)** - Silero VAD detects speech start/end automatically
- **Speech-to-Text (STT)** - Whisper runs on-device for fast, private transcription
- **Text-to-Speech (TTS)** - Silero TTS generates natural speech locally
- **Interruption handling** - Barge-in support stops TTS when user speaks
- **Simple API** - Text in, text out. No audio knowledge required.
- **Privacy** - All processing happens on-device. No audio leaves the phone.
- **Offline capable** - Works without internet (except for your LLM calls)

## Installation

```bash
npm install switchboard-voice-rn
```

### iOS Setup

1. The Switchboard SDK frameworks are downloaded automatically on `npm install`.

2. Add microphone permission to your `Info.plist`:
```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice input</string>
```

3. Build your app:
```bash
npx expo run:ios
```

## Quick Start

```typescript
import {
  SwitchboardVoiceModule,
  initialize,
  configure,
  start,
  speak,
  requestMicrophonePermission,
} from 'switchboard-voice-rn';

// 1. Initialize with your Switchboard credentials
initialize('YOUR_SWITCHBOARD_APP_ID', 'YOUR_SWITCHBOARD_APP_SECRET');

// 2. (Optional) tune settings
configure({ vadSensitivity: 0.5 });

// 3. Set up event listeners
SwitchboardVoiceModule.addListener('onTranscript', ({ text, isFinal }) => {
  console.log(isFinal ? 'Final:' : 'Interim:', text);
  if (isFinal) handleUserSpeech(text);
});

SwitchboardVoiceModule.addListener('onStateChange', ({ state }) => {
  console.log('State:', state); // 'idle' | 'listening' | 'speaking'
});

SwitchboardVoiceModule.addListener('onInterrupted', () => {
  console.log('User interrupted playback');
});

SwitchboardVoiceModule.addListener('onError', ({ code, message }) => {
  console.error('Voice error:', code, message);
});

// 4. Request permission and start
const granted = await requestMicrophonePermission();
if (granted) {
  await start();
}

// 5. Speak responses
await speak('Hello! How can I help you today?');
```

## API Reference

### Configuration

```typescript
await SwitchboardVoice.configure({
  appId: string,           // Required: Switchboard app ID
  appSecret: string,       // Required: Switchboard app secret
  sttModel?: string,       // Optional: STT model (default: 'whisper-base-en')
  ttsVoice?: string,       // Optional: TTS voice (default: 'en_GB')
  vadSensitivity?: number, // Optional: VAD sensitivity 0.0-1.0 (default: 0.5)
});
```

### Methods

| Method | Description |
|--------|-------------|
| `configure(config)` | Initialize with credentials and settings |
| `start()` | Start listening for voice input |
| `stop()` | Stop listening |
| `speak(text)` | Speak text using TTS |
| `stopSpeaking()` | Stop current TTS playback |
| `requestMicrophonePermission()` | Request microphone access |

### Events

Listen via `SwitchboardVoiceModule.addListener(eventName, handler)`.

| Event | Payload | Description |
|-------|---------|-------------|
| `onTranscript` | `{ text: string, isFinal: boolean }` | Speech recognized |
| `onStateChange` | `{ state: string }` | State changed (`idle`, `listening`, `speaking`) |
| `onSpeechStart` | `{}` | VAD detected voice activity |
| `onSpeechEnd` | `{}` | VAD detected end of speech |
| `onTTSComplete` | `{}` | TTS finished playing |
| `onInterrupted` | `{}` | TTS interrupted by user speech |
| `onError` | `{ code: string, message: string }` | Error occurred |

### States

```
idle -> listening -> processing -> idle
                 \              /
                   -> speaking -
```

## Example App

The `example/` directory contains a minimal demo showing the complete voice loop:

```bash
cd example
npm install
npx expo run:ios
```

## Architecture

```mermaid
flowchart TB
    mic["🎤 Microphone"]
    spk["🔊 Speaker"]

    subgraph Engines["LCL-speech"]
        subgraph JS["JavaScript API"]
            subgraph Controls["Controls"]
                start["start()"]
                stop["stop()"]
                stopSpeaking["stopSpeaking()"]
            end
            speak["speak(text)"]
            onTranscript["onTranscript"]
            onInterrupted["onInterrupted"]
        end
        subgraph ListenGraph["Listening Graph"]
            direction LR
            MCtoMono["MultiChannelToMono"] --> Split["BusSplitter"]
            Split --> VAD["SileroVAD"]
            Split --> STT["Whisper STT"]
            VAD -.-> STT
        end

        subgraph SpeakingGraph["Speaking Graph"]
            TTS["Sherpa TTS"]
        end
    end

    SDK["Switchboard SDK (Runtime)"]

    mic --> ListenGraph
    SpeakingGraph --> spk
    ListenGraph -- "executed by" --> SDK
    SpeakingGraph -- "executed by" --> SDK

    start --> ListenGraph
    stop --> ListenGraph
    speak --> SpeakingGraph
    stopSpeaking --> SpeakingGraph

    STT -.-> onTranscript
    ListenGraph -.-> onInterrupted
    onInterrupted --> stopSpeaking

    onTranscript --> LLM
    LLM --> speak

    LLM["🤖 Your LLM Pipeline"]:::external

    classDef external fill:#f5f5f5,stroke:#999,stroke-dasharray: 5 5

    style ListenGraph fill:#fff,stroke:#999,stroke-dasharray: 5 5
    style SpeakingGraph fill:#fff,stroke:#999,stroke-dasharray: 5 5
```

## Why Switchboard?

[Switchboard SDK](https://switchboard.audio/) is a professional audio processing toolkit used in production apps. It provides:

- **Optimized audio graphs** - Efficient on-device audio processing pipelines
- **Production-ready models** - Whisper, Silero VAD, and Silero TTS tuned for mobile
- **Low latency** - Real-time processing suitable for conversational AI
- **Battery efficient** - Designed for sustained use on mobile devices

## Platform Support

| Platform | Status |
|----------|--------|
| iOS | Supported |
| Android | Coming soon |

## Requirements

- React Native 0.74+
- iOS 13.4+
- Node.js 20+

## Get Switchboard Credentials

1. Sign up at [switchboard.audio](https://console.switchboard.audio/register)
2. Create a new app in the dashboard
3. Copy your App ID and App Secret

## License

MIT

## Links

- [Switchboard SDK Documentation](https://docs.switchboard.audio/)
- [Example App](./example/)
- [GitHub Issues](https://github.com/switchboard-sdk/switchboard-voice-rn/issues)
