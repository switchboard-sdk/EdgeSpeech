import React, { createContext, useContext, useEffect, type ReactNode } from 'react'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

export interface EdgeSpeechConfig {
  appId: string
  appSecret: string
  sttModel?: string
  ttsVoice?: string
  vadSensitivity?: number
}

export interface EdgeSpeechContextValue {
  start: () => Promise<void>
  stop: () => Promise<void>
  speak: (text: string) => Promise<void>
  stopSpeaking: () => Promise<void>
  requestMicrophonePermission: () => Promise<boolean>
}

const EdgeSpeechContext = createContext<EdgeSpeechContextValue | null>(null)

interface EdgeSpeechProviderProps {
  config: EdgeSpeechConfig
  children?: ReactNode
}

export function EdgeSpeechProvider({ config, children }: EdgeSpeechProviderProps) {
  const { appId, appSecret, sttModel, ttsVoice, vadSensitivity } = config

  useEffect(() => {
    SwitchboardVoiceModule.initialize(appId, appSecret)
    SwitchboardVoiceModule.configure({
      sttModel: sttModel ?? 'whisper-base-en',
      ttsVoice: ttsVoice ?? 'en_GB',
      vadSensitivity: vadSensitivity ?? 0.5,
    })

    return () => {
      SwitchboardVoiceModule.stop().catch(() => {})
    }
  }, [appId, appSecret, sttModel, ttsVoice, vadSensitivity])

  const value: EdgeSpeechContextValue = {
    start: () => SwitchboardVoiceModule.start(),
    stop: () => SwitchboardVoiceModule.stop(),
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
