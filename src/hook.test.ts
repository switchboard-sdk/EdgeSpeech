import { renderHook, act } from '@testing-library/react-hooks'
import { useEdgeSpeech } from './hook'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

// Capture addListener callbacks by event name so tests can simulate native events
const eventListeners: Record<string, Array<(data?: unknown) => void>> = {}

jest.mock('../src/SwitchboardVoiceModule', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  },
}))

/** Fire a simulated native event with optional payload */
function fireNativeEvent(eventName: string, data?: unknown): void {
  ;(eventListeners[eventName] ?? []).forEach((cb) => cb(data))
}

describe('useEdgeSpeech', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.keys(eventListeners).forEach((key) => {
      eventListeners[key] = []
    })

    jest.mocked(SwitchboardVoiceModule.addListener).mockImplementation((eventName, listener) => {
      const name = eventName as string
      const callback = listener as (data?: unknown) => void
      if (!eventListeners[name]) {
        eventListeners[name] = []
      }
      eventListeners[name].push(callback)
      return {
        remove: jest.fn(() => {
          eventListeners[name] = eventListeners[name].filter((cb) => cb !== callback)
        }),
      }
    })
  })

  describe('transcript', () => {
    it('starts empty', () => {
      const { result } = renderHook(() => useEdgeSpeech())
      expect(result.current.transcript).toBe('')
    })

    it('updates with interim transcript text', () => {
      const { result } = renderHook(() => useEdgeSpeech())

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello wor', isFinal: false })
      })

      expect(result.current.transcript).toBe('hello wor')
    })

    it('updates with final transcript text then clears', () => {
      const { result } = renderHook(() => useEdgeSpeech())

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello world', isFinal: true })
      })

      expect(result.current.transcript).toBe('')
    })

    it('shows interim text before clearing on final', () => {
      const { result } = renderHook(() => useEdgeSpeech())

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello', isFinal: false })
      })
      expect(result.current.transcript).toBe('hello')

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello world', isFinal: true })
      })
      expect(result.current.transcript).toBe('')
    })
  })

  describe('onTranscriptComplete', () => {
    it('calls the registered callback with final text', () => {
      const { result } = renderHook(() => useEdgeSpeech())
      const handler = jest.fn()

      act(() => {
        result.current.onTranscriptComplete(handler)
      })

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello world', isFinal: true })
      })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('hello world')
    })

    it('does not call the callback for interim results', () => {
      const { result } = renderHook(() => useEdgeSpeech())
      const handler = jest.fn()

      act(() => {
        result.current.onTranscriptComplete(handler)
      })

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hel', isFinal: false })
        fireNativeEvent('onTranscript', { text: 'hello', isFinal: false })
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('replaces the callback when called again', () => {
      const { result } = renderHook(() => useEdgeSpeech())
      const first = jest.fn()
      const second = jest.fn()

      act(() => {
        result.current.onTranscriptComplete(first)
        result.current.onTranscriptComplete(second)
      })

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello', isFinal: true })
      })

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith('hello')
    })
  })

  describe('cleanup', () => {
    it('removes the onTranscript listener on unmount', () => {
      const { unmount } = renderHook(() => useEdgeSpeech())
      unmount()
      expect(SwitchboardVoiceModule.removeAllListeners).toHaveBeenCalledWith('onTranscript')
    })
  })
})
