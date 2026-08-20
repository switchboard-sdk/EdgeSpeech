package com.synervoz.edgespeech

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manages the Android audio session while the engine runs: enters
 * MODE_IN_COMMUNICATION (engages the hardware AEC) and routes to a connected
 * headset, else the built-in loudspeaker
 * (never the earpiece). Called from VoiceEngine.ts on start/stop; needs
 * MODIFY_AUDIO_SETTINGS. Route is fixed at start — no mid-call re-detection.
 * Mode and route are process-wide, so whatever the host app had is captured on
 * enable and restored on disable.
 */
class EdgeSpeechAudioSessionModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  private val audioManager: AudioManager
    get() = reactContext.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  /** What the host app had before we took the route over. Null when we don't hold it. */
  private class SavedAudioState(
    val mode: Int,
    val communicationDevice: AudioDeviceInfo?,
    val speakerphoneOn: Boolean,
    val bluetoothScoOn: Boolean,
  )

  private var savedState: SavedAudioState? = null

  /**
   * Record the host app's audio state, once per acquisition — a second enable must not
   * overwrite it with our own settings.
   */
  @Suppress("DEPRECATION")
  private fun captureAudioState(am: AudioManager) {
    if (savedState != null) {
      return
    }
    val device =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.communicationDevice else null
    savedState = SavedAudioState(am.mode, device, am.isSpeakerphoneOn, am.isBluetoothScoOn)
  }

  /** Enter communication mode; route to a connected headset if present, else the loudspeaker. */
  @ReactMethod
  fun enableCommunicationRoute(promise: Promise) {
    try {
      val am = audioManager
      captureAudioState(am)
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val devices = am.availableCommunicationDevices
        val headset = PREFERRED_HEADSET_TYPES.firstNotNullOfOrNull { type ->
          devices.firstOrNull { it.type == type }
        }
        if (headset != null) {
          selectDeviceAndWait(am, headset, promise) // resolves the promise (async)
        } else {
          // No headset: force the loudspeaker so we don't sit on the earpiece.
          devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            ?.let { am.setCommunicationDevice(it) }
          promise.resolve(null)
        }
      } else {
        routeLegacy(am)
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.reject("audio_session_error", e)
    }
  }

  /**
   * Select [device] and resolve only once the route is active (or times out).
   * Bluetooth SCO connects asynchronously — resolving early would let the engine
   * open its mic stream before capture is ready and silence it.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun selectDeviceAndWait(am: AudioManager, device: AudioDeviceInfo, promise: Promise) {
    if (am.communicationDevice?.id == device.id) {
      promise.resolve(null)
      return
    }
    val done = AtomicBoolean(false)
    val holder = arrayOfNulls<AudioManager.OnCommunicationDeviceChangedListener>(1)
    fun finish() {
      if (done.compareAndSet(false, true)) {
        holder[0]?.let { am.removeOnCommunicationDeviceChangedListener(it) }
        promise.resolve(null)
      }
    }
    val listener = AudioManager.OnCommunicationDeviceChangedListener { active ->
      if (active?.id == device.id) finish()
    }
    holder[0] = listener
    am.addOnCommunicationDeviceChangedListener(Executor { it.run() }, listener)
    if (!am.setCommunicationDevice(device)) {
      finish() // couldn't select it; don't hang the call
      return
    }
    // Safety net: SCO can take up to a couple seconds; don't block start forever.
    Handler(Looper.getMainLooper()).postDelayed({ finish() }, ROUTE_TIMEOUT_MS)
  }

  /**
   * Give the route back, restoring what enableCommunicationRoute() found. Mode and
   * communication device are process-wide, so a hardcoded MODE_NORMAL here would end a
   * call the host app was running alongside us.
   */
  @ReactMethod
  fun disableCommunicationRoute(promise: Promise) {
    try {
      // A stop with no matching start — e.g. the engine failed before the route was
      // entered. Nothing of ours to undo, and the host's state isn't ours to change.
      val saved = savedState
      if (saved == null) {
        promise.resolve(null)
        return
      }
      val am = audioManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // Re-select a device only if the host was itself in a communication mode.
        // Otherwise communicationDevice merely reported the system's default, and
        // pinning that would leave the app forcing a route it never asked for.
        val device = saved.communicationDevice
        if (saved.mode != AudioManager.MODE_NORMAL && device != null) {
          am.setCommunicationDevice(device)
        } else {
          am.clearCommunicationDevice()
        }
      } else {
        @Suppress("DEPRECATION")
        run {
          if (saved.bluetoothScoOn) am.startBluetoothSco() else am.stopBluetoothSco()
          am.isBluetoothScoOn = saved.bluetoothScoOn
          am.isSpeakerphoneOn = saved.speakerphoneOn
        }
      }
      am.mode = saved.mode
      // Only on success: a failed restore keeps the state for the next stop to retry.
      savedState = null
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("audio_session_error", e)
    }
  }

  /** Pre-API-31 routing: Bluetooth SCO > wired/USB headset > loudspeaker. */
  @Suppress("DEPRECATION")
  private fun routeLegacy(am: AudioManager) {
    val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val hasBluetooth = outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
    val hasWired = outputs.any {
      it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
        it.type == AudioDeviceInfo.TYPE_USB_HEADSET
    }
    when {
      hasBluetooth -> {
        // SCO connects asynchronously; best-effort on legacy devices.
        am.startBluetoothSco()
        am.isBluetoothScoOn = true
        am.isSpeakerphoneOn = false
      }
      // Wired/USB routes automatically in comm mode; just don't force speaker.
      hasWired -> am.isSpeakerphoneOn = false
      else -> am.isSpeakerphoneOn = true
    }
  }

  companion object {
    const val NAME = "EdgeSpeechAudioSession"

    private const val ROUTE_TIMEOUT_MS = 3000L

    // Headset output types, most-preferred first.
    private val PREFERRED_HEADSET_TYPES = listOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLE_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )
  }
}
