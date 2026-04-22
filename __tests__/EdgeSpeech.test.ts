import { EdgeSpeech } from '../src/EdgeSpeech'
import type { VoiceConfig } from '../src/types'

// Mock the native module (SwitchboardVoiceModule uses expo-modules-core, so mock it directly)
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

describe('EdgeSpeech', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset the singleton state between tests
    ;(EdgeSpeech as any)._cleanup()
  })

  describe('configure()', () => {
    it('should throw error if appId is missing', async () => {
      const config = {
        appSecret: 'test-secret',
      } as VoiceConfig

      await expect(EdgeSpeech.configure(config)).rejects.toThrow('appId is required')
    })

    it('should throw error if appSecret is missing', async () => {
      const config = {
        appId: 'test-id',
      } as VoiceConfig

      await expect(EdgeSpeech.configure(config)).rejects.toThrow('appSecret is required')
    })

    it('should accept valid configuration', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await expect(EdgeSpeech.configure(config)).resolves.toBeUndefined()
    })

    it('should accept optional parameters', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
        sttModel: 'whisper-base-en',
        ttsVoice: 'silero-en-us',
        vadSensitivity: 0.7,
      }

      await expect(EdgeSpeech.configure(config)).resolves.toBeUndefined()
    })

    it('should validate vadSensitivity range', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
        vadSensitivity: 1.5, // Invalid: > 1.0
      }

      await expect(EdgeSpeech.configure(config)).rejects.toThrow(
        'vadSensitivity must be between 0.0 and 1.0'
      )
    })
  })

  describe('start()', () => {
    it('should throw error if not configured', async () => {
      await expect(EdgeSpeech.start()).rejects.toThrow('EdgeSpeech must be configured before use')
    })

    it('should start listening after configuration', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await expect(EdgeSpeech.start()).resolves.toBeUndefined()
    })
  })

  describe('stop()', () => {
    it('should stop listening', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await EdgeSpeech.start()
      await expect(EdgeSpeech.stop()).resolves.toBeUndefined()
    })
  })

  describe('speak()', () => {
    it('should throw error if not configured', async () => {
      await expect(EdgeSpeech.speak('hello')).rejects.toThrow(
        'EdgeSpeech must be configured before use'
      )
    })

    it('should throw error for empty text', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await expect(EdgeSpeech.speak('')).rejects.toThrow('Text cannot be empty')
    })

    it('should speak text after configuration', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await expect(EdgeSpeech.speak('Hello world')).resolves.toBeUndefined()
    })
  })

  describe('stopSpeaking()', () => {
    it('should stop current TTS playback', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await EdgeSpeech.speak('Hello world')
      await expect(EdgeSpeech.stopSpeaking()).resolves.toBeUndefined()
    })
  })

  describe('Event handlers', () => {
    it('should allow setting onTranscript callback', async () => {
      const callback = jest.fn()
      EdgeSpeech.onTranscript = callback
      expect(EdgeSpeech.onTranscript).toBe(callback)
    })

    it('should allow setting onStateChange callback', async () => {
      const callback = jest.fn()
      EdgeSpeech.onStateChange = callback
      expect(EdgeSpeech.onStateChange).toBe(callback)
    })

    it('should allow setting onInterrupted callback', async () => {
      const callback = jest.fn()
      EdgeSpeech.onInterrupted = callback
      expect(EdgeSpeech.onInterrupted).toBe(callback)
    })

    it('should allow setting onError callback', async () => {
      const callback = jest.fn()
      EdgeSpeech.onError = callback
      expect(EdgeSpeech.onError).toBe(callback)
    })
  })

  describe('requestMicrophonePermission()', () => {
    it('should request microphone permission', async () => {
      await expect(EdgeSpeech.requestMicrophonePermission()).resolves.toBe(true)
    })
  })
})
