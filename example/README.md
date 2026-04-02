# EdgeSpeech Example App

The app has two sections: **Voice Input** for transcription (tap "Start Listening", speak, watch the transcript appear) and **Text-to-Speech** (type text, tap "Speak"). Enable **Conversation Mode** to wire them together automatically: speech is transcribed, sent to an LLM, and the response is spoken back.

## Prerequisites

- Node.js 20+
- Xcode 15+
- Physical iOS device (microphone required for voice features)
- Switchboard SDK credentials ([sign up here](https://switchboard.audio/))

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

3. Build and run on a physical iOS device:

```bash
npx expo run:ios --device
```

