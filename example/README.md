# EdgeSpeech Example App

The app has two sections: **Voice Input** for transcription (tap "Start Listening", speak, watch the transcript appear) and **Text-to-Speech** (type text, tap "Speak"). Enable **Conversation Mode** to wire them together automatically: speech is transcribed, sent to an LLM, and the response is spoken back.

Runs on **iOS and Android**.

> [!NOTE]
> This is an **Expo** app using [prebuild](https://docs.expo.dev/workflow/prebuild/): `ios/` and
> `android/` are generated from `app.json` (plus EdgeSpeech's config plugin) rather than checked in,
> so `expo run:*` creates them on first use. EdgeSpeech ships native code, so it needs a development
> build — it does **not** run in Expo Go.

## Prerequisites

- Node.js 20+
- Switchboard SDK credentials ([sign up here](https://console.switchboard.audio/register))

For iOS:

- Xcode 16.1+
- Physical iOS device (microphone required for voice features)

For Android:

- Android Studio, with **NDK 29.0.14206865** installed (see [Run on Android](#run-on-android))

## Setup

Install and build the root library first:

```bash
npm install
npm run build
```

Install example app dependencies (this also downloads the Switchboard SDK frameworks and the
Android models — around 1.9 GB in total, so expect it to take a while):

```bash
cd example
npm install
```

Copy the environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Switchboard App ID and App Secret. Demo credentials are included, so this
works as-is for a first run.

## Run on iOS

Set up iOS code signing for your device.

Follow [these instructions first](https://docs.expo.dev/get-started/set-up-your-environment/?platform=ios&device=physical&mode=development-build&buildEnv=local).

1. Generate the native project, then open the Xcode workspace:

   ```bash
   npx expo prebuild --platform ios
   open ios/SwitchboardVoiceExample.xcworkspace
   ```

2. In Xcode, select the **SwitchboardVoiceExample** project in the navigator, then select the **SwitchboardVoiceExample** target.
3. Go to the **Signing & Capabilities** tab.
4. Under **Team**, select your Apple Developer account. Xcode will automatically register the app ID and generate a provisioning profile.
   - If you don't see a team, click **Add an Account…** and sign in with your Apple ID. A free Apple ID (without a paid developer membership) is sufficient to run on a personal device.
   - If Xcode shows a bundle ID conflict, change the **Bundle Identifier** to something unique (e.g. `com.yourname.voiceexample`) and try again.
   - Ensure your device has been connected and trusted by Xcode.
   - Add the device to your provisioning profile if prompted.
5. Close Xcode.

> This step is only needed once. After Xcode creates the profile, all future CLI builds will work without opening Xcode again.

Build and run on a physical iOS device:

```bash
npx expo run:ios --device
```

- Choose your connected device from the list.
- If you see a prompt "codesign wants to access key '...' in your keychain", fill in the password field with your MacOS login password and click "Always Allow" to let Xcode sign the app.
- You may see the development dashboard appear with a message "no development servers"
- Scan the QR code in the terminal with your iOS device to open the app.

## Run on Android

Install NDK r29 first

```bash
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "ndk;29.0.14206865"
```

Or from Android Studio: **SDK Manager → SDK Tools → NDK (Side by side) → 29.0.14206865**.

Then build and run:

```bash
npx expo run:android
```

No code signing needed. The app asks for microphone permission on the first "Start Listening" —
grant it, or voice input fails with a permission error.

The build prints the NDK it used, so you can confirm the config plugin applied:

```
[ExpoRootProject]  - ndk:  29.0.14206865
```

> [!TIP]
> If a build fails oddly after changing `app.json` or the library's config plugin, regenerate the
> native projects with `npx expo prebuild --clean` — they are build output, so deleting and
> regenerating them is safe.
