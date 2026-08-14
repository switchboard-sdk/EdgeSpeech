/**
 * Chat backend for the example app's Conversation Mode.
 *
 * Uses Pollinations' keyless legacy endpoint (`openai-fast`, the only model on
 * the anonymous tier). Its limits are undocumented in the response — no
 * Retry-After, no x-ratelimit-* headers — so the client enforces them itself:
 *
 *   429 "Queue full for IP" — one request in flight per IP, ~1 per 30s. Retryable
 *                             after clearing the interval.
 *   402 PAYMENT_REQUIRED    — the shared anonymous request pool is out of credit
 *                             ("pollen"). Server-side; retrying cannot fix it.
 *   404                     — model retired. Re-check GET /models.
 *   403                     — IP blocked.
 */

const POLLINATIONS_URL = 'https://text.pollinations.ai/openai'

/** Canonical name from GET /models; `openai` and `gpt-oss-20b` are aliases for it. */
const MODEL = 'openai-fast'

/** Identifies the caller. Anonymous traffic can have referral content injected into completions. */
const REFERRER = 'https://github.com/switchboard-sdk/EdgeSpeech'

const SYSTEM_PROMPT =
  'You are a helpful, friendly voice assistant. Keep responses concise (1-2 sentences) since they will be spoken aloud.'

const FALLBACK_REPLY = 'Sorry, I could not generate a response.'

/** Transient only. 402/403/404 are deliberately absent — no amount of retrying clears them. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const DEFAULT_TUNING = {
  /** Trailing history messages to send (4 exchanges). */
  historyMessages: 8,
  /** Matches the server's per-IP interval, so a normal turn never trips the queue. */
  minRequestIntervalMs: 30_000,
  requestTimeoutMs: 20_000,
  maxAttempts: 2,
  /** Retries must clear the 30s interval, so backoff starts above it rather than at zero. */
  retryFloorMs: 30_000,
  retryJitterMs: 10_000,
  /** Ceiling on total time in sendToChat, retries and spacing included. */
  totalBudgetMs: 90_000,
}

export type ChatTuning = typeof DEFAULT_TUNING

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SendToChatOptions extends Partial<ChatTuning> {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface RequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>
}

interface ErrorBody {
  error?: string | { message?: string }
  details?: { error?: { message?: string; code?: string } }
}

export class ChatError extends Error {
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, opts: { status?: number; retryable: boolean }) {
    super(message)
    this.name = 'ChatError'
    this.status = opts.status
    this.retryable = opts.retryable
  }
}

/** Serialises requests — the server allows exactly one in flight per IP. */
let queue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

export async function sendToChat(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  options: SendToChatOptions = {}
): Promise<string> {
  const tuning: ChatTuning = { ...DEFAULT_TUNING, ...options }
  const doFetch = options.fetchImpl ?? fetch
  const messages = buildMessages(userMessage, conversationHistory, tuning)

  const run = () => requestWithRetry(messages, tuning, doFetch)
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/** Test seam: clears the spacing timer and in-flight queue between cases. */
export function resetChatState(): void {
  queue = Promise.resolve()
  lastRequestAt = 0
}

function buildMessages(
  userMessage: string,
  history: ConversationMessage[],
  tuning: ChatTuning
): RequestMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-tuning.historyMessages),
    { role: 'user', content: userMessage },
  ]
}

async function requestWithRetry(
  messages: RequestMessage[],
  tuning: ChatTuning,
  doFetch: typeof fetch
): Promise<string> {
  const startedAt = Date.now()
  let lastError: ChatError | undefined

  for (let attempt = 1; attempt <= tuning.maxAttempts; attempt++) {
    await respectMinInterval(tuning)

    try {
      return await postCompletion(messages, tuning, doFetch)
    } catch (error) {
      lastError = asChatError(error)

      const wait = backoffFor(attempt, tuning)
      const budgetLeft = tuning.totalBudgetMs - (Date.now() - startedAt)
      if (!lastError.retryable || attempt === tuning.maxAttempts || wait > budgetLeft) {
        break
      }

      console.warn(
        `[Chat] attempt ${attempt}/${tuning.maxAttempts} failed (${lastError.message}); ` +
          `retrying in ${Math.round(wait / 1000)}s`
      )
      await sleep(wait)
    }
  }

  throw lastError ?? new ChatError('Chat request failed', { retryable: false })
}

async function postCompletion(
  messages: RequestMessage[],
  tuning: ChatTuning,
  doFetch: typeof fetch
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), tuning.requestTimeoutMs)

  let response: Response
  try {
    response = await doFetch(POLLINATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: REFERRER },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        referrer: REFERRER,
        // Identical prompts are served from a long-lived cache, so vary the seed.
        seed: Math.floor(Math.random() * 1_000_000_000),
      }),
      signal: controller.signal,
    })
  } catch (error) {
    const reason = controller.signal.aborted
      ? `No response within ${tuning.requestTimeoutMs}ms`
      : `Network error: ${(error as Error).message}`
    throw new ChatError(reason, { retryable: true })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new ChatError(await describeFailure(response), {
      status: response.status,
      retryable: RETRYABLE_STATUSES.has(response.status),
    })
  }

  let data: CompletionResponse
  try {
    data = (await response.json()) as CompletionResponse
  } catch (error) {
    throw new ChatError(`Malformed response: ${(error as Error).message}`, { retryable: false })
  }

  return cleanReply(data.choices?.[0]?.message?.content ?? '')
}

async function describeFailure(response: Response): Promise<string> {
  const detail = await readErrorDetail(response)

  switch (response.status) {
    case 402:
      return (
        'Pollinations returned 402: the shared anonymous request pool is out of credit. ' +
        `This is server-side, not a bad request — retrying will not help.${detail}`
      )
    case 429:
      return `Pollinations returned 429: per-IP limit is one request in flight, ~1 per 30s.${detail}`
    case 404:
      return `Pollinations returned 404: model "${MODEL}" is gone — check GET /models.${detail}`
    case 403:
      return `Pollinations returned 403: this IP appears to be blocked.${detail}`
    default:
      return `Chat API error: ${response.status}${detail}`
  }
}

/** Pulls the server's own explanation out of the error body when there is one. */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody
    const nested = body.details?.error?.message
    const top = typeof body.error === 'string' ? body.error : body.error?.message
    const message = nested ?? top
    return message ? ` (${message})` : ''
  } catch {
    return ''
  }
}

/**
 * openai-fast returns its reasoning in a separate field, but strip inline
 * <think> blocks defensively — including an unterminated one from a cut-off
 * response, which would otherwise be spoken aloud.
 */
function cleanReply(content: string): string {
  const stripped = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim()

  if (!stripped) {
    console.warn('[Chat] reply was empty after cleaning; using fallback')
    return FALLBACK_REPLY
  }
  return stripped
}

async function respectMinInterval(tuning: ChatTuning): Promise<void> {
  const wait = tuning.minRequestIntervalMs - (Date.now() - lastRequestAt)
  if (wait > 0) {
    await sleep(wait)
  }
  lastRequestAt = Date.now()
}

/** Jitter sits on top of the interval floor, so a retry never lands inside it. */
function backoffFor(attempt: number, tuning: ChatTuning): number {
  return tuning.retryFloorMs * attempt + Math.random() * tuning.retryJitterMs
}

function asChatError(error: unknown): ChatError {
  return error instanceof ChatError
    ? error
    : new ChatError((error as Error).message ?? 'Unknown chat error', { retryable: false })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
