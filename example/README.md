# Switchboard Voice Expo Example

Example app demonstrating the Switchboard Voice library using Expo Modules Core.

## Prerequisites

- Node.js 18+
- Xcode 15+
- CocoaPods
- Physical iOS device (microphone required for voice features)
- Switchboard SDK frameworks (run `python scripts/setup.py` from project root)

## Setup

1. Install dependencies:

```bash
cd example
npm install
```

2. Generate iOS project:

```bash
npx expo prebuild --platform ios
```

3. Add local module to Podfile. Open `ios/Podfile` and add this line inside the target block (after `use_expo_modules!`):

```ruby
target 'switchboardvoiceexpoexample' do
  use_expo_modules!

  # Add this line:
  pod 'SwitchboardVoice', :path => '../modules/switchboard-voice/ios'
```

4. Install pods:

```bash
cd ios && pod install && cd ..
```

5. Update credentials (if not already done):

Edit `credentials.ts` with your Switchboard app credentials.

## Running

Run on a physical iOS device (simulator doesn't support microphone):

```bash
npx expo run:ios --device
```

Or open `ios/switchboardvoiceexpoexample.xcworkspace` in Xcode and run from there.

## Architecture

This example uses **Expo Modules Core** for native-to-JavaScript communication, which provides a more reliable event system than React Native's standard RCTEventEmitter.

### Key Files

- `App.tsx` - Main app component with voice UI
- `modules/switchboard-voice/` - Local Expo native module
  - `src/` - TypeScript module wrapper
  - `ios/` - Swift implementation using Expo Module API
  - `ios/SwitchboardVoice.podspec` - CocoaPods spec linking Switchboard frameworks

### Event Pattern

Events use Expo's `Module.addListener()` pattern:

```typescript
const subscription = SwitchboardVoiceModule.addListener('onTranscript', (event) => {
  console.log(event.text, event.isFinal);
});

// Cleanup
subscription.remove();
```
