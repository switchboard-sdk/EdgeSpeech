package com.synervoz.edgespeech

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.synervoz.switchboard.sdk.Switchboard
import java.io.BufferedInputStream
import java.io.File
import java.io.FileNotFoundException
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

  /** Copy asset [assetPath] to filesDir (only if missing/size-changed) and resolve its path. */
  @ReactMethod
  fun prepareModel(assetPath: String, promise: Promise) {
    try {
      val assets = reactContext.assets
      val dest = File(reactContext.filesDir, assetPath)

      // Cheap up-to-date check via the asset's real size. openFd().length only works
      // on uncompressed assets — the .bin is compressed in the APK, so this usually
      // throws and we fall back to an existence check (see catch below).
      val assetSize: Long =
        try {
          assets.openFd(assetPath).use { it.length }
        } catch (e: Exception) {
          -1L // compressed / unknown — fall back to an existence check
        }

      if (dest.exists() && (assetSize < 0L || dest.length() == assetSize)) {
        promise.resolve(dest.absolutePath)
        return
      }

      dest.parentFile?.mkdirs()
      assets.open(assetPath).use { input ->
        dest.outputStream().use { output -> input.copyTo(output, 1 shl 16) }
      }
      promise.resolve(dest.absolutePath)
    } catch (e: FileNotFoundException) {
      // The asset isn't in the APK — the app configured a model outside the set the
      // build downloaded. Its own code so JS can tell it from a genuine copy failure.
      promise.reject(
        "model_asset_missing",
        "Model asset '$assetPath' is not bundled in this build.",
        e,
      )
    } catch (e: Exception) {
      promise.reject(
        "model_prepare_error",
        "Failed to prepare model asset '$assetPath': ${e.message}",
        e,
      )
    }
  }

  /** Extract zip asset [assetZipPath] into filesDir/[destSubdir] once (`.extracted` marker); resolve that dir. Used for multi-file models (Sherpa TTS voice). */
  @ReactMethod
  fun prepareArchive(assetZipPath: String, destSubdir: String, promise: Promise) {
    try {
      val destRoot = File(reactContext.filesDir, destSubdir)
      val marker = File(destRoot, ".extracted")
      if (marker.exists()) {
        promise.resolve(destRoot.absolutePath)
        return
      }
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
      promise.resolve(destRoot.absolutePath)
    } catch (e: Exception) {
      promise.reject("model_archive_error", "Failed to extract '$assetZipPath': ${e.message}", e)
    }
  }

  companion object {
    const val NAME = "EdgeSpeechModels"
  }
}
