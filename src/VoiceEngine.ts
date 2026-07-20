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
}

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

  private config: VoiceEngineConfig = {
    vadSensitivity: 0.5,
    sampleRate: 16000,
    bufferSize: 512,
    ttsVoice: 'en_GB',
  }

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

    const res = client.callAction('switchboard', 'initialize', {
      appID: appId,
      appSecret,
      extensions: EXTENSIONS,
    })
    if (res.error) {
      const message = res.error.message ?? ''
      // The native SDK is a process-global singleton that outlives JS bundle
      // reloads (Fast Refresh, dev reopen). A repeat initialize then reports
      // "already been initialized" — treat that as success so the app doesn't
      // red-box on reload.
      // STOPGAP: matching on the error string is brittle — see TECH_DEBT.md #1.
      if (/already.*initialized/i.test(message)) {
        this.isInitialized = true
        return
      }
      this.emitError('NOT_INITIALIZED', message)
      throw new Error(`Switchboard initialization failed: ${message}`)
    }
    this.isInitialized = true
  }

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
  }

  // MARK: - Control

  async listen(): Promise<void> {
    if (!this.isInitialized) {
      throw this.fail('NOT_INITIALIZED', 'Switchboard SDK not initialized. Call initialize() first.')
    }
    if (!this.engineId) {
      this.createEngine()
    }
    if (this.isListening) {
      return
    }
    const res = this.ensureClient().callAction(this.engineId!, 'start', {})
    if (res.error) {
      throw this.fail('LISTEN_FAILED', res.error.message)
    }
    this.isListening = true
    this.setState('listening')
  }

  async stopListening(): Promise<void> {
    if (!this.engineId || !this.isListening) {
      return
    }
    const res = this.ensureClient().callAction(this.engineId, 'stop', {})
    if (res.error) {
      throw this.fail('STOP_LISTENING_FAILED', res.error.message)
    }
    this.isListening = false
    this.isSpeaking = false
    this.setState('idle')
  }

  async speak(text: string): Promise<void> {
    if (!this.isInitialized) {
      throw this.fail('NOT_INITIALIZED', 'Switchboard SDK not initialized. Call initialize() first.')
    }
    if (!text) {
      return
    }
    if (!this.engineId) {
      this.createEngine()
    }
    // Starting the engine also activates the mic + AEC needed for barge-in.
    if (!this.isListening) {
      const startRes = this.ensureClient().callAction(this.engineId!, 'start', {})
      if (startRes.error) {
        throw this.fail('LISTEN_FAILED', startRes.error.message)
      }
      this.isListening = true
      this.setState('listening')
    }

    const res = this.ensureClient().callAction('ttsNode', 'synthesize', { text })
    if (res.error) {
      throw this.fail('SPEAK_FAILED', res.error.message)
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

  requestMicrophonePermission(): Promise<boolean> {
    return NativeEdgeSpeech.requestMicrophonePermission()
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
      throw this.fail('ENGINE_CREATION_FAILED', `Failed to create audio engine: ${message}`)
    }
    this.engineId = res.result

    // Enable VoiceProcessingIO (AEC). Must be set after creation via setValue —
    // with one combined engine this keeps AEC active during TTS playback and
    // prevents self-triggered barge-in.
    client.setValue(this.engineId, 'voiceProcessingEnabled', true)
  }

  private destroyEngine(): void {
    if (!this.engineId) {
      return
    }
    this.ensureClient().callAction(this.engineId, 'stop', {})
    this.engineId = null
    this.isListening = false
    this.isSpeaking = false
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
    // Whisper's Metal GPU path crashes in the iOS Simulator, so gate on it.
    const useGPU = !NativeEdgeSpeech.isSimulator()

    return {
      type: 'Realtime',
      config: {
        microphoneEnabled: true,
        speakerEnabled: true,
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
              config: { initializeModel: true, useGPU },
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

  /** Emit onError and return an Error to throw from the failing action. */
  private fail(code: string, message: string): Error {
    this.emitError(code, message)
    return new Error(message)
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
    this.config = { vadSensitivity: 0.5, sampleRate: 16000, bufferSize: 512, ttsVoice: 'en_GB' }
  }
}

/** Process-wide singleton — the whole library talks to one engine. */
export const voiceEngine = new VoiceEngine()
