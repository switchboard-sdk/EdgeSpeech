# EdgeSpeech Example App

The app has two sections: **Voice Input** for transcription (tap "Start Listening", speak, watch the transcript appear) and **Text-to-Speech** (type text, tap "Speak"). Enable **Conversation Mode** to wire them together automatically: speech is transcribed, sent to an LLM, and the response is spoken back.

## Conversation Mode's LLM

Everything except the LLM step runs on-device. For the LLM turn, `services/chatService.ts` posts to
the Switchboard API's OpenAI proxy at `https://api.switchboard.audio/openai/chat`, authenticated with
the **same App ID and App Secret** the SDK is initialised with — `configureChat()` is called once in
`App.tsx` with those values.

No OpenAI key is needed here, and none is shipped in the app. The key is set on your app's config in
the [console](https://console.switchboard.audio), and the API uses it server-side; the app only ever
receives generated text.

The proxy owns the request shape. It picks the model and output length and trims history, so the app
sends only `messages` — no `model`, no `max_tokens`. It also rate limits per app and answers `429`
with a `Retry-After`, which `chatService` honours in preference to its own backoff.

| Status | Meaning                             | Handling                                         |
| ------ | ----------------------------------- | ------------------------------------------------ |
| `429`  | Per-app rate limit reached          | Retried, waiting the `Retry-After` the API sends |
| `401`  | App credentials rejected            | Not retried — fix your `.env`                    |
| `400`  | No OpenAI key set on the app config | Not retried — set one in the console             |

Two things to know:

- **Transcripts leave the device in Conversation Mode.** Only the text, and only to our API — but
  the transcription, VAD and speech synthesis around it are entirely on-device.
- **To use your own backend instead**, replace `chatService.ts`. The
  `sendToChat(message, history)` signature is the only contract the app depends on.

## Prerequisites

- Node.js 20+
- Xcode 16.1+
- Physical iOS device (microphone required for voice features)
- Switchboard SDK credentials ([sign up here](https://console.switchboard.audio/register))

## Setup

Install and build the root library first:

```bash
npm install
npm run build
```

Install example app dependencies (this also downloads the Switchboard SDK frameworks):

```bash
cd example
npm install
```

Copy the environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Switchboard App ID and App Secret.

Set up iOS code signing for your device:

Follow [these instructions first](https://docs.expo.dev/get-started/set-up-your-environment/?platform=ios&device=physical&mode=development-build&buildEnv=local).

1. Open the Xcode workspace:

   ```bash
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
