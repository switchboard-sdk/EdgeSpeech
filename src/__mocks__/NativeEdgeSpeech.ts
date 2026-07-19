// Manual Jest mock for the native TurboModule seam.
//
// `TurboModuleRegistry.getEnforcing('EdgeSpeech')` throws under Jest (no native
// module registered), so any suite that pulls in code touching
// `./NativeEdgeSpeech` must mock it via `jest.mock('./NativeEdgeSpeech')`.
//
// The event emitter is modeled faithfully: `onEventReceived(cb)` records the
// subscriber and returns a subscription with a real `remove()`, so tests can
// assert NativeModuleRPCClient's "replace the old subscription so we never
// double-deliver" contract. Use `emit()` to push an event through the *current*
// subscriber (mirrors the native event stream).

type EventCallback = (eventJSON: string) => void

// The subscriber currently registered via onEventReceived (null once removed).
let currentCallback: EventCallback | null = null

const processCommand = jest.fn<string, [string]>(() => '{"jsonrpc":"2.0","id":1,"result":null}')
const isSimulator = jest.fn<boolean, []>(() => false)
const requestMicrophonePermission = jest.fn<Promise<boolean>, []>(() => Promise.resolve(true))

const onEventReceived = jest.fn((cb: EventCallback) => {
  currentCallback = cb
  return {
    remove: jest.fn(() => {
      // Only clear if this subscription is still the active one.
      if (currentCallback === cb) {
        currentCallback = null
      }
    }),
  }
})

/** Push an event JSON string through the currently-subscribed listener. */
export function emit(eventJSON: string): void {
  currentCallback?.(eventJSON)
}

/** Whether a listener is currently subscribed (for the double-delivery test). */
export function hasSubscriber(): boolean {
  return currentCallback !== null
}

/** Reset all mock fns and the captured subscriber between tests. */
export function resetNativeMock(): void {
  processCommand.mockReset()
  processCommand.mockReturnValue('{"jsonrpc":"2.0","id":1,"result":null}')
  isSimulator.mockReset()
  isSimulator.mockReturnValue(false)
  requestMicrophonePermission.mockReset()
  requestMicrophonePermission.mockResolvedValue(true)
  onEventReceived.mockClear()
  currentCallback = null
}

const NativeEdgeSpeechMock = {
  processCommand,
  isSimulator,
  requestMicrophonePermission,
  onEventReceived,
}

export default NativeEdgeSpeechMock
