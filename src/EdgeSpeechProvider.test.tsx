import React from 'react'
import { renderHook, act } from '@testing-library/react-native'
import {
  EdgeSpeechProvider,
  useEdgeSpeechContext,
  type EdgeSpeechProviderProps,
} from './EdgeSpeechProvider'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'
import { DEFAULT_APP_ID, DEFAULT_APP_SECRET } from './credentials'

jest.mock('../src/SwitchboardVoiceModule', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    getState: jest.fn(() => 'ready'),
    initialize: jest.fn(() => Promise.resolve()),
    configure: jest.fn(),
    listen: jest.fn(() => Promise.resolve()),
    stopListening: jest.fn(() => Promise.resolve()),
    speak: jest.fn(() => Promise.resolve()),
    stopSpeaking: jest.fn(() => Promise.resolve()),
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
  },
}))

const defaultProps: EdgeSpeechProviderProps = { appId: 'test-id', appSecret: 'test-secret' }

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(EdgeSpeechProvider, defaultProps, children)

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
      expect.objectContaining({ vadSensitivity: 0.5 })
    )
  })

  it('configures with provided optional values', () => {
    const customWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        EdgeSpeechProvider,
        { appId: 'test-id', appSecret: 'test-secret', vadSensitivity: 0.8 },
        children
      )

    renderHook(() => useEdgeSpeechContext(), { wrapper: customWrapper })

    expect(SwitchboardVoiceModule.configure).toHaveBeenCalledWith(
      expect.objectContaining({ vadSensitivity: 0.8 })
    )
  })

  it('passes sampleRate and bufferSize to configure when provided', () => {
    const customWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        EdgeSpeechProvider,
        { appId: 'test-id', appSecret: 'test-secret', sampleRate: 22050, bufferSize: 1024 },
        children
      )

    renderHook(() => useEdgeSpeechContext(), { wrapper: customWrapper })

    expect(SwitchboardVoiceModule.configure).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 22050, bufferSize: 1024 })
    )
  })

  it('omits sampleRate and bufferSize from configure when not provided', () => {
    renderHook(() => useEdgeSpeechContext(), { wrapper })

    const configArg = (SwitchboardVoiceModule.configure as jest.Mock).mock.calls[0][0]
    expect(configArg).not.toHaveProperty('sampleRate')
    expect(configArg).not.toHaveProperty('bufferSize')
  })

  it('calls stopListening on unmount', () => {
    const { unmount } = renderHook(() => useEdgeSpeechContext(), { wrapper })
    unmount()

    expect(SwitchboardVoiceModule.stopListening).toHaveBeenCalled()
  })

  it('throws when used outside of provider', () => {
    expect(() => renderHook(() => useEdgeSpeechContext())).toThrow(
      'useEdgeSpeech must be used within an <EdgeSpeechProvider>'
    )
  })

  describe('prop validation', () => {
    it('falls back to the library credentials when none are given', () => {
      const noCredsWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(EdgeSpeechProvider, {}, children)
      renderHook(() => useEdgeSpeechContext(), { wrapper: noCredsWrapper })

      expect(SwitchboardVoiceModule.initialize).toHaveBeenCalledWith(
        DEFAULT_APP_ID,
        DEFAULT_APP_SECRET
      )
    })

    it('falls back to the library credentials when they are blank', () => {
      const blankCredsWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(EdgeSpeechProvider, { appId: '   ', appSecret: '' }, children)
      renderHook(() => useEdgeSpeechContext(), { wrapper: blankCredsWrapper })

      expect(SwitchboardVoiceModule.initialize).toHaveBeenCalledWith(
        DEFAULT_APP_ID,
        DEFAULT_APP_SECRET
      )
    })

    it('throws when vadSensitivity is above 1.0', () => {
      const badWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          EdgeSpeechProvider,
          { appId: 'test-id', appSecret: 'test-secret', vadSensitivity: 1.5 },
          children
        )
      expect(() => renderHook(() => useEdgeSpeechContext(), { wrapper: badWrapper })).toThrow(
        'EdgeSpeechProvider: vadSensitivity must be between 0.0 and 1.0'
      )
    })

    it('throws when vadSensitivity is below 0.0', () => {
      const badWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          EdgeSpeechProvider,
          { appId: 'test-id', appSecret: 'test-secret', vadSensitivity: -0.1 },
          children
        )
      expect(() => renderHook(() => useEdgeSpeechContext(), { wrapper: badWrapper })).toThrow(
        'EdgeSpeechProvider: vadSensitivity must be between 0.0 and 1.0'
      )
    })
  })

  describe('exposed methods delegate to native module', () => {
    it('listen()', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      await act(async () => {
        await result.current.listen()
      })
      expect(SwitchboardVoiceModule.listen).toHaveBeenCalled()
    })

    it('stopListening()', async () => {
      const { result } = renderHook(() => useEdgeSpeechContext(), { wrapper })
      await act(async () => {
        await result.current.stopListening()
      })
      expect(SwitchboardVoiceModule.stopListening).toHaveBeenCalled()
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
