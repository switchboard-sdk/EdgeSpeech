package com.synervoz.edgespeech

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Materializes bundled model assets to a real filesystem path.
 *
 * The Switchboard Whisper (and Sherpa) nodes load models from an absolute file
 * path — and whisper.cpp cannot read from inside the APK's `assets/`. The models
 * are bundled into `assets/` by `scripts/download-android-models.js`; this module
 * copies the requested asset into the app's filesDir on first use and returns its
 * absolute path, which `VoiceEngine.ts` injects into the STT node's `modelPath`.
 * Android-only — on iOS the models ship inside the SDK framework.
 */
class EdgeSpeechModelsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  /**
   * Ensure the asset at [assetPath] exists on disk under filesDir and resolve its
   * absolute path. Copies only when missing or a different size, so the ~141 MB
   * base model is not rewritten on every launch.
   */
  @ReactMethod
  fun prepareModel(assetPath: String, promise: Promise) {
    try {
      val assets = reactContext.assets
      val dest = File(reactContext.filesDir, assetPath)

      // Uncompressed asset (app build sets androidResources.noCompress += 'bin'):
      // openFd().length gives the real size for a cheap up-to-date check.
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
    } catch (e: Exception) {
      promise.reject(
        "model_prepare_error",
        "Failed to prepare model asset '$assetPath': ${e.message}",
        e,
      )
    }
  }

  companion object {
    const val NAME = "EdgeSpeechModels"
  }
}
