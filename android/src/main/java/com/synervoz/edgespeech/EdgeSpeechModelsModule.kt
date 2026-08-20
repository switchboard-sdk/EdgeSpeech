package com.synervoz.edgespeech

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.synervoz.switchboard.sdk.Switchboard
import java.io.BufferedInputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.util.zip.ZipInputStream
import org.json.JSONObject

/**
 * Materializes bundled model assets to a real filesDir path — the Switchboard
 * nodes load models by file path and can't read inside the APK's `assets/`.
 * Android-only; iOS ships models in the SDK framework.
 */
class EdgeSpeechModelsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  /**
   * Init the SDK via Kotlin so it registers its PlatformInfoProvider from the Context
   * — that's what gives Whisper the native-lib dir for its ggml backends (the C++
   * JSON-RPC init has no Context). Requires extractNativeLibs=true.
   */
  @ReactMethod
  fun initializeSdk(appId: String, appSecret: String, extensionsJson: String, promise: Promise) {
    try {
      val extObj = JSONObject(extensionsJson)
      val extensions = HashMap<String, Any>()
      val keys = extObj.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        extensions[key] = emptyMap<String, Any>()
      }
      val result = Switchboard.initialize(reactContext.applicationContext, appId, appSecret, extensions)
      // Treat "already initialized" (JS bundle reloads) as success.
      if (result.isSuccess || result.error?.contains("already", ignoreCase = true) == true) {
        promise.resolve(null)
      } else {
        promise.reject("init_failed", result.error ?: "Switchboard SDK initialize failed")
      }
    } catch (t: Throwable) {
      promise.reject("init_error", t.message, t)
    }
  }

  /**
   * Stage the on-device models and resolve the paths the Switchboard nodes load by.
   * One call rather than one per asset: they are always needed together, and this is the
   * side that knows where they live inside the APK.
   *
   * [includeTts] extracts the TTS voice too (~82 MB). A listen()-only session doesn't
   * need it, so it isn't paid for until the first speak().
   *
   * Resolves `{ sttModelPath, ttsModelPath?, ttsTokensPath?, ttsDataPath? }`. Rejects
   * with `model_asset_missing` when the build never downloaded an asset, and with
   * `model_prepare_error` / `model_archive_error` for genuine copy failures — JS maps
   * those codes onto its own error codes.
   */
  @ReactMethod
  fun prepareAssets(includeTts: Boolean, promise: Promise) {
    try {
      val result = Arguments.createMap()
      result.putString("sttModelPath", copyAsset(WHISPER_MODEL_ASSET))
      if (includeTts) {
        val root = extractArchive(TTS_ZIP_ASSET, TTS_EXTRACT_DIR)
        val dir = "$root/$TTS_VOICE_DIR"
        result.putString("ttsModelPath", "$dir/$TTS_MODEL_FILE")
        result.putString("ttsTokensPath", "$dir/tokens.txt")
        result.putString("ttsDataPath", "$dir/espeak-ng-data")
      }
      promise.resolve(result)
    } catch (e: FileNotFoundException) {
      // The asset isn't in the APK — the build never ran (or stripped) the model
      // download. Its own code so JS can tell it from a genuine copy failure.
      promise.reject(
        "model_asset_missing",
        "Model asset is not bundled in this build: ${e.message}",
        e,
      )
    } catch (e: ArchiveException) {
      promise.reject("model_archive_error", e.message, e)
    } catch (e: Exception) {
      promise.reject("model_prepare_error", "Failed to prepare model assets: ${e.message}", e)
    }
  }

  /** Copy asset [assetPath] to filesDir (only if missing/changed) and return its path. */
  private fun copyAsset(assetPath: String): String {
    val assets = reactContext.assets
    val dest = File(reactContext.filesDir, assetPath)
    val stamp = File(dest.parentFile, "${dest.name}.stamp")

    // available() is the asset's length without inflating it (openFd() only works on
    // uncompressed assets, and the .bin is compressed in the APK). We compare it to the
    // value recorded by the copy that produced dest, so what the number *means* doesn't
    // matter — only that the same asset always reports the same one. A shipped model
    // that changes reports a different one and is re-copied.
    val assetSize = assets.open(assetPath).use { it.available().toLong() }

    val stamped = if (stamp.exists()) stamp.readText().trim() else null
    if (dest.exists() && stamped == assetSize.toString()) {
      return dest.absolutePath
    }

    // Copy to a sidecar and rename. Process death or a full disk mid-copy then leaves
    // a .part to overwrite and no stamp, rather than a truncated model that every later
    // launch treats as valid. The stamp lands last, so it only describes a finished copy.
    dest.parentFile?.mkdirs()
    val part = File(dest.parentFile, "${dest.name}.part")
    assets.open(assetPath).use { input ->
      part.outputStream().use { output -> input.copyTo(output, 1 shl 16) }
    }
    if (!part.renameTo(dest)) {
      throw IOException("Could not move ${part.name} into place")
    }
    stamp.writeText(assetSize.toString())
    return dest.absolutePath
  }

  /**
   * Extract zip asset [assetZipPath] into filesDir/[destSubdir] once (`.extracted`
   * marker) and return that dir. Used for multi-file models (the Sherpa TTS voice).
   */
  private fun extractArchive(assetZipPath: String, destSubdir: String): String {
    val destRoot = File(reactContext.filesDir, destSubdir)
    val marker = File(destRoot, ".extracted")
    if (marker.exists()) {
      return destRoot.absolutePath
    }
    try {
      destRoot.mkdirs()
      val canonicalRoot = destRoot.canonicalPath
      reactContext.assets.open(assetZipPath).use { raw ->
        ZipInputStream(BufferedInputStream(raw)).use { zin ->
          var entry = zin.nextEntry
          while (entry != null) {
            val outFile = File(destRoot, entry.name)
            // Zip-slip guard: reject entries resolving outside destRoot.
            if (outFile.canonicalPath != canonicalRoot &&
              !outFile.canonicalPath.startsWith(canonicalRoot + File.separator)
            ) {
              throw SecurityException("Zip entry escapes target dir: ${entry.name}")
            }
            if (entry.isDirectory) {
              outFile.mkdirs()
            } else {
              outFile.parentFile?.mkdirs()
              outFile.outputStream().use { zin.copyTo(it, 1 shl 16) }
            }
            zin.closeEntry()
            entry = zin.nextEntry
          }
        }
      }
      marker.writeText("ok")
    } catch (e: FileNotFoundException) {
      throw e // the zip isn't in the build — reported as model_asset_missing
    } catch (e: Exception) {
      throw ArchiveException("Failed to extract '$assetZipPath': ${e.message}", e)
    }
    return destRoot.absolutePath
  }

  /** An extraction failure, so prepareAssets can tell it from a model copy failure. */
  private class ArchiveException(message: String?, cause: Throwable) : Exception(message, cause)

  companion object {
    const val NAME = "EdgeSpeechModels"

    // Where the models live inside the APK, and where their files sit once extracted.
    // Kept in step with android/build.gradle's download list; the JS side never sees
    // these paths, only the resolved filesDir ones.
    private const val WHISPER_MODEL_ASSET = "models/whisper/ggml-base.en.bin"
    private const val TTS_ZIP_ASSET = "models/sherpa/tts/en_GB.zip"
    private const val TTS_EXTRACT_DIR = "sherpa/tts/en_GB"
    private const val TTS_VOICE_DIR = "en_GB/vits-piper-en_GB-southern_english_female-low"
    private const val TTS_MODEL_FILE = "en_GB-southern_english_female-low.with_runtime_opt.ort"
  }
}
