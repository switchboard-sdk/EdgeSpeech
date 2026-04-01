# Progress Log: switchboard-voice-rn

## Session 1 - 2026-01-21

### Setup & Planning
- [x] Initialized git repository
- [x] Created `.gitignore` (excludes `external/`, `node_modules/`, `dist/`, `libs/`, Pods/, etc.)
- [x] Cloned reference repositories to `external/`:
  - `daw-react-native` - TurboModule architecture reference
  - `voice-app-control-example-ios` - VAD → STT pipeline reference
  - `switchboard-voice-changer-demo` - Advanced audio processing patterns
- [x] Explored all reference repositories
- [x] Created comprehensive implementation plan at `/Users/tleigh/.claude/plans/shiny-painting-pascal.md`

### Phase 1.1: Project Structure ✓
- [x] Created directory structure:
  - `src/` - TypeScript library source
  - `specs/` - TurboModule specifications
  - `shared/` - C++ cross-platform implementation
  - `ios/` - iOS native code
  - `scripts/` - Setup and build scripts
  - `example/` - Example app (to be initialized)
  - `__tests__/` - Jest tests

### Phase 1.2: Core Configuration Files ✓
- [x] Created `package.json` with:
  - name: "switchboard-voice-rn"
  - version: "0.1.0"
  - TurboModule codegenConfig
  - Peer dependencies: react ^18.3.1, react-native ^0.76.0
  - Dev dependencies: TypeScript, Jest, ESLint, Prettier, React Native tools
- [x] Created `tsconfig.json` extending `@react-native/typescript-config`
- [x] Created `babel.config.js` using `@react-native/babel-preset`
- [x] Created `metro.config.js` with React Native defaults
- [x] Created `jest.config.js` configured for React Native
- [x] Created `.eslintrc.js` extending `@react-native` config
- [x] Created `.prettierrc.js` with code formatting rules
- [x] Created `Gemfile` pinning CocoaPods >= 1.13
- [x] Updated `.gitignore` to exclude build artifacts and dependencies
- [x] Created `README.md` with API documentation and quick start guide
- [x] Created `CHANGELOG.md` for version tracking
- [x] Created `LICENSE` (MIT)
- [x] Created `TODO.md` for task tracking
- [x] Created `PROGRESS.md` for session log
- [x] Updated `CLAUDE.md` with process management instructions

### Phase 1.3: TurboModule Specification ✓
- [x] Created `specs/NativeSwitchboardVoiceModule.ts` with TurboModule interface:
  - initialize(), configure() methods
  - Engine management (createListeningEngine, createSpeakingEngine)
  - Control methods (start, stop, speak, stopSpeaking)
  - Event listener setup methods
  - Dynamic parameter updates (setValue, getValue)
  - Microphone permission handling

### Phase 1.4: C++ Implementation Stub ✓
- [x] Created `shared/NativeSwitchboardVoiceModule.h` with:
  - Class inheriting from TurboModule spec
  - All method declarations matching the TypeScript spec
  - Private member variables for engine IDs
- [x] Created `shared/NativeSwitchboardVoiceModule.cpp` with:
  - Stub implementations for all methods
  - TODO comments indicating where Switchboard SDK calls go
  - Console logging for debugging
  - Pattern follows daw-react-native reference

### Phase 1.5: iOS Native Module Setup ✓
- [x] Created `ios/.xcode.env` - Node binary configuration for Xcode
- [x] Created `ios/Podfile` - CocoaPods configuration with React Native setup
- [x] Created `ios/SwitchboardVoiceRN/` directory structure
- [x] Created `ios/SwitchboardVoiceRN/AppDelegate.h` - RCTAppDelegate interface
- [x] Created `ios/SwitchboardVoiceRN/AppDelegate.mm` - TurboModule registration
- [x] Created `ios/SwitchboardVoiceRN/Info.plist` - App metadata with microphone permissions
- [x] Created `ios/SwitchboardVoiceRN-Bridging-Header.h` - Objective-C to Swift bridge

### Phase 1.6: Setup Scripts ✓
- [x] Created `scripts/setup.py` - Python-based setup script for cross-platform compatibility
  - Downloads Switchboard SDK XCFrameworks from S3
  - Supports iOS platform (Android placeholder)
  - Command-line arguments for platform and SDK version
  - Automatic extraction and cleanup
- [x] Updated `.gitignore` to exclude `Frameworks/` directory
- [x] Updated `README.md` with setup instructions

### Phase 1.X: TypeScript API Layer (TDD Approach) ✓
- [x] Created `__tests__/SwitchboardVoice.test.ts` - Comprehensive test suite (17 tests)
  - Configuration validation tests
  - Lifecycle method tests (start, stop, speak, stopSpeaking)
  - Event handler tests
  - Permission request tests
- [x] Created `src/types.ts` - TypeScript type definitions
  - VoiceConfig, VoiceState, VoiceError interfaces
  - Callback type definitions
- [x] Created `src/SwitchboardVoice.ts` - Main API wrapper
  - Singleton pattern with event-driven architecture
  - Native module bridging with proper error handling
  - Configuration validation and state management
- [x] Created `src/index.ts` - Public API exports
- [x] All 17 tests passing ✅ (RED → GREEN)

### Phase 1.7: Example App Setup ✓
- [x] Initialized React Native 0.76.5 example app
- [x] Configured `example/package.json` to link to parent library (file:..)
- [x] Created `example/App.tsx` with full voice demo UI:
  - Voice input controls (start/stop listening)
  - Transcript display
  - TTS controls with text input
  - State visualization (idle/listening/processing/speaking)
  - Error handling and permission requests
- [x] Installed example app dependencies (949 packages)

## Summary of Phase 1 Progress
**Phases 1.1-1.7 Complete! ✓**

### What's Been Built
1. **Project Structure**: All directories created (src/, specs/, shared/, ios/, scripts/, example/, __tests__/)
2. **Configuration**: Complete build toolchain (package.json, tsconfig, babel, metro, jest, eslint, prettier, Gemfile)
3. **Documentation**: README, CHANGELOG, LICENSE, TODO.md, PROGRESS.md
4. **TurboModule Spec**: TypeScript interface defining the native bridge API
5. **C++ Stubs**: Cross-platform implementation layer (header + source)
6. **iOS Native Setup**: Podfile, AppDelegate, Info.plist, Bridging header
7. **Setup Scripts**: Python-based SDK downloader with cross-platform support
8. **TypeScript API Layer**: Complete with 17 passing tests (TDD approach)
9. **Example App**: Full-featured demo app ready for testing

### Next Steps (Phase 1.8 then Phase 2)
1. Phase 1.8: Verify linking and build
2. Phase 2: Implement native iOS layer with Switchboard SDK integration

### Key Decisions Made
- **Architecture**: TurboModule (C++) for cross-platform readiness
- **Example Structure**: Separate `example/` directory as standalone RN app
- **Scope**: Full implementation including all 5 phases (VAD, STT, TTS, barge-in, polish)
- **Extensions**: Load SwitchboardWhisper, SileroVAD, Silero BEFORE SDK initialization
- **Sample Rate**: 16000 Hz for Whisper STT compatibility

### Phase 1.8: Build and Verification ✓
- [x] Created `switchboard-voice-rn.podspec` with Switchboard SDK framework dependencies
- [x] Downloaded Switchboard SDK frameworks via `scripts/setup.py`:
  - SwitchboardSDK.xcframework
  - SwitchboardWhisper.xcframework
  - SwitchboardSileroVAD.xcframework
  - SwitchboardOnnx.xcframework
- [x] Cleaned up iOS directory structure (removed App-specific files from library)
- [x] Created Swift native module implementation:
  - `ios/SwitchboardVoiceModule.swift` - Stub implementation with all methods
  - `ios/SwitchboardVoiceModule.mm` - Objective-C bridge for React Native
  - `ios/SwitchboardVoiceRN-Bridging-Header.h` - Swift-ObjC bridge
- [x] Resolved C++ compilation issues (excluded shared/ from podspec temporarily)
- [x] Successfully built example app for iOS Simulator ✅
- [x] Verified npm dependencies installed (root and example)
- [x] Verified CocoaPods integration working
- [x] Verified TypeScript tests passing (17/17 tests ✅)

## Summary of Phase 1 Complete! 🎉
**All Phase 1 tasks (1.1-1.8) are now complete!**

### What's Been Built
1. **Project Structure**: All directories created (src/, specs/, shared/, ios/, scripts/, example/, __tests__/)
2. **Configuration**: Complete build toolchain (package.json, tsconfig, babel, metro, jest, eslint, prettier, Gemfile)
3. **Documentation**: README, CHANGELOG, LICENSE, TODO.md, PROGRESS.md
4. **TurboModule Spec**: TypeScript interface defining the native bridge API
5. **C++ Stubs**: Cross-platform implementation layer (stubbed for future use)
6. **iOS Native Module**: Swift implementation with Objective-C bridge (stubs ready for Switchboard SDK)
7. **Setup Scripts**: Python-based SDK downloader with cross-platform support
8. **TypeScript API Layer**: Complete with 17 passing tests (TDD approach)
9. **Example App**: Full-featured demo app with voice UI
10. **Build System**: CocoaPods integration, Switchboard SDK frameworks installed
11. **Verification**: Example app builds successfully, tests pass

### Architecture Decisions
- **Native Implementation**: Swift-based (not C++ TurboModule) for iOS
  - Simpler to implement Switchboard SDK integration in Swift
  - C++ layer excluded for now, can be added later if needed for Android
- **Module Bridge**: Uses RCT_EXTERN_MODULE for Swift-to-React Native bridge
- **Framework Management**: Switchboard SDK frameworks downloaded via Python script
- **Example Structure**: Separate `example/` directory as standalone RN app

### Ready for Phase 2: Native Implementation
The scaffolding is complete. Next steps:
1. Create `AudioGraphManager.swift` to manage Switchboard audio graphs
2. Implement VAD → STT pipeline using Switchboard SDK
3. Wire up event emitters for transcript callbacks
4. Test on device with actual speech input

### References
- Plan file: `/Users/tleigh/.claude/plans/shiny-painting-pascal.md`
- CLAUDE.md: Project specifications and requirements
- Reference repos: `external/daw-react-native`, `external/voice-app-control-example-ios`, `external/switchboard-voice-changer-demo`

---

## Session 2 - 2026-01-22

### Phase 1.8 Fix: Framework Linking Issue
- [x] Fixed podspec framework dependencies
  - **Issue**: App crashed at launch with "Library not loaded: @rpath/libwhisper.framework/libwhisper"
  - **Root cause**: Whisper library dependencies were listed as `vendored_libraries` but they're actually XCFrameworks
  - **Fix**: Moved all Whisper deps to `vendored_frameworks` array in podspec
  - Successfully rebuilt and launched app in simulator ✅

### Testing Instructions Created
- [x] Documented testing procedures for:
  - iOS Simulator testing (quick verification, no audio)
  - Physical device testing (full voice features)
  - TypeScript test suite
  - Log monitoring (Metro, Xcode console, React Native Debugger)

### Phase 1 Status: Fully Verified ✅
All Phase 1 scaffolding complete and working:
- ✅ Build system functional
- ✅ Native module loads without crashes
- ✅ App launches in simulator
- ✅ Framework dependencies properly linked
- ✅ Ready for Phase 2 implementation

### Phase 2: Native Implementation - VAD → STT Pipeline
- [x] Created `ios/AudioGraphManager.swift`:
  - Manages Switchboard SDK audio graph lifecycle
  - Builds VAD → STT audio graph configuration programmatically
  - Sets up event listeners for transcription and VAD events
  - Delegate pattern for communicating events to module
- [x] Updated `ios/SwitchboardVoiceModule.swift`:
  - Now extends RCTEventEmitter for native-to-JS event emission
  - Integrates AudioGraphManager with delegate callbacks
  - Emits events: onTranscript, onStateChange, onError, onSpeechStart, onSpeechEnd, onInterrupted
  - SDK initialization with placeholder credentials
- [x] Updated `ios/SwitchboardVoiceModule.mm`:
  - Changed bridge to extend RCTEventEmitter instead of NSObject
- [x] Added microphone permission to `example/ios/SwitchboardVoiceExample/Info.plist`
- [x] Fixed TypeScript native module name (SwitchboardVoiceModule not NativeSwitchboardVoiceModule)
- [x] Build verified for iOS Simulator ✅

### Physical Device Build & Testing
- [x] Fixed Metro bundler module resolution issue
  - Updated `example/metro.config.js` with watchFolders and nodeModulesPaths
  - Allows Metro to resolve the parent library via `file:..` dependency
- [x] Build succeeded for physical iOS device ✅
- [x] App tested on physical iPhone

### Phase 2 Complete! 🎉

**What's working:**
- ✅ SDK initialization with placeholder credentials
- ✅ Microphone permission request
- ✅ VAD detection (speech start/end events)
- ✅ Whisper STT transcription
- ✅ Event emission to React Native (onTranscript, onStateChange, onSpeechStart, onSpeechEnd)

**Not yet implemented (Phase 3):**
- ❌ TTS audio playback (`speak()` method is a stub - emits state change but no audio)
