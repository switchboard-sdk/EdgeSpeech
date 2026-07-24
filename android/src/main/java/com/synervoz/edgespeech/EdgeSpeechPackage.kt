package com.synervoz.edgespeech

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The core EdgeSpeech engine is a pure C++ TurboModule (registered via RN's C++
 * autolinking, not the JVM). This package still has to exist so autolinking
 * recognizes the directory as an Android library — otherwise the CLI drops the
 * android config and its Switchboard Maven/Prefab wiring. It also registers the
 * JVM modules we need: [EdgeSpeechAudioSessionModule] (AudioManager routing for
 * speakerphone + hardware AEC, required for reliable barge-in) and
 * [EdgeSpeechModelsModule] (copies bundled model assets to a real file path for
 * the STT node).
 */
class EdgeSpeechPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      EdgeSpeechAudioSessionModule.NAME -> EdgeSpeechAudioSessionModule(reactContext)
      EdgeSpeechModelsModule.NAME -> EdgeSpeechModelsModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    fun info(name: String) =
      ReactModuleInfo(
        name, // name
        name, // className
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        false, // isTurboModule
      )
    mapOf(
      EdgeSpeechAudioSessionModule.NAME to info(EdgeSpeechAudioSessionModule.NAME),
      EdgeSpeechModelsModule.NAME to info(EdgeSpeechModelsModule.NAME),
    )
  }
}
