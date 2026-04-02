# EdgeSpeech Example App

Example app demonstrating the `@synervoz/edgespeech` library using Expo Modules Core.

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

## Architecture

- `App.tsx` — Main app component with voice UI
- The `@synervoz/edgespeech` library is linked locally via `"file:.."` in `package.json`

### Event Pattern

```typescript
import { SwitchboardVoiceModule } from '@synervoz/edgespeech';

const subscription = SwitchboardVoiceModule.addListener('onTranscript', (event) => {
  console.log(event.text, event.isFinal);
});

// Cleanup
subscription.remove();
```
