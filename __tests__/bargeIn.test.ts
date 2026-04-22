import { EdgeSpeech } from '../src/EdgeSpeech'
import SwitchboardVoiceModule from '../src/SwitchboardVoiceModule'
import type { VoiceConfig } from '../src/types'

// Capture addListener callbacks by event name so tests can simulate native events
const eventListeners: Record<string, Array<(data?: unknown) => void>> = {}

jest.mock('../src/SwitchboardVoiceModule', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(),
    initialize: jest.fn(),
    configure: jest.fn(),
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    speak: jest.fn(() => Promise.resolve()),
    stopSpeaking: jest.fn(() => Promise.resolve()),
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
  },
}))

/** Fire a simulated native event with optional payload */
function fireNativeEvent(eventName: string, data?: unknown): void {
  ;(eventListeners[eventName] ?? []).forEach((cb) => cb(data))
}

const baseConfig: VoiceConfig = { appId: 'test-id', appSecret: 'test-secret' }

describe('Barge-in (interruption handling)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset captured listener map
    Object.keys(eventListeners).forEach((key) => {
      eventListeners[key] = []
    })
    ;(EdgeSpeech as any)._cleanup()

    // Wire addListener to capture callbacks
    jest
      .mocked(SwitchboardVoiceModule.addListener)
      .mockImplementation((eventName: string, callback: (data?: unknown) => void) => {
        if (!eventListeners[eventName]) {
          eventListeners[eventName] = []
        }
        eventListeners[eventName].push(callback)
        return {
          remove: jest.fn(() => {
            eventListeners[eventName] = eventListeners[eventName].filter((cb) => cb !== callback)
          }),
        }
      })
  })

  it('invokes onInterrupted callback when native onInterrupted event fires', async () => {
    await EdgeSpeech.configure(baseConfig)
    const handler = jest.fn()
    EdgeSpeech.onInterrupted = handler

    fireNativeEvent('onInterrupted')

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not throw when onInterrupted fires with no callback set', async () => {
    await EdgeSpeech.configure(baseConfig)
    EdgeSpeech.onInterrupted = null

    expect(() => fireNativeEvent('onInterrupted')).not.toThrow()
  })

  it('updates currentState via onStateChange: speaking → listening after interruption', async () => {
    await EdgeSpeech.configure(baseConfig)

    fireNativeEvent('onStateChange', { state: 'speaking' })
    expect(EdgeSpeech.currentState).toBe('speaking')

    // Native emits listening state after barge-in stops TTS
    fireNativeEvent('onStateChange', { state: 'listening' })
    expect(EdgeSpeech.currentState).toBe('listening')
  })
})
