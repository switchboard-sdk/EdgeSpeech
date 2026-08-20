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

/** How many times an action was called — for the concurrency tests. */
function countAction(actionName: string): number {
  return sentCalls().filter((c) => c.method === 'callAction' && c.params?.actionName === actionName)
    .length
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
  it('initialize() throws synchronously when the transport itself fails', () => {
    // A broken native module is a setup error, not a runtime one: it has to reach the
    // caller synchronously (red-box / reject configure()), not become an unhandled
    // rejection that leaves the app looking initialized.
    native.default.processCommand.mockImplementation(() => {
      throw new Error('TurboModule not found')
    })

    expect(() => voiceEngine.initialize('app-id', 'app-secret')).toThrow(/TurboModule not found/)
  })

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

    await expect(voiceEngine.initialize('app-id', 'app-secret')).resolves.toBeUndefined()
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

    await expect(voiceEngine.initialize('app-id', 'app-secret')).resolves.toBeUndefined()
    expect(errors).toEqual([]) // not surfaced as an error
    await expect(voiceEngine.listen()).resolves.toBeUndefined() // initialized → proceeds
  })

  it("starts at 'initializing' and settles to 'idle' once init returns", async () => {
    expect(voiceEngine.currentState).toBe('initializing')
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    await voiceEngine.initialize('app-id', 'app-secret')

    expect(states).toEqual(['initializing', 'idle'])
    expect(voiceEngine.currentState).toBe('idle')
  })

  it("settles to 'idle' even when init fails — the failure goes to onError", async () => {
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, params } = JSON.parse(cmd)
      if (params?.actionName === 'initialize') {
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'bad credentials' },
        })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    await voiceEngine.initialize('app-id', 'app-secret')

    expect(states).toEqual(['initializing', 'idle'])
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

  it('reports processing while Whisper decodes, then listening with the transcript', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()
    const events: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => events.push(`state:${state}`))
    voiceEngine.addListener('onTranscript', ({ text }) => events.push(`transcript:${text}`))

    native.emit(JSON.stringify({ objectURI: 'vadNode', name: 'speechEnded' }))
    native.emit(JSON.stringify({ objectURI: 'sttNode', name: 'transcribed', data: { text: 'hi' } }))

    // 'listening' lands before the transcript: a speak() from onTranscriptComplete
    // must be free to set 'speaking' last.
    expect(events).toEqual(['state:processing', 'state:listening', 'transcript:hi'])
  })

  it('leaves processing when Whisper decodes nothing', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    native.emit(JSON.stringify({ objectURI: 'vadNode', name: 'speechEnded' }))
    native.emit(JSON.stringify({ objectURI: 'sttNode', name: 'transcribed', data: {} }))

    expect(states).toEqual(['processing', 'listening'])
  })

  it('does not report a state for events that arrive after stopListening()', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()
    await voiceEngine.stopListening()
    const states: string[] = []
    const transcripts: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))
    voiceEngine.addListener('onTranscript', ({ text }) => transcripts.push(text))

    // The graph is down but its events can still be in flight; they must not drag the
    // state back off 'idle'.
    native.emit(JSON.stringify({ objectURI: 'vadNode', name: 'speechEnded' }))
    native.emit(JSON.stringify({ objectURI: 'sttNode', name: 'transcribed', data: { text: 'hi' } }))

    expect(states).toEqual([])
    expect(transcripts).toEqual(['hi'])
  })

  it('does not report processing while TTS is playing (that window is speaking)', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('a long answer')
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    native.emit(JSON.stringify({ objectURI: 'vadNode', name: 'speechEnded' }))

    expect(states).toEqual([])
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

  it('asks Whisper to initialize its bundled model (iOS has no loadModel call)', async () => {
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    const create = findAction('createEngine')!
    const sttNode = create.params.params.config.graph.nodes.find((n: any) => n.id === 'sttNode')
    expect(sttNode.config.initializeModel).toBe(true)
    expect(findAction('loadModel')).toBeUndefined()
  })
})

describe('VoiceEngine Android platform branches', () => {
  const RN = require('react-native')
  const originalOS = RN.Platform.OS
  const FILES_DIR = '/data/user/0/app/files'
  const ANDROID_MODEL_PATH = `${FILES_DIR}/models/whisper/ggml-base.en.bin`
  // Each voice gets its own extraction root, so the resolved path depends on destSubdir.
  const ttsRoot = (voice: string) => `${FILES_DIR}/sherpa/tts/${voice}`
  let prepareModel: jest.Mock
  let prepareArchive: jest.Mock
  let initializeSdk: jest.Mock
  let checkPermission: jest.SpyInstance
  let enableCommunicationRoute: jest.Mock
  let disableCommunicationRoute: jest.Mock
  /** Whether the engine had already been told to start when the route was entered. */
  let startSentBeforeRoute: boolean | null

  const sttLoadCalls = () =>
    sentCalls().filter(
      (c) =>
        c.method === 'callAction' &&
        c.params?.actionName === 'loadModel' &&
        c.params?.objectURI === 'sttNode'
    )

  const ttsLoadCall = () =>
    sentCalls().find(
      (c) =>
        c.method === 'callAction' &&
        c.params?.actionName === 'loadModel' &&
        c.params?.objectURI === 'ttsNode'
    )

  beforeEach(() => {
    prepareModel = jest.fn().mockResolvedValue(ANDROID_MODEL_PATH)
    prepareArchive = jest.fn((_zip: string, dest: string) =>
      Promise.resolve(`${FILES_DIR}/${dest}`)
    )
    initializeSdk = jest.fn().mockResolvedValue(null)
    RN.NativeModules.EdgeSpeechModels = { prepareModel, prepareArchive, initializeSdk }
    startSentBeforeRoute = null
    enableCommunicationRoute = jest.fn(async () => {
      startSentBeforeRoute = findAction('start') !== undefined
    })
    disableCommunicationRoute = jest.fn().mockResolvedValue(null)
    RN.NativeModules.EdgeSpeechAudioSession = {
      enableCommunicationRoute,
      disableCommunicationRoute,
    }
    // Mic-permission gate: default to granted so the existing listen/speak tests pass.
    checkPermission = jest.spyOn(RN.PermissionsAndroid, 'check').mockResolvedValue(true)
  })

  afterEach(() => {
    RN.Platform.OS = originalOS
    delete RN.NativeModules.EdgeSpeechModels
    delete RN.NativeModules.EdgeSpeechAudioSession
    jest.restoreAllMocks()
  })

  it("holds 'initializing' until the model staging settles", async () => {
    RN.Platform.OS = 'android'
    // Park the staging so the window between the Kotlin init and a ready model — the
    // one 'initializing' exists to describe — can be observed.
    let finishStaging: (path: string) => void = () => {}
    prepareModel.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishStaging = resolve
      })
    )
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    const init = voiceEngine.initialize('app-id', 'app-secret')
    await new Promise<void>((resolve) => setImmediate(() => resolve()))
    expect(voiceEngine.currentState).toBe('initializing')
    expect(states).toEqual(['initializing'])

    finishStaging(ANDROID_MODEL_PATH)
    await init

    expect(states).toEqual(['initializing', 'idle'])
    expect(voiceEngine.currentState).toBe('idle')
  })

  it("defers a listen() issued during 'initializing' rather than rejecting it", async () => {
    RN.Platform.OS = 'android'
    let finishStaging: (path: string) => void = () => {}
    prepareModel.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishStaging = resolve
      })
    )
    const states: string[] = []
    voiceEngine.addListener('onStateChange', ({ state }) => states.push(state))

    voiceEngine.initialize('app-id', 'app-secret')
    const listening = voiceEngine.listen()
    await new Promise<void>((resolve) => setImmediate(() => resolve()))
    // Parked on the init chain: no engine built, no mic opened, and no rejection.
    expect(findAction('createEngine')).toBeUndefined()
    expect(states).toEqual(['initializing'])

    finishStaging(ANDROID_MODEL_PATH)
    await listening

    // 'listening' comes after the settle, never clobbered by it — listen() awaits the
    // same promise the settle is chained onto.
    expect(states).toEqual(['initializing', 'idle', 'listening'])
    expect(voiceEngine.currentState).toBe('listening')
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

  it('omits initializeModel on Android — the model is loaded by path instead', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    const create = findAction('createEngine')!
    const sttNode = create.params.params.config.graph.nodes.find((n: any) => n.id === 'sttNode')
    expect(sttNode.config.initializeModel).toBeUndefined()
  })

  it('opens the mic as voice-communication on Android (AEC input preset)', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    // 7 = oboe InputPreset.VoiceCommunication. An Oboe stream parameter, so it has
    // to be in the creation config — it cannot be applied later.
    expect(findAction('createEngine')!.params.params.config.inputPreset).toBe(7)
  })

  it('does not send an inputPreset on iOS (no Oboe; VoiceProcessingIO covers AEC)', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(findAction('createEngine')!.params.params.config.inputPreset).toBeUndefined()
  })

  it('enters the communication route BEFORE the engine opens its streams', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(enableCommunicationRoute).toHaveBeenCalledTimes(1)
    // The whole point: MODE_IN_COMMUNICATION has to be set before the mic stream
    // opens, or the hardware AEC isn't engaged for it.
    expect(startSentBeforeRoute).toBe(false)
    expect(findAction('start')).toBeDefined()
  })

  it('enters the communication route for speak() too (TTS needs AEC for barge-in)', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('hello')

    expect(enableCommunicationRoute).toHaveBeenCalledTimes(1)
    expect(startSentBeforeRoute).toBe(false)
  })

  it('restores the route on stopListening, only after the graph is down', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()
    expect(disableCommunicationRoute).not.toHaveBeenCalled()

    await voiceEngine.stopListening()

    expect(disableCommunicationRoute).toHaveBeenCalledTimes(1)
    expect(findAction('stop')).toBeDefined()
  })

  it('keeps the comm route while only TTS stops — the engine is still listening', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('hello')
    await voiceEngine.stopSpeaking()

    expect(disableCommunicationRoute).not.toHaveBeenCalled()
  })

  it('a refused route change degrades AEC but does not fail listen()', async () => {
    RN.Platform.OS = 'android'
    enableCommunicationRoute.mockRejectedValue(new Error('audio_session_error'))
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.listen()).resolves.toBeUndefined()
    expect(findAction('start')).toBeDefined()
  })

  it('survives an app without the audio-session module registered', async () => {
    RN.Platform.OS = 'android'
    delete RN.NativeModules.EdgeSpeechAudioSession
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.listen()).resolves.toBeUndefined()
    await expect(voiceEngine.stopListening()).resolves.toBeUndefined()
  })

  it('never touches the audio session on iOS (the SDK owns it)', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()
    await voiceEngine.stopListening()

    expect(enableCommunicationRoute).not.toHaveBeenCalled()
    expect(disableCommunicationRoute).not.toHaveBeenCalled()
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

  it('ignores a configure() after the engine is built — models are chosen once', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('hello')
    const loadsBefore = countAction('loadModel')

    // Configure-once by design: the nodes load their models when the engine is
    // built, so a later change must not half-apply (new path resolved, node still
    // on the old model). Nothing reloads, and nothing is re-resolved.
    voiceEngine.configure({ sttModel: 'whisper-tiny-en', ttsVoice: 'de_DE' })
    await voiceEngine.speak('again')

    expect(countAction('loadModel')).toBe(loadsBefore)
    expect(prepareModel).toHaveBeenCalledTimes(1)
    expect(prepareArchive).toHaveBeenCalledTimes(1)
  })

  it('keeps the voice staged at initialize() when configure() changes it later', async () => {
    RN.Platform.OS = 'android'
    // Fixed for the session, as on iOS: only the staged voice's files exist on disk, so
    // honouring the change would point loadModel at files that were never extracted.
    await voiceEngine.initialize('app-id', 'app-secret')
    voiceEngine.configure({ ttsVoice: 'de_DE' })
    await voiceEngine.speak('hallo')

    expect(prepareArchive).toHaveBeenCalledTimes(1)
    expect(prepareArchive).toHaveBeenCalledWith('models/sherpa/tts/en_GB.zip', 'sherpa/tts/en_GB')
    expect(ttsLoadCall()!.params.params.modelPath).toContain('en_GB-southern_english_female-low')
  })

  it('discards the engine when Whisper loadModel fails, so a retry reloads it', async () => {
    RN.Platform.OS = 'android'
    // engineId is assigned before the model loads. If a failed load left it set, the next
    // listen() would skip createEngine() — and start a graph whose sttNode has no model,
    // which transcribes nothing and reports no error.
    let failNextLoad = true
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, method, params } = JSON.parse(cmd)
      if (method === 'callAction' && params?.actionName === 'createEngine') {
        return JSON.stringify({ jsonrpc: '2.0', id, result: 'engine_1' })
      }
      if (params?.actionName === 'loadModel' && params?.objectURI === 'sttNode' && failNextLoad) {
        failNextLoad = false
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'bad model file' },
        })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })

    voiceEngine.initialize('app-id', 'app-secret')
    await expect(voiceEngine.listen()).rejects.toMatchObject({ code: 'MODEL_LOAD_FAILED' })
    expect(findAction('start')).toBeUndefined()

    await voiceEngine.listen()

    expect(countAction('createEngine')).toBe(2)
    expect(sttLoadCalls()).toHaveLength(2)
    expect(findAction('start')).toBeDefined()
  })

  it('gives the communication route back when the engine fails to start', async () => {
    RN.Platform.OS = 'android'
    // Prep entered the route before this point. stopListening() early-returns while
    // isListening is false, so a leak here leaves the app in MODE_IN_COMMUNICATION
    // with nothing the caller can do about it.
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, method, params } = JSON.parse(cmd)
      if (method === 'callAction' && params?.actionName === 'createEngine') {
        return JSON.stringify({ jsonrpc: '2.0', id, result: 'engine_1' })
      }
      if (params?.actionName === 'start') {
        return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'no mic' } })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })

    voiceEngine.initialize('app-id', 'app-secret')
    await expect(voiceEngine.listen()).rejects.toMatchObject({ code: 'LISTEN_FAILED' })

    expect(disableCommunicationRoute).toHaveBeenCalled()
  })

  it('gives the communication route back when the TTS voice fails to load', async () => {
    RN.Platform.OS = 'android'
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, method, params } = JSON.parse(cmd)
      if (method === 'callAction' && params?.actionName === 'createEngine') {
        return JSON.stringify({ jsonrpc: '2.0', id, result: 'engine_1' })
      }
      if (params?.actionName === 'loadModel' && params?.objectURI === 'ttsNode') {
        return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'bad voice' } })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })

    voiceEngine.initialize('app-id', 'app-secret')
    await expect(voiceEngine.speak('hello')).rejects.toMatchObject({
      code: 'TTS_MODEL_LOAD_FAILED',
    })

    expect(disableCommunicationRoute).toHaveBeenCalled()
    expect(findAction('start')).toBeUndefined()
  })

  it('keeps the route when a failed speak() leaves a listening session running', async () => {
    RN.Platform.OS = 'android'
    native.default.processCommand.mockImplementation((cmd: string) => {
      const { id, method, params } = JSON.parse(cmd)
      if (method === 'callAction' && params?.actionName === 'createEngine') {
        return JSON.stringify({ jsonrpc: '2.0', id, result: 'engine_1' })
      }
      if (params?.actionName === 'synthesize') {
        return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'busy' } })
      }
      return JSON.stringify({ jsonrpc: '2.0', id, result: null })
    })

    const states: string[] = []
    voiceEngine.addListener('onStateChange', (e) => states.push(e.state))
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()
    await expect(voiceEngine.speak('hello')).rejects.toMatchObject({ code: 'SPEAK_FAILED' })

    // The mic is still open and the graph still running — it needs the route.
    expect(disableCommunicationRoute).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe('listening')
    expect(countAction('stop')).toBe(0)
  })

  it('rejects an unknown sttModel, without opening the mic', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    // Only the models with an asset mapping resolve, so asking for another fails
    // loudly rather than silently using base.
    voiceEngine.configure({ sttModel: 'whisper-small-en' })

    await expect(voiceEngine.listen()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
    expect(prepareModel).not.toHaveBeenCalled()
    expect(findAction('start')).toBeUndefined()
  })

  it('stages and loads the tiny model when sttModel selects it', async () => {
    RN.Platform.OS = 'android'
    const tinyPath = `${FILES_DIR}/models/whisper/ggml-tiny.en.bin`
    prepareModel.mockResolvedValue(tinyPath)
    voiceEngine.configure({ sttModel: 'whisper-tiny-en' })
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(prepareModel).toHaveBeenCalledWith('models/whisper/ggml-tiny.en.bin')
    expect(findAction('loadModel')!.params.params.modelPath).toBe(tinyPath)
  })

  it('reports a known sttModel whose asset was left out of the build', async () => {
    RN.Platform.OS = 'android'
    // The default Gradle download set carries base only, so a build that never opted
    // tiny in has no such asset. The fix is a build change — say so, and say how.
    const missing = Object.assign(new Error('Model asset is not bundled in this build.'), {
      code: 'model_asset_missing',
    })
    prepareModel.mockRejectedValue(missing)
    voiceEngine.configure({ sttModel: 'whisper-tiny-en' })
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.listen()).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      message: expect.stringContaining('edgespeechModels'),
    })
    expect(findAction('start')).toBeUndefined()
  })

  it('rejects with the init cause when the native models module is missing', async () => {
    RN.Platform.OS = 'android'
    delete RN.NativeModules.EdgeSpeechModels
    const errors: Array<{ code: string; message: string }> = []
    voiceEngine.addListener('onError', (e) => errors.push(e))

    voiceEngine.initialize('app-id', 'app-secret')

    expect(errors).toEqual([
      { code: 'INIT_FAILED', message: 'EdgeSpeechModels native module is unavailable.' },
    ])
    await expect(voiceEngine.listen()).rejects.toThrow(/EdgeSpeechModels native module/i)
  })

  it('a failed Kotlin init leaves the engine uninitialized — listen() rejects, no engine', async () => {
    RN.Platform.OS = 'android'
    initializeSdk.mockRejectedValue(new Error('bad credentials'))
    const errors: Array<{ code: string; message: string }> = []
    voiceEngine.addListener('onError', (e) => errors.push(e))

    // initialize() is sync and can't await the Kotlin call, so the failure only
    // lands once listen() awaits it — it must not build a graph on a dead SDK.
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.listen()).rejects.toMatchObject({
      code: 'NOT_INITIALIZED',
      message: expect.stringContaining('bad credentials'),
    })
    expect(errors).toEqual([{ code: 'INIT_FAILED', message: 'bad credentials' }])
    expect(findAction('createEngine')).toBeUndefined()
    expect(prepareModel).not.toHaveBeenCalled()
  })

  it('a failed Kotlin init also blocks speak()', async () => {
    RN.Platform.OS = 'android'
    initializeSdk.mockRejectedValue(new Error('bad credentials'))
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.speak('hello')).rejects.toMatchObject({ code: 'NOT_INITIALIZED' })
    expect(findAction('createEngine')).toBeUndefined()
  })

  it('initialize() can retry after a failed Kotlin init', async () => {
    RN.Platform.OS = 'android'
    initializeSdk.mockRejectedValueOnce(new Error('transient failure'))
    voiceEngine.initialize('app-id', 'app-secret')
    await expect(voiceEngine.listen()).rejects.toMatchObject({ code: 'NOT_INITIALIZED' })

    // The failure cleared isInitialized, so a second initialize() is not a no-op.
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(initializeSdk).toHaveBeenCalledTimes(2)
    expect(findAction('createEngine')).toBeDefined()
  })

  it('treats a Kotlin "already initialized" reload as success', async () => {
    RN.Platform.OS = 'android'
    initializeSdk.mockRejectedValue(new Error('Switchboard has already been initialized'))
    const errors: unknown[] = []
    voiceEngine.addListener('onError', (e) => errors.push(e))

    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(errors).toEqual([])
    expect(findAction('createEngine')).toBeDefined()
  })

  it('stages the model files during initialize(), before any listen()/speak()', async () => {
    RN.Platform.OS = 'android'
    await voiceEngine.initialize('app-id', 'app-secret')

    expect(prepareModel).toHaveBeenCalledWith('models/whisper/ggml-base.en.bin')
    expect(prepareArchive).toHaveBeenCalledWith('models/sherpa/tts/en_GB.zip', 'sherpa/tts/en_GB')
    // Staging only materializes the files — the engine is untouched until listen().
    expect(findAction('createEngine')).toBeUndefined()
  })

  it('stages nothing on iOS', async () => {
    RN.Platform.OS = 'ios'
    await voiceEngine.initialize('app-id', 'app-secret')

    expect(prepareModel).not.toHaveBeenCalled()
    expect(prepareArchive).not.toHaveBeenCalled()
  })

  it('retries a staging failure from init on the next listen()', async () => {
    RN.Platform.OS = 'android'
    prepareModel.mockRejectedValueOnce(new Error('no space left'))
    await voiceEngine.initialize('app-id', 'app-secret')

    await voiceEngine.listen()
    expect(prepareModel).toHaveBeenCalledTimes(2)
    expect(findAction('createEngine')).toBeDefined()
  })

  it('surfaces a staging failure that persists — init itself stays quiet', async () => {
    RN.Platform.OS = 'android'
    prepareModel.mockRejectedValue(new Error('no space left'))
    const errors: unknown[] = []
    voiceEngine.addListener('onError', (e) => errors.push(e))
    await voiceEngine.initialize('app-id', 'app-secret')

    expect(errors).toEqual([])
    await expect(voiceEngine.listen()).rejects.toMatchObject({ code: 'MODEL_LOAD_FAILED' })
    expect(findAction('createEngine')).toBeUndefined()
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

    expect(prepareArchive).toHaveBeenCalledWith('models/sherpa/tts/en_GB.zip', 'sherpa/tts/en_GB')
    const load = ttsLoadCall()!
    const v = 'en_GB/vits-piper-en_GB-southern_english_female-low'
    expect(load.params.params.modelPath).toBe(
      `${ttsRoot('en_GB')}/${v}/en_GB-southern_english_female-low.with_runtime_opt.ort`
    )
    expect(load.params.params.tokensPath).toBe(`${ttsRoot('en_GB')}/${v}/tokens.txt`)
    expect(load.params.params.dataPath).toBe(`${ttsRoot('en_GB')}/${v}/espeak-ng-data`)
  })

  it('selects the de_DE voice zip when ttsVoice is de_DE', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    voiceEngine.configure({ ttsVoice: 'de_DE' })
    await voiceEngine.speak('hallo')

    expect(prepareArchive).toHaveBeenCalledWith('models/sherpa/tts/de_DE.zip', 'sherpa/tts/de_DE')
    expect(ttsLoadCall()!.params.params.modelPath).toContain('de_DE-thorsten-low.with_runtime_opt.ort')
  })

  it('does not load a TTS voice on iOS', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.speak('hello')

    expect(prepareArchive).not.toHaveBeenCalled()
    expect(ttsLoadCall()).toBeUndefined()
  })

  // The Android prep suspends before the engine is touched, so these cover what
  // that window can do: two taps racing, and a Stop landing inside it.

  it('two concurrent listen() calls start the engine exactly once', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')

    await Promise.all([voiceEngine.listen(), voiceEngine.listen()])

    // Both calls clear the async prep, then the first runs its await-free stretch to
    // completion (isListening = true) before the second is scheduled.
    expect(countAction('createEngine')).toBe(1)
    expect(countAction('start')).toBe(1)
  })

  it('two concurrent speak() calls start the engine and load the voice once', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')

    await Promise.all([voiceEngine.speak('one'), voiceEngine.speak('two')])

    expect(countAction('start')).toBe(1)
    expect(countAction('loadModel')).toBe(2) // sttNode + ttsNode, once each
    expect(countAction('synthesize')).toBe(2) // both utterances still queued
  })

  /** Park every enableCommunicationRoute() call — the last await in the Android prep. */
  const parkRouteEntry = () => {
    const parked: Array<() => void> = []
    let announce: (n: number) => void = () => {}
    const reached = (n: number) =>
      new Promise<void>((resolve) => {
        announce = (count) => {
          if (count >= n) resolve()
        }
      })
    enableCommunicationRoute.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          parked.push(resolve)
          announce(parked.length)
        })
    )
    return { release: () => parked.forEach((r) => r()), reached }
  }

  it('a stopListening() during the prep cancels every pending start, not just the first', async () => {
    RN.Platform.OS = 'android'
    // The cancel has to reach both waiters. Consuming a single shared flag cancels
    // whichever resumes first and lets the other open the mic after the stop.
    const route = parkRouteEntry()
    const bothParked = route.reached(2)
    voiceEngine.initialize('app-id', 'app-secret')

    const first = voiceEngine.listen()
    const second = voiceEngine.listen()
    await bothParked
    await voiceEngine.stopListening()
    route.release()
    await Promise.all([first, second])

    expect(findAction('createEngine')).toBeUndefined()
    expect(findAction('start')).toBeUndefined()
  })

  it('a stopListening() cancels a start still in prep while a session is running', async () => {
    RN.Platform.OS = 'android'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    // This stop takes the real branch — there is an engine to stop — so it never
    // recorded an intent for the in-flight start, which then restarted the mic.
    const route = parkRouteEntry()
    const parked = route.reached(1)
    const pending = voiceEngine.listen()
    await parked
    await voiceEngine.stopListening()
    route.release()
    await pending

    expect(countAction('start')).toBe(1)
  })

  it('a stopListening() during the Android prep cancels the pending listen()', async () => {
    RN.Platform.OS = 'android'
    // Park the prep on the model copy, and signal when it gets there — the test has
    // to wait for that, not just for a microtask tick.
    let releaseModel: (path: string) => void = () => {}
    let announceModelStep: () => void = () => {}
    const reachedModelStep = new Promise<void>((resolve) => {
      announceModelStep = resolve
    })
    prepareModel.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseModel = resolve
          announceModelStep()
        })
    )
    voiceEngine.initialize('app-id', 'app-secret')

    const pending = voiceEngine.listen()
    await reachedModelStep
    // No engine exists yet, so this cannot stop anything — it records the intent.
    await voiceEngine.stopListening()
    releaseModel(ANDROID_MODEL_PATH)
    await pending

    // The user asked for it to stop before it ever started: no mic.
    expect(findAction('createEngine')).toBeUndefined()
    expect(findAction('start')).toBeUndefined()
    // And the route the prep took is handed back.
    expect(disableCommunicationRoute).toHaveBeenCalledTimes(1)

    // The request is spent — the next listen() starts normally (the model path
    // resolved before the cancel, so it is already cached).
    await voiceEngine.listen()
    expect(findAction('start')).toBeDefined()
  })

  it('listen() runs start-to-finish synchronously on iOS (as it did before Android)', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')

    const pending = voiceEngine.listen() // deliberately not awaited

    // No await ran, so the engine is already up: iOS never sees the prep window,
    // which is what keeps it byte-for-byte on its pre-Android behaviour.
    expect(findAction('createEngine')).toBeDefined()
    expect(findAction('start')).toBeDefined()
    await pending
  })

  it('speak() runs start-to-finish synchronously on iOS', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')

    const pending = voiceEngine.speak('hello')

    expect(findAction('synthesize')).toBeDefined()
    await pending
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

  it('listen() throws PERMISSION_DENIED and never opens the mic when RECORD_AUDIO is not granted', async () => {
    RN.Platform.OS = 'android'
    checkPermission.mockResolvedValue(false)
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.listen()).rejects.toThrow(/permission/i)
    expect(checkPermission).toHaveBeenCalledWith(RN.PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    // Gate fires before the engine is created/started — the SDK never opens the mic.
    expect(findAction('createEngine')).toBeUndefined()
    expect(findAction('start')).toBeUndefined()
  })

  it('speak() throws PERMISSION_DENIED when RECORD_AUDIO is not granted (combined mic+AEC engine)', async () => {
    RN.Platform.OS = 'android'
    checkPermission.mockResolvedValue(false)
    voiceEngine.initialize('app-id', 'app-secret')

    await expect(voiceEngine.speak('hello')).rejects.toThrow(/permission/i)
    expect(findAction('start')).toBeUndefined()
    expect(findAction('synthesize')).toBeUndefined()
  })

  it('does not gate on PermissionsAndroid.check on iOS (the OS handles a missing grant)', async () => {
    RN.Platform.OS = 'ios'
    voiceEngine.initialize('app-id', 'app-secret')
    await voiceEngine.listen()

    expect(checkPermission).not.toHaveBeenCalled()
    expect(findAction('start')).toBeDefined()
  })
})
