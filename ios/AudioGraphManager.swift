import Foundation
import SwitchboardSDK
import SwitchboardOnnx
import SwitchboardWhisper
import SwitchboardSileroVAD
import SwitchboardSherpa

// Enable verbose SDK logging
private func enableSDKDebugLogging() {
    SBLogger.setLogLevel(.debug)
    print("[AudioGraphManager] SDK debug logging enabled")
}

/// Delegate protocol for receiving audio graph events
protocol AudioGraphManagerDelegate: AnyObject {
    func audioGraphManager(_ manager: AudioGraphManager, didReceiveTranscript text: String, isFinal: Bool)
    func audioGraphManager(_ manager: AudioGraphManager, didChangeState state: String)
    func audioGraphManager(_ manager: AudioGraphManager, didEncounterError error: Error)
    func audioGraphManagerDidDetectSpeechStart(_ manager: AudioGraphManager)
    func audioGraphManagerDidDetectSpeechEnd(_ manager: AudioGraphManager)
    func audioGraphManagerDidFinishSpeaking(_ manager: AudioGraphManager)
    func audioGraphManagerDidDetectInterruption(_ manager: AudioGraphManager)
}

/// Manages a single Switchboard SDK audio engine with both listening (VAD→STT) and
/// TTS pipelines in one graph. Using a single engine keeps VoiceProcessingIO (AEC)
/// active during TTS playback, which is required for barge-in to work correctly.
class AudioGraphManager {

    // MARK: - Properties

    weak var delegate: AudioGraphManagerDelegate?

    // Single combined engine (VAD→STT + TTS in one graph)
    private var engineId: String?

    // Event listener IDs
    private var transcriptionListenerId: NSNumber?
    private var vadStartListenerId: NSNumber?
    private var vadEndListenerId: NSNumber?
    private var ttsFinishedListenerId: NSNumber?
    private var ttsSynthesisStartedListenerId: NSNumber?

    // State
    private var isListening = false
    private var isSpeaking = false
    private var isInitialized = false

    // Configuration
    private var vadSensitivity: Float = 0.5
    private var sampleRate: Int = 16000
    private var bufferSize: Int = 512
    private var ttsVoice: String = "en_GB"

    // MARK: - Initialization

    /// Initialize the Switchboard SDK with credentials
    func initialize(appId: String, appSecret: String) throws {
        guard !isInitialized else {
            print("[AudioGraphManager] Already initialized")
            return
        }

        enableSDKDebugLogging()

        print("[AudioGraphManager] Initializing Switchboard SDK...")

        // Load extensions — ONNX must be first (SileroVAD depends on it)
        print("[AudioGraphManager] Loading ONNX extension...")
        SBOnnxExtension.loadExtension()

        print("[AudioGraphManager] Loading SileroVAD extension...")
        SBSileroVADExtension.loadExtension()

        print("[AudioGraphManager] Loading Whisper extension...")
        SBWhisperExtension.loadExtension()

        print("[AudioGraphManager] Loading Sherpa extension...")
        SBSherpaExtension.loadExtension()

        let initConfig: [String: Any] = [
            "appID": appId,
            "appSecret": appSecret,
            "extensions": [
                "Onnx": [:],
                "SileroVAD": [:],
                "Whisper": [:],
                "Sherpa": [:]
            ]
        ]

        print("[AudioGraphManager] Initializing SDK with config...")
        let result = Switchboard.initialize(withConfig: initConfig)

        if !result.success {
            let errorMsg = result.error?.localizedDescription ?? "Unknown error"
            if errorMsg.contains("already been initialized") || errorMsg.contains("already initialized") {
                print("[AudioGraphManager] SDK already initialized, continuing")
            } else {
                print("[AudioGraphManager] SDK initialization failed: \(errorMsg)")
                throw AudioGraphError.engineCreationFailed("SDK initialization failed: \(errorMsg)")
            }
        }

        isInitialized = true
        print("[AudioGraphManager] SDK and all extensions initialized successfully")
    }

    /// Configure audio graph parameters
    func configure(vadSensitivity: Float? = nil, sampleRate: Int? = nil, bufferSize: Int? = nil, ttsVoice: String? = nil) {
        if let sensitivity = vadSensitivity {
            self.vadSensitivity = max(0.0, min(1.0, sensitivity))
        }
        if let rate = sampleRate {
            self.sampleRate = rate
        }
        if let size = bufferSize {
            self.bufferSize = size
        }
        if let voice = ttsVoice {
            self.ttsVoice = voice
        }
        print("[AudioGraphManager] Configuration updated: vadSensitivity=\(self.vadSensitivity), sampleRate=\(self.sampleRate), bufferSize=\(self.bufferSize)")
    }

    // MARK: - Engine Management

    /// Create the combined audio engine (VAD→STT + TTS in a single graph)
    func createEngine() throws -> String {
        guard isInitialized else {
            throw AudioGraphError.notInitialized
        }

        if engineId != nil {
            destroyEngine()
        }

        let config = buildCombinedGraphConfig()

        if let jsonData = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print("[AudioGraphManager] Creating combined engine with config:\n\(jsonString)")
        }

        let result = Switchboard.createEngine(withConfig: config)

        guard result.success, let id = result.value as? String else {
            let errorMsg = result.error?.localizedDescription ?? "Unknown error"
            print("[AudioGraphManager] Failed to create engine: \(errorMsg)")
            throw AudioGraphError.engineCreationFailed(errorMsg)
        }

        engineId = id
        print("[AudioGraphManager] Engine created with ID: \(id)")

        // Enable VoiceProcessingIO (AEC). Must be set after creation via setValue —
        // the JSON config key does not reach SBIOSAudioIO.configureWithVoiceProcessingEnabled.
        // With a single engine (microphoneEnabled + speakerEnabled), VoiceChat mode keeps
        // AEC active during TTS playback, preventing self-triggered barge-in.
        let vpResult = Switchboard.setValue(NSNumber(value: true), forKey: "voiceProcessingEnabled", onObject: id)
        if let error = vpResult.error {
            print("[AudioGraphManager] Warning: Could not set voiceProcessingEnabled: \(error.localizedDescription)")
        } else {
            print("[AudioGraphManager] voiceProcessingEnabled = true")
        }

        try setupEventListeners(for: id)

        return id
    }

    /// Destroy the engine and clean up resources
    func destroyEngine() {
        removeEventListeners()

        if let id = engineId {
            _ = Switchboard.callAction(withObject: id, actionName: "stop", params: nil)
            engineId = nil
            isListening = false
            isSpeaking = false
            print("[AudioGraphManager] Engine destroyed")
        }
    }

    // MARK: - Control Methods

    /// Start the engine (activates mic input and enables TTS output)
    func startListening() throws {
        guard let id = engineId else {
            throw AudioGraphError.noEngine
        }

        guard !isListening else {
            print("[AudioGraphManager] Already listening")
            return
        }

        print("[AudioGraphManager] Starting engine...")

        let result = Switchboard.callAction(withObject: id, actionName: "start", params: nil)

        if let error = result.error {
            print("[AudioGraphManager] Failed to start engine: \(error.localizedDescription)")
            throw AudioGraphError.startFailed(error.localizedDescription)
        }

        isListening = true
        delegate?.audioGraphManager(self, didChangeState: "listening")
        print("[AudioGraphManager] Engine started successfully")
    }

    /// Stop the engine (stops mic input and TTS output)
    func stopListening() throws {
        guard let id = engineId else {
            print("[AudioGraphManager] stopListening: no engine, ignoring")
            return
        }

        guard isListening else {
            print("[AudioGraphManager] Not currently listening, ignoring stop")
            return
        }

        print("[AudioGraphManager] Stopping engine...")

        let result = Switchboard.callAction(withObject: id, actionName: "stop", params: nil)

        if let error = result.error {
            print("[AudioGraphManager] Failed to stop engine: \(error.localizedDescription)")
            throw AudioGraphError.stopFailed(error.localizedDescription)
        }

        isListening = false
        isSpeaking = false
        delegate?.audioGraphManager(self, didChangeState: "idle")
        print("[AudioGraphManager] Engine stopped successfully")
    }

    // MARK: - TTS Control Methods

    /// Speak text using the TTS node in the running engine
    func speak(text: String) throws {
        guard isInitialized else {
            throw AudioGraphError.notInitialized
        }

        guard !text.isEmpty else {
            print("[AudioGraphManager] Empty text, skipping")
            return
        }

        // Ensure engine exists
        if engineId == nil {
            _ = try createEngine()
        }

        // Start engine if not already running (also activates mic + AEC for barge-in)
        if !isListening {
            try startListening()
        }

        print("[AudioGraphManager] Speaking text: '\(text)'")

        let speakResult = Switchboard.callAction(
            withObject: "ttsNode",
            actionName: "synthesize",
            params: ["text": text]
        )

        if let error = speakResult.error {
            print("[AudioGraphManager] Failed to speak text: \(error.localizedDescription)")
            throw AudioGraphError.speakFailed(error.localizedDescription)
        }

        isSpeaking = true
        delegate?.audioGraphManager(self, didChangeState: "speaking")
        print("[AudioGraphManager] TTS synthesis started")
    }

    /// Stop TTS playback. Attempts to cancel the ttsNode; if the SDK does not support
    /// a stop action on the node, the audio drains naturally but onTTSComplete won't fire.
    func stopSpeaking() throws {
        guard isSpeaking else {
            print("[AudioGraphManager] Not currently speaking, ignoring")
            return
        }

        print("[AudioGraphManager] Stopping TTS playback...")

        // isSpeaking must be false before calling stop so the 'finished' event handler
        // (which guards on isSpeaking) does not fire onTTSComplete after cancellation.
        isSpeaking = false

        _ = Switchboard.callAction(withObject: "ttsNode", actionName: "stop", params: nil)

        let state = isListening ? "listening" : "idle"
        delegate?.audioGraphManager(self, didChangeState: state)
        print("[AudioGraphManager] TTS stop requested")
    }

    // MARK: - Private Methods

    /// Build the combined graph config with both listening (VAD→STT) and TTS pipelines.
    /// Topology matches the first-party WhisperSTTSherpaTTS example:
    ///   inputNode → multiChannelToMono → busSplitter → vadNode (SileroVAD.VAD)
    ///                                                → sttNode (Whisper.STT)
    ///   ttsNode (Sherpa.TTS) → monoToMultiChannel → outputNode
    ///   Data: vadNode/speechEnded → sttNode/transcribe
    private func buildCombinedGraphConfig() -> [String: Any] {
        // Input path nodes
        let multiChannelToMonoNode: [String: Any] = [
            "id": "multiChannelToMonoNode",
            "type": "MultiChannelToMono"
        ]
        let busSplitterNode: [String: Any] = [
            "id": "busSplitterNode",
            "type": "BusSplitter"
        ]
        let vadNode: [String: Any] = [
            "id": "vadNode",
            "type": "SileroVAD.VAD",
            "config": [
                "frameSize": 512,
                "threshold": vadSensitivity,
                "minSilenceDurationMs": 100
            ]
        ]
        let sttNode: [String: Any] = [
            "id": "sttNode",
            "type": "Whisper.STT",
            "config": ["initializeModel": true, "useGPU": true]
        ]

        // Output path nodes
        let ttsNode: [String: Any] = [
            "id": "ttsNode",
            "type": "Sherpa.TTS",
            "config": ["voice": ttsVoice]
        ]
        let monoToMultiChannelNode: [String: Any] = [
            "id": "monoToMultiChannelNode",
            "type": "MonoToMultiChannel"
        ]

        let connections: [[String: Any]] = [
            // Input path
            ["sourceNode": "inputNode", "destinationNode": "multiChannelToMonoNode"],
            ["sourceNode": "multiChannelToMonoNode", "destinationNode": "busSplitterNode"],
            ["sourceNode": "busSplitterNode", "destinationNode": "vadNode"],
            ["sourceNode": "busSplitterNode", "destinationNode": "sttNode"],
            // Data connection: VAD speechEnded triggers STT transcribe
            ["sourceNode": "vadNode.speechEnded", "destinationNode": "sttNode.transcribe"],
            // Output path
            ["sourceNode": "ttsNode", "destinationNode": "monoToMultiChannelNode"],
            ["sourceNode": "monoToMultiChannelNode", "destinationNode": "outputNode"]
        ]

        let graphConfig: [String: Any] = [
            "config": [
                "sampleRate": sampleRate,
                "bufferSize": bufferSize
            ],
            "nodes": [multiChannelToMonoNode, busSplitterNode, vadNode, sttNode, ttsNode, monoToMultiChannelNode],
            "connections": connections
        ]

        return [
            "type": "Realtime",
            "config": [
                "microphoneEnabled": true,
                "speakerEnabled": true,
                "graph": graphConfig
            ]
        ]
    }

    /// Set up all event listeners for both the listening and TTS pipelines
    private func setupEventListeners(for engineId: String) throws {
        print("[AudioGraphManager] Setting up event listeners for engine: \(engineId)")

        // STT transcription
        let transcriptionResult = Switchboard.addEventListener("sttNode", eventName: "transcribed") { [weak self] eventData in
            guard let self = self else { return }

            print("[AudioGraphManager] STT 'transcribed' event fired! Data: \(String(describing: eventData))")

            var transcriptText: String?
            if let text = eventData as? String {
                transcriptText = text
            } else if let dict = eventData as? [AnyHashable: Any],
                      let data = dict["data"] as? [String: Any],
                      let text = data["text"] as? String {
                transcriptText = text
            } else if let dict = eventData as? [String: Any], let text = dict["text"] as? String {
                transcriptText = text
            }

            guard let text = transcriptText else { return }
            print("[AudioGraphManager] Received transcript: \(text)")

            if self.isSpeaking {
                // Barge-in: Whisper recognised actual speech while TTS was playing.
                // Gating on transcription avoids false triggers from TTS audio bleed-through —
                // Whisper must decode real speech, not just noise.
                print("[AudioGraphManager] Barge-in detected — stopping TTS")
                self.isSpeaking = false
                _ = Switchboard.callAction(withObject: "ttsNode", actionName: "stop", params: nil)
                DispatchQueue.main.async {
                    self.delegate?.audioGraphManager(self, didChangeState: "listening")
                    self.delegate?.audioGraphManagerDidDetectInterruption(self)
                    self.delegate?.audioGraphManager(self, didReceiveTranscript: text, isFinal: true)
                }
            } else {
                DispatchQueue.main.async {
                    self.delegate?.audioGraphManager(self, didReceiveTranscript: text, isFinal: true)
                }
            }
        }

        if let listenerId = transcriptionResult.value {
            transcriptionListenerId = listenerId
            print("[AudioGraphManager] STT 'transcribed' listener added with ID: \(listenerId)")
        } else if let error = transcriptionResult.error {
            print("[AudioGraphManager] Failed to add STT 'transcribed' listener: \(error.localizedDescription)")
        }

        // VAD speech start
        let vadStartResult = Switchboard.addEventListener("vadNode", eventName: "speechStarted") { [weak self] eventData in
            guard let self = self else { return }
            print("[AudioGraphManager] VAD 'speechStarted' event fired!")
            DispatchQueue.main.async {
                self.delegate?.audioGraphManagerDidDetectSpeechStart(self)
            }
        }

        if let listenerId = vadStartResult.value {
            vadStartListenerId = listenerId
            print("[AudioGraphManager] VAD 'speechStarted' listener added with ID: \(listenerId)")
        } else if let error = vadStartResult.error {
            print("[AudioGraphManager] Failed to add VAD 'speechStarted' listener: \(error.localizedDescription)")
        }

        // VAD speech end
        let vadEndResult = Switchboard.addEventListener("vadNode", eventName: "speechEnded") { [weak self] eventData in
            guard let self = self else { return }
            print("[AudioGraphManager] VAD 'speechEnded' event fired!")
            DispatchQueue.main.async {
                self.delegate?.audioGraphManagerDidDetectSpeechEnd(self)
            }
        }

        if let listenerId = vadEndResult.value {
            vadEndListenerId = listenerId
            print("[AudioGraphManager] VAD 'speechEnded' listener added with ID: \(listenerId)")
        } else if let error = vadEndResult.error {
            print("[AudioGraphManager] Failed to add VAD 'speechEnded' listener: \(error.localizedDescription)")
        }

        // TTS finished
        let finishedResult = Switchboard.addEventListener("ttsNode", eventName: "finished") { [weak self] eventData in
            guard let self = self, self.isSpeaking else { return }
            print("[AudioGraphManager] TTS 'finished' event fired")
            self.isSpeaking = false
            DispatchQueue.main.async {
                self.delegate?.audioGraphManager(self, didChangeState: "listening")
                self.delegate?.audioGraphManagerDidFinishSpeaking(self)
            }
        }

        if let listenerId = finishedResult.value {
            ttsFinishedListenerId = listenerId
            print("[AudioGraphManager] TTS 'finished' listener added with ID: \(listenerId)")
        } else if let error = finishedResult.error {
            print("[AudioGraphManager] Failed to add TTS 'finished' listener: \(error.localizedDescription)")
        }

        // TTS synthesis started
        let synthesisStartedResult = Switchboard.addEventListener("ttsNode", eventName: "synthesisStarted") { [weak self] eventData in
            guard let self = self else { return }
            print("[AudioGraphManager] TTS 'synthesisStarted' event fired")
        }

        if let listenerId = synthesisStartedResult.value {
            ttsSynthesisStartedListenerId = listenerId
            print("[AudioGraphManager] TTS 'synthesisStarted' listener added with ID: \(listenerId)")
        } else if let error = synthesisStartedResult.error {
            print("[AudioGraphManager] Failed to add TTS 'synthesisStarted' listener: \(error.localizedDescription)")
        }
    }

    /// Remove all event listeners
    private func removeEventListeners() {
        if let id = transcriptionListenerId {
            Switchboard.removeEventListener("sttNode", listenerID: id)
            transcriptionListenerId = nil
        }
        if let id = vadStartListenerId {
            Switchboard.removeEventListener("vadNode", listenerID: id)
            vadStartListenerId = nil
        }
        if let id = vadEndListenerId {
            Switchboard.removeEventListener("vadNode", listenerID: id)
            vadEndListenerId = nil
        }
        if let id = ttsFinishedListenerId {
            Switchboard.removeEventListener("ttsNode", listenerID: id)
            ttsFinishedListenerId = nil
        }
        if let id = ttsSynthesisStartedListenerId {
            Switchboard.removeEventListener("ttsNode", listenerID: id)
            ttsSynthesisStartedListenerId = nil
        }
        print("[AudioGraphManager] All event listeners removed")
    }

    // MARK: - Status

    var isCurrentlyListening: Bool {
        return isListening
    }

    var isCurrentlySpeaking: Bool {
        return isSpeaking
    }

    var hasEngine: Bool {
        return engineId != nil
    }

    // MARK: - Cleanup

    deinit {
        destroyEngine()
    }
}

// MARK: - Error Types

enum AudioGraphError: LocalizedError {
    case notInitialized
    case noEngine
    case engineCreationFailed(String)
    case startFailed(String)
    case stopFailed(String)
    case speakFailed(String)
    case listenerSetupFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "Switchboard SDK not initialized. Call initialize() first."
        case .noEngine:
            return "No audio engine created. Call createEngine() first."
        case .engineCreationFailed(let message):
            return "Failed to create audio engine: \(message)"
        case .startFailed(let message):
            return "Failed to start audio engine: \(message)"
        case .stopFailed(let message):
            return "Failed to stop audio engine: \(message)"
        case .speakFailed(let message):
            return "Failed to speak text: \(message)"
        case .listenerSetupFailed(let message):
            return "Failed to setup event listener: \(message)"
        }
    }
}
