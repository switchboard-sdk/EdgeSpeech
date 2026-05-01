import React, { createContext, useContext, useEffect, type ReactNode } from 'react'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

export interface EdgeSpeechContextValue {
  addListener: typeof SwitchboardVoiceModule.addListener
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
  useEffect(() => {
    SwitchboardVoiceModule.initialize(appId, appSecret)

    return () => {
      SwitchboardVoiceModule.stopListening().catch(() => {})
    }
  }, [appId, appSecret])

  useEffect(() => {
    SwitchboardVoiceModule.configure({
      sttModel: sttModel ?? defaultConfig.sttModel,
      ttsVoice: ttsVoice ?? defaultConfig.ttsVoice,
      vadSensitivity: vadSensitivity ?? defaultConfig.vadSensitivity,
      ...(sampleRate !== undefined && { sampleRate }),
      ...(bufferSize !== undefined && { bufferSize }),
    })
  }, [sttModel, ttsVoice, vadSensitivity, sampleRate, bufferSize])

  const value: EdgeSpeechContextValue = {
    addListener: SwitchboardVoiceModule.addListener,
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
