import { NativeModule, requireNativeModule } from 'expo-modules-core'

// Event payload types
export interface TranscriptEvent {
  text: string
  isFinal: boolean
}

export interface StateChangeEvent {
  state: VoiceState
}

export interface ErrorEvent {
  code: string
  message: string
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

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
  configure(config: Record<string, any>): void
  start(): Promise<void>
  stop(): Promise<void>
  speak(text: string): Promise<void>
  stopSpeaking(): Promise<void>
  requestMicrophonePermission(): Promise<boolean>
}

export default requireNativeModule<SwitchboardVoiceModuleType>('SwitchboardVoice')
