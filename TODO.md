# TODO: switchboard-voice-rn Implementation

## Phase 1: Library Scaffolding

### ✓ 1.1 Project Structure Setup

- [x] Create directory structure (src/, specs/, shared/, ios/, scripts/, example/, **tests**/)

### ✓ 1.2 Core Configuration Files

- [x] package.json
- [x] tsconfig.json
- [x] babel.config.js
- [x] metro.config.js
- [x] jest.config.js
- [x] .eslintrc.js
- [x] .prettierrc.js
- [x] Gemfile
- [x] .gitignore
- [x] README.md
- [x] CHANGELOG.md
- [x] LICENSE

### ✓ 1.3 TurboModule Specification

- [x] specs/NativeSwitchboardVoiceModule.ts

### ✓ 1.4 C++ Implementation Stub

- [x] shared/NativeSwitchboardVoiceModule.h
- [x] shared/NativeSwitchboardVoiceModule.cpp

### ✓ 1.5 iOS Native Module Setup

- [x] ios/.xcode.env
- [x] ios/SwitchboardVoiceRN-Bridging-Header.h
- [x] ios/SwitchboardVoiceModule.swift (stub implementation)
- [x] ios/SwitchboardVoiceModule.mm (Objective-C bridge)
- [x] switchboard-voice-rn.podspec

### ✓ 1.6 Setup Scripts

- [x] scripts/setup.py (Python-based, cross-platform)
- [x] Downloaded Switchboard SDK frameworks
- [x] Updated .gitignore to exclude Frameworks/
- [x] Updated README.md with setup instructions

### ✓ 1.7 TypeScript API Layer (TDD)

- [x] Created **tests**/SwitchboardVoice.test.ts (17 tests)
- [x] Created src/types.ts
- [x] Created src/SwitchboardVoice.ts
- [x] Created src/index.ts
- [x] All tests passing ✅

### ✓ 1.8 Example App Setup

- [x] example/ - Initialized React Native 0.76.5 project
- [x] example/package.json - Linked to parent library
- [x] example/App.tsx - Full voice demo UI
- [x] example/ios/Podfile - Configured with parent pod

### ✓ 1.9 Verification

- [x] Run npm install in root
- [x] Run npm install in example
- [x] Run pod install in example/ios
- [x] Build example app successfully
- [x] Verify module imports and tests pass
- [x] Fixed podspec framework linking issue (Session 2)
- [x] App launches in simulator without crashes ✅

---

## 🎉 Phase 1 Complete - Ready for Phase 2!

**Session 2 Status (2026-01-22):**

- All Phase 1 scaffolding verified and working
- Build system functional, app launches successfully
- Native module bridge working (stub methods callable from JS)
- Framework dependencies properly linked
- TypeScript tests passing (17/17)

**Next Session: Start Phase 2 - Native Implementation**

---

## Phase 2: Listening Pipeline (VAD → STT)

### ✓ 2.1 Native iOS Implementation

- [x] ios/AudioGraphManager.swift (audio graph manager with VAD → STT pipeline)
- [x] ios/SwitchboardVoiceModule.swift (RCTEventEmitter with AudioGraphManager integration)
- [x] ios/SwitchboardVoiceModule.mm (bridge extends RCTEventEmitter)

### ✓ 2.2 TypeScript Wrapper

- [x] src/SwitchboardVoice.ts (fixed native module name)
- [x] src/types.ts
- [x] src/index.ts

### ✓ 2.3 Example App Integration

- [x] example/App.tsx has full listening UI
- [x] example/ios/SwitchboardVoiceExample/Info.plist has microphone permission

### ✓ 2.4 Testing & Verification

- [x] Build succeeds for iOS Simulator ✅
- [x] Fixed Metro bundler module resolution (updated example/metro.config.js)
- [x] Build succeeds for physical iOS device ✅
- [x] Tested on physical device - VAD → STT pipeline working ✅

---

## 🎉 Phase 2 Complete!

**What's working:**

- ✅ SDK initialization
- ✅ Microphone permission request
- ✅ VAD detection (speech start/end)
- ✅ Whisper STT transcription
- ✅ Events to React Native

**Next: Phase 3 - TTS**

---

## Phase 3: Speaking Pipeline (TTS)

### ⏳ 3.1 TTS AudioGraph Configuration

- [ ] Extend AudioGraphManager.swift with TTS methods

### ⏳ 3.2 Bridge to React Native

- [ ] Extend SwitchboardVoiceModule.swift with speak methods

### ⏳ 3.3 State Machine Implementation

- [ ] Add state tracking to SwitchboardVoice.ts

### ⏳ 3.4 Example App Update

- [ ] Add text input and speak button

---

## Phase 4: Interruption Handling (Barge-in)

### ⏳ 4.1 VAD Detection During TTS

- [ ] Add VAD activity listener to AudioGraphManager.swift

### ⏳ 4.2 Barge-in Logic

- [ ] Implement interruption detection in SwitchboardVoiceModule.swift

### ⏳ 4.3 JavaScript Integration

- [ ] Add onInterrupted callback to SwitchboardVoice.ts

### ⏳ 4.4 Example App Integration

- [ ] Handle interruption events in UI

---

## Phase 5: Polish

### ⏳ 5.1 Error Handling

- [ ] Wrap Switchboard calls in error handling
- [ ] Bridge errors to JavaScript

### ⏳ 5.2 Microphone Permission Handling

- [ ] Add permission check method
- [ ] Update Info.plist with usage description

### ⏳ 5.3 Configuration Validation

- [ ] Validate config parameters
- [ ] Add runtime parameter update method

### ⏳ 5.4 TypeScript Types Export

- [ ] Complete all type definitions

### ⏳ 5.5 Testing

- [ ] **tests**/SwitchboardVoice.test.ts
- [ ] Add unit tests for configuration validation

### ⏳ 5.6 Documentation

- [ ] Complete README.md with full API docs
- [ ] Create CHANGELOG.md
- [ ] Add LICENSE file

### ⏳ 5.7 Pre-publish Checklist

- [ ] All tests passing
- [ ] Linting passing
- [ ] Example app builds and runs
- [ ] TypeScript declarations generated
- [ ] package.json metadata complete
- [ ] .npmignore created

---

**Legend:**

- ✓ Completed
- → In Progress
- ⏳ Pending
