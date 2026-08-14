/**
 * Unit tests for chatService's defensive behaviour. No network — fetch is injected.
 */

import { sendToChat, resetChatState, ChatError } from '../example/services/chatService'

const FAST = {
  minRequestIntervalMs: 0,
  retryFloorMs: 1,
  retryJitterMs: 1,
  requestTimeoutMs: 500,
}

function reply(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

function failure(status: number, body: unknown = {}): Response {
  return { ok: false, status, json: async () => body } as unknown as Response
}

/** Shape Pollinations actually returns when the anonymous pool is drained. */
const POLLEN_EXHAUSTED = {
  error: '402 Payment Required',
  status: 402,
  details: {
    success: false,
    error: {
      message:
        'API key budget too low. This request costs ~0.0003 pollen, but this key has 0.0000.',
      code: 'PAYMENT_REQUIRED',
    },
  },
}

const QUEUE_FULL = {
  error: 'Queue full for IP: 203.0.113.7: 1 requests already queued (max: 1).',
  status: 429,
}

describe('chatService', () => {
  beforeEach(() => {
    resetChatState()
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

  it('requests the anonymous-tier model with a referrer and a cache-busting seed', async () => {
    const sent: RequestInit[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(init as RequestInit)
      return reply('ok')
    }

    await sendToChat('hi', [], { ...FAST, fetchImpl })

    const body = JSON.parse(String(sent[0]?.body))
    expect(body.model).toBe('openai-fast')
    expect(typeof body.seed).toBe('number')
    expect(body.referrer).toBeTruthy()
  })

  it('sends a system prompt, trailing history and the current message', async () => {
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
    expect(body.messages[0].role).toBe('system')
    // system + last 8 history + current, and the current message appears once
    expect(body.messages).toHaveLength(10)
    expect(body.messages[1].content).toBe('msg4')
    expect(body.messages[9]).toEqual({ role: 'user', content: 'current' })
  })

  it('does not retry a 402 — a drained pool cannot be fixed by retrying', async () => {
    const fetchImpl = jest.fn(async () => failure(402, POLLEN_EXHAUSTED))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toMatchObject({
      status: 402,
      retryable: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("surfaces the server's own reason for a 402", async () => {
    const fetchImpl = jest.fn(async () => failure(402, POLLEN_EXHAUSTED))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toThrow(
      /out of credit.*pollen/s
    )
  })

  it('retries a 429 queue-full and succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(failure(429, QUEUE_FULL))
      .mockResolvedValueOnce(reply('recovered'))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).resolves.toBe('recovered')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxAttempts on a persistent 429', async () => {
    const fetchImpl = jest.fn(async () => failure(429, QUEUE_FULL))

    await expect(
      sendToChat('hi', [], { ...FAST, maxAttempts: 3, fetchImpl })
    ).rejects.toMatchObject({ status: 429, retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 404 retired model', async () => {
    const fetchImpl = jest.fn(async () => failure(404, { error: 'Model not found: openai-large' }))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toMatchObject({
      status: 404,
      retryable: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 403 blocked IP', async () => {
    const fetchImpl = jest.fn(async () => failure(403))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).rejects.toMatchObject({
      status: 403,
      retryable: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries network failures', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply('back online'))

    await expect(sendToChat('hi', [], { ...FAST, fetchImpl })).resolves.toBe('back online')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('strips balanced and unterminated think blocks', async () => {
    const balanced = jest.fn(async () => reply('<think>plan</think>Spoken answer.'))
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl: balanced })).resolves.toBe(
      'Spoken answer.'
    )

    const cutOff = jest.fn(async () => reply('Answer first.<think>truncated reasoning'))
    await expect(sendToChat('hi', [], { ...FAST, fetchImpl: cutOff })).resolves.toBe(
      'Answer first.'
    )
  })

  it('falls back rather than returning an empty string', async () => {
    const fetchImpl = jest.fn(async () => reply('<think>only reasoning</think>'))
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

  it('serialises overlapping calls — the server allows one in flight per IP', async () => {
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
