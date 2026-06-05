# EdgeSpeech

A React Native hook that provides on-device AI speech processing through the [Switchboard SDK](https://switchboard.audio/).
This can be up to 99% cheaper than cloud speech-to-speech.

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

The [example app](./example/) shows the complete voice loop running end-to-end.

## Requirements

| Requirement       | Minimum |
| ----------------- | ------- |
| React Native      | 0.74+   |
| iOS               | 13.4+   |
| Node.js           | 22+     |
| expo-modules-core | 2.0.0+  |

## Platform Support

| Platform | Status      |
| -------- | ----------- |
| iOS      | Supported   |
| Android  | Coming soon |

## Installation

```bash
npm install @synervoz/edgespeech
```

### iOS Setup — Expo (managed or bare)

1. The Switchboard SDK frameworks are downloaded automatically when you run `npm install`. No separate setup command is needed.

2. Add microphone permission to your `Info.plist` (or via `app.json` `infoPlist` for Expo managed workflow):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice input</string>
```

3. Build your app:

```bash
npx expo run:ios
```

## API Reference

### Configuration

```typescript
await EdgeSpeech.configure({
  appId: string,           // Required: Switchboard app ID
  appSecret: string,       // Required: Switchboard app secret
  sttModel?: string,       // Optional: STT model (default: 'whisper-base-en')
  ttsVoice?: string,       // Optional: TTS voice (default: 'en_GB')
  vadSensitivity?: number, // Optional: VAD sensitivity 0.0-1.0 (default: 0.5)
});
```

### Functions

| Function                        | Description                              |
| ------------------------------- | ---------------------------------------- |
| `configure(config)`             | Initialize with credentials and settings |
| `listen()`                      | Start listening for voice input          |
| `stopListening()`               | Stop listening                           |
| `speak(text)`                   | Speak text using TTS                     |
| `stopSpeaking()`                | Stop current TTS playback                |
| `requestMicrophonePermission()` | Request microphone access                |

### Demo Token

The example app ships with a built-in demo `APP_ID` and `APP_SECRET` so you can run it immediately without creating a Switchboard account. This token is provided for evaluation only and **may be rotated or revoked at any time** — do not use it in a production app. Replace it with your own credentials from [console.switchboard.audio](https://console.switchboard.audio/register) before shipping.

## Get Switchboard Credentials

1. Sign up at [switchboard.audio](https://console.switchboard.audio/register)
2. Create a new app in the dashboard
3. Copy your App ID and App Secret

## Credential Security

Your Switchboard `APP_ID` and `APP_SECRET` are **safe to bundle in your application**. They function like a publishing key and are intended to be distributed with your app.

These credentials identify your application to the Switchboard SDK runtime. They do not grant access to any backend system, user data, or billing controls beyond your own app's usage quota. There is no equivalent "secret key" that must be kept private.

You can commit them to source control, include them in your app bundle, or pass them at build time via environment variables.

## Pricing and Quotas

See the full pricing details at [switchboard.audio/pricing](https://switchboard.audio/pricing/).

**Free Prototyping License** — no cost for apps with fewer than 20,000 cumulative SDK activations. Suitable for development, testing, and early App Store releases.

**Commercial License** — required once your app exceeds 20,000 cumulative activations. Contact [licensing@synervoz.com](mailto:licensing@synervoz.com) before your app reaches that threshold.

## Development

## Tests

Run unit tests with:

```bash
npm test
```

### Release

Releases are published to npm automatically when a version tag is pushed. Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH` — increment `MAJOR` for breaking changes, `MINOR` for new features, `PATCH` for bug fixes.

1. Bump the version in `package.json`.
2. Commit: `git commit -am "chore: release vX.Y.Z"`
3. Tag and push:

```bash
git tag vX.Y.Z
git push origin main --tags
```

The [release workflow](.github/workflows/release.yml) builds the package and publishes to npm under the `@synervoz` scope using `npm publish --access public`. Requires an `NPM_TOKEN` secret configured in the repository settings.

## License

**EdgeSpeech** - the JavaScript, TypeScript, and Swift source files in this repository are released under the [MIT License](./LICENSE).

**Switchboard SDK frameworks** are downloaded at install time and are proprietary software subject to the [Switchboard SDK Master License Agreement](https://switchboard.audio/licensing/). Key terms for production use:

- **Free Prototyping License** - no cost for apps with fewer than 20,000 cumulative SDK activations. Allows public release including on the iOS App Store.
- **Commercial License** - required once your app exceeds 20,000 cumulative activations. Contact [licensing@synervoz.com](mailto:licensing@synervoz.com) before your app reaches that threshold.
- Apps using the Prototyping License must include the following attribution in app credits:
  > [App Name] uses the Switchboard SDK by Synervoz (Synervoz.com)
- The SDK may not be sublicensed or incorporated into another platform, SDK, or API without written permission from Synervoz.
- Synervoz may disable access without notice if license terms are exceeded.

The full Switchboard SDK license text is downloaded to `ios/Frameworks/SwitchboardSDK/ios/LICENSE.txt` when you run `npm install` and is also available at [switchboard.audio/licensing](https://switchboard.audio/licensing/).

**AI model weights** (Whisper STT, Silero VAD, Sherpa TTS) are bundled inside the Switchboard SDK frameworks under their own open-source licenses: Whisper.cpp (MIT), Silero VAD (MIT), and Sherpa-ONNX (Apache 2.0). Their full license texts are included in the downloaded framework packages.
