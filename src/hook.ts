import { useCallback, useEffect, useRef, useState } from 'react'
import { type VoiceState } from './SwitchboardVoiceModule'
import { useEdgeSpeechContext } from './EdgeSpeechProvider'

export function useEdgeSpeech() {
  const { addListener, listen, stopListening, speak, stopSpeaking, requestMicrophonePermission } =
    useEdgeSpeechContext()

  const [transcript, setTranscript] = useState('')
  const transcriptCompleteCallback = useRef<((text: string) => void) | null>(null)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const transcriptSub = addListener('onTranscript', ({ text, isFinal }) => {
      setTranscript(text)

      if (isFinal) {
        transcriptCompleteCallback.current?.(text)
        setTranscript('')
      }
    })

    const stateSub = addListener('onStateChange', ({ state }) => {
      setVoiceState(state)
    })

    const errorSub = addListener('onError', ({ message }) => {
      setError(message)
    })

    return () => {
      transcriptSub.remove()
      stateSub.remove()
      errorSub.remove()
    }
  }, [addListener])

  const onTranscriptComplete = useCallback((cb: (text: string) => void) => {
    transcriptCompleteCallback.current = cb
  }, [])

  return {
    transcript,
    onTranscriptComplete,
    voiceState,
    error,
    listen,
    stopListening,
    speak,
    stopSpeaking,
    requestMicrophonePermission,
  }
}
