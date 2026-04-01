/**
 * switchboard-voice-rn
 *
 * React Native library for on-device voice processing with Switchboard SDK.
 * Provides VAD, STT, and TTS through a simple JavaScript callback interface.
 *
 * @packageDocumentation
 */

// Re-export the native module for direct access
export { default as SwitchboardVoiceModule } from './SwitchboardVoiceModule'

// Export the high-level wrapper API
export { SwitchboardVoice } from './SwitchboardVoice'

// Export convenience functions that delegate to the native module
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

export function initialize(appId: string, appSecret: string): void {
  SwitchboardVoiceModule.initialize(appId, appSecret)
}

export function configure(config: Record<string, any>): void {
  SwitchboardVoiceModule.configure(config)
}

export async function start(): Promise<void> {
  return SwitchboardVoiceModule.start()
}

export async function stop(): Promise<void> {
  return SwitchboardVoiceModule.stop()
}

export async function speak(text: string): Promise<void> {
  return SwitchboardVoiceModule.speak(text)
}

export async function stopSpeaking(): Promise<void> {
  return SwitchboardVoiceModule.stopSpeaking()
}

export async function requestMicrophonePermission(): Promise<boolean> {
  return SwitchboardVoiceModule.requestMicrophonePermission()
}

// Export types
export type {
  VoiceConfig,
  VoiceState,
  VoiceError,
  TranscriptEvent,
  StateChangeEvent,
  TranscriptCallback,
  StateChangeCallback,
  InterruptedCallback,
  ErrorCallback,
} from './types'
