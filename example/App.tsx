import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
  Switch,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { sendToChat, ConversationMessage } from './services/chatService'

import { EdgeSpeechProvider, useEdgeSpeech } from '@synervoz/edgespeech'

// Credentials from environment variables (see .env.example)
const SWITCHBOARD_APP_ID = process.env.EXPO_PUBLIC_SWITCHBOARD_APP_ID ?? ''
const SWITCHBOARD_APP_SECRET = process.env.EXPO_PUBLIC_SWITCHBOARD_APP_SECRET ?? ''

function VoiceApp(): React.JSX.Element {
  const {
    transcript,
    onTranscriptComplete,
    onInterrupted,
    voiceState,
    listen,
    stopListening,
    speak,
    stopSpeaking,
    requestMicrophonePermission,
  } = useEdgeSpeech()

  const [textToSpeak, setTextToSpeak] = useState('Hello from EdgeSpeech!')
  const [conversationMode, setConversationMode] = useState(false)
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])
  const chatScrollRef = useRef<ScrollView>(null)
  const prevVoiceStateRef = useRef(voiceState)

  const handleConversationResponse = useCallback(
    async (userMessage: ConversationMessage) => {
      await stopListening()
      let response: string
      try {
        response = await sendToChat(userMessage.content, [...conversationHistory, userMessage])
      } catch (error) {
        console.error('Chat error:', error)
        Alert.alert('Chat Error', (error as Error).message)
        return
      }
      const assistantMessage: ConversationMessage = { role: 'assistant', content: response }
      setConversationHistory((prev) => [...prev, assistantMessage])
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 50)
      await speak(response)
    },
    [conversationHistory, stopListening, speak]
  )

  // Register interrupted callback
  useEffect(() => {
    onInterrupted(() => {
      setConversationHistory((prev) => [...prev, { role: 'assistant', content: '[interrupted]' }])
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 50)
    })
  }, [onInterrupted])

  // Register final-transcript callback
  useEffect(() => {
    onTranscriptComplete((text: string) => {
      const userMessage: ConversationMessage = { role: 'user', content: text }
      setConversationHistory((prev) => [...prev, userMessage])
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 50)

      if (conversationMode && text.trim()) {
        handleConversationResponse(userMessage)
      }
    })
  }, [onTranscriptComplete, conversationMode, handleConversationResponse])

  // Resume listening after TTS completes in conversation mode
  useEffect(() => {
    if (prevVoiceStateRef.current === 'speaking' && voiceState === 'idle') {
      if (conversationMode) {
        listen()
      }
    }
    prevVoiceStateRef.current = voiceState
  }, [voiceState, listen, conversationMode])

  const handleStartListening = async () => {
    const granted = await requestMicrophonePermission()
    if (!granted) {
      Alert.alert('Permission Denied', 'Microphone permission is required')
      return
    }
    await listen()
  }

  const handleStopListening = async () => {
    await stopListening()
  }

  const handleStartSpeaking = async () => {
    if (!textToSpeak.trim()) {
      Alert.alert('Error', 'Please enter text to speak')
      return
    }
    await speak(textToSpeak)
  }

  const handleStopSpeaking = async () => {
    await stopSpeaking()
  }

  const clearConversation = () => {
    setConversationHistory([])
  }

  const getStateColor = () => {
    switch (voiceState) {
      case 'idle':
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

        {/* Conversation Mode Toggle */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.sectionTitle}>Conversation Mode</Text>
              <Text style={styles.toggleDescription}>Auto-respond to speech using AI</Text>
            </View>
            <Switch
              value={conversationMode}
              onValueChange={setConversationMode}
              trackColor={{ false: '#ccc', true: '#81b0ff' }}
              thumbColor={conversationMode ? '#2196F3' : '#f4f3f4'}
            />
          </View>

          {/* Chat History */}
          {conversationHistory.length > 0 && (
            <View style={styles.chatContainer}>
              <View style={styles.chatHeader}>
                <Text style={styles.chatLabel}>Conversation:</Text>
                <TouchableOpacity onPress={clearConversation}>
                  <Text style={styles.clearButton}>Clear</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={chatScrollRef}
                style={styles.chatScroll}
                contentContainerStyle={styles.chatContent}>
                {conversationHistory.map((msg, index) => (
                  <View
                    key={index}
                    style={[
                      styles.chatBubble,
                      msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                      msg.content === '[interrupted]' && styles.interruptedBubble,
                    ]}>
                    <Text style={styles.chatRole}>{msg.role === 'user' ? 'You' : 'Assistant'}</Text>
                    <Text style={styles.chatText}>{msg.content}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Thinking Indicator */}
          {voiceState === 'processing' && (
            <View style={styles.thinkingContainer}>
              <Text style={styles.thinkingText}>Thinking...</Text>
            </View>
          )}
        </View>

        {/* Listening Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Voice Input</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, voiceState === 'listening' && styles.buttonActive]}
              onPress={voiceState === 'listening' ? handleStopListening : handleStartListening}>
              <Text style={styles.buttonText}>
                {voiceState === 'listening' ? 'Stop Listening' : 'Start Listening'}
              </Text>
            </TouchableOpacity>
          </View>

          {transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptLabel}>Transcript:</Text>
              <Text style={styles.transcriptText}>{transcript}</Text>
            </View>
          ) : null}
        </View>

        {/* Speaking Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Text-to-Speech</Text>
          <TextInput
            style={styles.input}
            value={textToSpeak}
            onChangeText={setTextToSpeak}
            placeholder="Enter text to speak"
            multiline
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary]}
              onPress={handleStartSpeaking}>
              <Text style={styles.buttonText}>Speak</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonDanger]}
              onPress={handleStopSpeaking}>
              <Text style={styles.buttonText}>Stop Speaking</Text>
            </TouchableOpacity>
          </View>
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
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
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
  buttonDanger: {
    backgroundColor: '#d32f2f',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  transcriptBox: {
    marginTop: 15,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  transcriptLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 5,
  },
  transcriptText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  footer: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginTop: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  chatContainer: {
    marginTop: 15,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  clearButton: {
    fontSize: 12,
    color: '#2196F3',
    fontWeight: '600',
  },
  chatScroll: {
    maxHeight: 200,
  },
  chatContent: {
    gap: 8,
  },
  chatBubble: {
    padding: 10,
    borderRadius: 12,
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: '#e3f2fd',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#f5f5f5',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  interruptedBubble: {
    backgroundColor: '#fce4ec',
    alignSelf: 'center',
    borderRadius: 12,
  },
  chatRole: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  chatText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  thinkingContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    alignItems: 'center',
  },
  thinkingText: {
    fontSize: 14,
    color: '#e65100',
    fontStyle: 'italic',
  },
})

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <EdgeSpeechProvider
        appId={SWITCHBOARD_APP_ID}
        appSecret={SWITCHBOARD_APP_SECRET}
        vadSensitivity={0.5}>
        <VoiceApp />
      </EdgeSpeechProvider>
    </SafeAreaProvider>
  )
}
