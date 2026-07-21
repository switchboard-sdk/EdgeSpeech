#include "NativeEdgeSpeech.h"

#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif

// Switchboard extensions. Each must be loaded once, before any graph that uses
// it is built — hence the constructor below. Headers resolve via the per-
// framework `include/` dirs added to the build's header search paths.
#include "OnnxExtension.hpp"
#include "SileroVADExtension.hpp"
#include "WhisperExtension.hpp"
#include "SherpaExtension.hpp"

namespace facebook::react {

NativeEdgeSpeech::NativeEdgeSpeech(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeEdgeSpeechCxxSpec(std::move(jsInvoker)) {
  // Register extensions with the SDK. ONNX underpins SileroVAD, so load it first.
  switchboard::extensions::onnx::OnnxExtension::load();
  switchboard::extensions::silerovad::SileroVADExtension::load();
  switchboard::extensions::whisper::WhisperExtension::load();
  switchboard::extensions::sherpa::SherpaExtension::load();

  // Forward every SDK event to JS via the codegen-generated emitter.
  switchboard.setEventCallback(
      [this](const std::string& event) { emitOnEventReceived(event); });
}

static MicrophonePermissionHook s_micPermissionHook;

void NativeEdgeSpeech::setMicrophonePermissionHook(MicrophonePermissionHook hook) {
  s_micPermissionHook = std::move(hook);
}

std::string NativeEdgeSpeech::processCommand(jsi::Runtime& rt, std::string command) {
  return switchboard.processCommand(command);
}

bool NativeEdgeSpeech::isSimulator(jsi::Runtime& rt) {
#if defined(__APPLE__) && TARGET_OS_SIMULATOR
  return true;
#else
  return false;
#endif
}

AsyncPromise<bool> NativeEdgeSpeech::requestMicrophonePermission(jsi::Runtime& rt) {
  AsyncPromise<bool> promise(rt, jsInvoker_);
  if (s_micPermissionHook) {
    // resolve() hops back to the JS thread; the completion may fire on any thread.
    s_micPermissionHook([promise](bool granted) mutable { promise.resolve(granted); });
  } else {
    // No hook (Android / tests): handled elsewhere.
    promise.resolve(true);
  }
  return promise;
}

} // namespace facebook::react
