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

### Android Setup

> [!NOTE]
> Android support is in progress. `RECORD_AUDIO` is declared by the library and merged into your app automatically (requested at runtime via `requestMicrophonePermission()`). The on-device models (Whisper + the Sherpa TTS voice, ~290 MB) aren't in the npm package, but they **download automatically on `npm install`** (a postinstall script) into the library's assets and merge into your APK — no manual step. Set `EDGESPEECH_SKIP_ANDROID_MODELS=1` to opt out (e.g. iOS-only or CI).

Follow **one** path depending on your app. For *why* each setting lives where it does
(the library-vs-app ownership split and the Expo-vs-bare-RN mechanics), see [`RN.md`](RN.md).

#### Expo

**1. Enable the New Architecture** — `"newArchEnabled": true` in `app.json` (default in recent Expo SDKs).

**2. Add the Switchboard Maven repo, ABIs, and packaging** via [`expo-build-properties`](https://docs.expo.dev/versions/latest/sdk/build-properties/) in `app.json`. The repo must be declared here (not left to the library) because `expo run:android` builds with `--configure-on-demand`, under which the library's own repo injection runs too late. `buildArchs` drops 32-bit `x86` (the AARs ship `arm64-v8a`/`armeabi-v7a`/`x86_64` only); `useLegacyPackaging` extracts native libs to disk so Whisper's ggml backends can `dlopen` (else `ggml_abort` at runtime):

```json
{
  "plugins": [
    ["expo-build-properties", {
      "android": {
        "extraMavenRepos": ["https://s3.amazonaws.com/synervoz-android-maven-repository"],
        "useLegacyPackaging": true,
        "buildArchs": ["armeabi-v7a", "arm64-v8a", "x86_64"]
      }
    }]
  ]
}
```

**3. Models — automatic.** They download on `npm install` (postinstall) into the library's own assets and merge into your APK — nothing to run. If your package manager gated install scripts (npm/pnpm may), run the fallback:

```bash
node node_modules/@synervoz/edgespeech/scripts/download-android-models.js
```

**4. Generate the native project, pin NDK, and build:**

```bash
npx expo prebuild -p android
# then set ndkVersion "29.0.14206865" in android/app/build.gradle (see note below)
npx expo run:android
```

> [!NOTE]
> **NDK r29 is required** — the prebuilt Switchboard `.so` needs `__cxa_init_primary_exception`, absent from the r27 default, so `dlopen` fails at launch without it. `expo-build-properties` has no `ndkVersion` key, so after `prebuild` set `ndkVersion "29.0.14206865"` in `android/app/build.gradle`'s `android { }` block, and install the NDK: `sdkmanager --install "ndk;29.0.14206865"`. The edit persists across normal `expo run:android` — re-apply it after any `prebuild --clean`.

#### Bare React Native

**1. Enable the New Architecture** — the default from RN 0.76+.

**2. Switchboard Maven repo — nothing to add.** The library injects it into your Gradle build automatically (bare-RN autolinking configures the library before `:app` resolves). Only if your app opts into settings-level resolution (`dependencyResolutionManagement { repositoriesMode = FAIL_ON_PROJECT_REPOS }`) or builds with `--configure-on-demand`, declare it yourself in `android/build.gradle`:

```gradle
allprojects {
  repositories { maven { url 'https://s3.amazonaws.com/synervoz-android-maven-repository' } }
}
```

**3. Exclude 32-bit `x86`** in `android/gradle.properties` (the AARs ship `arm64-v8a`/`armeabi-v7a`/`x86_64` only):

```
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

**4. Extract native libs** so Whisper's ggml backends can `dlopen` (else `ggml_abort` at runtime) — in `android/app/build.gradle`:

```gradle
android {
  packagingOptions { jniLibs { useLegacyPackaging true } }
}
```

Also pin **NDK r29** in the same `android { }` block (`ndkVersion "29.0.14206865"`) — see the note below.

**5. Models — automatic** on `npm install` (postinstall → the library's assets, merged into your APK). Fallback if install scripts were gated:

```bash
node node_modules/@synervoz/edgespeech/scripts/download-android-models.js
```

**6. Build:**

```bash
npx react-native run-android
```

> [!NOTE]
> **NDK r29 is required** — the prebuilt Switchboard `.so` needs `__cxa_init_primary_exception`, absent from the r27 default, so `dlopen` fails at launch without it. Set `ndkVersion "29.0.14206865"` in `android/app/build.gradle`'s `android { }` block (step 4) and install it: `sdkmanager --install "ndk;29.0.14206865"`.

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
