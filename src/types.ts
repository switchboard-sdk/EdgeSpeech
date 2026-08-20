/**
 * Voice processing states.
 *
 * `initializing` covers SDK startup — on Android that includes staging the STT/TTS
 * model files, which takes seconds. A `listen()`/`speak()` issued during it waits
 * rather than failing, so gating your UI on it is a courtesy, not a requirement.
 *
 * `idle` means "not initializing and not running", which covers a *failed* init as
 * well as a ready or stopped engine — it is not a readiness signal. An init failure
 * is reported through `onError`.
 */
export type VoiceState = 'initializing' | 'idle' | 'listening' | 'processing' | 'speaking'

/**
 * Configuration for SwitchboardVoice
 */
export interface VoiceConfig {
  /** Switchboard app ID (required) */
  appId: string

  /** Switchboard app secret (required) */
  appSecret: string

  /**
   * STT model: 'whisper-base-en' | 'whisper-tiny-en' (optional, default: 'whisper-base-en').
   * Android only — iOS always uses the base model bundled in the Switchboard framework.
   * 'whisper-tiny-en' must be added to the `edgespeechModels` Gradle property to be in the build.
   */
  sttModel?: string

  /** TTS voice: 'en_GB' | 'de_DE' (optional, default: 'en_GB'; Android only) */
  ttsVoice?: string

  /** VAD sensitivity (0.0-1.0, default: 0.5) */
  vadSensitivity?: number
}

/**
 * Error types that can occur during voice processing
 */
export interface VoiceError {
  /** Error code */
  code: string

  /** Human-readable error message */
  message: string

  /** Optional additional error details */
  details?: Record<string, unknown>
}

/**
 * Transcript event data
 */
export interface TranscriptEvent {
  /** Transcribed text */
  text: string

  /** Whether this is a final transcript */
  isFinal: boolean
}

/**
 * State change event data
 */
export interface StateChangeEvent {
  /** New voice state */
  state: VoiceState

  /** Previous voice state (may be absent on first emission) */
  previousState?: VoiceState
}

/**
 * Error event payload emitted by the native module
 */
export interface ErrorEvent {
  /** Machine-readable error code */
  code: string

  /** Human-readable error message */
  message: string
}

/**
 * Callback type for transcript events
 */
export type TranscriptCallback = (text: string, isFinal: boolean) => void

/**
 * Callback type for state change events
 */
export type StateChangeCallback = (state: VoiceState) => void

/**
 * Callback type for interruption events
 */
export type InterruptedCallback = () => void

/**
 * Callback type for error events
 */
export type ErrorCallback = (error: VoiceError) => void
