import type { TurboModule } from 'react-native'
import { TurboModuleRegistry, CodegenTypes } from 'react-native'

/**
 * TurboModule spec consumed by React Native Codegen (new architecture).
 *
 * The native surface is intentionally tiny: everything flows through a single
 * JSON-RPC 2.0 string channel (`processCommand`), plus an event stream. The
 * higher-level voice pipeline (VoiceEngine, SwitchboardClient) is built on top
 * of this in TypeScript, so adding new Switchboard actions never requires
 * touching native code.
 */
export interface Spec extends TurboModule {
  /** Execute a JSON-RPC 2.0 command and return the JSON-RPC response string. */
  readonly processCommand: (command: string) => string

  /**
   * Whether the app is running in the iOS Simulator. TypeScript uses this to
   * disable Whisper's Metal GPU path (which crashes in the simulator).
   */
  readonly isSimulator: () => boolean

  /** Request microphone permission; resolves to whether it's granted. */
  readonly requestMicrophonePermission: () => Promise<boolean>

  /** Stream of Switchboard SDK events, delivered as JSON strings. */
  readonly onEventReceived: CodegenTypes.EventEmitter<string>
}

export default TurboModuleRegistry.getEnforcing<Spec>('EdgeSpeech')
