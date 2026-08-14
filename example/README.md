# EdgeSpeech Example App

The app has two sections: **Voice Input** for transcription (tap "Start Listening", speak, watch the transcript appear) and **Text-to-Speech** (type text, tap "Speak"). Enable **Conversation Mode** to wire them together automatically: speech is transcribed, sent to an LLM, and the response is spoken back.

## Conversation Mode's LLM

Everything except the LLM step runs on-device. The LLM lives in `services/chatService.ts` and calls
[Pollinations](https://pollinations.ai)' keyless OpenAI-compatible endpoint so the demo works with no
signup and no API key. The model is `openai-fast` (GPT-OSS 20B) — the only entry `GET /models`
returns for the anonymous tier, and the canonical name behind the `openai` / `gpt-oss-20b` aliases.

The anonymous tier is strict, and its responses carry no `Retry-After` or `x-ratelimit-*` headers,
so `chatService` enforces the limits itself:

| Status | Meaning                                                        | Handling                                                            |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `429`  | `Queue full for IP` — one request in flight per IP, ~1 per 30s | Retried after clearing the 30s interval                             |
| `402`  | The shared anonymous request pool is out of credit ("pollen")  | Not retried — server-side, retrying cannot fix it                   |
| `404`  | Model retired                                                  | Not retried; re-check `GET /models` for the current anonymous model |
| `403`  | IP blocked                                                     | Not retried                                                         |

Consequences worth knowing before you rely on this:

- **One exchange per ~30 seconds.** The per-IP limit is one request in flight and roughly one every
  30s, so Conversation Mode cannot sustain a natural back-and-forth. `chatService` serialises and
  spaces calls to respect that rather than tripping the limiter.
- **`402` is not your fault and not fixable client-side.** The pool drains for everyone using the
  keyless endpoint; when it's empty, every fresh request fails until it's topped up. Cached prompts
  keep returning `200`, which can make the service look healthier than it is.
- **Responses are cached aggressively.** Identical prompts return long-lived cached completions, so
  each request sends a random `seed` to get a fresh answer.
- **Anonymous traffic can have referral content injected into completions** (~5% unless the referrer
  is allow-listed). This app _speaks its responses aloud_, so an injected ad would be read out. Do
  not ship this path to users.
- **Transcripts leave the device.** Only in Conversation Mode, and only the text — but they go to a
  third-party host. Swap `chatService.ts` for your own backend before shipping anything real; the
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
