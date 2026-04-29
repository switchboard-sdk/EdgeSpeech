import React from 'react'
import { renderHook, act } from '@testing-library/react-hooks'
import { EdgeSpeechProvider, useEdgeSpeechContext } from './EdgeSpeechProvider'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

jest.mock('../src/SwitchboardVoiceModule', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    initialize: jest.fn(),
    configure: jest.fn(),
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    speak: jest.fn(() => Promise.resolve()),
    stopSpeaking: jest.fn(() => Promise.resolve()),
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
  },
}))

const testConfig = { appId: 'test-id', appSecret: 'test-secret' }

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(EdgeSpeechProvider, { config: testConfig }, children)

describe('EdgeSpeechProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('initializes the native module on mount with provided credentials', () => {
    renderHook(() => useEdgeSpeechContext(), { wrapper })

    expect(SwitchboardVoiceModule.initialize).toHaveBeenCalledWith('test-id', 'test-secret')
  })

  it('configures the native module on mount with defaults', () => {
    renderHook(() => useEdgeSpeechContext(), { wrapper })

    expect(SwitchboardVoiceModule.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        sttModel: 'whisper-base-en',
        ttsVoice: 'en_GB',
        vadSensitivity: 0.5,
      })
    )
  })

  it('configures with provided optional values', () => {
    const customWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        EdgeSpeechProvider,
        { config: { ...testConfig, vadSensitivity: 0.8, ttsVoice: 'en_US' } },
        children
      )

    renderHook(() => useEdgeSpeechContext(), { wrapper: customWrapper })

    expect(SwitchboardVoiceModule.configure).toHaveBeenCalledWith(
      expect.objectContaining({ vadSensitivity: 0.8, ttsVoice: 'en_US' })
    )
  })

  it('calls stop on unmount', () => {
    const { unmount } = renderHook(() => useEdgeSpeechContext(), { wrapper })
    unmount()

    expect(SwitchboardVoiceModule.stop).toHaveBeenCalled()
  })

  it('throws when used outside of provider', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useEdgeSpeechContext())
    consoleSpy.mockRestore()
    expect(result.error).toEqual(
      new Error('useEdgeSpeech must be used within an <EdgeSpeechProvider>')
    )
  })

  describe('exposed methods delegate to native module', () => {
    it('start()', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      await act(async () => {
        await result.current.start()
      })
      expect(SwitchboardVoiceModule.start).toHaveBeenCalled()
    })

    it('stop()', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      await act(async () => {
        await result.current.stop()
      })
      expect(SwitchboardVoiceModule.stop).toHaveBeenCalled()
    })

    it('speak(text)', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      await act(async () => {
        await result.current.speak('hello')
      })
      expect(SwitchboardVoiceModule.speak).toHaveBeenCalledWith('hello')
    })

    it('stopSpeaking()', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      await act(async () => {
        await result.current.stopSpeaking()
      })
      expect(SwitchboardVoiceModule.stopSpeaking).toHaveBeenCalled()
    })

    it('requestMicrophonePermission()', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      let granted: boolean
      await act(async () => {
        granted = await result.current.requestMicrophonePermission()
      })
      expect(SwitchboardVoiceModule.requestMicrophonePermission).toHaveBeenCalled()
      expect(granted!).toBe(true)
    })
  })
})
