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

/// Manages Switchboard SDK audio graphs for VAD → STT pipeline
class AudioGraphManager {

    // MARK: - Properties

    weak var delegate: AudioGraphManagerDelegate?

    // Listening engine (VAD → STT)
    private var listeningEngineId: String?
    private var transcriptionListenerId: NSNumber?
    private var vadStartListenerId: NSNumber?
    private var vadEndListenerId: NSNumber?

    // TTS engine
    private var ttsEngineId: String?
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

        // Enable verbose logging first
        enableSDKDebugLogging()

        print("[AudioGraphManager] Initializing Switchboard SDK...")

        // Load extensions first (before SDK initialization)
        // IMPORTANT: Load ONNX extension first as SileroVAD depends on it
        print("[AudioGraphManager] Loading ONNX extension...")
        SBOnnxExtension.loadExtension()

        print("[AudioGraphManager] Loading SileroVAD extension...")
        SBSileroVADExtension.loadExtension()

        print("[AudioGraphManager] Loading Whisper extension...")
        SBWhisperExtension.loadExtension()

        print("[AudioGraphManager] Loading Sherpa extension...")
        SBSherpaExtension.loadExtension()

        // Build extensions config
        var extensionsConfig: [String: Any] = [:]
        extensionsConfig["Onnx"] = [:]
        extensionsConfig["SileroVAD"] = [:]
        extensionsConfig["Whisper"] = [:]
        extensionsConfig["Sherpa"] = [:]

        // Initialize SDK with config (sample app approach)
        let initConfig: [String: Any] = [
            "appID": appId,
            "appSecret": appSecret,
            "extensions": extensionsConfig
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

    /// Create the listening audio graph (VAD → STT)
    func createListeningEngine() throws -> String {
        guard isInitialized else {
            throw AudioGraphError.notInitialized
        }

        // If engine already exists, destroy it first
        if listeningEngineId != nil {
            destroyListeningEngine()
        }

        let config = buildListeningGraphConfig()

        // DEBUG: Pretty print the config
        if let jsonData = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print("[AudioGraphManager] Creating listening engine with config:\n\(jsonString)")
        } else {
            print("[AudioGraphManager] Creating listening engine with config: \(config)")
        }

        let result = Switchboard.createEngine(withConfig: config)

        guard result.success, let engineId = result.value as? String else {
            let errorMsg = result.error?.localizedDescription ?? "Unknown error"
            print("[AudioGraphManager] Failed to create listening engine: \(errorMsg)")
            throw AudioGraphError.engineCreationFailed(errorMsg)
        }

        listeningEngineId = engineId
        print("[AudioGraphManager] Listening engine created with ID: \(engineId)")

        // Set up event listeners
        try setupListeningEventListeners(for: engineId)

        return engineId
    }

    /// Destroy the listening engine and clean up resources
    func destroyListeningEngine() {
        // Remove event listeners first
        removeListeningEventListeners()

        if let engineId = listeningEngineId {
            let result = Switchboard.callAction(withObject: engineId, actionName: "stop", params: nil)
            if let error = result.error {
                print("[AudioGraphManager] Warning: Failed to stop engine before destruction: \(error.localizedDescription)")
            }
            // Note: Switchboard SDK may handle engine cleanup automatically
            listeningEngineId = nil
            print("[AudioGraphManager] Listening engine destroyed")
        }
    }

    // MARK: - TTS Engine Management

    /// Create the TTS audio graph
    func createTTSEngine() throws -> String {
        guard isInitialized else {
            throw AudioGraphError.notInitialized
        }

        // If engine already exists, destroy it first
        if ttsEngineId != nil {
            destroyTTSEngine()
        }

        let config = buildTTSGraphConfig()

        print("[AudioGraphManager] Creating TTS engine with config: \(config)")

        let result = Switchboard.createEngine(withConfig: config)

        guard result.success, let engineId = result.value as? String else {
            let errorMsg = result.error?.localizedDescription ?? "Unknown error"
            print("[AudioGraphManager] Failed to create TTS engine: \(errorMsg)")
            throw AudioGraphError.engineCreationFailed(errorMsg)
        }

        ttsEngineId = engineId
        print("[AudioGraphManager] TTS engine created with ID: \(engineId)")

        // Set up TTS event listeners
        try setupTTSEventListeners(for: engineId)

        return engineId
    }

    /// Destroy the TTS engine and clean up resources
    func destroyTTSEngine() {
        removeTTSEventListeners()

        if let engineId = ttsEngineId {
            let result = Switchboard.callAction(withObject: engineId, actionName: "stop", params: nil)
            if let error = result.error {
                print("[AudioGraphManager] Warning: Failed to stop TTS engine before destruction: \(error.localizedDescription)")
            }
            ttsEngineId = nil
            isSpeaking = false
            print("[AudioGraphManager] TTS engine destroyed")
        }
    }

    // MARK: - Control Methods

    /// Start listening for voice input
    func startListening() throws {
        guard let engineId = listeningEngineId else {
            throw AudioGraphError.noEngine
        }

        guard !isListening else {
            print("[AudioGraphManager] Already listening")
            return
        }

        print("[AudioGraphManager] Starting listening engine...")

        let result = Switchboard.callAction(withObject: engineId, actionName: "start", params: nil)

        if let error = result.error {
            print("[AudioGraphManager] Failed to start listening: \(error.localizedDescription)")
            throw AudioGraphError.startFailed(error.localizedDescription)
        }

        isListening = true
        delegate?.audioGraphManager(self, didChangeState: "listening")
        print("[AudioGraphManager] Listening started successfully")
    }

    /// Stop listening for voice input
    func stopListening() throws {
        guard let engineId = listeningEngineId else {
            print("[AudioGraphManager] stopListening: no engine, ignoring")
            return
        }

        guard isListening else {
            print("[AudioGraphManager] Not currently listening, ignoring stop")
            return
        }

        print("[AudioGraphManager] Stopping listening engine...")

        let result = Switchboard.callAction(withObject: engineId, actionName: "stop", params: nil)

        if let error = result.error {
            print("[AudioGraphManager] Failed to stop listening: \(error.localizedDescription)")
            throw AudioGraphError.stopFailed(error.localizedDescription)
        }

        isListening = false
        delegate?.audioGraphManager(self, didChangeState: "idle")
        print("[AudioGraphManager] Listening stopped successfully")
    }

    // MARK: - TTS Control Methods

    /// Speak text using TTS
    func speak(text: String) throws {
        guard isInitialized else {
            throw AudioGraphError.notInitialized
        }

        guard !text.isEmpty else {
            print("[AudioGraphManager] Empty text, skipping")
            return
        }

        // Ensure TTS engine exists
        if ttsEngineId == nil {
            _ = try createTTSEngine()
        }

        guard let engineId = ttsEngineId else {
            throw AudioGraphError.noTTSEngine
        }

        print("[AudioGraphManager] Speaking text: '\(text)'")

        // Start the TTS engine if not running
        let startResult = Switchboard.callAction(withObject: engineId, actionName: "start", params: nil)
        if let error = startResult.error {
            print("[AudioGraphManager] Warning: Failed to start TTS engine: \(error.localizedDescription)")
        }

        // Send text to TTS node
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

    /// Stop TTS playback
    func stopSpeaking() throws {
        guard let engineId = ttsEngineId else {
            print("[AudioGraphManager] No TTS engine, nothing to stop")
            return
        }

        print("[AudioGraphManager] Stopping TTS playback...")

        // Stop the TTS engine
        let result = Switchboard.callAction(withObject: engineId, actionName: "stop", params: nil)

        if let error = result.error {
            print("[AudioGraphManager] Failed to stop TTS: \(error.localizedDescription)")
            throw AudioGraphError.stopFailed(error.localizedDescription)
        }

        isSpeaking = false
        delegate?.audioGraphManager(self, didChangeState: "idle")
        print("[AudioGraphManager] TTS stopped successfully")
    }

    // MARK: - Private Methods

    /// Build the listening graph config (VAD → STT)
    /// Uses the simpler format from the working reference implementation
    private func buildListeningGraphConfig() -> [String: Any] {
        // Node definitions - simpler format matching reference
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
            "config": [
                "initializeModel": true,
                "useGPU": true
            ]
        ]

        // Audio connections + data connection (VAD end triggers STT transcribe)
        let connections: [[String: Any]] = [
            ["sourceNode": "inputNode", "destinationNode": "multiChannelToMonoNode"],
            ["sourceNode": "multiChannelToMonoNode", "destinationNode": "busSplitterNode"],
            ["sourceNode": "busSplitterNode", "destinationNode": "vadNode"],
            ["sourceNode": "busSplitterNode", "destinationNode": "sttNode"],
            // Data connection: VAD speechEnded event triggers STT transcribe action
            // Note: SileroVAD.VAD uses "speechEnded" (not "end") per engine4.json
            ["sourceNode": "vadNode.speechEnded", "destinationNode": "sttNode.transcribe"]
        ]

        // Graph config
        let graphConfig: [String: Any] = [
            "config": [
                "sampleRate": sampleRate,
                "bufferSize": bufferSize
            ],
            "nodes": [multiChannelToMonoNode, busSplitterNode, vadNode, sttNode],
            "connections": connections
        ]

        // Engine config - simpler format (must have microphoneEnabled!)
        let engineConfig: [String: Any] = [
            "type": "Realtime",
            "config": [
                "microphoneEnabled": true,
                "graph": graphConfig
            ]
        ]

        return engineConfig
    }

    /// Build the TTS graph config
    private func buildTTSGraphConfig() -> [String: Any] {
        let ttsNode: [String: Any] = [
            "id": "ttsNode",
            "type": "Sherpa.TTS",
            "config": ["voice": ttsVoice]
        ]

        // Connections (TTS → output)
        let connections: [[String: Any]] = [
            ["sourceNode": "ttsNode", "destinationNode": "outputNode"]
        ]

        // Graph config
        let graphConfig: [String: Any] = [
            "config": [
                "sampleRate": sampleRate,
                "bufferSize": bufferSize
            ],
            "nodes": [ttsNode],
            "connections": connections
        ]

        // Engine config - simpler format
        let engineConfig: [String: Any] = [
            "type": "Realtime",
            "config": [
                "speakerEnabled": true,
                "graph": graphConfig
            ]
        ]

        return engineConfig
    }

    /// Set up event listeners for transcription and VAD events
    /// Uses event names from the working reference implementation
    private func setupListeningEventListeners(for engineId: String) throws {
        print("[AudioGraphManager] Setting up listeners for engine: \(engineId)")

        // Listen for transcription events from STT node
        let transcriptionResult = Switchboard.addEventListener("sttNode", eventName: "transcribed") { [weak self] eventData in
            guard let self = self else { return }

            print("[AudioGraphManager] STT 'transcribed' event fired! Data: \(String(describing: eventData))")

            // Extract transcript text from event data
            // Event structure: { "data": { "text": "...", "processingTime": ... }, "id": ..., ... }
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

            if let text = transcriptText {
                print("[AudioGraphManager] Received transcript: \(text)")
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

        // Listen for VAD start events (speech detected)
        // Note: SileroVAD.VAD uses "speechStarted" event (not "start")
        let vadStartResult = Switchboard.addEventListener("vadNode", eventName: "speechStarted") { [weak self] eventData in
            guard let self = self else { return }
            print("[AudioGraphManager] VAD 'speechStarted' event fired! Data: \(String(describing: eventData))")
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

        // Listen for VAD end events (silence detected)
        // Note: SileroVAD.VAD uses "speechEnded" event (not "end")
        // The data connection (vadNode.speechEnded → sttNode.transcribe) handles triggering STT automatically
        let vadEndResult = Switchboard.addEventListener("vadNode", eventName: "speechEnded") { [weak self] eventData in
            guard let self = self else { return }
            print("[AudioGraphManager] VAD 'speechEnded' event fired! Data: \(String(describing: eventData))")

            // Notify delegate - transcription is triggered automatically via data connection
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
    }

    /// Remove listening event listeners
    private func removeListeningEventListeners() {
        if let listenerId = transcriptionListenerId {
            Switchboard.removeEventListener("sttNode", listenerID: listenerId)
            transcriptionListenerId = nil
            print("[AudioGraphManager] Transcription listener removed")
        }

        if let listenerId = vadStartListenerId {
            Switchboard.removeEventListener("vadNode", listenerID: listenerId)
            vadStartListenerId = nil
            print("[AudioGraphManager] VAD start listener removed")
        }

        if let listenerId = vadEndListenerId {
            Switchboard.removeEventListener("vadNode", listenerID: listenerId)
            vadEndListenerId = nil
            print("[AudioGraphManager] VAD end listener removed")
        }
    }

    /// Set up TTS event listeners
    private func setupTTSEventListeners(for engineId: String) throws {
        print("[AudioGraphManager] Setting up TTS listeners for engine: \(engineId)")

        let finishedResult = Switchboard.addEventListener("ttsNode", eventName: "finished") { [weak self] eventData in
            guard let self = self, self.isSpeaking else { return }
            print("[AudioGraphManager] TTS 'finished' event fired")
            self.isSpeaking = false
            DispatchQueue.main.async {
                self.delegate?.audioGraphManager(self, didChangeState: "idle")
                self.delegate?.audioGraphManagerDidFinishSpeaking(self)
            }
        }

        if let listenerId = finishedResult.value {
            ttsFinishedListenerId = listenerId
            print("[AudioGraphManager] TTS 'finished' listener added with ID: \(listenerId)")
        } else if let error = finishedResult.error {
            print("[AudioGraphManager] Failed to add TTS 'finished' listener: \(error.localizedDescription)")
        }

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

    /// Remove TTS event listeners
    private func removeTTSEventListeners() {
        if let listenerId = ttsFinishedListenerId {
            Switchboard.removeEventListener("ttsNode", listenerID: listenerId)
            ttsFinishedListenerId = nil
            print("[AudioGraphManager] TTS 'finished' listener removed")
        }

        if let listenerId = ttsSynthesisStartedListenerId {
            Switchboard.removeEventListener("ttsNode", listenerID: listenerId)
            ttsSynthesisStartedListenerId = nil
            print("[AudioGraphManager] TTS 'synthesisStarted' listener removed")
        }
    }

    // MARK: - Status

    var isCurrentlyListening: Bool {
        return isListening
    }

    var isCurrentlySpeaking: Bool {
        return isSpeaking
    }

    var hasListeningEngine: Bool {
        return listeningEngineId != nil
    }

    var hasTTSEngine: Bool {
        return ttsEngineId != nil
    }

    // For backward compatibility
    var hasEngine: Bool {
        return hasListeningEngine
    }

    // MARK: - Cleanup

    deinit {
        destroyListeningEngine()
        destroyTTSEngine()
    }
}

// MARK: - Error Types

enum AudioGraphError: LocalizedError {
    case notInitialized
    case noEngine
    case noTTSEngine
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
            return "No audio engine created. Call createListeningEngine() first."
        case .noTTSEngine:
            return "No TTS engine created. Call createTTSEngine() first."
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
