import { voiceEngine, type EdgeSpeechEventMap, type EdgeSpeechEventName } from './VoiceEngine'
import type { VoiceState, TranscriptEvent, StateChangeEvent, ErrorEvent } from './types'

export type { VoiceState, TranscriptEvent, StateChangeEvent, ErrorEvent }

/**
 * Backwards-compatible façade over the TurboModule + JSON-RPC pipeline.
 *
 * Historically this file was the Expo `requireNativeModule` binding. The native
 * transport is now a bare C++ TurboModule driven from TypeScript ({@link
 * VoiceEngine}), but this module keeps the exact same shape — the seven methods
 * plus `addListener` — so `EdgeSpeech`, `EdgeSpeechProvider`, `useEdgeSpeech`,
 * and any downstream consumers are unaffected.
 */
const SwitchboardVoiceModule = {
  initialize(appId: string, appSecret: string): void {
    voiceEngine.initialize(appId, appSecret)
  },

  configure(config: Record<string, unknown>): void {
    voiceEngine.configure(config)
  },

  listen(): Promise<void> {
    return voiceEngine.listen()
  },

  stopListening(): Promise<void> {
    return voiceEngine.stopListening()
  },

  speak(text: string): Promise<void> {
    return voiceEngine.speak(text)
  },

  stopSpeaking(): Promise<void> {
    return voiceEngine.stopSpeaking()
  },

  requestMicrophonePermission(): Promise<boolean> {
    return voiceEngine.requestMicrophonePermission()
  },

  /** Subscribe to a voice event. Returns a subscription with `remove()`. */
  addListener<K extends EdgeSpeechEventName>(
    event: K,
    listener: (payload: EdgeSpeechEventMap[K]) => void
  ): { remove: () => void } {
    return voiceEngine.addListener(event, listener)
  },
}

export default SwitchboardVoiceModule
