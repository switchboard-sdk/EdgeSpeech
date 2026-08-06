import { Platform, PermissionsAndroid, NativeModules } from 'react-native'
import NativeEdgeSpeech from './NativeEdgeSpeech'
import { NativeModuleRPCClient } from './NativeModuleRPCClient'
import { SwitchboardClient } from './SwitchboardClient'
import type { VoiceState, TranscriptEvent, StateChangeEvent, ErrorEvent } from './types'

/**
 * Payload shape for each public event name. Drives the typing of
 * {@link VoiceEngine.addListener} so consumers get checked callbacks.
 */
export interface EdgeSpeechEventMap {
  onTranscript: TranscriptEvent
  onStateChange: StateChangeEvent
  onError: ErrorEvent
  onSpeechStart: undefined
  onSpeechEnd: undefined
  onInterrupted: undefined
  onTTSComplete: undefined
}

export type EdgeSpeechEventName = keyof EdgeSpeechEventMap

type Listener = (payload: unknown) => void

/**
 * Extensions the SDK must initialize. ONNX underpins Silero VAD. Note the key is
 * `Silero` (the name the C++ SileroVADExtension registers) — not `SileroVAD`,
 * which was the Objective-C extension's name in the old Expo implementation.
 */
const EXTENSIONS = { Onnx: {}, Silero: {}, Whisper: {}, Sherpa: {} }

interface VoiceEngineConfig {
  vadSensitivity: number
  sampleRate: number
  bufferSize: number
  ttsVoice: string
  sttModel: string
}

// Maps `sttModel` → bundled asset path (Android; iOS uses the SDK-framework model).
// Deliberately the same single model the iOS framework ships, so `sttModel` means
// the same thing on both platforms.
const ANDROID_MODEL_ASSETS: Record<string, string> = {
  'whisper-base-en': 'models/whisper/ggml-base.en.bin',
}

// Android Sherpa TTS voices keyed by `ttsVoice`: bundled zip + in-zip paths.
// Extracted to filesDir once; iOS uses the SDK-framework voices.
const ANDROID_TTS_VOICES: Record<
  string,
  { zipAsset: string; voiceDir: string; modelFile: string }
> = {
  en_GB: {
    zipAsset: 'models/sherpa/tts/en_GB.zip',
    voiceDir: 'en_GB/vits-piper-en_GB-southern_english_female-low',
    modelFile: 'en_GB-southern_english_female-low.with_runtime_opt.ort',
  },
  de_DE: {
    zipAsset: 'models/sherpa/tts/de_DE.zip',
    voiceDir: 'de_DE/vits-piper-de_DE-thorsten-low',
    modelFile: 'de_DE-thorsten-low.with_runtime_opt.ort',
  },
}

const ANDROID_TTS_EXTRACT_DIR = 'sherpa/tts'

// Android AEC: open the mic as voice-communication. Pairs with MODE_IN_COMMUNICATION
// (set natively on start — see EdgeSpeechAudioSessionModule). The engine's
// `voiceProcessingEnabled` key is iOS-only (VoiceProcessingIO), so this and the
// communication route are what engage echo cancellation on Android.
const ANDROID_VOICE_COMMUNICATION_INPUT_PRESET = 7 // oboe InputPreset.VoiceCommunication

/**
 * The on-device voice pipeline, authored entirely in TypeScript over the
 * Switchboard JSON-RPC channel. This is the TypeScript port of the old native
 * `AudioGraphManager.swift`: it builds the combined VAD → STT + TTS graph,
 * creates the engine, runs the idle/listening/speaking state machine, handles
 * barge-in, and translates raw SDK events into EdgeSpeech's public events.
 *
 * A single combined engine (microphone + speaker) keeps VoiceProcessingIO (AEC)
 * active during TTS playback, which is what makes barge-in reliable.
 */
class VoiceEngine {
  private client: SwitchboardClient | null = null
  private engineId: string | null = null
  private isInitialized = false
  private isListening = false
  private isSpeaking = false
  private eventsWired = false

  /** Why the last initialize() failed, if it did — folded into NOT_INITIALIZED rejections. */
  private initFailureReason: string | null = null

  private config: VoiceEngineConfig = {
    vadSensitivity: 0.5,
    sampleRate: 16000,
    bufferSize: 512,
    ttsVoice: 'en_GB',
    sttModel: 'whisper-base-en',
  }

  /** Resolved absolute path to the Whisper model on Android (see ensureAndroidModel). */
  private androidModelPath: string | null = null

  /** Whether the Sherpa TTS voice has been loaded into the ttsNode (Android). */
  private androidTtsLoaded = false

  /** filesDir root the TTS voice zip was extracted to (Android; see stageAndroidTtsVoice). */
  private androidTtsDir: string | null = null

  /**
   * Android: a stopListening() that arrived while listen()/speak() was still in
   * its async prep, when there is no engine to stop yet. The pending start reads
   * it in its synchronous section and aborts, so the mic never opens after the
   * user asked it not to. iOS has no prep, hence no window — see below.
   */
  private androidStopRequested = false

  /**
   * Pending Kotlin SDK init on Android. Awaited (and its outcome checked) by
   * ensureAndroidInitialized() before the engine is created.
   */
  private androidInitPromise: Promise<void> | null = null

  private readonly listeners = new Map<EdgeSpeechEventName, Set<Listener>>()

  // MARK: - Public listener API (mirrors the old Expo NativeModule.addListener)

  addListener<K extends EdgeSpeechEventName>(
    event: K,
    listener: (payload: EdgeSpeechEventMap[K]) => void
  ): { remove: () => void } {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener)
    return {
      remove: () => {
        this.listeners.get(event)?.delete(listener as Listener)
      },
    }
  }

  // MARK: - Lifecycle

  initialize(appId: string, appSecret: string): void {
    if (this.isInitialized) {
      return
    }
    const client = this.ensureClient()
    this.wireEvents()
    this.initFailureReason = null

    if (Platform.OS === 'android') {
      // Android inits via Kotlin (registers the PlatformInfoProvider → native-lib
      // dir Whisper needs); listen()/speak() await it before creating the engine.
      //
      // Optimistic, and set BEFORE dispatching: initializeAndroidSdk() runs its
      // first synchronous stretch during this assignment and clears the flag if it
      // fails there, so setting it afterwards would resurrect a failed init.
      this.isInitialized = true
      this.androidInitPromise = this.initializeAndroidSdk(appId, appSecret)
      return
    }

    const res = client.callAction('switchboard', 'initialize', {
      appID: appId,
      appSecret,
      extensions: EXTENSIONS,
    })
    if (res.error) {
      const message = res.error.message ?? ''
      // The native SDK is a process-global singleton that survives JS bundle
      // reloads (Fast Refresh / dev reopen); a repeat initialize then reports
      // "already been initialized". Treat that as success so the app doesn't
      // red-box on reload.
      // NOTE (stopgap): matching on the error text is brittle — a stable error
      // code or an SDK init-state query would be more robust.
      if (/already.*initialized/i.test(message)) {
        this.isInitialized = true
        return
      }
      // Surface genuine failures via onError and stay uninitialized (a later
      // listen()/speak() then rejects NOT_INITIALIZED). Don't throw:
      // EdgeSpeechProvider calls initialize() inside an effect, so throwing would
      // red-box the app instead of firing onError — matches the original module.
      this.failInitialization(message)
      return
    }
    this.isInitialized = true
  }

  /**
   * Android SDK init via Kotlin. Never rejects — a failure goes to onError and
   * leaves the engine uninitialized, exactly as the iOS path above does, so the
   * next listen()/speak() rejects instead of building a graph on a dead SDK. A
   * repeat init after a JS bundle reload counts as success.
   */
  private async initializeAndroidSdk(appId: string, appSecret: string): Promise<void> {
    const models = NativeModules.EdgeSpeechModels
    if (!models?.initializeSdk) {
      this.failInitialization('EdgeSpeechModels native module is unavailable.')
      return
    }
    try {
      await models.initializeSdk(appId, appSecret, JSON.stringify(EXTENSIONS))
    } catch (e) {
      const message = (e as Error)?.message ?? String(e)
      if (/already.*initialized/i.test(message)) {
        return
      }
      this.failInitialization(message)
    }
  }

  /**
   * Mark initialization as failed: record the cause, drop back to uninitialized so
   * a later initialize() can retry, and surface it via onError.
   */
  private failInitialization(message: string): void {
    this.isInitialized = false
    this.initFailureReason = message
    this.emitError('INIT_FAILED', message)
  }

  /** NOT_INITIALIZED, naming the underlying init failure when there was one. */
  private notInitializedError(): Error {
    return this.makeError(
      'NOT_INITIALIZED',
      this.initFailureReason
        ? `Switchboard SDK not initialized: ${this.initFailureReason}`
        : 'Switchboard SDK not initialized. Call initialize() first.'
    )
  }

  /**
   * Android: block until the Kotlin init settles, then reject if it didn't succeed.
   * initialize() is synchronous (EdgeSpeechProvider calls it from an effect) so it
   * can't await the result itself — this is the first point where a caller can be
   * told, and it runs before anything touches the engine. No-op on iOS, where
   * initialize() already knows the outcome before it returns.
   */
  private async ensureAndroidInitialized(): Promise<void> {
    if (Platform.OS !== 'android') {
      return
    }
    await this.androidInitPromise
    if (!this.isInitialized) {
      throw this.notInitializedError()
    }
  }

  /**
   * Apply configuration. `sttModel` and `ttsVoice` select which model files the
   * nodes load, which happens once when the engine is built — so they take effect
   * only if set before the first listen()/speak(), and changing them later is
   * ignored on both platforms. Configure once, at mount. (`vadSensitivity`,
   * `sampleRate` and `bufferSize` are likewise baked into the graph at creation.)
   */
  configure(config: Record<string, unknown>): void {
    if (typeof config.vadSensitivity === 'number') {
      this.config.vadSensitivity = Math.max(0, Math.min(1, config.vadSensitivity))
    }
    if (typeof config.sampleRate === 'number') {
      this.config.sampleRate = config.sampleRate
    }
    if (typeof config.bufferSize === 'number') {
      this.config.bufferSize = config.bufferSize
    }
    if (typeof config.ttsVoice === 'string') {
      this.config.ttsVoice = config.ttsVoice
    }
    if (typeof config.sttModel === 'string' && config.sttModel.trim() !== '') {
      this.config.sttModel = config.sttModel
    }
  }

  /** Android: copy the Whisper model asset to filesDir (once) and cache its path. iOS no-op (bundled). */
  private async ensureAndroidModel(): Promise<void> {
    if (Platform.OS !== 'android') {
      return
    }
    if (this.androidModelPath) {
      return
    }
    const assetPath = ANDROID_MODEL_ASSETS[this.config.sttModel]
    if (!assetPath) {
      throw this.makeError(
        'MODEL_UNAVAILABLE',
        `Unknown sttModel '${this.config.sttModel}' on Android. Bundle it and add it to ANDROID_MODEL_ASSETS.`
      )
    }
    const models = NativeModules.EdgeSpeechModels
    if (!models?.prepareModel) {
      throw this.makeError(
        'MODEL_UNAVAILABLE',
        'EdgeSpeechModels native module is unavailable — cannot resolve the Whisper model path on Android.'
      )
    }
    try {
      this.androidModelPath = await models.prepareModel(assetPath)
    } catch (e) {
      throw this.makeError(
        'MODEL_LOAD_FAILED',
        `Failed to prepare Whisper model '${assetPath}': ${(e as Error)?.message ?? String(e)}`
      )
    }
  }

  /**
   * Android: extract the TTS voice to filesDir (once) and cache its root. Only the
   * extraction — handing the voice to the ttsNode is a synchronous action and lives
   * in loadAndroidTtsVoice(), so it can stay inside speak()'s critical section.
   * iOS no-op (voices ship in the SDK framework).
   */
  private async stageAndroidTtsVoice(): Promise<void> {
    if (Platform.OS !== 'android' || this.androidTtsLoaded || this.androidTtsDir) {
      return
    }
    const voice = ANDROID_TTS_VOICES[this.config.ttsVoice]
    if (!voice) {
      throw this.makeError(
        'TTS_VOICE_UNAVAILABLE',
        `Unknown ttsVoice '${this.config.ttsVoice}' on Android. Bundle it and add it to ANDROID_TTS_VOICES.`
      )
    }
    const models = NativeModules.EdgeSpeechModels
    if (!models?.prepareArchive) {
      throw this.makeError(
        'TTS_VOICE_UNAVAILABLE',
        'EdgeSpeechModels native module is unavailable — cannot resolve the TTS voice path on Android.'
      )
    }
    try {
      this.androidTtsDir = await models.prepareArchive(voice.zipAsset, ANDROID_TTS_EXTRACT_DIR)
    } catch (e) {
      throw this.makeError(
        'TTS_MODEL_LOAD_FAILED',
        `Failed to extract TTS voice '${voice.zipAsset}': ${(e as Error)?.message ?? String(e)}`
      )
    }
  }

  /**
   * Android: load the staged voice into the ttsNode. Synchronous (a plain
   * callAction), so speak() can do it without suspending. Re-runs after
   * destroyEngine(), which leaves a fresh, unloaded ttsNode behind.
   */
  private loadAndroidTtsVoice(): void {
    if (Platform.OS !== 'android' || this.androidTtsLoaded) {
      return
    }
    const voice = ANDROID_TTS_VOICES[this.config.ttsVoice]
    if (!voice || !this.androidTtsDir) {
      throw this.makeError(
        'TTS_VOICE_UNAVAILABLE',
        `TTS voice '${this.config.ttsVoice}' was not staged before speak().`
      )
    }
    const dir = `${this.androidTtsDir}/${voice.voiceDir}`
    const res = this.ensureClient().callAction('ttsNode', 'loadModel', {
      modelPath: `${dir}/${voice.modelFile}`,
      tokensPath: `${dir}/tokens.txt`,
      dataPath: `${dir}/espeak-ng-data`,
    })
    if (res.error) {
      throw this.makeError('TTS_MODEL_LOAD_FAILED', `Sherpa TTS loadModel failed: ${res.error.message}`)
    }
    this.androidTtsLoaded = true
  }

  // MARK: - Control
  //
  // listen()/speak() end in a *Sync critical section that must contain no `await` —
  // hoist any async work into prepareAndroidSession() instead. JS is single-threaded,
  // so an await-free block cannot interleave with a concurrent caller; that is what
  // stops a double tap starting the engine twice. On iOS the platform check is false,
  // so nothing awaits and the call runs start-to-finish synchronously, as in main.

  /**
   * Android: enter MODE_IN_COMMUNICATION and route to a headset (else the
   * loudspeaker) *before* the engine opens its streams — that, plus the
   * voice-communication input preset, is what engages the hardware AEC. Best effort:
   * a refused change only degrades echo cancellation, so failures are swallowed.
   * No-op on iOS, where the SDK owns the audio session.
   */
  private async enableAndroidCommunicationRoute(): Promise<void> {
    if (Platform.OS !== 'android') {
      return
    }
    try {
      await NativeModules.EdgeSpeechAudioSession?.enableCommunicationRoute()
    } catch {
      // Proceed without the route change; listening and TTS still work.
    }
  }

  /**
   * Android: restore the normal audio mode/route. Only once the graph is down —
   * while it runs, the communication route is what keeps AEC engaged.
   */
  private disableAndroidCommunicationRoute(): void {
    if (Platform.OS !== 'android') {
      return
    }
    NativeModules.EdgeSpeechAudioSession?.disableCommunicationRoute()?.catch(() => {})
  }

  /**
   * Android: everything a start needs that can only be done asynchronously —
   * awaiting the Kotlin SDK init, checking the mic grant, materializing the model
   * assets, entering the communication route.
   *
   * @param stageTtsVoice also extract the TTS voice (speak() only).
   */
  private async prepareAndroidSession(stageTtsVoice = false): Promise<void> {
    // A new start attempt supersedes any Stop left over from the last one.
    this.androidStopRequested = false
    await this.ensureAndroidInitialized()
    await this.ensureAndroidMicPermission()
    await this.ensureAndroidModel()
    if (stageTtsVoice) {
      await this.stageAndroidTtsVoice()
    }
    await this.enableAndroidCommunicationRoute()
  }

  /**
   * Whether a stopListening() landed during the Android prep, in which case the
   * pending start must abort. Clears the request as it reports it, and gives back
   * the communication route the prep took — nothing is going to use it. No state
   * event: nothing had moved off `idle`, so there is nothing to correct.
   */
  private startWasCancelled(): boolean {
    if (!this.androidStopRequested) {
      return false
    }
    this.androidStopRequested = false
    this.disableAndroidCommunicationRoute()
    return true
  }

  /** Start the engine. Synchronous — the Android route is entered during prep. */
  private startEngineSync(): void {
    const res = this.ensureClient().callAction(this.engineId!, 'start', {})
    if (res.error) {
      throw this.makeError('LISTEN_FAILED', res.error.message)
    }
    this.isListening = true
    this.setState('listening')
  }

  async listen(): Promise<void> {
    if (!this.isInitialized) {
      throw this.notInitializedError()
    }
    if (Platform.OS === 'android') {
      await this.prepareAndroidSession()
    }
    this.listenSync()
  }

  /** listen()'s critical section. Must contain no `await` — see the note above. */
  private listenSync(): void {
    if (this.startWasCancelled()) {
      return
    }
    if (!this.engineId) {
      this.createEngine()
    }
    if (this.isListening) {
      return
    }
    this.startEngineSync()
  }

  async stopListening(): Promise<void> {
    if (!this.engineId || !this.isListening) {
      // Nothing to stop yet. On Android that can mean a start is mid-prep, so
      // record the intent for its critical section to honour.
      if (Platform.OS === 'android') {
        this.androidStopRequested = true
      }
      return
    }
    const res = this.ensureClient().callAction(this.engineId, 'stop', {})
    if (res.error) {
      throw this.makeError('STOP_LISTENING_FAILED', res.error.message)
    }
    this.isListening = false
    this.isSpeaking = false
    this.disableAndroidCommunicationRoute()
    this.setState('idle')
  }

  async speak(text: string): Promise<void> {
    if (!this.isInitialized) {
      throw this.notInitializedError()
    }
    if (!text) {
      return
    }
    if (Platform.OS === 'android') {
      await this.prepareAndroidSession(true)
    }
    this.speakSync(text)
  }

  /** speak()'s critical section. Must contain no `await` — see the note above. */
  private speakSync(text: string): void {
    if (this.startWasCancelled()) {
      return
    }
    if (!this.engineId) {
      this.createEngine()
    }
    // Load the TTS voice lazily on first speak (Android; iOS auto-loads it).
    this.loadAndroidTtsVoice()
    // Starting the engine also activates the mic + AEC needed for barge-in.
    if (!this.isListening) {
      this.startEngineSync()
    }

    const res = this.ensureClient().callAction('ttsNode', 'synthesize', { text })
    if (res.error) {
      throw this.makeError('SPEAK_FAILED', res.error.message)
    }
    this.isSpeaking = true
    this.setState('speaking')
  }

  async stopSpeaking(): Promise<void> {
    if (!this.isSpeaking) {
      return
    }
    // Clear isSpeaking before stopping so the 'finished' handler (which guards on
    // isSpeaking) does not fire onTTSComplete after an explicit cancellation.
    this.isSpeaking = false
    this.ensureClient().callAction('ttsNode', 'stop', {})
    this.setState(this.isListening ? 'listening' : 'idle')
  }

  /**
   * Android: fail fast with PERMISSION_DENIED if RECORD_AUDIO isn't granted — the SDK
   * segfaults (AudioEngineOboe::initInputStream) when the engine opens the mic without
   * it. Only checks (never prompts) — call requestMicrophonePermission() first. iOS
   * tolerates a missing grant, so this is a no-op there.
   */
  private async ensureAndroidMicPermission(): Promise<void> {
    if (Platform.OS !== 'android') {
      return
    }
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    if (!granted) {
      throw this.makeError(
        'PERMISSION_DENIED',
        'Microphone permission not granted. Call requestMicrophonePermission() before listen() or speak().'
      )
    }
  }

  async requestMicrophonePermission(): Promise<boolean> {
    // Android: request RECORD_AUDIO from JS (the native mic hook is iOS-only).
    const granted =
      Platform.OS === 'android'
        ? (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) ===
          PermissionsAndroid.RESULTS.GRANTED
        : await NativeEdgeSpeech.requestMicrophonePermission()
    if (!granted) {
      // Match the original module: reject on denial. The useEdgeSpeech hook
      // catches this and surfaces the message as `error`.
      throw this.makeError('PERMISSION_DENIED', 'Microphone permission was denied')
    }
    return granted
  }

  // MARK: - Engine management

  private createEngine(): void {
    const client = this.ensureClient()
    if (this.engineId) {
      this.destroyEngine()
    }

    const res = client.callAction('switchboard', 'createEngine', this.buildGraphConfig())
    if (res.error || typeof res.result !== 'string') {
      const message = res.error?.message ?? 'Unknown error'
      throw this.makeError('ENGINE_CREATION_FAILED', `Failed to create audio engine: ${message}`)
    }
    this.engineId = res.result

    // iOS: enable VoiceProcessingIO (AEC). Must be set after creation via setValue —
    // with one combined engine this keeps AEC active during TTS playback and
    // prevents self-triggered barge-in. The key does not exist in the Android SDK,
    // where AEC comes from the input preset + communication route instead (see
    // enableAndroidCommunicationRoute).
    client.setValue(this.engineId, 'voiceProcessingEnabled', true)

    // Android: load the Whisper model by path (iOS auto-loads its bundled model).
    if (Platform.OS === 'android') {
      if (!this.androidModelPath) {
        throw this.makeError(
          'MODEL_UNAVAILABLE',
          'Whisper model path was not resolved before engine creation (call listen()/speak()).'
        )
      }
      const loadRes = client.callAction('sttNode', 'loadModel', {
        modelPath: this.androidModelPath,
        useGPU: false,
      })
      if (loadRes.error) {
        throw this.makeError('MODEL_LOAD_FAILED', `Whisper loadModel failed: ${loadRes.error.message}`)
      }
    }
  }

  private destroyEngine(): void {
    if (!this.engineId) {
      return
    }
    this.ensureClient().callAction(this.engineId, 'stop', {})
    this.engineId = null
    this.isListening = false
    this.isSpeaking = false
    this.disableAndroidCommunicationRoute()
    // A new engine has a fresh, unloaded ttsNode — reload the voice on next speak.
    this.androidTtsLoaded = false
  }

  /**
   * Build the combined graph config (VAD → STT + TTS in one graph). Mirrors the
   * old Swift `buildCombinedGraphConfig()` exactly:
   *   inputNode → multiChannelToMono → busSplitter → vadNode (SileroVAD.VAD)
   *                                                 → sttNode (Whisper.STT)
   *   ttsNode (Sherpa.TTS) → monoToMultiChannel → outputNode
   *   data: vadNode.speechEnded → sttNode.transcribe
   */
  private buildGraphConfig(): object {
    const isAndroid = Platform.OS === 'android'
    // GPU off in the iOS Simulator (Metal crash) and on Android (no Metal; CPU only).
    const useGPU = !isAndroid && !NativeEdgeSpeech.isSimulator()

    return {
      type: 'Realtime',
      config: {
        microphoneEnabled: true,
        speakerEnabled: true,
        // Android only: an Oboe stream parameter, so it must be set at creation —
        // there is no iOS equivalent (VoiceProcessingIO covers it there).
        ...(isAndroid ? { inputPreset: ANDROID_VOICE_COMMUNICATION_INPUT_PRESET } : {}),
        graph: {
          config: {
            sampleRate: this.config.sampleRate,
            bufferSize: this.config.bufferSize,
          },
          nodes: [
            { id: 'multiChannelToMonoNode', type: 'MultiChannelToMono' },
            { id: 'busSplitterNode', type: 'BusSplitter' },
            {
              id: 'vadNode',
              type: 'Silero.VAD',
              config: {
                frameSize: 512,
                threshold: this.config.vadSensitivity,
                minSilenceDurationMs: 100,
              },
            },
            {
              id: 'sttNode',
              type: 'Whisper.STT',
              // iOS auto-initializes the model bundled in the SDK framework. Android
              // has none to auto-initialize, so `initializeModel` is left off there
              // and createEngine() loads it by path instead (sttNode.loadModel).
              config: { useGPU, ...(isAndroid ? {} : { initializeModel: true }) },
            },
            { id: 'ttsNode', type: 'Sherpa.TTS' },
            { id: 'monoToMultiChannelNode', type: 'MonoToMultiChannel' },
          ],
          connections: [
            { sourceNode: 'inputNode', destinationNode: 'multiChannelToMonoNode' },
            { sourceNode: 'multiChannelToMonoNode', destinationNode: 'busSplitterNode' },
            { sourceNode: 'busSplitterNode', destinationNode: 'vadNode' },
            { sourceNode: 'busSplitterNode', destinationNode: 'sttNode' },
            { sourceNode: 'vadNode.speechEnded', destinationNode: 'sttNode.transcribe' },
            { sourceNode: 'ttsNode', destinationNode: 'monoToMultiChannelNode' },
            { sourceNode: 'monoToMultiChannelNode', destinationNode: 'outputNode' },
          ],
        },
      },
    }
  }

  // MARK: - Events

  private ensureClient(): SwitchboardClient {
    if (!this.client) {
      this.client = new SwitchboardClient(new NativeModuleRPCClient())
    }
    return this.client
  }

  /** Subscribe once to the SDK's event stream and route it through dispatch(). */
  private wireEvents(): void {
    if (this.eventsWired) {
      return
    }
    const client = this.ensureClient()
    client.setEventReceivedCallback((raw) => this.dispatch(raw))
    // Wildcard listener: matches every object/event, including nodes created
    // later by createEngine.
    client.addEventListener('*', '*')
    this.eventsWired = true
  }

  /** Classify a raw SDK event JSON string and emit the matching public event. */
  private dispatch(raw: string): void {
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const e = parsed?.params ?? parsed
    const objectURI: string = e?.objectURI ?? ''
    const name: string = e?.name ?? e?.eventName ?? ''
    const node = objectURI.split(/[/.]/).pop() ?? objectURI

    if (node === 'sttNode' && name === 'transcribed') {
      const text = this.extractText(e)
      if (text == null) {
        return
      }
      if (this.isSpeaking) {
        // Barge-in: Whisper decoded real speech while TTS was playing. Gating on
        // a decoded transcript (not raw VAD) avoids false triggers from TTS
        // audio bleed-through.
        this.isSpeaking = false
        this.ensureClient().callAction('ttsNode', 'stop', {})
        this.setState('listening')
        this.emit('onInterrupted', undefined)
      }
      this.emit('onTranscript', { text, isFinal: true })
    } else if (node === 'vadNode' && name === 'speechStarted') {
      this.emit('onSpeechStart', undefined)
    } else if (node === 'vadNode' && name === 'speechEnded') {
      this.emit('onSpeechEnd', undefined)
    } else if (node === 'ttsNode' && name === 'finished') {
      if (!this.isSpeaking) {
        return
      }
      this.isSpeaking = false
      this.setState('listening')
      this.emit('onTTSComplete', undefined)
    }
    // ttsNode 'synthesisStarted' is intentionally ignored (matches old native).
  }

  private extractText(e: any): string | null {
    const data = e?.data
    if (data && typeof data === 'object' && typeof data.text === 'string') {
      return data.text
    }
    if (typeof data === 'string') {
      return data
    }
    if (typeof e?.text === 'string') {
      return e.text
    }
    return null
  }

  private setState(state: VoiceState): void {
    this.emit('onStateChange', { state })
  }

  private emit<K extends EdgeSpeechEventName>(event: K, payload: EdgeSpeechEventMap[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload))
  }

  private emitError(code: string, message: string): void {
    this.listeners.get('onError')?.forEach((listener) => listener({ code, message }))
  }

  /**
   * Build an Error (carrying a machine `code`) to reject a failing action with.
   * The useEdgeSpeech hook catches the rejection and surfaces the message as
   * `error`. Mirrors the original module, which rejected action promises and did
   * not additionally emit onError for action failures.
   */
  private makeError(code: string, message: string): Error {
    const error = new Error(message)
    ;(error as { code?: string }).code = code
    return error
  }

  /**
   * Reset all in-memory state and listeners. For tests only.
   * @internal
   */
  _cleanup(): void {
    this.listeners.clear()
    this.client = null
    this.engineId = null
    this.isInitialized = false
    this.isListening = false
    this.isSpeaking = false
    this.eventsWired = false
    this.initFailureReason = null
    this.androidModelPath = null
    this.androidTtsLoaded = false
    this.androidTtsDir = null
    this.androidStopRequested = false
    this.androidInitPromise = null
    this.config = {
      vadSensitivity: 0.5,
      sampleRate: 16000,
      bufferSize: 512,
      ttsVoice: 'en_GB',
      sttModel: 'whisper-base-en',
    }
  }
}

/** Process-wide singleton — the whole library talks to one engine. */
export const voiceEngine = new VoiceEngine()
