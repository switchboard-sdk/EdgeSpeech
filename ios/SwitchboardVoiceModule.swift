import ExpoModulesCore
import AVFoundation

public class SwitchboardVoiceModule: Module, AudioGraphManagerDelegate {

    // MARK: - Properties

    private var audioGraphManager: AudioGraphManager?
    private var isInitialized = false

    // Event names
    private static let EVENT_TRANSCRIPT = "onTranscript"
    private static let EVENT_STATE_CHANGE = "onStateChange"
    private static let EVENT_ERROR = "onError"
    private static let EVENT_SPEECH_START = "onSpeechStart"
    private static let EVENT_SPEECH_END = "onSpeechEnd"
    private static let EVENT_INTERRUPTED = "onInterrupted"
    private static let EVENT_TTS_COMPLETE = "onTTSComplete"

    // MARK: - Expo Module Definition

    public func definition() -> ModuleDefinition {
        Name("SwitchboardVoice")

        // Define events that can be sent to JavaScript
        Events(
            SwitchboardVoiceModule.EVENT_TRANSCRIPT,
            SwitchboardVoiceModule.EVENT_STATE_CHANGE,
            SwitchboardVoiceModule.EVENT_ERROR,
            SwitchboardVoiceModule.EVENT_SPEECH_START,
            SwitchboardVoiceModule.EVENT_SPEECH_END,
            SwitchboardVoiceModule.EVENT_INTERRUPTED,
            SwitchboardVoiceModule.EVENT_TTS_COMPLETE
        )

        // SDK Initialization
        Function("initialize") { (appId: String, appSecret: String) in
            print("[SwitchboardVoice] initialize called with appId: \(appId)")

            guard !self.isInitialized else {
                print("[SwitchboardVoice] Already initialized, skipping")
                return
            }

            do {
                self.audioGraphManager = AudioGraphManager()
                self.audioGraphManager?.delegate = self
                try self.audioGraphManager?.initialize(appId: appId, appSecret: appSecret)
                self.isInitialized = true
                print("[SwitchboardVoice] SDK initialized successfully")
            } catch {
                print("[SwitchboardVoice] Failed to initialize SDK: \(error.localizedDescription)")
                self.emitError(code: "INIT_FAILED", message: error.localizedDescription)
            }
        }

        // Configure
        Function("configure") { (config: [String: Any]) in
            print("[SwitchboardVoice] configure called with config: \(config)")

            let vadSensitivity = config["vadSensitivity"] as? Float
            let sampleRate = config["sampleRate"] as? Int
            let bufferSize = config["bufferSize"] as? Int
            let ttsVoice = config["ttsVoice"] as? String

            self.audioGraphManager?.configure(
                vadSensitivity: vadSensitivity,
                sampleRate: sampleRate,
                bufferSize: bufferSize,
                ttsVoice: ttsVoice
            )
        }

        // Create Listening Engine
        Function("createListeningEngine") { () -> String in
            print("[SwitchboardVoice] createListeningEngine called")

            guard self.isInitialized else {
                self.emitError(code: "NOT_INITIALIZED", message: "SDK not initialized. Call initialize() first.")
                return ""
            }

            do {
                let engineId = try self.audioGraphManager?.createListeningEngine() ?? ""
                print("[SwitchboardVoice] Listening engine created: \(engineId)")
                return engineId
            } catch {
                print("[SwitchboardVoice] Failed to create listening engine: \(error.localizedDescription)")
                self.emitError(code: "ENGINE_CREATION_FAILED", message: error.localizedDescription)
                return ""
            }
        }

        // Create TTS Engine
        Function("createTTSEngine") { () -> String in
            print("[SwitchboardVoice] createTTSEngine called")

            guard self.isInitialized else {
                self.emitError(code: "NOT_INITIALIZED", message: "SDK not initialized. Call initialize() first.")
                return ""
            }

            do {
                let engineId = try self.audioGraphManager?.createTTSEngine() ?? ""
                print("[SwitchboardVoice] TTS engine created: \(engineId)")
                return engineId
            } catch {
                print("[SwitchboardVoice] Failed to create TTS engine: \(error.localizedDescription)")
                self.emitError(code: "ENGINE_CREATION_FAILED", message: error.localizedDescription)
                return ""
            }
        }

        // Start listening
        AsyncFunction("start") { (promise: Promise) in
            print("[SwitchboardVoice] start called")

            guard self.isInitialized else {
                promise.reject("NOT_INITIALIZED", "SDK not initialized. Call initialize() first.")
                return
            }

            DispatchQueue.main.async {
                // Ensure we have a listening engine
                if self.audioGraphManager?.hasEngine != true {
                    do {
                        _ = try self.audioGraphManager?.createListeningEngine()
                    } catch {
                        promise.reject("ENGINE_CREATION_FAILED", error.localizedDescription)
                        return
                    }
                }

                do {
                    try self.audioGraphManager?.startListening()
                    promise.resolve(nil)
                } catch {
                    promise.reject("START_FAILED", error.localizedDescription)
                }
            }
        }

        // Stop listening
        AsyncFunction("stop") { (promise: Promise) in
            print("[SwitchboardVoice] stop called")

            do {
                try self.audioGraphManager?.stopListening()
                promise.resolve(nil)
            } catch {
                promise.reject("STOP_FAILED", error.localizedDescription)
            }
        }

        // Speak text
        AsyncFunction("speak") { (text: String, promise: Promise) in
            print("[SwitchboardVoice] speak called with text: \(text)")

            guard self.isInitialized else {
                promise.reject("NOT_INITIALIZED", "SDK not initialized. Call initialize() first.")
                return
            }

            DispatchQueue.main.async {
                do {
                    try self.audioGraphManager?.speak(text: text)
                    promise.resolve(nil)
                } catch {
                    print("[SwitchboardVoice] Failed to speak: \(error.localizedDescription)")
                    promise.reject("SPEAK_FAILED", error.localizedDescription)
                }
            }
        }

        // Stop speaking
        AsyncFunction("stopSpeaking") { (promise: Promise) in
            print("[SwitchboardVoice] stopSpeaking called")

            do {
                try self.audioGraphManager?.stopSpeaking()
                promise.resolve(nil)
            } catch {
                promise.reject("STOP_SPEAKING_FAILED", error.localizedDescription)
            }
        }

        // Set value
        Function("setValue") { (engineId: String, key: String, value: Double) in
            print("[SwitchboardVoice] setValue called: engineId=\(engineId), key=\(key), value=\(value)")
            // TODO: Implement dynamic parameter updates
        }

        // Get value
        Function("getValue") { (engineId: String, key: String) -> Double in
            print("[SwitchboardVoice] getValue called: engineId=\(engineId), key=\(key)")
            // TODO: Implement dynamic parameter retrieval
            return 0.0
        }

        // Request microphone permission
        AsyncFunction("requestMicrophonePermission") { (promise: Promise) in
            print("[SwitchboardVoice] requestMicrophonePermission called")

            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    if granted {
                        print("[SwitchboardVoice] Microphone permission granted")
                        promise.resolve(true)
                    } else {
                        print("[SwitchboardVoice] Microphone permission denied")
                        promise.reject("PERMISSION_DENIED", "Microphone permission was denied")
                    }
                }
            }
        }
    }

    // MARK: - AudioGraphManagerDelegate

    func audioGraphManager(_ manager: AudioGraphManager, didReceiveTranscript text: String, isFinal: Bool) {
        print("[SwitchboardVoice] Transcript received: '\(text)' (isFinal: \(isFinal))")
        emitTranscript(text: text, isFinal: isFinal)
    }

    func audioGraphManager(_ manager: AudioGraphManager, didChangeState state: String) {
        print("[SwitchboardVoice] State changed: \(state)")
        emitStateChange(state)
    }

    func audioGraphManager(_ manager: AudioGraphManager, didEncounterError error: Error) {
        print("[SwitchboardVoice] Error: \(error.localizedDescription)")
        emitError(code: "AUDIO_GRAPH_ERROR", message: error.localizedDescription)
    }

    func audioGraphManagerDidDetectSpeechStart(_ manager: AudioGraphManager) {
        print("[SwitchboardVoice] Speech start detected")
        emitSpeechStart()
    }

    func audioGraphManagerDidDetectSpeechEnd(_ manager: AudioGraphManager) {
        print("[SwitchboardVoice] Speech end detected")
        emitSpeechEnd()
    }

    func audioGraphManagerDidFinishSpeaking(_ manager: AudioGraphManager) {
        print("[SwitchboardVoice] Finished speaking")
        emitTTSComplete()
    }

    func audioGraphManagerDidDetectInterruption(_ manager: AudioGraphManager) {
        print("[SwitchboardVoice] Interruption detected (barge-in)")
        emitInterrupted()
    }

    // MARK: - Event Emission Helpers

    private func emitTranscript(text: String, isFinal: Bool) {
        sendEvent(SwitchboardVoiceModule.EVENT_TRANSCRIPT, [
            "text": text,
            "isFinal": isFinal
        ])
    }

    private func emitStateChange(_ state: String) {
        sendEvent(SwitchboardVoiceModule.EVENT_STATE_CHANGE, [
            "state": state
        ])
    }

    private func emitError(code: String, message: String) {
        sendEvent(SwitchboardVoiceModule.EVENT_ERROR, [
            "code": code,
            "message": message
        ])
    }

    private func emitSpeechStart() {
        sendEvent(SwitchboardVoiceModule.EVENT_SPEECH_START, [:])
    }

    private func emitSpeechEnd() {
        sendEvent(SwitchboardVoiceModule.EVENT_SPEECH_END, [:])
    }

    private func emitInterrupted() {
        sendEvent(SwitchboardVoiceModule.EVENT_INTERRUPTED, [:])
    }

    private func emitTTSComplete() {
        sendEvent(SwitchboardVoiceModule.EVENT_TTS_COMPLETE, [:])
    }
}
