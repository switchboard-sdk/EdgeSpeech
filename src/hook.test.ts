import React from 'react'
import { renderHook, act } from '@testing-library/react-native'
import { useEdgeSpeech } from './hook'
import { EdgeSpeechProvider } from './EdgeSpeechProvider'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

// Capture addListener callbacks by event name so tests can simulate native events
const eventListeners: Record<string, Array<(data?: unknown) => void>> = {}

jest.mock('../src/SwitchboardVoiceModule', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(),
    initialize: jest.fn(),
    configure: jest.fn(),
    listen: jest.fn(() => Promise.resolve()),
    stopListening: jest.fn(() => Promise.resolve()),
    speak: jest.fn(() => Promise.resolve()),
    stopSpeaking: jest.fn(() => Promise.resolve()),
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
  },
}))

// Wrap hook in provider for all tests
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(EdgeSpeechProvider, { appId: 'test-id', appSecret: 'test-secret' }, children)

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
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })
      expect(result.current.transcript).toBe('')
    })

    it('updates with interim transcript text', () => {
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello wor', isFinal: false })
      })

      expect(result.current.transcript).toBe('hello wor')
    })

    it('updates with final transcript text then clears', () => {
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })

      act(() => {
        fireNativeEvent('onTranscript', { text: 'hello world', isFinal: true })
      })

      expect(result.current.transcript).toBe('')
    })

    it('shows interim text before clearing on final', () => {
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })

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
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })
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
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })
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
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })
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

  describe('voiceState', () => {
    it('starts as idle', () => {
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })
      expect(result.current.voiceState).toBe('idle')
    })

    it('updates when onStateChange fires', () => {
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })

      act(() => {
        fireNativeEvent('onStateChange', { state: 'listening' })
      })

      expect(result.current.voiceState).toBe('listening')
    })

    it('tracks all state transitions', () => {
      const { result } = renderHook(() => useEdgeSpeech(), { wrapper })

      act(() => {
        fireNativeEvent('onStateChange', { state: 'listening' })
      })
      expect(result.current.voiceState).toBe('listening')

      act(() => {
        fireNativeEvent('onStateChange', { state: 'processing' })
      })
      expect(result.current.voiceState).toBe('processing')

      act(() => {
        fireNativeEvent('onStateChange', { state: 'speaking' })
      })
      expect(result.current.voiceState).toBe('speaking')

      act(() => {
        fireNativeEvent('onStateChange', { state: 'idle' })
      })
      expect(result.current.voiceState).toBe('idle')
    })
  })

  describe('cleanup', () => {
    it('removes all listeners on unmount', () => {
      const removeFns: jest.Mock[] = []
      jest.mocked(SwitchboardVoiceModule.addListener).mockImplementation((eventName, listener) => {
        const name = eventName as string
        const callback = listener as (data?: unknown) => void
        if (!eventListeners[name]) eventListeners[name] = []
        eventListeners[name].push(callback)
        const removeFn = jest.fn(() => {
          eventListeners[name] = eventListeners[name].filter((cb) => cb !== callback)
        })
        removeFns.push(removeFn)
        return { remove: removeFn }
      })

      const { unmount } = renderHook(() => useEdgeSpeech(), { wrapper })
      unmount()

      expect(removeFns.length).toBeGreaterThan(0)
      removeFns.forEach((fn) => expect(fn).toHaveBeenCalledTimes(1))
    })
  })
})
