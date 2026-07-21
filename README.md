# EdgeSpeech

A React Native hook that provides on-device AI speech processing, completely locally.
This can be up to 99% cheaper than cloud speech-to-speech.

| Platform | Status      |
| -------- | ----------- |
| iOS      | Supported   |
| Android  | Coming soon |

## Example Usage

```typescript
import { EdgeSpeechProvider, useEdgeSpeech } from '@synervoz/edgespeech'

function VoiceChat() {
  const { listen, speak, onTranscriptComplete } = useEdgeSpeech()

  onTranscriptComplete(async (text) => {
    const response = await chat(text)
    await speak(response)
  })

  return <Button onPress={listen} title="Start Listening" />
}

export default function App() {
  return (
    <EdgeSpeechProvider appId="YOUR_APP_ID" appSecret="YOUR_APP_SECRET">
      <VoiceChat />
    </EdgeSpeechProvider>
  )
}
```

> [!TIP]
> The included [example app](./example/) shows a complete speech-to-speech workflow.

## Installation

```bash
npm install @synervoz/edgespeech
```

### Requirements

| Requirement      | Minimum            |
| ---------------- | ------------------ |
| React Native     | 0.81+              |
| New Architecture | Required (enabled) |
| iOS              | 13.4+              |
| Node.js          | 22+                |

EdgeSpeech is a bare React Native **C++ TurboModule** and requires the **[New Architecture](https://reactnative.dev/architecture/landing-page)**. It
works in both Expo (prebuild) and bare React Native apps — it does **not** use the Expo Modules API.

### iOS Setup

**1. Enable the New Architecture.**

- **Expo:** set `"newArchEnabled": true` in `app.json` (the default in recent Expo SDKs).
- **Bare RN:** the default from RN 0.76+ (for older setups, `RCT_NEW_ARCH_ENABLED=1` at `pod install`).

**2. Add microphone permission** to your `Info.plist` (or via `app.json` `infoPlist` on Expo):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice input</string>
```

**3. Build:**

```bash
npx expo run:ios
```

> [!NOTE]
> A `postinstall` script downloads the native Switchboard frameworks into
> `ios/Frameworks/` — they aren't bundled in the package. If your package manager blocks install
> scripts (e.g. npm 11+), run it once manually:
> `node node_modules/@synervoz/edgespeech/scripts/postinstall.js`.

## API Reference

The `useEdgeSpeech` hook provides access to the main functions of the Switchboard SDK.

### EdgeSpeechProvider provider

Wrap your app in the `EdgeSpeechProvider` and configure it.

<!-- prettier-ignore -->
```tsx
<EdgeSpeechProvider
  appId="YOUR_APP_ID"         // Optional: Switchboard app ID
  appSecret="YOUR_APP_SECRET" // Optional: Switchboard app secret
  sttModel="whisper-base-en"  // Optional: STT model (default: 'whisper-base-en')
  ttsVoice="en_GB"            // Optional: TTS voice (default: 'en_GB')
  vadSensitivity={0.5}        // Optional: VAD sensitivity 0.0–1.0 (default: 0.5)
>
  <App />
</EdgeSpeechProvider>
```

> [!TIP]
> This library ships with built-in demo credentials so you can run it immediately without creating a Switchboard account.

> [!NOTE]
> Your Switchboard `APP_ID` and `APP_SECRET` are **safe to bundle in your application**. They function like a publishing key and are intended to be distributed with your app.

### `useEdgeSpeech` hook

Access the state and actions from any component with the `useEdgeSpeech` hook.

<!-- prettier-ignore -->
```typescript
const {
  // State
  transcript,              // string       — live interim transcript (clears on final)
  voiceState,              // 'idle' | 'listening' | 'processing' | 'speaking'
  error,                   // string | null
  hasMicrophonePermission, // boolean | null

  // Actions
  listen,                      // () => Promise<void>
  stopListening,               // () => Promise<void>
  speak,                       // (text: string) => Promise<void>
  stopSpeaking,                // () => Promise<void>
  requestMicrophonePermission, // () => Promise<boolean>

  // Callbacks
  onTranscriptComplete, // (cb: (text: string) => void) => void — fires on final transcript
  onInterrupted,        // (cb: () => void) => void — fires when VAD interrupts TTS
} = useEdgeSpeech()
```
