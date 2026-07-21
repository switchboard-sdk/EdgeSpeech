import { EdgeSpeech } from './EdgeSpeech'
import type { VoiceConfig } from './types'

// Mock the SwitchboardVoiceModule façade directly — it wraps the native TurboModule
// (via TurboModuleRegistry.getEnforcing), which isn't registered under Jest.
jest.mock('../src/SwitchboardVoiceModule', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    initialize: jest.fn(),
    configure: jest.fn(),
    listen: jest.fn(() => Promise.resolve()),
    stopListening: jest.fn(() => Promise.resolve()),
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

    it('should validate vadSensitivity range (above 1.0)', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
        vadSensitivity: 1.5,
      }

      await expect(EdgeSpeech.configure(config)).rejects.toThrow(
        'vadSensitivity must be between 0.0 and 1.0'
      )
    })

    it('should validate vadSensitivity range (below 0.0)', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
        vadSensitivity: -0.1,
      }

      await expect(EdgeSpeech.configure(config)).rejects.toThrow(
        'vadSensitivity must be between 0.0 and 1.0'
      )
    })

    it('should reject empty sttModel string', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
        sttModel: '   ',
      }

      await expect(EdgeSpeech.configure(config)).rejects.toThrow('sttModel cannot be an empty string')
    })

    it('should reject empty ttsVoice string', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
        ttsVoice: '',
      }

      await expect(EdgeSpeech.configure(config)).rejects.toThrow('ttsVoice cannot be an empty string')
    })
  })

  describe('listen()', () => {
    it('should throw error if not configured', async () => {
      await expect(EdgeSpeech.listen()).rejects.toThrow('EdgeSpeech must be configured before use')
    })

    it('should start listening after configuration', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await expect(EdgeSpeech.listen()).resolves.toBeUndefined()
    })
  })

  describe('stopListening()', () => {
    it('should stop listening', async () => {
      const config: VoiceConfig = {
        appId: 'test-id',
        appSecret: 'test-secret',
      }

      await EdgeSpeech.configure(config)
      await EdgeSpeech.listen()
      await expect(EdgeSpeech.stopListening()).resolves.toBeUndefined()
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
