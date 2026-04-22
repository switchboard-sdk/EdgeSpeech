/**
 * Voice processing states
 */
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

/**
 * Configuration for SwitchboardVoice
 */
export interface VoiceConfig {
  /** Switchboard app ID (required) */
  appId: string

  /** Switchboard app secret (required) */
  appSecret: string

  /** STT model to use (optional, default: 'whisper-base-en') */
  sttModel?: string

  /** TTS voice to use (optional, default: 'silero-en-us') */
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

  /** Previous voice state */
  previousState: VoiceState
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
