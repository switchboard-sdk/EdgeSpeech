/**
 * Voice processing states.
 *
 * Three of these describe the SDK's lifecycle rather than the audio pipeline:
 *
 * - `idle` — the SDK is not up: either `initialize()` has not run yet, or it ran and
 *   failed. `onError` (and the hook's `error`) says which. `listen()`/`speak()` reject
 *   with `NOT_INITIALIZED` from here.
 * - `initializing` — init is in flight. On Android that includes staging the STT/TTS
 *   model files, which takes seconds. A `listen()`/`speak()` issued now waits for it
 *   rather than failing, so gating your UI on this state is a courtesy, not a duty.
 * - `ready` — initialized, nothing running. This is the state that means "operable",
 *   not `idle`.
 */
export type VoiceState = 'idle' | 'initializing' | 'ready' | 'listening' | 'processing' | 'speaking'

/**
 * Configuration for SwitchboardVoice
 */
export interface VoiceConfig {
  /** Switchboard app ID (required) */
  appId: string

  /** Switchboard app secret (required) */
  appSecret: string

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
