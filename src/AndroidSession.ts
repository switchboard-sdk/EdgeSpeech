import { PermissionsAndroid, NativeModules } from 'react-native'
import { makeError } from './errors'

/**
 * Everything Android has to do that iOS doesn't, kept out of {@link VoiceEngine} so the
 * engine reads as one platform-neutral pipeline. iOS has no counterpart to this class —
 * there, the engine simply has no session, and the `this.android?.` calls no-op.
 *
 * The asymmetry has a single cause: the iOS xcframeworks bake the models in and the
 * Android AARs bundle nothing. So Android does at runtime — copy the Whisper model out
 * of APK assets, unzip the Sherpa voice, load both by path — what iOS gets for free at
 * link time. Android also drives its own audio mode/route (iOS has VoiceProcessingIO)
 * and has to gate on the mic permission, because the SDK segfaults without it.
 *
 * The division of labour: this class stages files and reports where they landed; the
 * engine does all the talking to the audio graph. So there is no RPC access here, and no
 * session state either — that all stays in the engine.
 */

/** The Oboe input preset that, with the communication route, turns on the hardware AEC. */
export const ANDROID_INPUT_PRESET = 7 // oboe InputPreset.VoiceCommunication

// The one Whisper model, as an asset path. iOS reads the identical model from inside
// SwitchboardWhisper.framework, which is why there is nothing to select: the framework
// bundles base.en alone (plus its CoreML encoder), so a second model would be available
// on one platform only. Kept in step with android/build.gradle's model list.
const WHISPER_MODEL_ASSET = 'models/whisper/ggml-base.en.bin'

// The one Sherpa TTS voice: bundled zip, plus the paths inside it. Extracted to filesDir
// once. iOS needs no equivalent — Sherpa.TTS hardcodes "en" in its constructor and loads
// this same voice out of SwitchboardSherpa.framework by itself.
const TTS_VOICE = {
  zipAsset: 'models/sherpa/tts/en_GB.zip',
  extractDir: 'sherpa/tts/en_GB',
  voiceDir: 'en_GB/vits-piper-en_GB-southern_english_female-low',
  modelFile: 'en_GB-southern_english_female-low.with_runtime_opt.ort',
}

export class AndroidSession {
  /** Resolved absolute path to the Whisper model (see ensureModel). */
  private modelPath: string | null = null

  /** filesDir root the TTS voice zip was extracted to (see stageTtsVoice). */
  private ttsDir: string | null = null

  /**
   * Bumped by every cancelPendingStarts(). A start captures it before its first await and
   * aborts if it changed while it ran, so the mic never opens after the user asked it not
   * to. A counter rather than a flag because a flag cancels only whichever waiter
   * consumes it — a second concurrent listen() would see it already cleared and start.
   */
  private stopGeneration = 0

  /**
   * Init via Kotlin (which registers the PlatformInfoProvider → native-lib dir Whisper
   * needs), then stage the model files so the first listen()/speak() isn't stalled by
   * them. Never rejects: a failure goes to `fail`, which the engine turns into onError,
   * and staging is skipped from there.
   *
   * `fail` is a callback rather than a returned message on purpose, and the difference is
   * observable: a missing EdgeSpeechModels module is known *synchronously*, and the engine
   * has to emit onError for it before initialize() returns, as it always has. Returning
   * the message would defer that by a microtask (the engine applies it in a `.then`), so
   * a caller who doesn't await initialize() would miss it. Pinned by "rejects with the
   * init cause when the native models module is missing", which asserts on `errors`
   * immediately after an un-awaited initialize().
   *
   * Staging failures are swallowed: prepareSession() retries them, which is where they
   * can reach a caller.
   */
  async initialize(
    appId: string,
    appSecret: string,
    extensions: object,
    fail: (message: string) => void
  ): Promise<void> {
    const models = NativeModules.EdgeSpeechModels
    if (!models?.initializeSdk) {
      fail('EdgeSpeechModels native module is unavailable.')
      return
    }
    try {
      await models.initializeSdk(appId, appSecret, JSON.stringify(extensions))
    } catch (e) {
      const message = (e as Error)?.message ?? String(e)
      // A repeat init after a JS bundle reload counts as success.
      if (!/already.*initialized/i.test(message)) {
        fail(message)
        return
      }
    }
    try {
      await this.ensureModel()
      await this.stageTtsVoice()
    } catch {
      // Retried on the next listen()/speak(), which is where it reaches the caller.
    }
  }

  /**
   * All the async setup a start needs. `awaitInit` blocks until initialization has
   * settled and throws if it failed; it runs in here, after the cancellation point is
   * captured, so a stop landing during init still cancels the start.
   *
   * Returns true if a stop landed while it ran, in which case the caller must abort — it
   * also gives the route back, since nothing is going to use it.
   */
  async prepareSession(stageTtsVoice: boolean, awaitInit: () => Promise<void>): Promise<boolean> {
    const generation = this.stopGeneration
    await awaitInit()
    await this.ensureMicPermission()
    await this.ensureModel()
    if (stageTtsVoice) {
      await this.stageTtsVoice()
    }
    await this.enableRoute()

    if (this.stopGeneration === generation) {
      return false
    }
    this.releaseRoute()
    return true
  }

  /** Where the Whisper model was staged, for the engine's sttNode loadModel. */
  get sttModelPath(): string | null {
    return this.modelPath
  }

  /** Where the TTS voice was staged, as the three paths Sherpa's loadModel wants. */
  get ttsVoicePaths(): { modelPath: string; tokensPath: string; dataPath: string } | null {
    if (!this.ttsDir) {
      return null
    }
    const dir = `${this.ttsDir}/${TTS_VOICE.voiceDir}`
    return {
      modelPath: `${dir}/${TTS_VOICE.modelFile}`,
      tokensPath: `${dir}/tokens.txt`,
      dataPath: `${dir}/espeak-ng-data`,
    }
  }

  /** Cancel any start still in its async prep, so the mic never opens after a stop. */
  cancelPendingStarts(): void {
    this.stopGeneration++
  }

  /**
   * Restore the normal audio mode/route. Only once the graph is down — while it runs, the
   * communication route is what keeps AEC engaged.
   */
  releaseRoute(): void {
    NativeModules.EdgeSpeechAudioSession?.disableCommunicationRoute()?.catch(() => {})
  }

  /** Request RECORD_AUDIO from JS — the native mic hook is iOS-only. */
  async requestMicrophonePermission(): Promise<boolean> {
    return (
      (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) ===
      PermissionsAndroid.RESULTS.GRANTED
    )
  }

  /** Copy the Whisper model asset to filesDir (once) and cache its path. */
  private async ensureModel(): Promise<void> {
    if (this.modelPath) {
      return
    }
    const models = NativeModules.EdgeSpeechModels
    if (!models?.prepareModel) {
      throw makeError(
        'MODEL_UNAVAILABLE',
        'EdgeSpeechModels native module is unavailable — cannot resolve the Whisper model path on Android.'
      )
    }
    try {
      this.modelPath = await models.prepareModel(WHISPER_MODEL_ASSET)
    } catch (e) {
      // The asset never made it into the APK — a build that stripped or never ran the
      // model download. Separated from a genuine copy failure (no space, unreadable)
      // because the fix is a build change, not a runtime one.
      if ((e as { code?: string })?.code === 'model_asset_missing') {
        throw makeError(
          'MODEL_UNAVAILABLE',
          `The Whisper model is missing from this build (expected asset ` +
            `'${WHISPER_MODEL_ASSET}'). Rebuild so Gradle's downloadModels task runs.`
        )
      }
      throw makeError(
        'MODEL_LOAD_FAILED',
        `Failed to prepare Whisper model '${WHISPER_MODEL_ASSET}': ${(e as Error)?.message ?? String(e)}`
      )
    }
  }

  /**
   * Extract the TTS voice to filesDir (once) and cache its root. Handing it to the
   * ttsNode is a separate, synchronous step — loadTtsVoice().
   */
  private async stageTtsVoice(): Promise<void> {
    if (this.ttsDir) {
      return
    }
    const models = NativeModules.EdgeSpeechModels
    if (!models?.prepareArchive) {
      throw makeError(
        'TTS_VOICE_UNAVAILABLE',
        'EdgeSpeechModels native module is unavailable — cannot resolve the TTS voice path on Android.'
      )
    }
    try {
      this.ttsDir = await models.prepareArchive(TTS_VOICE.zipAsset, TTS_VOICE.extractDir)
    } catch (e) {
      throw makeError(
        'TTS_MODEL_LOAD_FAILED',
        `Failed to extract TTS voice '${TTS_VOICE.zipAsset}': ${(e as Error)?.message ?? String(e)}`
      )
    }
  }

  /**
   * Fail fast with PERMISSION_DENIED if RECORD_AUDIO isn't granted — the SDK segfaults
   * (AudioEngineOboe::initInputStream) when the engine opens the mic without it. Only
   * checks (never prompts) — call requestMicrophonePermission() first.
   */
  private async ensureMicPermission(): Promise<void> {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    if (!granted) {
      throw makeError(
        'PERMISSION_DENIED',
        'Microphone permission not granted. Call requestMicrophonePermission() before listen() or speak().'
      )
    }
  }

  /**
   * Switch to MODE_IN_COMMUNICATION and route to a headset (else the loudspeaker) before
   * the engine opens its streams — this and the input preset are what turn on the
   * hardware AEC. Failures are ignored; the only cost is weaker echo cancellation.
   */
  private async enableRoute(): Promise<void> {
    try {
      await NativeModules.EdgeSpeechAudioSession?.enableCommunicationRoute()
    } catch {
      // Proceed without the route change; listening and TTS still work.
    }
  }
}
