# TURBO.md — Migrating EdgeSpeech to a TurboModule + JSON-RPC Architecture

> Plan to re-implement `@synervoz/edgespeech` internally on the same
> architecture as `@synervoz/openai-realtime-toolkit` (the `EdgeAudio` repo):
> a **bare React Native C++ TurboModule** whose entire native surface is a single
> **JSON-RPC 2.0 string channel** (`processCommand`) plus one event emitter, with
> all feature logic living in TypeScript.

---

## 1. Goal

Replace EdgeSpeech's current **Expo Modules API (Swift)** implementation with the
**EdgeAudio pattern**, so that:

- Native code is a ~10-line delegate to the Switchboard SDK's C++ `SwitchboardJSONRPC` — it (almost) never changes to add features.
- The VAD → STT → TTS audio graph, the state machine, barge-in logic, and event translation all move **up into TypeScript**.
- **The library's public JS API does not change** — existing consumers and the example app keep working with zero source edits.
- The Swift files (`SwitchboardVoiceModule.swift`, `AudioGraphManager.swift`) and the Expo Modules dependency are **removed**.

### Locked decisions (confirmed with owner, 2026-07-19)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Platform scope** | **iOS only now.** Put the shared implementation in `cpp/` so Android is a clean follow-up, but only wire/build/ship/test iOS. |
| 2 | **Public JS API** | **Unchanged.** Freeze the current public interface; rebuild internals only. |
| 3 | **Audio graph authorship** | **In TypeScript**, over the RPC channel (port `AudioGraphManager.swift` → TS). |
| 4 | **Expo Modules API** | **Dropped.** Become a bare RN C++ TurboModule like EdgeAudio. |

---

## 2. Why this is feasible (verified)

- EdgeSpeech and EdgeAudio download Switchboard frameworks from the **same public S3 bucket** (`switchboard-sdk-public/builds/release/<ver>/ios`).
- EdgeAudio's native `processCommand` is a one-liner because the **`SwitchboardSDK.zip` ships a C++ `SwitchboardJSONRPC` class** (`ios/Frameworks/SwitchboardSDK/ios/include/switchboard/SwitchboardJSONRPC.hpp`) that parses the JSON-RPC envelope, dispatches to the Switchboard object model, and serializes the response — plus a `setEventCallback` for pushing events.
- EdgeSpeech pulls the **same** `SwitchboardSDK.zip` (it currently only consumes the Swift/ObjC face of it). So the identical thin-native approach applies — **no hand-written C++ dispatch switch is required.**
- The only real differences from EdgeAudio: EdgeSpeech needs the **Whisper** (STT) and **Sherpa** (TTS) extensions instead of OpenAI/SmartTurn; both share core SDK + SileroVAD + Onnx.

### SDK version note

- **Locked: stay on `release/3.2.3`** (owner decision, 2026-07-19). No version bump.
- **✅ Verified (downloaded & inspected 3.2.3):** `SwitchboardSDK.zip` ships `include/switchboard/SwitchboardJSONRPC.hpp` — identical `processCommand`/`setEventCallback` API to 3.2.4 — and `Switchboard.hpp` with `createEngine → ObjectURI` and `destroyEngine`. `SWITCHBOARD_VERSION_NAME == "3.2.3"`. The thin-native delegate is viable on the pinned version with **no bump**; feasibility risk retired.

---

## 3. Architecture: before → after

### Current (Expo Modules API)

```
JS: EdgeSpeech / EdgeSpeechProvider / useEdgeSpeech
      └─ src/SwitchboardVoiceModule.ts  (requireNativeModule + NativeModule.addListener)
            └─ ios/SwitchboardVoiceModule.swift   (Expo `Module` DSL: 7 Functions, Events(...))
                  └─ ios/AudioGraphManager.swift  (ALL graph/engine/action/listener logic)
                        └─ SwitchboardSDK (Swift API)
```

### Target (bare C++ TurboModule + JSON-RPC)

```
JS: EdgeSpeech / EdgeSpeechProvider / useEdgeSpeech   ← UNCHANGED public API
      └─ src/SwitchboardVoiceModule.ts   ← REWRITTEN as a façade (same shape) over ↓
            └─ src/VoiceEngine.ts        ← NEW: ports AudioGraphManager.swift to TS
                  └─ src/SwitchboardClient.ts       (getValue/setValue/callAction/addEventListener)
                        └─ src/NativeModuleRPCClient.ts   (builds JSON-RPC envelope)
                              └─ src/NativeEdgeSpeech.ts   (codegen TurboModule spec)
                                    └─ cpp/NativeEdgeSpeech.cpp   ← THIN: delegates to SwitchboardJSONRPC
                                          └─ SwitchboardSDK (C++ SwitchboardJSONRPC)
      ios/EdgeSpeechModuleProvider.mm    ← constructs the C++ module, injects mic-permission hook
```

**Key structural change:** everything inside `AudioGraphManager.swift` (graph JSON, `createEngine`, `start`/`stop`, `synthesize`, event listeners, barge-in, state machine) moves into `src/VoiceEngine.ts`, expressed as RPC calls. Native becomes a pass-through.

---

## 4. The invariant: the public API that must NOT change

These are re-exported from `src/index.ts` and consumed by the example app and downstream users. **All signatures, names, and event semantics stay identical.**

**Standalone functions** (`index.ts`): `initialize(appId, appSecret)`, `configure(config)`, `listen()`, `stopListening()`, `speak(text)`, `stopSpeaking()`, `requestMicrophonePermission()`.

**`EdgeSpeech` singleton** (`EdgeSpeech.ts`): `configure(config)`, `listen()`, `stopListening()`, `speak(text)`, `stopSpeaking()`, `requestMicrophonePermission()`; getters `currentState`, `isConfigured`; settable callbacks `onTranscript`, `onStateChange`, `onInterrupted`, `onError`; `_cleanup()`.

**`EdgeSpeechProvider`** (`EdgeSpeechProvider.tsx`): props `appId`, `appSecret`, `sttModel?`, `ttsVoice?`, `vadSensitivity?`, `sampleRate?`, `bufferSize?`, `children?`; context value `{ addListener, listen, stopListening, speak, stopSpeaking, requestMicrophonePermission }`.

**`useEdgeSpeech()`** (`hook.ts`): returns `transcript`, `onTranscriptComplete`, `onInterrupted`, `voiceState`, `error`, `hasMicrophonePermission`, and wrapped `listen`/`stopListening`/`speak`/`stopSpeaking`/`requestMicrophonePermission`.

**Default export `SwitchboardVoiceModule`** (re-exported by `index.ts`): keeps its shape — methods `initialize`, `configure`, `listen`, `stopListening`, `speak`, `stopSpeaking`, `requestMicrophonePermission`, and `addListener(eventName, cb) → { remove() }`.

**Events** (via `addListener`): `onTranscript` `{text, isFinal}`, `onStateChange` `{state}`, `onError` `{code, message}`, plus `onSpeechStart`, `onSpeechEnd`, `onInterrupted`, `onTTSComplete`.

**Types** (`types.ts`): `VoiceState`, `VoiceConfig`, `VoiceError`, `TranscriptEvent`, `StateChangeEvent`, `ErrorEvent`, and the callback types — **unchanged**.

> **Strategy that guarantees this:** keep `src/index.ts`, `EdgeSpeech.ts`,
> `EdgeSpeechProvider.tsx`, `hook.ts`, `types.ts` **byte-for-byte unchanged**, and
> re-implement `src/SwitchboardVoiceModule.ts` as a **façade** exposing exactly the
> same shape (methods + `addListener`) but backed by the new RPC/`VoiceEngine`
> layer instead of Expo's `requireNativeModule`. Nothing upstream of that file
> needs to know the transport changed.

---

## 5. The JSON-RPC contract (copied from EdgeAudio, renamed)

**Request** (built in `NativeModuleRPCClient.sendCommand`):
```json
{ "jsonrpc": "2.0", "id": 1, "method": "callAction",
  "params": { "objectURI": "switchboard", "actionName": "initialize", "params": { ... } } }
```

**Response** (returned synchronously as a string by `processCommand`):
```json
{ "jsonrpc": "2.0", "id": 1, "result": <any> }
// or
{ "jsonrpc": "2.0", "id": 1, "error": { "code": <int>, "message": "...", "data": <any?> } }
```

**Five RPC methods** exposed by `SwitchboardClient` (each keyed by `objectURI`):

| Method | params |
|--------|--------|
| `getValue` | `{ objectURI, key }` |
| `setValue` | `{ objectURI, key, value }` |
| `callAction` | `{ objectURI, actionName, params }` |
| `addEventListener` | `{ objectURI, eventName }` |
| `removeEventListener` | `{ objectURI, listenerID }` |

**Events:** native pushes every Switchboard event as a JSON string through the
`onEventReceived` emitter. TS subscribes once (`setEventReceivedCallback`) and
registers a wildcard SDK listener (`addEventListener('*', '*')`), then classifies
each event by `objectURI` (last path segment → `vadNode`/`sttNode`/`ttsNode`) and
event name. This mirrors EdgeAudio's `dispatch(raw)` parser.

---

## 6. Porting `AudioGraphManager.swift` → `src/VoiceEngine.ts`

Every Swift SDK call has a direct RPC equivalent. This table is the core of the migration.

| Swift (today) | TS RPC (target) |
|---|---|
| `SBOnnxExtension.loadExtension()` … (4 extensions) | **Two layers:** TS declares the set in the `initialize` `extensions` map (row below); the C++ ctor also calls `::load()` once per extension (§7). |
| `Switchboard.initialize(withConfig: {appID, appSecret, extensions})` | `client.callAction('switchboard', 'initialize', { appID, appSecret, extensions: { Onnx:{}, SileroVAD:{}, Whisper:{}, Sherpa:{} } })` |
| `Switchboard.createEngine(withConfig: config)` → `engineId` | ✅ `client.callAction('switchboard', 'createEngine', graphConfig)` → `result` is the engine `ObjectURI`. Pass the graph config **as the action params directly** (mirrors the C++ `createEngine(config)` signature; confirm the exact wrapping on first run). |

> **Node addressing (verified):** nodes are targeted by **bare name** — `ttsNode`,
> `sttNode`, `vadNode` (no engine-ID prefix). Engine-level actions (`start`/`stop`,
> `voiceProcessingEnabled`) target the **engine `ObjectURI`** returned by
> `createEngine`. Teardown can call `callAction('switchboard', 'destroyEngine', <engineURI>)`
> (available in 3.2.3) in addition to the Swift approach of `stop` + dropping the ref.
| `Switchboard.setValue(true, forKey:"voiceProcessingEnabled", onObject: id)` | `client.setValue(engineId, 'voiceProcessingEnabled', true)` |
| `Switchboard.callAction(id, "start", nil)` | `client.callAction(engineId, 'start', {})` |
| `Switchboard.callAction(id, "stop", nil)` | `client.callAction(engineId, 'stop', {})` |
| `Switchboard.callAction("ttsNode", "synthesize", ["text": text])` | `client.callAction('ttsNode', 'synthesize', { text })` |
| `Switchboard.callAction("ttsNode", "stop", nil)` | `client.callAction('ttsNode', 'stop', {})` |
| `Switchboard.addEventListener("sttNode", "transcribed", cb)` | wildcard subscribe + classify `objectURI` ends with `sttNode`, `name === 'transcribed'` |
| `addEventListener("vadNode", "speechStarted"/"speechEnded")` | classify `vadNode` + name |
| `addEventListener("ttsNode", "finished"/"synthesisStarted")` | classify `ttsNode` + name |
| `Switchboard.removeEventListener(...)` | `client.removeEventListener(uri, id)` (or drop entirely if using a single wildcard listener) |

### Graph config (moves verbatim into TS)

`buildCombinedGraphConfig()` becomes a plain TS object builder producing the exact
same JSON (`type:"Realtime"`, `microphoneEnabled:true`, `speakerEnabled:true`,
nodes: `MultiChannelToMono → BusSplitter → {SileroVAD.VAD, Whisper.STT}`, and
`Sherpa.TTS → MonoToMultiChannel → outputNode`, data edge
`vadNode.speechEnded → sttNode.transcribe`). `vadSensitivity`, `sampleRate`,
`bufferSize`, `ttsVoice` come from `configure()` and are interpolated in TS.

> **Simulator GPU guard (resolved):** the Swift code disables Whisper `useGPU` on
> the simulator (`#if targetEnvironment(simulator)`) because Metal crashes there.
> TS can't see that compile flag, and RN's `Platform.OS` only distinguishes ios/
> android. **Decision:** expose a tiny native `isSimulator(): boolean` on the
> TurboModule spec; `VoiceEngine` sets `useGPU: !Native.isSimulator()`. (EdgeAudio
> has no precedent here — it runs no on-device GPU model.)

### Logic that moves into TS (`VoiceEngine`)

- **State machine** `idle → listening → speaking` and the `onStateChange` emissions.
- **Barge-in:** the `transcribed`-while-`isSpeaking` gate → stop TTS, emit `onInterrupted`, emit final `onTranscript`.
- **TTS lifecycle:** `synthesisStarted`/`finished` handling, `isSpeaking` guarding so `stopSpeaking()` doesn't fire a late `onTTSComplete`.
- **Lazy engine creation** in `speak()` (create engine + `start` if not already listening) — mirrors Swift `speak()`.
- **Event fan-out:** translate classified SDK events into the public events (`onTranscript`, `onStateChange`, `onInterrupted`, `onSpeechStart`, `onSpeechEnd`, `onTTSComplete`, `onError`) that the façade re-emits through `addListener`.
- **Error mapping:** RPC `error` responses → `onError` `{code, message}` using the existing code vocabulary (`NOT_INITIALIZED`, `ENGINE_CREATION_FAILED`, `LISTEN_FAILED`, …).

---

## 7. Native layer (thin — iOS)

### `cpp/NativeEdgeSpeech.{h,cpp}` (shared; only iOS wired now)

Mirror `cpp/NativeOpenAIRealtimeToolkit.*`:

```cpp
// NativeEdgeSpeech.h
#include <RNEdgeSpeechSpecJSI.h>            // codegen output; name from codegenConfig.name
#include <react/bridging/Promise.h>
#include <switchboard/SwitchboardJSONRPC.hpp>

namespace facebook::react {
using MicrophonePermissionHook = std::function<void(std::function<void(bool)>)>;

class NativeEdgeSpeech : public NativeEdgeSpeechCxxSpec<NativeEdgeSpeech> {
public:
  NativeEdgeSpeech(std::shared_ptr<CallInvoker> jsInvoker);
  std::string processCommand(jsi::Runtime& rt, std::string command);
  bool isSimulator(jsi::Runtime& rt);                 // TS uses this to gate Whisper useGPU
  AsyncPromise<bool> requestMicrophonePermission(jsi::Runtime& rt);
  static void setMicrophonePermissionHook(MicrophonePermissionHook hook);
private:
  switchboard::SwitchboardJSONRPC switchboard;
};
}
```

```cpp
// NativeEdgeSpeech.cpp (essence)
#include "OnnxExtension.hpp"
#include "SileroVADExtension.hpp"
#include "WhisperExtension.hpp"   // per SDK convention; auto-confirmed on Phase-1 download
#include "SherpaExtension.hpp"    // per SDK convention; auto-confirmed on Phase-1 download

NativeEdgeSpeech::NativeEdgeSpeech(std::shared_ptr<CallInvoker> js)
    : NativeEdgeSpeechCxxSpec(std::move(js)) {
  // Register extensions once, before any graph is built (mirrors EdgeAudio).
  switchboard::extensions::onnx::OnnxExtension::load();
  switchboard::extensions::silerovad::SileroVADExtension::load();
  switchboard::extensions::whisper::WhisperExtension::load();
  switchboard::extensions::sherpa::SherpaExtension::load();

  switchboard.setEventCallback([this](const std::string& e){ emitOnEventReceived(e); });
}
std::string NativeEdgeSpeech::processCommand(jsi::Runtime&, std::string cmd) {
  return switchboard.processCommand(cmd);
}
```

> **Extension loading (resolved, mirrors EdgeAudio):** two layers — (1) TS declares
> the set + per-extension config in the `initialize` `extensions` map; (2) the C++
> ctor calls `::load()` once per extension (the only per-extension native code, ~4
> lines + includes). SileroVAD/Onnx header names come straight from EdgeAudio; the
> **only Phase-0 lookup** is the exact Whisper/Sherpa C++ header names + namespaces
> in the 3.2.3 headers.

### `ios/EdgeSpeechModuleProvider.{h,mm}`

Mirror `OpenAIRealtimeToolkitModuleProvider.*`: conform to `<RCTModuleProvider>`,
`getTurboModule:` returns `std::make_shared<NativeEdgeSpeech>(params.jsInvoker)`
and injects the **mic-permission hook** (AVFoundation) via
`NativeEdgeSpeech::setMicrophonePermissionHook(...)`. (EdgeSpeech doesn't need
`getDocumentsPath`/`writeFile`, so those are omitted unless we want them.)

### Files removed

- `ios/SwitchboardVoiceModule.swift` ❌
- `ios/AudioGraphManager.swift` ❌
- `expo-module.config.json` ❌
- `shared/NativeSwitchboardVoiceModule.{h,cpp}` ❌ (orphaned dead stub)

### Files kept

- `ios/PrivacyInfo.xcprivacy` ✅ (still bundled as a resource)

---

## 8. `edgespeech.podspec`

Replace the ExpoModulesCore-based spec with the EdgeAudio shape:

```ruby
s.source_files = "cpp/**/*.{h,hpp,cpp}", "ios/**/*.{h,mm}"
s.pod_target_xcconfig = {
  "HEADER_SEARCH_PATHS"         => "$(inherited) " + header_search_paths.join(" "),
  "FRAMEWORK_SEARCH_PATHS"      => "$(inherited) " + framework_search_paths.join(" "),
  "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
}
s.frameworks = "AVFoundation", "AudioToolbox"
s.vendored_frameworks = [ "SwitchboardSDK", "SwitchboardOnnx", "SwitchboardSileroVAD",
                          "SwitchboardWhisper", "SwitchboardSherpa" ].map { |p| ".../#{p}.xcframework" }
s.resource_bundles = { "edgespeech_privacy" => ["ios/PrivacyInfo.xcprivacy"] }

install_modules_dependencies(s)   # <-- enables new-arch / codegen / Folly flags
```

- Remove `s.dependency 'ExpoModulesCore'`.
- Keep the framework download. Either keep the current JS `scripts/postinstall.js` **or** move to a podspec `prepare_command` like EdgeAudio (`bash scripts/download-ios-frameworks.sh`). **Recommend keeping the existing S3 postinstall** to minimize churn, but ensure it also lays down the C++ `include/` headers (verify in Phase 0).

---

## 9. `package.json`, codegen, build

**Add `codegenConfig`:**
```json
"codegenConfig": {
  "name": "RNEdgeSpeechSpec",
  "type": "modules",
  "jsSrcsDir": "src",
  "android": { "javaPackageName": "com.synervoz.edgespeech" },
  "ios": { "modulesProvider": { "EdgeSpeech": "EdgeSpeechModuleProvider" } }
}
```

**Dependency changes:**
- Remove `expo`, `expo-modules-core` from `peerDependencies`/`devDependencies`.
- **Stay on RN 0.81.5 / Expo SDK 54** (locked). Add dev deps `@react-native/*` matching 0.81.5.
- Bump `peerDependencies.react-native` from `>=0.74.0` → **`>=0.81.0`** (new arch + C++ TurboModule `ios.modulesProvider`; matches the tested version). Relax later if needed.
- Keep runtime deps needed by the S3 postinstall (`@aws-sdk/client-s3`, `@clack/prompts`) if we retain that path.
- Keep `main`/`types` = `dist/*`; add `react-native`/`source` = `src/index` (EdgeAudio does this).

**`files` array:** add `src`, `cpp`, `ios/**/*.{h,mm}`, `react-native.config.js`; drop `expo-module.config.json` and the `ios/*.swift` glob.

**`react-native.config.js` (new):** iOS `podspecPath` now; Android `cxxModule*` keys added but effectively dormant until Android phase.

**Build:** unchanged — plain `tsc` (`build`, `check`/`typecheck`). No builder-bob.

---

## 10. Example app impact

- **Stays an Expo app.** `example/app.json` already has `newArchEnabled: true`. Expo prebuild's `use_native_modules!` autolinks the bare TurboModule via `react-native.config.js` + podspec.
- **`App.tsx` unchanged** — it uses only `EdgeSpeechProvider` + `useEdgeSpeech`, which are frozen (§4).
- Re-run `expo prebuild --clean` + `npx expo run:ios` to regenerate `example/ios` with the new pod and codegen output.
- `example/metro.config.js` mapping stays; just drop the `expo-modules-core` pin if present.

---

## 11. Testing strategy

- **Preserve existing JS unit tests.** Because `SwitchboardVoiceModule.ts` keeps its shape, tests that mock `./SwitchboardVoiceModule` keep passing. Tests that mock the Expo layer directly get repointed at the façade.
- **Add `src/__mocks__/NativeEdgeSpeech.ts`** (mirror EdgeAudio's mock): canned JSON-RPC responses for `processCommand` (return `{"jsonrpc":"2.0","id":<n>,"result":...}`), a controllable `onEventReceived` emitter, and `requestMicrophonePermission`. `TurboModuleRegistry.getEnforcing` throws without a native module, so this mock is required for Jest.
- **New unit tests** for `VoiceEngine` (graph JSON shape, state machine transitions, barge-in gating, event classification) driven entirely through the mock — this is the biggest quality win, since that logic was previously untestable Swift.
- Keep `test` + `test:integration` scripts.

---

## 12. Phased implementation plan

> Per CLAUDE.md: keep `PROGRESS.md` / `TODO.md` updated and **check in after each phase**.

**Phase 0 — Verification & spike (no product code) — ✅ DONE**
1. ✅ SDK version locked at 3.2.3.
2. ✅ Downloaded & inspected `builds/release/3.2.3/ios/SwitchboardSDK.zip`: `include/switchboard/SwitchboardJSONRPC.hpp` present (same API as 3.2.4); `SWITCHBOARD_VERSION_NAME == "3.2.3"`.
3. ✅ Extension convention verified from SileroVAD/Onnx headers: file `<Name>Extension.hpp`, `namespace switchboard::extensions::<name>`, static `load()` (+ `sb_extension_load()`). Whisper/Sherpa follow it → `WhisperExtension`/`SherpaExtension` in `…::whisper`/`…::sherpa` (exact names auto-confirmed when the 332 MB/488 MB packages download in Phase 1; not pulled now).
4. ✅ `createEngine` shape verified in 3.2.3 `Switchboard.hpp`: `callAction('switchboard','createEngine', <graphConfig>)` → engine `ObjectURI`; `destroyEngine(engineURI)` also available. Node addressing = bare names.
→ **All Phase-0 unknowns retired. Ready for Phase 1.**

**Phase 1 — TurboModule skeleton (iOS)**
- Add `src/NativeEdgeSpeech.ts`, `codegenConfig`, `react-native.config.js`, `cpp/NativeEdgeSpeech.*`, `ios/EdgeSpeechModuleProvider.*`, new podspec.
- Remove Swift files + Expo config + `shared/` stub.
- Get it to compile & load in the example; verify a trivial `processCommand` round-trips.
→ Check in.

**Phase 2 — Port the listening pipeline (VAD → STT)**
- `RPCClient.ts`, `NativeModuleRPCClient.ts`, `SwitchboardClient.ts` (copied/renamed).
- `VoiceEngine.ts`: init, graph build, `createEngine`, `voiceProcessingEnabled`, `start`/`stop`, event classification → `onTranscript`/`onStateChange`/`onSpeechStart`/`onSpeechEnd`. Simulator GPU guard (Q1).
- Rewrite `SwitchboardVoiceModule.ts` façade; verify `EdgeSpeech`/hook still work.
→ Check in (live STT in example).

**Phase 3 — Port the speaking pipeline (TTS) + barge-in**
- `speak`/`stopSpeaking`, `synthesize`/`finished`/`synthesisStarted`, `onTTSComplete`.
- Barge-in gating + `onInterrupted`.
→ Check in (full round trip + interruption).

**Phase 4 — Tests, errors, cleanup**
- `__mocks__/NativeEdgeSpeech.ts`, VoiceEngine unit tests, error mapping, README, version bump to **1.1.0** (owner decision — public API is source-compatible). CHANGELOG must **prominently** flag the changed build contract (New Architecture now required, RN ≥0.81, no longer an Expo module) so 1.0.x consumers aren't surprised on `npm update`.
→ Final check in.

**Phase 5 (deferred) — Android**
- `android/CMakeLists.txt`, `build.gradle`, Kotlin package, Prefab AARs for Whisper/Sherpa, mic-permission JVM module. Only after iOS ships.

---

## 13. Risks & open questions

- **Q1 — Simulator GPU:** **Resolved** — add a native `isSimulator(): boolean` to the TurboModule spec; `VoiceEngine` sets `useGPU: !isSimulator`. (RN `Platform` only gives ios/android; EdgeAudio has no precedent — cloud-based.)
- **Q2 — Object URIs:** **Resolved & verified** — nodes use bare names (`ttsNode`, `sttNode`, `vadNode`); engine-level actions use the `createEngine` `ObjectURI`. `createEngine` = `callAction('switchboard','createEngine', graphConfig)` → engine URI (verified in 3.2.3 `Switchboard.hpp`).
- **Q3 — C++ extension loading:** **Resolved & verified** — two-layer (TS `initialize` map + C++ ctor `::load()`). Convention verified from SileroVAD/Onnx headers: `<Name>Extension.hpp`, `namespace switchboard::extensions::<name>`, static `load()`. Whisper/Sherpa follow it (auto-confirmed when their packages download in Phase 1).
- **Q4 — SDK version:** ~~bump 3.2.3 → 3.2.4?~~ **Resolved: stay on 3.2.3.** (Phase 0 must confirm 3.2.3 ships the C++ JSON-RPC header — see §2.)
- **Q5 — RN version:** **Resolved** — stay on RN 0.81.5 / Expo SDK 54 (avoids dragging an Expo SDK upgrade into this work; 0.81 already supports C++ TurboModules + `ios.modulesProvider`). Peer floor set to `>=0.81.0`.
- **Q6 — Framework download path:** keep the JS S3 postinstall vs move to podspec `prepare_command`. Recommend keeping postinstall, but it must also place the C++ `include/` headers.
- **Q7 — Versioning/semver:** **Resolved: 1.1.0** (owner decision — public API is source-compatible). CHANGELOG must **prominently** note the changed build contract (New Architecture required, RN ≥0.81, Expo Modules removed) since a minor version alone under-signals it.

---

## 14. File-by-file summary

| Action | Path | Notes |
|--------|------|-------|
| **keep** | `src/index.ts`, `EdgeSpeech.ts`, `EdgeSpeechProvider.tsx`, `hook.ts`, `types.ts` | Public API — unchanged |
| **rewrite** | `src/SwitchboardVoiceModule.ts` | Expo binding → façade over `VoiceEngine` (same shape) |
| **add** | `src/NativeEdgeSpeech.ts` | Codegen TurboModule spec |
| **add** | `src/RPCClient.ts`, `src/NativeModuleRPCClient.ts`, `src/SwitchboardClient.ts` | Transport (copied/renamed from EdgeAudio) |
| **add** | `src/VoiceEngine.ts` | Ported `AudioGraphManager.swift` logic |
| **add** | `src/__mocks__/NativeEdgeSpeech.ts` | Jest mock |
| **add** | `cpp/NativeEdgeSpeech.{h,cpp}` | Thin JSON-RPC delegate |
| **add** | `ios/EdgeSpeechModuleProvider.{h,mm}` | RCTModuleProvider + mic hook |
| **add** | `react-native.config.js` | Autolinking (iOS now; Android keys dormant) |
| **rewrite** | `edgespeech.podspec` | `install_modules_dependencies`, c++20, cpp+mm sources |
| **edit** | `package.json` | `codegenConfig`, drop Expo, files array, deps |
| **delete** | `ios/SwitchboardVoiceModule.swift` | Expo module |
| **delete** | `ios/AudioGraphManager.swift` | Logic moved to TS |
| **delete** | `expo-module.config.json` | Expo registration |
| **delete** | `shared/NativeSwitchboardVoiceModule.{h,cpp}` | Orphaned dead stub |
| **keep** | `ios/PrivacyInfo.xcprivacy`, `scripts/postinstall.js` | (postinstall may need header-layout tweak) |
```
