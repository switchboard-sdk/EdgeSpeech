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
  const interruptedCallback = useRef<(() => void) | null>(null)

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

    const interruptedSub = addListener('onInterrupted', () => {
      interruptedCallback.current?.()
    })

    const errorSub = addListener('onError', ({ message }) => {
      setError(message)
    })

    return () => {
      transcriptSub.remove()
      stateSub.remove()
      interruptedSub.remove()
      errorSub.remove()
    }
  }, [addListener])

  const onTranscriptComplete = useCallback((cb: (text: string) => void) => {
    transcriptCompleteCallback.current = cb
  }, [])

  const onInterrupted = useCallback((cb: () => void) => {
    interruptedCallback.current = cb
  }, [])

  const wrappedListen = useCallback(async () => {
    try {
      await listen()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [listen])

  const wrappedStopListening = useCallback(async () => {
    try {
      await stopListening()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [stopListening])

  const wrappedSpeak = useCallback(
    async (text: string) => {
      try {
        await speak(text)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [speak]
  )

  const wrappedStopSpeaking = useCallback(async () => {
    try {
      await stopSpeaking()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [stopSpeaking])

  const wrappedRequestMicrophonePermission = useCallback(async () => {
    try {
      return await requestMicrophonePermission()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [requestMicrophonePermission])

  return {
    transcript,
    onTranscriptComplete,
    onInterrupted,
    voiceState,
    error,
    listen: wrappedListen,
    stopListening: wrappedStopListening,
    speak: wrappedSpeak,
    stopSpeaking: wrappedStopSpeaking,
    requestMicrophonePermission: wrappedRequestMicrophonePermission,
  }
}
