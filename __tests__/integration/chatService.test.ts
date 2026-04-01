/**
 * Integration test for chatService.
 * Hits the real LLM API — run with: npm run test:integration
 */

import { sendToChat } from '../../example/services/chatService';

describe('chatService (integration)', () => {
  it('returns a non-empty string response', async () => {
    const response = await sendToChat('Reply with only the word yes.', []);
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  }, 30_000);

  it('accepts conversation history without error', async () => {
    const history = [
      { role: 'user' as const, content: 'My name is TestUser.' },
      { role: 'assistant' as const, content: 'Nice to meet you, TestUser.' },
    ];
    const response = await sendToChat('What did I just tell you?', history);
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  }, 30_000);
});
