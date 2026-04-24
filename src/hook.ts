import { useCallback, useEffect, useRef, useState } from 'react'
import SwitchboardVoiceModule, { type VoiceState } from './SwitchboardVoiceModule'

export function useEdgeSpeech() {
  const [transcript, setTranscript] = useState('')
  const transcriptCompleteCallback = useRef<((text: string) => void) | null>(null)

  const [voiceState, setVoiceState] = useState<VoiceState>('idle')

  useEffect(() => {
    const transcriptSub = SwitchboardVoiceModule.addListener(
      'onTranscript',
      ({ text, isFinal }) => {
        setTranscript(text)

        if (isFinal) {
          transcriptCompleteCallback.current?.(text)
          setTranscript('')
        }
      }
    )

    const stateSub = SwitchboardVoiceModule.addListener('onStateChange', ({ state }) => {
      setVoiceState(state)
    })

    return () => {
      transcriptSub.remove()
      stateSub.remove()
    }
  }, [])

  const onTranscriptComplete = useCallback((cb: (text: string) => void) => {
    transcriptCompleteCallback.current = cb
  }, [])

  return {
    transcript,
    onTranscriptComplete,
    voiceState,
  }
}
