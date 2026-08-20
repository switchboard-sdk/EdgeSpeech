import React, { createContext, useContext, useEffect, type ReactNode } from 'react'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

export interface EdgeSpeechContextValue {
  addListener: typeof SwitchboardVoiceModule.addListener
  getState: typeof SwitchboardVoiceModule.getState
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
  vadSensitivity?: number
  sampleRate?: number
  bufferSize?: number
  children?: ReactNode
}

const defaultConfig = {
  vadSensitivity: 0.5,
}

export function EdgeSpeechProvider({
  appId,
  appSecret,
  vadSensitivity,
  sampleRate,
  bufferSize,
  children,
}: EdgeSpeechProviderProps) {
  if (!appId || appId.trim() === '') {
    throw new Error('EdgeSpeechProvider: appId is required')
  }
  if (!appSecret || appSecret.trim() === '') {
    throw new Error('EdgeSpeechProvider: appSecret is required')
  }
  if (vadSensitivity !== undefined && (vadSensitivity < 0.0 || vadSensitivity > 1.0)) {
    throw new Error('EdgeSpeechProvider: vadSensitivity must be between 0.0 and 1.0')
  }

  // Runs before the initialize() effect below, which builds the graph this config
  // shapes.
  useEffect(() => {
    SwitchboardVoiceModule.configure({
      vadSensitivity: vadSensitivity ?? defaultConfig.vadSensitivity,
      ...(sampleRate !== undefined && { sampleRate }),
      ...(bufferSize !== undefined && { bufferSize }),
    })
  }, [vadSensitivity, sampleRate, bufferSize])

  useEffect(() => {
    // Init reports its own progress through onStateChange ('initializing' → 'ready'),
    // so there is nothing to do with the promise here.
    SwitchboardVoiceModule.initialize(appId, appSecret)

    return () => {
      SwitchboardVoiceModule.stopListening().catch(() => {})
    }
  }, [appId, appSecret])

  const value: EdgeSpeechContextValue = {
    // Keep NativeModule method bound to avoid losing JSI `this` context.
    addListener: SwitchboardVoiceModule.addListener.bind(SwitchboardVoiceModule),
    getState: SwitchboardVoiceModule.getState.bind(SwitchboardVoiceModule),
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
