import { voiceEngine } from './VoiceEngine'

// Drive the real transport (SwitchboardClient → NativeModuleRPCClient) against
// the manual native mock, so this exercises JSON-RPC envelope construction,
// response parsing, the state machine, and event dispatch end-to-end in JS.
jest.mock('./NativeEdgeSpeech')

const native = jest.requireMock(
  './NativeEdgeSpeech'
) as typeof import('./__mocks__/NativeEdgeSpeech')

interface RpcCall {
  method: string
  params: any
}

/** All JSON-RPC requests sent to processCommand this test, decoded. */
function sentCalls(): RpcCall[] {
  return native.default.processCommand.mock.calls.map(([cmd]) => JSON.parse(cmd as string))
}

/** Find the callAction request whose actionName matches. */
function findAction(actionName: string): RpcCall | undefined {
  return sentCalls().find((c) => c.method === 'callAction' && c.params?.actionName === actionName)
}

beforeEach(() => {
  native.resetNativeMock()
  voiceEngine._cleanup()
  // Return an engine id for createEngine; null result for everything else.
  native.default.processCommand.mockImplementation((cmd: string) => {
    const { id, method, params } = JSON.parse(cmd)
    if (method === 'callAction' && params?.actionName === 'createEngine') {
      return JSON.stringify({ jsonrpc: '2.0', id, result: 'engine_1' })
    }
    return JSON.stringify({ jsonrpc: '2.0', id, result: null })
  })
})

describe('VoiceEngine transport', () => {
  it('initialize() surfaces a genuine failure via onError and does NOT throw', async () => {
    const errors: Array<{ code: string; message: string }> = []
    voiceEngine.addListener('onError', (e) => errors.push(e))
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, params } = JSON.parse(cmd)
      if (params?.actionName === 'initialize') {
        return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'bad credentials' } })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })

    expect(() => voiceEngine.initialize('app-id', 'app-secret')).not.toThrow()
    expect(errors).toEqual([{ code: 'INIT_FAILED', message: 'bad credentials' }])
    // Stayed uninitialized, so a later action rejects rather than proceeding.
    await expect(voiceEngine.listen()).rejects.toThrow(/not initialized/i)
  })

  it('initialize() treats "already been initialized" as success (reload case)', async () => {
    const errors: unknown[] = []
    voiceEngine.addListener('onError', (e) => errors.push(e))
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, params } = JSON.parse(cmd)
      if (params?.actionName === 'initialize') {
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'SwitchboardSDK has already been initialized.' },
        })
      }
      if (params?.actionName === 'createEngine') {
        return JSON.stringify({ jsonrpc: '2.0', id, result: 'engine_1' })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })

    expect(() => voiceEngine.initialize('app-id', 'app-secret')).not.toThrow()
    expect(errors).toEqual([]) // not surfaced as an error
    await expect(voiceEngine.listen()).resolves.toBeUndefined() // initialized → proceeds
  })

  it('listen() creates the engine (bare-name nodes), enables AEC, then starts', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    await voiceEngine.listen()

    expect(findAction('createEngine')).toBeDefined()
    // voiceProcessingEnabled set on the returned engine id
    const setVal = sentCalls().find((c) => c.method === 'setValue')
    expect(setVal!.params).toEqual({
      objectURI: 'engine_1',
      key: 'voiceProcessingEnabled',
      value: true,
    })
    const start = sentCalls().find((c) => c.method === 'callAction' && c.params.actionName === 'start')
    expect(start!.params.objectURI).toBe('engine_1')
    expect(states).toContain('listening')
  })

  it('speak() synthesizes on ttsNode and moves to speaking', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    await voiceEngine.speak('hello world')

    const synth = findAction('synthesize')
    expect(synth!.params.objectURI).toBe('ttsNode')
    expect(synth!.params.params).toEqual({ text: 'hello world' })
    expect(states[states.length - 1]).toBe('speaking')
  })

  it('emits onTranscript when a transcribed event arrives', () => {
    voiceEngine.initialize('app-id', 'app-secret')
    const transcripts: Array<{ text: string; isFinal: boolean }> = []
    voiceEngine.addListener('onTranscript', (e) => transcripts.push(e))

    native.emit(JSON.stringify({ objectURI: 'sttNode', name: 'transcribed', data: { text: 'hi' } }))

    expect(transcripts).toEqual([{ text: 'hi', isFinal: true }])
  })

  it('barge-in: a transcript during TTS stops speaking, interrupts, then transcribes', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    const events: string[] = []
    voiceEngine.addListener('onInterrupted', () => events.push('interrupted'))
    voiceEngine.addListener('onStateChange', ({ state }) => events.push(`state:${state}`))
    voiceEngine.addListener('onTranscript', ({ text }) => events.push(`transcript:${text}`))

    await voiceEngine.speak('a long answer')
    // speak() lazily starts the engine (→ listening) then synthesizes (→ speaking);
    // clear those setup events so we assert only the barge-in sequence.
    events.length = 0
    native.default.processCommand.mockClear()

    native.emit(
      JSON.stringify({ objectURI: 'sttNode', name: 'transcribed', data: { text: 'stop' } })
    )

    // TTS was told to stop, and the barge-in sequence fired in order.
    expect(findAction('stop')?.params.objectURI).toBe('ttsNode')
    expect(events).toEqual(['state:listening', 'interrupted', 'transcript:stop'])
  })

  it('configure() clamps vadSensitivity into [0,1] and feeds the graph', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    voiceEngine.configure({ vadSensitivity: 5 })
    await voiceEngine.listen()

    const create = findAction('createEngine')!
    const vadNode = create.params.params.config.graph.nodes.find((n: any) => n.id === 'vadNode')
    expect(vadNode.config.threshold).toBe(1)
  })

  it('useGPU follows !isSimulator in the built graph', async () => {
    native.default.isSimulator.mockReturnValue(true)
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    const create = findAction('createEngine')!
    const sttNode = create.params.params.config.graph.nodes.find((n: any) => n.id === 'sttNode')
    expect(sttNode.config.useGPU).toBe(false)
  })
})

describe('VoiceEngine Android platform branches', () => {
  const RN = require('react-native')
  const originalOS = RN.Platform.OS
  const ANDROID_MODEL_PATH = '/data/user/0/app/files/models/whisper/ggml-base.en.bin'
  const TTS_BASE = '/data/user/0/app/files/sherpa/tts'
  let prepareModel: jest.Mock
  let prepareArchive: jest.Mock
  let initializeSdk: jest.Mock

  const ttsLoadCall = () =>
    sentCalls().find(
      (c) =>
        c.method === 'callAction' &&
        c.params?.actionName === 'loadModel' &&
        c.params?.objectURI === 'ttsNode'
    )

  beforeEach(() => {
    prepareModel = jest.fn().mockResolvedValue(ANDROID_MODEL_PATH)
    prepareArchive = jest.fn().mockResolvedValue(TTS_BASE)
    initializeSdk = jest.fn().mockResolvedValue(null)
    RN.NativeModules.EdgeSpeechModels = { prepareModel, prepareArchive, initializeSdk }
  })

  afterEach(() => {
    RN.Platform.OS = originalOS
    delete RN.NativeModules.EdgeSpeechModels
    jest.restoreAllMocks()
  })

  it('forces Whisper useGPU=false on Android even when not a simulator', async () => {
    RN.Platform.OS = 'android'
    native.default.isSimulator.mockReturnValue(false) // would enable GPU on an iOS device
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    const create = findAction('createEngine')!
    const sttNode = create.params.params.config.graph.nodes.find((n: any) => n.id === 'sttNode')
    expect(sttNode.config.useGPU).toBe(false)
  })

  it('calls loadModel on the Whisper node with the resolved path on Android', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(prepareModel).toHaveBeenCalledWith('models/whisper/ggml-base.en.bin')
    const load = findAction('loadModel')!
    expect(load.params.objectURI).toBe('sttNode')
    expect(load.params.params.modelPath).toBe(ANDROID_MODEL_PATH)
    // The path is loaded via the action, not baked into the graph node config.
    const create = findAction('createEngine')!
    const sttNode = create.params.params.config.graph.nodes.find((n: any) => n.id === 'sttNode')
    expect(sttNode.config.modelPath).toBeUndefined()
  })

  it('selects the tiny model asset when sttModel is whisper-tiny-en', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    voiceEngine.configure({ sttModel: 'whisper-tiny-en' })
    await voiceEngine.listen()

    expect(prepareModel).toHaveBeenCalledWith('models/whisper/ggml-tiny.en.bin')
  })

  it('surfaces MODEL_UNAVAILABLE when the native models module is missing', async () => {
    RN.Platform.OS = 'android'
    delete RN.NativeModules.EdgeSpeechModels
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.listen()).rejects.toThrow(/EdgeSpeechModels native module/i)
  })

  it('does not call loadModel on iOS (model bundled in the SDK framework)', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(prepareModel).not.toHaveBeenCalled()
    expect(findAction('loadModel')).toBeUndefined()
  })

  it('extracts the voice zip and calls loadModel on the Sherpa TTS node on Android', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('hello')

    expect(prepareArchive).toHaveBeenCalledWith('models/sherpa/tts/en_GB.zip', 'sherpa/tts')
    const load = ttsLoadCall()!
    const v = 'en_GB/vits-piper-en_GB-southern_english_female-low'
    expect(load.params.params.modelPath).toBe(`${TTS_BASE}/${v}/en_GB-southern_english_female-low.with_runtime_opt.ort`)
    expect(load.params.params.tokensPath).toBe(`${TTS_BASE}/${v}/tokens.txt`)
    expect(load.params.params.dataPath).toBe(`${TTS_BASE}/${v}/espeak-ng-data`)
  })

  it('selects the de_DE voice zip when ttsVoice is de_DE', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    voiceEngine.configure({ ttsVoice: 'de_DE' })
    await voiceEngine.speak('hallo')

    expect(prepareArchive).toHaveBeenCalledWith('models/sherpa/tts/de_DE.zip', 'sherpa/tts')
    expect(ttsLoadCall()!.params.params.modelPath).toContain('de_DE-thorsten-low.with_runtime_opt.ort')
  })

  it('does not load a TTS voice on iOS', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('hello')

    expect(prepareArchive).not.toHaveBeenCalled()
    expect(ttsLoadCall()).toBeUndefined()
  })

  it('requestMicrophonePermission uses PermissionsAndroid (not the native hook) on Android', async () => {
    RN.Platform.OS = 'android'
    const req = jest
      .spyOn(RN.PermissionsAndroid, 'request')
      .mockResolvedValue(RN.PermissionsAndroid.RESULTS.GRANTED)

    await expect(voiceEngine.requestMicrophonePermission()).resolves.toBe(true)
    expect(req).toHaveBeenCalledWith(RN.PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    expect(native.default.requestMicrophonePermission).not.toHaveBeenCalled()
  })

  it('requestMicrophonePermission throws PERMISSION_DENIED when Android denies', async () => {
    RN.Platform.OS = 'android'
    jest
      .spyOn(RN.PermissionsAndroid, 'request')
      .mockResolvedValue(RN.PermissionsAndroid.RESULTS.DENIED)

    await expect(voiceEngine.requestMicrophonePermission()).rejects.toThrow(/denied/i)
  })
})
