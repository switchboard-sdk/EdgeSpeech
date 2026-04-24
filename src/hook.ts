import { useCallback, useEffect, useRef, useState } from 'react'
import SwitchboardVoiceModule from './SwitchboardVoiceModule'

export function useEdgeSpeech() {
  const [transcript, setTranscript] = useState('')
  const transcriptCompleteCallback = useRef<((text: string) => void) | null>(null)

  useEffect(() => {
    SwitchboardVoiceModule.addListener('onTranscript', ({ text, isFinal }) => {
      setTranscript(text) // always update display

      if (isFinal) {
        transcriptCompleteCallback.current?.(text)
        setTranscript('')
      }
    })

    return () => {
      SwitchboardVoiceModule.removeAllListeners('onTranscript')
    }
  }, [])

  const onTranscriptComplete = useCallback((cb: (text: string) => void) => {
    transcriptCompleteCallback.current = cb
  }, [])

  return {
    transcript,
    onTranscriptComplete,
  }
}
