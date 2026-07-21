#pragma once

// Codegen-generated C++ TurboModule spec for `src/NativeEdgeSpeech.ts`.
// The umbrella header name comes from package.json `codegenConfig.name`.
#include <RNEdgeSpeechSpecJSI.h>

#include <functional>
#include <memory>
#include <string>

#include <react/bridging/Promise.h>
#include <switchboard/SwitchboardJSONRPC.hpp>

namespace facebook::react {

// Platform-provided mic-permission request; calls the completion with the grant
// result (async, may complete on any thread).
using MicrophonePermissionHook = std::function<void(std::function<void(bool)>)>;

/**
 * EdgeSpeech's native core: a C++ TurboModule wrapping `SwitchboardJSONRPC`.
 *
 * The entire SDK is driven over one JSON-RPC string channel (`processCommand`),
 * and SDK events are pushed to JS through the generated `emitOnEventReceived`.
 * All voice-pipeline logic lives in TypeScript (VoiceEngine); this layer only
 * relays commands/events and exposes two platform facts (simulator + mic).
 * The same source is intended to compile for iOS and Android.
 */
class NativeEdgeSpeech : public NativeEdgeSpeechCxxSpec<NativeEdgeSpeech> {
public:
  NativeEdgeSpeech(std::shared_ptr<CallInvoker> jsInvoker);

  std::string processCommand(jsi::Runtime& rt, std::string command);
  bool isSimulator(jsi::Runtime& rt);
  AsyncPromise<bool> requestMicrophonePermission(jsi::Runtime& rt);

  /** Set by the platform layer (iOS provider / Android JNI) at startup. */
  static void setMicrophonePermissionHook(MicrophonePermissionHook hook);

private:
  switchboard::SwitchboardJSONRPC switchboard;
};

} // namespace facebook::react
