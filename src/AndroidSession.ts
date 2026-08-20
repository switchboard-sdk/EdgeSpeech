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

/** What Kotlin's prepareAssets() resolves: filesDir paths the Switchboard nodes load by. */
interface StagedAssets {
  sttModelPath: string
  /** Only present when the voice was asked for — see ensureAssets(). */
  ttsModelPath?: string
  ttsTokensPath?: string
  ttsDataPath?: string
}

export class AndroidSession {
  /** Where the staged assets landed, as resolved by Kotlin. Null until first staged. */
  private assets: StagedAssets | null = null

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
      await this.ensureAssets(true)
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
    await this.ensureAssets(stageTtsVoice)
    await this.enableRoute()

    if (this.stopGeneration === generation) {
      return false
    }
    this.releaseRoute()
    return true
  }

  /** Where the Whisper model was staged, for the engine's sttNode loadModel. */
  get sttModelPath(): string | null {
    return this.assets?.sttModelPath ?? null
  }

  /** Where the TTS voice was staged, as the three paths Sherpa's loadModel wants. */
  get ttsVoicePaths(): { modelPath: string; tokensPath: string; dataPath: string } | null {
    const { ttsModelPath, ttsTokensPath, ttsDataPath } = this.assets ?? {}
    if (!ttsModelPath || !ttsTokensPath || !ttsDataPath) {
      return null
    }
    return { modelPath: ttsModelPath, tokensPath: ttsTokensPath, dataPath: ttsDataPath }
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

  /**
   * Stage the models, once. Kotlin owns where they live inside the APK and returns the
   * filesDir paths; this only caches them and maps its error codes onto ours.
   *
   * `includeTts` extracts the ~82 MB voice too. A listen()-only retry doesn't ask for it,
   * so a session that never speaks never pays for it.
   */
  private async ensureAssets(includeTts: boolean): Promise<void> {
    if (this.assets && (!includeTts || this.assets.ttsModelPath)) {
      return
    }
    const models = NativeModules.EdgeSpeechModels
    if (!models?.prepareAssets) {
      throw makeError(
        'MODEL_UNAVAILABLE',
        'EdgeSpeechModels native module is unavailable — cannot stage the models on Android.'
      )
    }
    try {
      this.assets = await models.prepareAssets(includeTts)
    } catch (e) {
      const message = (e as Error)?.message ?? String(e)
      switch ((e as { code?: string })?.code) {
        // An asset that never made it into the APK: a build that stripped or never ran
        // the model download. Separated from a genuine copy failure (no space,
        // unreadable) because the fix is a build change, not a runtime one.
        case 'model_asset_missing':
          throw makeError(
            'MODEL_UNAVAILABLE',
            `${message} Rebuild so Gradle's downloadModels task runs.`
          )
        case 'model_archive_error':
          throw makeError('TTS_MODEL_LOAD_FAILED', message)
        default:
          throw makeError('MODEL_LOAD_FAILED', message)
      }
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
