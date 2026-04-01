import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface Spec extends TurboModule {
  // SDK Initialization
  initialize(appId: string, appSecret: string): void

  // Configuration
  configure(configJson: string): void

  // Engine Management
  createListeningEngine(): string // Returns engineID
  createSpeakingEngine(): string // Returns engineID

  // Control Methods
  start(): void
  stop(): void
  speak(text: string): void
  stopSpeaking(): void

  // Event Listeners
  setupTranscriptionListener(): void
  setupTTSCompleteListener(): void
  setupVADActivityListener(): void
  setupErrorListener(): void

  // Dynamic Parameter Updates
  setValue(nodeId: string, key: string, value: string): void
  getValue(nodeId: string, key: string): string

  // Permission Handling
  checkMicrophonePermission(): Promise<boolean>
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeSwitchboardVoiceModule')
