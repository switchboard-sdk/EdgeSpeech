# EdgeSpeech Example App

The app has two sections: **Voice Input** for transcription (tap "Start Listening", speak, watch the transcript appear) and **Text-to-Speech** (type text, tap "Speak"). Enable **Conversation Mode** to wire them together automatically: speech is transcribed, sent to an LLM, and the response is spoken back.

## Prerequisites

- Node.js 20+
- Xcode 16.1+
- Physical iOS device (microphone required for voice features)
- Switchboard SDK credentials ([sign up here](https://console.switchboard.audio/register))

## Setup

1. Install dependencies (this also downloads the Switchboard SDK frameworks):

```bash
cd example
npm install
```

2. Copy the environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Switchboard App ID and App Secret.

3. Set up iOS code signing for your device:

Follow [these instructions first](https://docs.expo.dev/get-started/set-up-your-environment/?platform=ios&device=physical&mode=development-build&buildEnv=local).

a. Open the Xcode workspace:

```bash
open ios/SwitchboardVoiceExample.xcworkspace
```

b. In Xcode, select the **SwitchboardVoiceExample** project in the navigator, then select the **SwitchboardVoiceExample** target.
c. Go to the **Signing & Capabilities** tab.
d. Under **Team**, select your Apple Developer account. Xcode will automatically register the app ID and generate a provisioning profile. - If you don't see a team, click **Add an Account…** and sign in with your Apple ID. A free Apple ID (without a paid developer membership) is sufficient to run on a personal device. - If Xcode shows a bundle ID conflict, change the **Bundle Identifier** to something unique (e.g. `com.yourname.voiceexample`) and try again. - Ensure your device has been connected and trusted by Xcode. - Add the device to your provisioning profile if prompted.
e. Close Xcode.

> This step is only needed once. After Xcode creates the profile, all future CLI builds will work without opening Xcode again.

4. Build and run on a physical iOS device:

```bash
npx expo run:ios --device
```

- Choose your connected device from the list.
- If you see a prompt "codesign wants to access key '...' in your keychain", fill in the password field with your MacOS login password and click "Always Allow" to let Xcode sign the app.
- You may see the development dashboard appear with a message "no development servers"
- Scan the QR code in the terminal with your iOS device to open the app.
