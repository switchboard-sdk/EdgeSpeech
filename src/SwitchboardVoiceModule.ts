import { NativeModule, requireNativeModule } from 'expo-modules-core'
import type { VoiceState, TranscriptEvent, StateChangeEvent, ErrorEvent } from './types'

export type { VoiceState, TranscriptEvent, StateChangeEvent, ErrorEvent }

// Native module type declaration
declare class SwitchboardVoiceModuleType extends NativeModule<{
  onTranscript: (event: TranscriptEvent) => void
  onStateChange: (event: StateChangeEvent) => void
  onError: (event: ErrorEvent) => void
  onSpeechStart: () => void
  onSpeechEnd: () => void
  onInterrupted: () => void
  onTTSComplete: () => void
}> {
  initialize(appId: string, appSecret: string): void
  configure(config: Record<string, unknown>): void
  listen(): Promise<void>
  stopListening(): Promise<void>
  speak(text: string): Promise<void>
  stopSpeaking(): Promise<void>
  requestMicrophonePermission(): Promise<boolean>
}

export default requireNativeModule<SwitchboardVoiceModuleType>('SwitchboardVoice')
