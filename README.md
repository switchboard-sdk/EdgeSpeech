# EdgeSpeech

A React Native hook that provides on-device AI speech processing on iOS and Android,
completely locally. This can be up to 99% cheaper than cloud speech-to-speech.

| Platform | Status    |
| -------- | --------- |
| iOS      | Supported |
| Android  | Supported |

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

### Requirements

| Requirement      | Minimum                            |
| ---------------- | ---------------------------------- |
| React Native     | 0.81+                              |
| New Architecture | Required (enabled)                 |
| iOS              | 13.4+                              |
| Android NDK      | r29 (`29.0.14206865`) — see step 2 |
| Node.js          | 22+                                |

EdgeSpeech is a bare React Native **C++ TurboModule** and requires the **[New Architecture](https://reactnative.dev/architecture/landing-page)**. It
works in both Expo (prebuild) and bare React Native apps — it does **not** use the Expo Modules API.

### Setup

**1. Install the package.**

```bash
npm install @synervoz/edgespeech
```

The native payload isn't bundled in the npm package — each platform's build fetches it, so nothing
extra to run by hand.

On Android, the STT/TTS models download during your first build into the library's own assets, which
Android's asset merge folds into your APK. The AARs bundle no models (the iOS frameworks bake the
same ones in), which is why Android needs the separate fetch. Give the first build time; later
builds skip it.

The set is fixed: Whisper `base.en` for STT (141 MB) and the `en_GB` Piper voice for TTS. Those are
the same model and voice the iOS frameworks bake in, so neither platform needs a choice and both
behave identically. English only, one model each.

**2. Install NDK r29.** Both paths need it, before your first Android build:

```bash
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "ndk;29.0.14206865"
```

Or from Android Studio: **SDK Manager → SDK Tools → NDK (Side by side) → 29.0.14206865**
(`cmdline-tools` isn't present in a default Android Studio install).

The prebuilt Switchboard `.so` reference `__cxa_init_primary_exception`, a libc++ symbol absent
from the template's r27 default; your app packages exactly one `libc++_shared.so`, so on r27 the
app builds and installs but dies at launch with `dlopen failed: cannot locate symbol`.

The remaining settings: **Prefab** and the **Maven repo** (EdgeSpeech's C++ TurboModule is compiled
in your app's native build, so the app resolves the Switchboard AARs itself), dropping 32-bit `x86`
(no AAR for it), and legacy packaging (extracts native libs so Whisper's ggml backends can
`dlopen`).

**3. Configure `app.json`** (Expo — for bare React Native, skip to
[Bare React Native](#bare-react-native)). Add the config plugin **before** prebuilding, since
prebuild is what applies it. It takes no options and does the Android setup for you (Maven repo,
Prefab, NDK 29, legacy packaging, dropping `x86`), so you don't need `expo-build-properties`. It
is only required for Android — every setting it writes is a Gradle one, so on an iOS-only project
it does nothing:

```json
{
  "expo": {
    "newArchEnabled": true,
    "plugins": ["@synervoz/edgespeech"],
    "ios": {
      "bundleIdentifier": "com.yourcompany.yourapp",
      "infoPlist": {
        "NSMicrophoneUsageDescription": "This app needs microphone access for voice input"
      }
    },
    "android": { "package": "com.yourcompany.yourapp" }
  }
}
```

The identifiers matter too: `expo run:ios` / `expo run:android` prebuild your native projects, and
prebuild fails without them — a fresh `create-expo-app` project has neither.

> [!NOTE]
> `NSMicrophoneUsageDescription` is iOS only. On Android, `RECORD_AUDIO` is added by the library;
> request it at runtime via `requestMicrophonePermission()`.

**4. Build:**

```bash
npx expo run:ios
npx expo run:android
```

If you prebuilt _before_ adding the plugin, prebuild again (`npx expo prebuild --clean`) —
otherwise the generated `android/` has no Maven repo, no Prefab and NDK 27, and the app crashes at
launch. Every Android build prints the NDK it used, so you can confirm it landed:

```
[ExpoRootProject]  - ndk:  29.0.14206865
```

### Bare React Native

New Architecture is on by default (RN 0.76+) — for older setups, `RCT_NEW_ARCH_ENABLED=1` at
`pod install`. Add microphone permission to your `Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice input</string>
```

EdgeSpeech's C++ TurboModule is compiled in _your app's_ native build, so your app declares the
Switchboard Maven repo and enables Prefab itself.

In `android/build.gradle` — at the project level, matching how React Native's Gradle plugin adds its own repos (a settings-level `dependencyResolutionManagement` block is ignored under Gradle's default `PREFER_PROJECT` mode):

```gradle
buildscript {
  ext {
    ndkVersion = "29.0.14206865"   // required by the Switchboard SDK
  }
}

allprojects {
  repositories {
    maven { url "https://s3.amazonaws.com/synervoz-android-maven-repository" }
  }
}
```

In `android/app/build.gradle`:

```gradle
android {
  buildFeatures { prefab true }
  packagingOptions { jniLibs { useLegacyPackaging true } }
}

// Runs EdgeSpeech's codegen before this app's native build — without it, Android builds
// can fail on a missing codegen/jni dir. Expo apps get this from the config plugin.
apply from: new File(
  providers.exec {
    workingDir(rootDir)
    commandLine("node", "--print", "require.resolve('@synervoz/edgespeech/package.json')")
  }.standardOutput.asText.get().trim()
).parentFile.toPath().resolve("android/edgespeech-app.gradle").toFile()
```

In `android/gradle.properties`:

```
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

Then `npx react-native run-android`.

## API Reference

The `useEdgeSpeech` hook provides access to the main functions of the Switchboard SDK.

### EdgeSpeechProvider provider

Wrap your app in the `EdgeSpeechProvider` and configure it.

<!-- prettier-ignore -->
```tsx
<EdgeSpeechProvider
  appId="YOUR_APP_ID"         // Optional: Switchboard app ID
  appSecret="YOUR_APP_SECRET" // Optional: Switchboard app secret
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
  voiceState,              // see the state table below
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

`voiceState` passes through three lifecycle states before it reaches the audio pipeline:

| State          | Meaning                                              |
| -------------- | ---------------------------------------------------- |
| `idle`         | SDK not up — not initialized yet, or the init failed |
| `initializing` | init in flight, including the Android model staging  |
| `ready`        | initialized, nothing running                         |
| `listening`    | microphone open, VAD watching for speech             |
| `processing`   | Whisper decoding an utterance                        |
| `speaking`     | TTS playing (microphone stays open for barge-in)     |

`speak()` opens the microphone even from `ready`: one combined engine keeps echo cancellation live
so barge-in works. That is also why finishing an utterance leaves you in `listening` rather than
back at `ready`.

Gate your UI on `ready`, not on `idle` — `idle` is also where a failed init lands, and `error` is
what tells you one happened.

> [!NOTE]
> On Android the STT/TTS models are copied out of the APK on first launch, which can take several
> seconds on a slower device. `EdgeSpeechProvider` starts that as soon as it mounts, and `voiceState`
> is `'initializing'` until it finishes — show a loading state while it is. `listen()` and `speak()`
> wait for it if called earlier, so they never fail because of it. Later launches reuse the copied
> files, and on iOS `'initializing'` passes in a single tick — the models ship inside the SDK
> frameworks.

Repeated calls are safe, so you don't need to guard the buttons yourself:

- `listen()` while a start is already in progress is a no-op — the microphone is opened once.
- `stopListening()` during a start cancels it, and the microphone is never opened.
- `speak()` while speaking queues the new text rather than cutting off what is playing —
  use `stopSpeaking()` for that.
