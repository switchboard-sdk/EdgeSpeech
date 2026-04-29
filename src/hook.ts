import { useCallback, useEffect, useRef, useState } from 'react'
import { type VoiceState } from './SwitchboardVoiceModule'
import { useEdgeSpeechContext } from './EdgeSpeechProvider'

export function useEdgeSpeech() {
  const { addListener, start, stop, speak, stopSpeaking, requestMicrophonePermission } =
    useEdgeSpeechContext()

  const [transcript, setTranscript] = useState('')
  const transcriptCompleteCallback = useRef<((text: string) => void) | null>(null)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')

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

    return () => {
      transcriptSub.remove()
      stateSub.remove()
    }
  }, [addListener])

  const onTranscriptComplete = useCallback((cb: (text: string) => void) => {
    transcriptCompleteCallback.current = cb
  }, [])

  return {
    transcript,
    onTranscriptComplete,
    voiceState,
    start,
    stop,
    speak,
    stopSpeaking,
    requestMicrophonePermission,
  }
}
