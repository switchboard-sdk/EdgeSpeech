import SwitchboardVoiceModule from './SwitchboardVoiceModule'
import type {
  VoiceConfig,
  VoiceState,
  VoiceError,
  TranscriptCallback,
  StateChangeCallback,
  InterruptedCallback,
  ErrorCallback,
} from './types'

/**
 * SwitchboardVoice - Main API for on-device voice processing
 *
 * Provides a simple event-based interface for Voice Activity Detection (VAD),
 * Speech-to-Text (STT), and Text-to-Speech (TTS) using the Switchboard SDK.
 *
 * @example
 * ```typescript
 * // Configure
 * await SwitchboardVoice.configure({
 *   appId: 'YOUR_APP_ID',
 *   appSecret: 'YOUR_APP_SECRET',
 * });
 *
 * // Set up event handlers
 * SwitchboardVoice.onTranscript = (text, isFinal) => {
 *   console.log('Transcript:', text, 'Final:', isFinal);
 * };
 *
 * // Start listening
 * await SwitchboardVoice.start();
 *
 * // Speak response
 * await SwitchboardVoice.speak('Hello world');
 * ```
 */
class SwitchboardVoiceAPI {
  private _isConfigured = false
  private _currentState: VoiceState = 'idle'
  private _onTranscript: TranscriptCallback | null = null
  private _onStateChange: StateChangeCallback | null = null
  private _onInterrupted: InterruptedCallback | null = null
  private _onError: ErrorCallback | null = null
  private _subscriptions: { remove: () => void }[] = []
  private _listenersSetup = false

  constructor() {
    // Defer listener setup until first use to ensure module is loaded
  }

  private _ensureListenersSetup(): void {
    if (this._listenersSetup) {return}
    this._setupEventListeners()
    this._listenersSetup = true
  }

  /**
   * Configure SwitchboardVoice with app credentials and optional settings
   *
   * @param config - Configuration object
   * @throws Error if required parameters are missing or invalid
   */
  async configure(config: VoiceConfig): Promise<void> {
    // Setup event listeners on first configure call
    this._ensureListenersSetup()

    // Validation
    if (!config.appId || config.appId.trim() === '') {
      throw new Error('appId is required')
    }

    if (!config.appSecret || config.appSecret.trim() === '') {
      throw new Error('appSecret is required')
    }

    if (
      config.vadSensitivity !== undefined &&
      (config.vadSensitivity < 0.0 || config.vadSensitivity > 1.0)
    ) {
      throw new Error('vadSensitivity must be between 0.0 and 1.0')
    }

    // Apply defaults
    const finalConfig = {
      appId: config.appId,
      appSecret: config.appSecret,
      sttModel: config.sttModel || 'whisper-base-en',
      ttsVoice: config.ttsVoice || 'silero-en-us',
      vadSensitivity: config.vadSensitivity ?? 0.5,
    }

    // Initialize and configure native module
    SwitchboardVoiceModule.initialize(finalConfig.appId, finalConfig.appSecret)
    SwitchboardVoiceModule.configure(finalConfig)

    this._isConfigured = true
  }

  /**
   * Start listening for voice input
   *
   * Activates microphone and begins Voice Activity Detection (VAD) and
   * Speech-to-Text (STT) processing.
   *
   * @throws Error if not configured
   */
  async start(): Promise<void> {
    this._ensureConfigured()
    await SwitchboardVoiceModule.start()
  }

  /**
   * Stop listening for voice input
   */
  async stop(): Promise<void> {
    await SwitchboardVoiceModule.stop()
  }

  /**
   * Speak text using Text-to-Speech (TTS)
   *
   * @param text - Text to speak
   * @throws Error if not configured or text is empty
   */
  async speak(text: string): Promise<void> {
    this._ensureConfigured()

    if (!text || text.trim() === '') {
      throw new Error('Text cannot be empty')
    }

    await SwitchboardVoiceModule.speak(text)
  }

  /**
   * Stop current TTS playback
   */
  async stopSpeaking(): Promise<void> {
    await SwitchboardVoiceModule.stopSpeaking()
  }

  /**
   * Request microphone permission from the user
   *
   * @returns Promise resolving to true if granted, false otherwise
   */
  async requestMicrophonePermission(): Promise<boolean> {
    return await SwitchboardVoiceModule.requestMicrophonePermission()
  }

  /**
   * Get current voice processing state
   */
  get currentState(): VoiceState {
    return this._currentState
  }

  /**
   * Check if SwitchboardVoice has been configured
   */
  get isConfigured(): boolean {
    return this._isConfigured
  }

  // Event callback setters

  set onTranscript(callback: TranscriptCallback | null) {
    this._onTranscript = callback
  }

  get onTranscript(): TranscriptCallback | null {
    return this._onTranscript
  }

  set onStateChange(callback: StateChangeCallback | null) {
    this._onStateChange = callback
  }

  get onStateChange(): StateChangeCallback | null {
    return this._onStateChange
  }

  set onInterrupted(callback: InterruptedCallback | null) {
    this._onInterrupted = callback
  }

  get onInterrupted(): InterruptedCallback | null {
    return this._onInterrupted
  }

  set onError(callback: ErrorCallback | null) {
    this._onError = callback
  }

  get onError(): ErrorCallback | null {
    return this._onError
  }

  // Private methods

  private _ensureConfigured(): void {
    if (!this._isConfigured) {
      throw new Error('SwitchboardVoice must be configured before use')
    }
  }

  private _setupEventListeners(): void {
    // Check if module and addListener are available
    if (!SwitchboardVoiceModule || typeof SwitchboardVoiceModule.addListener !== 'function') {
      console.warn('[SwitchboardVoice] Native module not available or missing addListener')
      return
    }

    // Transcript events
    const transcriptSub = SwitchboardVoiceModule.addListener(
      'onTranscript',
      (event: { text: string; isFinal: boolean }) => {
        if (this._onTranscript) {
          this._onTranscript(event.text, event.isFinal)
        }
      }
    )
    this._subscriptions.push(transcriptSub)

    // State change events
    const stateChangeSub = SwitchboardVoiceModule.addListener(
      'onStateChange',
      (event: { state: VoiceState }) => {
        this._currentState = event.state
        if (this._onStateChange) {
          this._onStateChange(event.state)
        }
      }
    )
    this._subscriptions.push(stateChangeSub)

    // Interruption events
    const interruptedSub = SwitchboardVoiceModule.addListener(
      'onInterrupted',
      () => {
        if (this._onInterrupted) {
          this._onInterrupted()
        }
      }
    )
    this._subscriptions.push(interruptedSub)

    // Error events
    const errorSub = SwitchboardVoiceModule.addListener(
      'onError',
      (error: VoiceError) => {
        if (this._onError) {
          this._onError(error)
        }
      }
    )
    this._subscriptions.push(errorSub)
  }

  /**
   * Clean up event listeners (for testing)
   * @internal
   */
  _cleanup(): void {
    this._subscriptions.forEach((sub) => sub.remove())
    this._subscriptions = []
    this._isConfigured = false
    this._currentState = 'idle'
    this._onTranscript = null
    this._onStateChange = null
    this._onInterrupted = null
    this._onError = null
  }
}

// Export singleton instance
export const SwitchboardVoice = new SwitchboardVoiceAPI()
