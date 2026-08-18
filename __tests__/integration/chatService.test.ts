/**
 * Integration test for chatService.
 * Hits the real Switchboard chat proxy — run with: npm run test:integration
 *
 * Requires SWITCHBOARD_APP_ID and SWITCHBOARD_APP_SECRET for an app that has an
 * OpenAI key set on its config in the console. Skipped when they are absent.
 */

import { sendToChat, configureChat } from '../../example/services/chatService'

// Read via globalThis so this file needs no @types/node.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

const appId = env.SWITCHBOARD_APP_ID
const appSecret = env.SWITCHBOARD_APP_SECRET

const describeIfConfigured = appId && appSecret ? describe : describe.skip

describeIfConfigured('chatService (integration)', () => {
  beforeAll(() => {
    configureChat({ appId: appId as string, appSecret: appSecret as string })
  })

  it('returns a non-empty string response', async () => {
    const response = await sendToChat('Reply with only the word yes.', [])
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  }, 60_000)

  it('accepts conversation history without error', async () => {
    const history = [
      { role: 'user' as const, content: 'My name is TestUser.' },
      { role: 'assistant' as const, content: 'Nice to meet you, TestUser.' },
    ]
    const response = await sendToChat('What did I just tell you?', history)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  }, 60_000)
})
