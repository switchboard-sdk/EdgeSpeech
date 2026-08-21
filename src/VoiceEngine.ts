import { Platform } from 'react-native'
import NativeEdgeSpeech from './NativeEdgeSpeech'
import { NativeModuleRPCClient } from './NativeModuleRPCClient'
import { SwitchboardClient } from './SwitchboardClient'
import { AndroidSession, ANDROID_INPUT_PRESET } from './AndroidSession'
import { makeError } from './errors'
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
}

/**
 * The on-device voice pipeline, authored entirely in TypeScript over the
 * Switchboard JSON-RPC channel. This is the TypeScript port of the old native
 * `AudioGraphManager.swift`: it builds the combined VAD → STT + TTS graph,
 * creates the engine, runs the ready/listening/speaking state machine, handles
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

  /**
   * The state last emitted via onStateChange. Starts at 'idle' — the SDK is not up
   * until initialize() has run, and a failed init returns here (see settleInit()).
   * 'ready' is the initialized-and-waiting state.
   */
  private state: VoiceState = 'idle'

  /** Why the last initialize() failed, if it did — folded into NOT_INITIALIZED rejections. */
  private initFailureReason: string | null = null

  private config: VoiceEngineConfig = {
    vadSensitivity: 0.5,
    sampleRate: 16000,
    bufferSize: 512,
  }

  /** Android's staging/route/permission work; null on iOS, which has none of it. */
  private androidSession: AndroidSession | null = null

  /**
   * Whether the current engine's ttsNode has been given a voice (Android loads it by
   * path; iOS auto-loads its own). Per engine, so destroyEngine() clears it.
   */
  private ttsVoiceLoaded = false

  /**
   * Init still in flight. A second initialize() hands it back rather than reporting the
   * init settled, and a start issued during it waits on it (see awaitInit).
   */
  private pendingInit: Promise<void> | null = null

  private readonly listeners = new Map<EdgeSpeechEventName, Set<Listener>>()

  /**
   * Android's session, or null on iOS. Built on first use, and dropped by `_cleanup()`,
   * which is what lets a test flip `Platform.OS` between cases — in an app the platform
   * never changes, so this resolves exactly once.
   */
  private get android(): AndroidSession | null {
    if (!this.androidSession && Platform.OS === 'android') {
      this.androidSession = new AndroidSession()
    }
    return this.androidSession
  }

  // MARK: - Public state API

  /**
   * The current state, for consumers that mount after an onStateChange they missed —
   * `useEdgeSpeech` seeds its `voiceState` from this.
   */
  get currentState(): VoiceState {
    return this.state
  }

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

  /**
   * Start the SDK. The returned promise resolves once initialization has settled — on
   * Android that includes the Kotlin init and the model staging — and never rejects: a
   * credentials failure goes to onError and leaves the engine uninitialized, so the next
   * listen()/speak() rejects instead.
   *
   * Deliberately not `async`: a broken native module is a setup error and must keep
   * throwing synchronously, rather than becoming an unhandled rejection in the callers
   * that ignore the promise (EdgeSpeechProvider's effect, EdgeSpeech.configure()).
   */
  initialize(appId: string, appSecret: string): Promise<void> {
    if (this.isInitialized) {
      // Hand back an init already in flight rather than reporting it as settled.
      return this.pendingInit ?? Promise.resolve()
    }
    this.ensureClient()
    this.wireEvents()
    this.initFailureReason = null
    // Announced on every attempt: a retry after a failed init starts from 'idle'.
    this.setState('initializing')

    const android = this.android
    if (android) {
      // The flag is optimistic: a listen()/speak() issued while the models stage waits
      // on pendingInit rather than rejecting. Set before the chain, since a failure
      // clears it.
      this.isInitialized = true
      this.pendingInit = android
        .initialize(appId, appSecret, EXTENSIONS, (message) => this.failInitialization(message))
        // No-ops after a failure, which already settled the state to 'idle'.
        .then(() => this.settleInit('ready'))
        // Nothing above rejects today. Belt and braces: an unhandled rejection here would
        // also strand the state on 'initializing', since settleInit() would never run.
        .catch((e) => this.failInitialization((e as Error)?.message ?? String(e)))
      return this.pendingInit
    }

    const res = this.ensureClient().callAction('switchboard', 'initialize', {
      appID: appId,
      appSecret,
      extensions: EXTENSIONS,
    })
    if (res.error) {
      const message = res.error.message ?? ''
      // The native SDK is a process-global singleton that survives JS bundle reloads
      // (Fast Refresh / dev reopen); a repeat initialize then reports "already been
      // initialized". Treat that as success so the app doesn't red-box on reload.
      // NOTE (stopgap): matching on the error text is brittle — a stable error code or
      // an SDK init-state query would be more robust.
      if (!/already.*initialized/i.test(message)) {
        // Surface genuine failures via onError and stay uninitialized (a later
        // listen()/speak() then rejects NOT_INITIALIZED). Don't throw:
        // EdgeSpeechProvider calls initialize() inside an effect, so throwing would
        // red-box the app instead of firing onError — matches the original module.
        this.failInitialization(message)
        return Promise.resolve()
      }
    }
    this.isInitialized = true
    this.settleInit('ready')
    return Promise.resolve()
  }

  /**
   * Block until initialization has settled, then reject if it didn't succeed.
   * initialize() is deliberately not async (EdgeSpeechProvider calls it from an effect
   * and ignores the promise) so it can't report the outcome itself — this is the first
   * point where a caller can be told, and it runs before anything touches the engine.
   */
  private async awaitInit(): Promise<void> {
    await this.pendingInit
    if (!this.isInitialized) {
      throw this.notInitializedError()
    }
  }

  /**
   * Mark initialization as failed: record the cause, drop back to uninitialized so
   * a later initialize() can retry, and surface it via onError.
   */
  private failInitialization(message: string): void {
    this.isInitialized = false
    this.initFailureReason = message
    this.settleInit('idle')
    this.emitError('INIT_FAILED', message)
  }

  /**
   * Leave 'initializing' once init has settled: 'ready' when the SDK came up, 'idle'
   * when it didn't — the cause is reported through onError, not by parking the state
   * machine on a spinner.
   *
   * The 'initializing' guard is load-bearing, not just de-duplication. On Android a
   * failure settles to 'idle' mid-chain via failInitialization(), and the tail of that
   * same chain calls here again with 'ready'; without the guard that tail would claim
   * a dead SDK is operable. It also protects a state reached while init was in flight.
   */
  private settleInit(next: 'ready' | 'idle'): void {
    if (this.state === 'initializing') {
      this.setState(next)
    }
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
   * Apply configuration. All three values are baked into the graph when the engine is
   * created, so a configure() after the first listen()/speak() is ignored. Configure
   * once, at mount.
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
  }

  // MARK: - Control

  /**
   * Undo a start that threw after prep entered the communication route. stopListening()
   * cannot help there — it early-returns while isListening is false — so the app would
   * be left in MODE_IN_COMMUNICATION with no way back. A session that is still running
   * keeps the route, which it needs. Only platforms with session prep have anything to
   * give back — iOS leaves a failed start's engine in place to retry, as it always has.
   */
  private rollbackFailedStart(): void {
    if (!this.android || this.isListening || this.isSpeaking) {
      return
    }
    if (this.engineId) {
      this.destroyEngine() // gives the route back too
    } else {
      this.android.releaseRoute()
    }
  }

  /**
   * Android: hand the staged voice to the ttsNode. Synchronous (a plain callAction), so
   * speak() can do it without suspending. Runs again after destroyEngine(), which leaves
   * a fresh, unloaded ttsNode behind. No-op on iOS.
   */
  private loadTtsVoice(): void {
    if (!this.android || this.ttsVoiceLoaded) {
      return
    }
    const paths = this.android.ttsVoicePaths
    if (!paths) {
      throw this.makeError('TTS_VOICE_UNAVAILABLE', 'The TTS voice was not staged before speak().')
    }
    const res = this.ensureClient().callAction('ttsNode', 'loadModel', paths)
    if (res.error) {
      throw this.makeError(
        'TTS_MODEL_LOAD_FAILED',
        `Sherpa TTS loadModel failed: ${res.error.message}`
      )
    }
    this.ttsVoiceLoaded = true
  }

  /** Start the engine. Synchronous — any audio route was entered during prep. */
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
    if (this.android && (await this.android.prepareSession(false, () => this.awaitInit()))) {
      return
    }

    // No `await` past this line: JS runs an await-free stretch to completion, which is
    // what stops a double tap from starting the engine twice. iOS never suspends above.
    try {
      if (!this.engineId) {
        this.createEngine()
      }
      if (this.isListening) {
        return
      }
      this.startEngineSync()
    } catch (e) {
      this.rollbackFailedStart()
      throw e
    }
  }

  async stopListening(): Promise<void> {
    // Cancel any start still in its async prep — including when there is also a live
    // session to stop below, since that prep would otherwise reopen the mic.
    this.android?.cancelPendingStarts()
    if (!this.engineId || !this.isListening) {
      return
    }
    const res = this.ensureClient().callAction(this.engineId, 'stop', {})
    if (res.error) {
      throw this.makeError('STOP_LISTENING_FAILED', res.error.message)
    }
    this.isListening = false
    this.isSpeaking = false
    this.android?.releaseRoute()
    this.setState('ready')
  }

  async speak(text: string): Promise<void> {
    if (!this.isInitialized) {
      throw this.notInitializedError()
    }
    if (!text) {
      return
    }
    if (this.android && (await this.android.prepareSession(true, () => this.awaitInit()))) {
      return
    }

    // No `await` past this line — see listen().
    let res
    try {
      if (!this.engineId) {
        this.createEngine()
      }
      // Lazily on first speak: Android loads the staged voice, iOS auto-loads its own.
      this.loadTtsVoice()
      // Starting the engine also activates the mic + AEC needed for barge-in.
      if (!this.isListening) {
        this.startEngineSync()
      }

      res = this.ensureClient().callAction('ttsNode', 'synthesize', { text })
    } catch (e) {
      this.rollbackFailedStart()
      throw e
    }
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
    this.setState(this.isListening ? 'listening' : 'ready')
  }

  async requestMicrophonePermission(): Promise<boolean> {
    const granted = this.android
      ? await this.android.requestMicrophonePermission()
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

    // Past this point engineId is set, so a throw would leave a half-built engine that
    // the next listen() reuses — skipping createEngine(), and with it the model load.
    // Discard it instead: a retry then builds and loads a fresh one.
    try {
      // iOS: enable VoiceProcessingIO (AEC). Must be set after creation via setValue —
      // with one combined engine this keeps AEC active during TTS playback and
      // prevents self-triggered barge-in. The key does not exist in the Android SDK,
      // where AEC comes from the input preset + communication route instead (see
      // AndroidSession).
      client.setValue(this.engineId, 'voiceProcessingEnabled', true)

      // Android loads the Whisper model by path; iOS auto-loads its bundled one.
      if (this.android) {
        const modelPath = this.android.sttModelPath
        if (!modelPath) {
          throw this.makeError(
            'MODEL_UNAVAILABLE',
            'Whisper model path was not resolved before engine creation (call listen()/speak()).'
          )
        }
        const loadRes = client.callAction('sttNode', 'loadModel', { modelPath, useGPU: false })
        if (loadRes.error) {
          throw this.makeError(
            'MODEL_LOAD_FAILED',
            `Whisper loadModel failed: ${loadRes.error.message}`
          )
        }
      }
    } catch (e) {
      this.destroyEngine()
      throw e
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
    this.android?.releaseRoute()
    // A new engine has a fresh, unloaded ttsNode — reload the voice on next speak.
    this.ttsVoiceLoaded = false
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
    const isAndroid = !!this.android
    // GPU off in the iOS Simulator (Metal crash) and on Android (no Metal; CPU only).
    const useGPU = !isAndroid && !NativeEdgeSpeech.isSimulator()

    return {
      type: 'Realtime',
      config: {
        microphoneEnabled: true,
        speakerEnabled: true,
        // Android only: an Oboe stream parameter, so it must be set at creation —
        // there is no iOS equivalent (VoiceProcessingIO covers it there).
        ...(isAndroid ? { inputPreset: ANDROID_INPUT_PRESET } : {}),
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
              // has none to auto-initialize, so the key is left off there
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
        // Nothing decoded — still leave 'processing', or the UI sticks on it.
        if (this.isListening && !this.isSpeaking) {
          this.setState('listening')
        }
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
      } else if (this.isListening) {
        // Leave 'processing' before the transcript, not after: consumers call speak()
        // from onTranscriptComplete, and that sets 'speaking'.
        this.setState('listening')
      }
      this.emit('onTranscript', { text, isFinal: true })
    } else if (node === 'vadNode' && name === 'speechStarted') {
      this.emit('onSpeechStart', undefined)
    } else if (node === 'vadNode' && name === 'speechEnded') {
      this.emit('onSpeechEnd', undefined)
      // Whisper decodes from here until 'transcribed'. Not during TTS: that window
      // belongs to 'speaking', and a barge-in transcript reports itself.
      if (this.isListening && !this.isSpeaking) {
        this.setState('processing')
      }
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
    this.state = state
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
    return makeError(code, message)
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
    this.state = 'idle'
    this.initFailureReason = null
    this.pendingInit = null
    this.ttsVoiceLoaded = false
    // Dropped rather than reset, so the next use re-reads the platform (see `android`).
    this.androidSession = null
    this.config = {
      vadSensitivity: 0.5,
      sampleRate: 16000,
      bufferSize: 512,
    }
  }
}

/** Process-wide singleton — the whole library talks to one engine. */
export const voiceEngine = new VoiceEngine()
