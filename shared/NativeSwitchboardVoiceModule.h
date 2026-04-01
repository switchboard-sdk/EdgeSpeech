#pragma once

#include <SwitchboardVoiceSpecsJSI.h>
#include <memory>
#include <string>

// TODO: Add Switchboard SDK headers when implementing native functionality
// #include "switchboard_v2/SwitchboardSDK.hpp"
// #include "switchboard/Switchboard.hpp"
// using namespace switchboard;

namespace facebook::react {
using namespace jsi;

class NativeSwitchboardVoiceModule
    : public NativeSwitchboardVoiceModuleCxxSpec<NativeSwitchboardVoiceModule> {
public:
  NativeSwitchboardVoiceModule(std::shared_ptr<CallInvoker> jsInvoker);

  // SDK Initialization
  void initialize(jsi::Runtime& rt, const std::string& appId, const std::string& appSecret);

  // Configuration
  void configure(jsi::Runtime& rt, const std::string& configJson);

  // Engine Management
  std::string createListeningEngine(jsi::Runtime& rt);
  std::string createSpeakingEngine(jsi::Runtime& rt);

  // Control Methods
  void start(jsi::Runtime& rt);
  void stop(jsi::Runtime& rt);
  void speak(jsi::Runtime& rt, const std::string& text);
  void stopSpeaking(jsi::Runtime& rt);

  // Event Listeners
  void setupTranscriptionListener(jsi::Runtime& rt);
  void setupTTSCompleteListener(jsi::Runtime& rt);
  void setupVADActivityListener(jsi::Runtime& rt);
  void setupErrorListener(jsi::Runtime& rt);

  // Dynamic Parameter Updates
  void setValue(jsi::Runtime& rt,
                const std::string& nodeId,
                const std::string& key,
                const std::string& value);

  std::string getValue(jsi::Runtime& rt,
                       const std::string& nodeId,
                       const std::string& key);

  // Permission Handling
  jsi::Value checkMicrophonePermission(jsi::Runtime& rt);

private:
  std::string listeningEngineID_;
  std::string speakingEngineID_;
};

} // namespace facebook::react
