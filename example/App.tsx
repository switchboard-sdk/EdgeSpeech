import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
  Switch,
} from 'react-native';

import { sendToChat, ConversationMessage } from './services/chatService';

import {
  SwitchboardVoiceModule,
  initialize,
  configure,
  start,
  stop,
  speak,
  stopSpeaking,
  requestMicrophonePermission,
} from 'switchboard-voice-rn';
import type { VoiceState, TranscriptEvent, StateChangeEvent } from 'switchboard-voice-rn';

// ErrorEvent type for the example
interface ErrorEvent {
  code: string;
  message: string;
}

// Credentials from environment variables (see .env.example)
const SWITCHBOARD_APP_ID = process.env.EXPO_PUBLIC_SWITCHBOARD_APP_ID ?? '';
const SWITCHBOARD_APP_SECRET = process.env.EXPO_PUBLIC_SWITCHBOARD_APP_SECRET ?? '';

interface TranscriptHistoryEvent {
  id: number;
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

function App(): React.JSX.Element {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptHistoryEvent[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [textToSpeak, setTextToSpeak] = useState('Hello from Switchboard Voice!');
  const [conversationMode, setConversationMode] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const transcriptScrollRef = useRef<ScrollView>(null);
  const chatScrollRef = useRef<ScrollView>(null);
  const nextEventId = useRef(0);
  const conversationModeRef = useRef(conversationMode);
  const conversationHistoryRef = useRef(conversationHistory);

  useEffect(() => {
    conversationModeRef.current = conversationMode;
  }, [conversationMode]);

  useEffect(() => {
    conversationHistoryRef.current = conversationHistory;
  }, [conversationHistory]);

  useEffect(() => {
    // Set up event listeners using Expo module pattern
    const transcriptSub = SwitchboardVoiceModule.addListener('onTranscript', (event: TranscriptEvent) => {
      console.log('Transcript:', event.text, 'Final:', event.isFinal);
      setTranscript(event.text);

      // Add to history
      const historyEvent: TranscriptHistoryEvent = {
        id: nextEventId.current++,
        text: event.text,
        isFinal: event.isFinal,
        timestamp: new Date(),
      };
      setTranscriptHistory(prev => [...prev, historyEvent]);

      // Auto-scroll to end
      setTimeout(() => {
        transcriptScrollRef.current?.scrollToEnd({ animated: true });
      }, 50);

      // Handle conversation mode - send final transcripts to chat API
      if (event.isFinal && event.text.trim() && conversationModeRef.current) {
        handleConversationResponse(event.text);
      }
    });

    const stateSub = SwitchboardVoiceModule.addListener('onStateChange', (event: StateChangeEvent) => {
      console.log('State changed to:', event.state);
      setVoiceState(event.state);
    });

    const interruptedSub = SwitchboardVoiceModule.addListener('onInterrupted', () => {
      console.log('User interrupted!');
      Alert.alert('Interrupted', 'You interrupted the speech');
    });

    const errorSub = SwitchboardVoiceModule.addListener('onError', (event: ErrorEvent) => {
      console.error('Voice error:', event);
      Alert.alert('Error', event.message);
    });

    const speechStartSub = SwitchboardVoiceModule.addListener('onSpeechStart', () => {
      console.log('Speech started (VAD detected voice)');
    });

    const speechEndSub = SwitchboardVoiceModule.addListener('onSpeechEnd', () => {
      console.log('Speech ended (VAD detected silence)');
    });

    const ttsCompleteSub = SwitchboardVoiceModule.addListener('onTTSComplete', () => {
      console.log('TTS playback completed');
      if (conversationModeRef.current) {
        start()
          .then(() => setIsListening(true))
          .catch(console.error);
      }
    });

    // Configure on mount
    handleConfigure();

    // Cleanup on unmount
    return () => {
      transcriptSub.remove();
      stateSub.remove();
      interruptedSub.remove();
      errorSub.remove();
      speechStartSub.remove();
      speechEndSub.remove();
      ttsCompleteSub.remove();
      stop().catch(console.error);
    };
  }, []);

  const handleConfigure = async () => {
    try {
      // Initialize the SDK first
      initialize(SWITCHBOARD_APP_ID, SWITCHBOARD_APP_SECRET);

      // Then configure additional settings
      configure({
        vadSensitivity: 0.5,
      });

      setIsConfigured(true);
    } catch (error) {
      Alert.alert('Configuration Error', (error as Error).message);
    }
  };

  const handleStartListening = async () => {
    try {
      // Request microphone permission first
      const granted = await requestMicrophonePermission();
      if (!granted) {
        Alert.alert('Permission Denied', 'Microphone permission is required');
        return;
      }

      await start();
      setIsListening(true);
      setTranscript('');
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
  };

  const handleStopListening = async () => {
    try {
      await stop();
      setIsListening(false);
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
  };

  const handleSpeak = async () => {
    try {
      if (!textToSpeak.trim()) {
        Alert.alert('Error', 'Please enter text to speak');
        return;
      }
      await speak(textToSpeak);
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
  };

  const handleStopSpeaking = async () => {
    try {
      await stopSpeaking();
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
  };

  const handleConversationResponse = async (userText: string) => {
    try {
      setIsThinking(true);
      await stop();
      setIsListening(false);

      // Add user message to conversation history
      const userMessage: ConversationMessage = { role: 'user', content: userText };
      setConversationHistory(prev => [...prev, userMessage]);

      // Send to chat API
      const t0 = Date.now();
      const response = await sendToChat(userText, [...conversationHistoryRef.current, userMessage]);
      console.log(`[Chat] LLM took ${Date.now() - t0}ms`);

      // Add assistant response to conversation history
      const assistantMessage: ConversationMessage = { role: 'assistant', content: response };
      setConversationHistory(prev => [...prev, assistantMessage]);

      setIsThinking(false);

      // Scroll chat to bottom
      setTimeout(() => {
        chatScrollRef.current?.scrollToEnd({ animated: true });
      }, 50);

      // Speak the response
      await speak(response);
    } catch (error) {
      setIsThinking(false);
      console.error('Chat error:', error);
      Alert.alert('Chat Error', (error as Error).message);
    }
  };

  const clearConversation = () => {
    setConversationHistory([]);
  };

  const getStateColor = () => {
    switch (voiceState) {
      case 'idle':
        return '#666';
      case 'listening':
        return '#4CAF50';
      case 'processing':
        return '#FFC107';
      case 'speaking':
        return '#2196F3';
      default:
        return '#666';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Switchboard Voice (Expo)</Text>

        {/* Status Indicator */}
        <View style={styles.statusContainer}>
          <View style={[styles.statusDot, { backgroundColor: getStateColor() }]} />
          <Text style={styles.statusText}>Status: {voiceState}</Text>
        </View>

        {!isConfigured && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              Update .env with your Switchboard app credentials
            </Text>
          </View>
        )}

        {/* Conversation Mode Toggle */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.sectionTitle}>Conversation Mode</Text>
              <Text style={styles.toggleDescription}>
                Auto-respond to speech using AI
              </Text>
            </View>
            <Switch
              value={conversationMode}
              onValueChange={setConversationMode}
              trackColor={{ false: '#ccc', true: '#81b0ff' }}
              thumbColor={conversationMode ? '#2196F3' : '#f4f3f4'}
            />
          </View>

          {/* Chat History */}
          {conversationMode && conversationHistory.length > 0 && (
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
                    ]}>
                    <Text style={styles.chatRole}>
                      {msg.role === 'user' ? 'You' : 'Assistant'}
                    </Text>
                    <Text style={styles.chatText}>{msg.content}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Thinking Indicator */}
          {isThinking && (
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
              style={[styles.button, isListening && styles.buttonActive]}
              onPress={isListening ? handleStopListening : handleStartListening}
              disabled={!isConfigured}>
              <Text style={styles.buttonText}>
                {isListening ? 'Stop Listening' : 'Start Listening'}
              </Text>
            </TouchableOpacity>
          </View>

          {transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptLabel}>Transcript:</Text>
              <Text style={styles.transcriptText}>{transcript}</Text>
            </View>
          ) : null}

          {/* Transcript History - Horizontal Scrolling */}
          {transcriptHistory.length > 0 && (
            <View style={styles.historyContainer}>
              <Text style={styles.transcriptLabel}>History:</Text>
              <ScrollView
                ref={transcriptScrollRef}
                horizontal
                showsHorizontalScrollIndicator={true}
                style={styles.historyScroll}
                contentContainerStyle={styles.historyContent}>
                {transcriptHistory.map(event => (
                  <View
                    key={event.id}
                    style={[
                      styles.historyItem,
                      event.isFinal ? styles.historyItemFinal : styles.historyItemInterim,
                    ]}>
                    <Text style={styles.historyText} numberOfLines={2}>
                      {event.text}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {event.isFinal ? 'Final' : 'Interim'} •{' '}
                      {event.timestamp.toLocaleTimeString()}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
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
              onPress={handleSpeak}
              disabled={!isConfigured}>
              <Text style={styles.buttonText}>Speak</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonDanger]}
              onPress={handleStopSpeaking}
              disabled={!isConfigured}>
              <Text style={styles.buttonText}>Stop Speaking</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.footer}>
          Powered by Switchboard SDK (Expo Module)
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
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
  warningBox: {
    backgroundColor: '#fff3cd',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ffc107',
  },
  warningText: {
    color: '#856404',
    fontSize: 14,
    textAlign: 'center',
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
  historyContainer: {
    marginTop: 15,
  },
  historyScroll: {
    marginTop: 8,
  },
  historyContent: {
    paddingRight: 10,
    gap: 10,
  },
  historyItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    minWidth: 120,
    maxWidth: 200,
  },
  historyItemFinal: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  historyItemInterim: {
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#FF9800',
  },
  historyText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  historyMeta: {
    fontSize: 10,
    color: '#666',
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
});

export default App;
