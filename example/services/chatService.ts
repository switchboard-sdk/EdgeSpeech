const MLVOCA_API_URL = 'https://mlvoca.com/api/generate';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function sendToChat(
  userMessage: string,
  conversationHistory: ConversationMessage[]
): Promise<string> {
  // Build context from history (last 4 exchanges to keep prompt short)
  const recentHistory = conversationHistory.slice(-8);
  const historyText = recentHistory
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = `You are a helpful, friendly voice assistant. Keep responses concise (1-2 sentences) since they will be spoken aloud.

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${userMessage}
Assistant:`;

  console.log('[Chat] Sending prompt:', prompt);

  const response = await fetch(MLVOCA_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-r1:1.5b',
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    console.error('[Chat] API error:', response.status);
    throw new Error(`Chat API error: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.response?.trim() || 'Sorry, I could not generate a response.';

  const thinkMatches = [...raw.matchAll(/<think>([\s\S]*?)<\/think>/g)];
  thinkMatches.forEach(m => console.log('[Chat] Think:', m[1].trim()));

  const result = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  console.log('[Chat] Response:', result);
  return result;
}
