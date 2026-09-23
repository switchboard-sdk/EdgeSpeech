import React, { useState, useEffect } from 'react'
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { EdgeSpeechProvider, useEdgeSpeech } from '@synervoz/edgespeech'

function Dictation(): React.JSX.Element {
  const {
    onTranscriptComplete,
    voiceState,
    error,
    listen,
    stopListening,
    speak,
    requestMicrophonePermission,
  } = useEdgeSpeech()

  const [text, setText] = useState('This is EdgeSpeech.')

  // Each final transcript replaces the text area
  useEffect(() => {
    onTranscriptComplete((transcript: string) => {
      setText(transcript)
    })
  }, [onTranscriptComplete])

  // 'processing' is Whisper decoding between utterances; still dictating from the user's view.
  const isDictating = voiceState === 'listening' || voiceState === 'processing'

  // Not operable until init finishes: 'initializing' is staging in progress, 'idle' means
  // the SDK is not up at all — not started yet, or init failed, which `error` tells apart.
  const isStarting = voiceState === 'idle' || voiceState === 'initializing'

  const handleDictate = async () => {
    if (isDictating) {
      await stopListening()
      return
    }
    const granted = await requestMicrophonePermission()
    if (!granted) {
      Alert.alert('Permission Denied', 'Microphone permission is required')
      return
    }
    await listen()
  }

  const handleReadBack = async () => {
    if (!text.trim()) {
      Alert.alert('Error', 'Please enter text to speak')
      return
    }
    await speak(text)
  }

  const dictateButtonLabel = () => {
    switch (voiceState) {
      case 'initializing':
        return 'Preparing…'
      case 'idle':
        return 'Not ready'
      case 'listening':
      case 'processing':
        return 'Dictating…'
      default:
        return 'Dictate'
    }
  }

  const getStateColor = () => {
    switch (voiceState) {
      case 'idle':
      case 'initializing':
        return '#9E9E9E'
      case 'ready':
        return '#666'
      case 'listening':
        return '#4CAF50'
      case 'processing':
        return '#FFC107'
      case 'speaking':
        return '#2196F3'
      default:
        return '#666'
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>EdgeSpeech</Text>

        {/* Status Indicator */}
        <View style={styles.statusContainer}>
          <View style={[styles.statusDot, { backgroundColor: getStateColor() }]} />
          <Text style={styles.statusText}>Status: {voiceState}</Text>
        </View>

        {/* A failed init leaves voiceState at 'idle' with the reason only in `error`. */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorLabel}>Error</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <TouchableOpacity
            style={[
              styles.button,
              isDictating && styles.buttonActive,
              isStarting && styles.buttonDisabled,
            ]}
            disabled={isStarting}
            onPress={handleDictate}>
            <Text style={styles.buttonText}>{dictateButtonLabel()}</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Dictate or type a message"
            multiline
          />

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, isStarting && styles.buttonDisabled]}
            disabled={isStarting}
            onPress={handleReadBack}>
            <Text style={styles.buttonText}>
              {voiceState === 'speaking' ? 'Speaking…' : 'Read it back'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>Powered by EdgeSpeech</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  errorBox: {
    backgroundColor: '#fdecea',
    borderColor: '#d32f2f',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  errorLabel: {
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 4,
  },
  errorText: {
    color: '#5f2120',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    gap: 15,
  },
  button: {
    backgroundColor: '#6200ee',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonActive: {
    backgroundColor: '#d32f2f',
  },
  buttonPrimary: {
    backgroundColor: '#2196F3',
  },
  buttonDisabled: {
    backgroundColor: '#bdbdbd',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  footer: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginTop: 20,
  },
})

// Not wired in. To use it, import this instead of `./App` in index.ts.
export default function DictationScreen(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <EdgeSpeechProvider vadSensitivity={0.5}>
        <Dictation />
      </EdgeSpeechProvider>
    </SafeAreaProvider>
  )
}
