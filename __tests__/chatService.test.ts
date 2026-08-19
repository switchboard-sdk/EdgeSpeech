/**
 * Unit tests for chatService's defensive behaviour. No network — fetch is injected.
 */

import {
  sendToChat,
  configureChat,
  resetChatState,
  ChatError,
} from '../example/services/chatService'

const FAST = {
  minRequestIntervalMs: 0,
  baseBackoffMs: 1,
  maxBackoffMs: 2,
  requestTimeoutMs: 500,
}

const CREDS = { appId: 'a'.repeat(24), appSecret: 'secret' }

function reply(text: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ success: true, message: 'Success', data: { text } }),
  } as unknown as Response
}

function failure(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {}
): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  } as unknown as Response
}

const RATE_LIMITED = {
  success: false,
  message: 'Rate limit reached: 10 requests per 60s. Retry in 12s.',
}

describe('chatService', () => {
  beforeEach(() => {
    resetChatState()
    configureChat(CREDS)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the assistant reply', async () => {
    const fetchImpl = jest.fn(async () => reply('Hello there.'))
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).resolves.toBe('Hello there.')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails clearly when credentials were never configured', async () => {
    resetChatState()
    const fetchImpl = jest.fn(async () => reply('unreachable'))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toThrow(/not configured/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends credentials, a system prompt, trailing history and the current message', async () => {
    const sent: RequestInit[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(init as RequestInit)
      return reply('ok')
    }
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: 'user' as const,
      content: `msg${i}`,
    }))

    await sendToChat('current', history, { ...FAST, fetchImpl })

    const body = JSON.parse(String(sent[0]?.body))
    expect(body.appId).toBe(CREDS.appId)
    expect(body.appSecret).toBe(CREDS.appSecret)
    expect(body.messages[0].role).toBe('system')
    // system + last 8 history + current, and the current message appears once
    expect(body.messages).toHaveLength(10)
    expect(body.messages[1].content).toBe('msg4')
    expect(body.messages[9]).toEqual({ role: 'user', content: 'current' })
  })

  it('never sends a model or token count — the API chooses those', async () => {
    const sent: RequestInit[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(init as RequestInit)
      return reply('ok')
    }

    await sendToChat('hi', [], { ...FAST, fetchImpl })

    const body = JSON.parse(String(sent[0]?.body))
    expect(body.model).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
  })

  it('posts to production by default and honours an API base URL override', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url))
      return reply('ok')
    }

    await sendToChat('hi', [], { ...FAST, fetchImpl })

    resetChatState()
    // Trailing slash included on purpose — it must not produce a double slash.
    configureChat({ ...CREDS, apiBaseUrl: 'https://api.example.test/' })
    await sendToChat('hi', [], { ...FAST, fetchImpl })

    expect(urls[0]).toBe('https://api.switchboard.audio/chat')
    expect(urls[1]).toBe('https://api.example.test/chat')
  })

  it('does not retry rejected credentials', async () => {
    const fetchImpl = jest.fn(async () =>
      failure(401, { success: false, message: 'Invalid app credentials.' })
    )

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toMatchObject({
      status: 401,
      retryable: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toThrow(
      /Invalid app credentials/
    )
  })

  it('retries a 429 and succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(failure(429, RATE_LIMITED))
      .mockResolvedValueOnce(reply('recovered'))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).resolves.toBe('recovered')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('waits the Retry-After the server sends instead of its own backoff', async () => {
    // Backoff would be ~5s; Retry-After says 0, so the retry should be immediate.
    jest.spyOn(Math, 'random').mockReturnValue(0.999)
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(failure(429, RATE_LIMITED, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(reply('recovered'))

    const startedAt = Date.now()
    await expect(
      sendToChat('hi', [], {
        ...FAST,
        baseBackoffMs: 5_000,
        maxBackoffMs: 5_000,
        fetchImpl,
      })
    ).resolves.toBe('recovered')

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxAttempts on a persistent 429', async () => {
    const fetchImpl = jest.fn(async () => failure(429, RATE_LIMITED))

    await expect(
      sendToChat('hi', [], { ...FAST, maxAttempts: 3, fetchImpl })
    ).rejects.toMatchObject({ status: 429, retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries network failures', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply('back online'))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).resolves.toBe('back online')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls back rather than returning an empty string', async () => {
    const fetchImpl = jest.fn(async () => reply('   '))
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).resolves.toBe(
      'Sorry, I could not generate a response.'
    )
  })

  it('spaces requests by minRequestIntervalMs', async () => {
    const fetchImpl = jest.fn(async () => reply('ok'))
    const startedAt = Date.now()

    await sendToChat('one', [], { ...FAST, minRequestIntervalMs: 60, fetchImpl })
    await sendToChat('two', [], { ...FAST, minRequestIntervalMs: 60, fetchImpl })

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60)
  })

  it('serialises overlapping calls', async () => {
    let inFlight = 0
    let sawOverlap = false
    const fetchImpl = jest.fn(async () => {
      inFlight += 1
      sawOverlap = sawOverlap || inFlight > 1
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      return reply('ok')
    })

    await Promise.all([
      sendToChat('one', [], { ...FAST, fetchImpl }),
      sendToChat('two', [], { ...FAST, fetchImpl }),
      sendToChat('three', [], { ...FAST, fetchImpl }),
    ])

    expect(sawOverlap).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps the queue usable after a failure', async () => {
    const failing = jest.fn(async () => failure(400))
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl: failing })).rejects.toBeInstanceOf(
      ChatError
    )

    const succeeding = jest.fn(async () => reply('still working'))
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl: succeeding })).resolves.toBe(
      'still working'
    )
  })
})
