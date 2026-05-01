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
      sttModel: sttModel ?? 'whisper-base-en',
      ttsVoice: ttsVoice ?? 'en_GB',
      vadSensitivity: vadSensitivity ?? 0.5,
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
