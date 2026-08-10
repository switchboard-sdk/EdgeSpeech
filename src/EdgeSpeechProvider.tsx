import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

export interface EdgeSpeechContextValue {
  addListener: typeof SwitchboardVoiceModule.addListener
  /** Android: true until the models are ready — a listen()/speak() before that waits. */
  isInitializing: boolean
  listen: () => Promise<void>
  stopListening: () => Promise<void>
  speak: (text: string) => Promise<void>
  stopSpeaking: () => Promise<void>
  requestMicrophonePermission: () => Promise<boolean>
}

const EdgeSpeechContext = createContext<EdgeSpeechContextValue | null>(null)

export interface EdgeSpeechProviderProps {
  appId: string
  appSecret: string
  sttModel?: string
  ttsVoice?: string
  vadSensitivity?: number
  sampleRate?: number
  bufferSize?: number
  children?: ReactNode
}

const defaultConfig = {
  sttModel: 'whisper-base-en',
  ttsVoice: 'en_GB',
  vadSensitivity: 0.5,
}

export function EdgeSpeechProvider({
  appId,
  appSecret,
  sttModel,
  ttsVoice,
  vadSensitivity,
  sampleRate,
  bufferSize,
  children,
}: EdgeSpeechProviderProps) {
  // Android stages the model files during initialize(); iOS has nothing to wait for.
  const [isInitializing, setIsInitializing] = useState(Platform.OS === 'android')

  if (!appId || appId.trim() === '') {
    throw new Error('EdgeSpeechProvider: appId is required')
  }
  if (!appSecret || appSecret.trim() === '') {
    throw new Error('EdgeSpeechProvider: appSecret is required')
  }
  if (vadSensitivity !== undefined && (vadSensitivity < 0.0 || vadSensitivity > 1.0)) {
    throw new Error('EdgeSpeechProvider: vadSensitivity must be between 0.0 and 1.0')
  }
  if (sttModel !== undefined && sttModel.trim() === '') {
    throw new Error('EdgeSpeechProvider: sttModel cannot be an empty string')
  }
  if (ttsVoice !== undefined && ttsVoice.trim() === '') {
    throw new Error('EdgeSpeechProvider: ttsVoice cannot be an empty string')
  }

  // Runs before the initialize() effect below, which stages the model files this
  // config names.
  useEffect(() => {
    SwitchboardVoiceModule.configure({
      sttModel: sttModel ?? defaultConfig.sttModel,
      ttsVoice: ttsVoice ?? defaultConfig.ttsVoice,
      vadSensitivity: vadSensitivity ?? defaultConfig.vadSensitivity,
      ...(sampleRate !== undefined && { sampleRate }),
      ...(bufferSize !== undefined && { bufferSize }),
    })
  }, [sttModel, ttsVoice, vadSensitivity, sampleRate, bufferSize])

  useEffect(() => {
    let active = true
    SwitchboardVoiceModule.initialize(appId, appSecret).finally(() => {
      if (active) {
        setIsInitializing(false)
      }
    })

    return () => {
      active = false
      SwitchboardVoiceModule.stopListening().catch(() => {})
    }
  }, [appId, appSecret])

  const value: EdgeSpeechContextValue = {
    // Keep NativeModule method bound to avoid losing JSI `this` context.
    addListener: SwitchboardVoiceModule.addListener.bind(SwitchboardVoiceModule),
    isInitializing,
    listen: () => SwitchboardVoiceModule.listen(),
    stopListening: () => SwitchboardVoiceModule.stopListening(),
    speak: (text) => SwitchboardVoiceModule.speak(text),
    stopSpeaking: () => SwitchboardVoiceModule.stopSpeaking(),
    requestMicrophonePermission: () => SwitchboardVoiceModule.requestMicrophonePermission(),
  }

  return <EdgeSpeechContext.Provider value={value}>{children}</EdgeSpeechContext.Provider>
}

export function useEdgeSpeechContext(): EdgeSpeechContextValue {
  const ctx = useContext(EdgeSpeechContext)
  if (!ctx) {
    throw new Error('useEdgeSpeech must be used within an <EdgeSpeechProvider>')
  }
  return ctx
}
