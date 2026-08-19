/**
 * Chat backend for the example app's Conversation Mode.
 *
 * Calls the Switchboard API's OpenAI proxy, authenticated with the same App ID and
 * App Secret the SDK is initialised with. The OpenAI key lives on the app's config in
 * the console and never reaches the device — this app only ever sees generated text.
 *
 * The proxy clamps the model, output length and history server-side, and rate limits
 * per app. It returns `Retry-After` on 429, which is honoured below.
 */

const DEFAULT_API_BASE_URL = 'https://api.switchboard.audio'

const SYSTEM_PROMPT =
  'You are a helpful, friendly voice assistant. Keep responses concise (1-2 sentences) since they will be spoken aloud.'

const FALLBACK_REPLY = 'Sorry, I could not generate a response.'

/** Transient only. 4xx other than 429 means the request or credentials are wrong. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const DEFAULT_TUNING = {
  /** Trailing history messages to send; the proxy trims further if needed. */
  historyMessages: 8,
  /** Light spacing so a fast conversation can't trip the proxy's limiter. */
  minRequestIntervalMs: 1_000,
  requestTimeoutMs: 20_000,
  maxAttempts: 3,
  baseBackoffMs: 2_000,
  maxBackoffMs: 10_000,
  /** Ceiling on total time in sendToChat, retries and spacing included. */
  totalBudgetMs: 45_000,
}

export type ChatTuning = typeof DEFAULT_TUNING

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatCredentials {
  appId: string
  appSecret: string
  /** Override the API host. Defaults to the production API. */
  apiBaseUrl?: string
}

export interface SendToChatOptions extends Partial<ChatTuning> {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface RequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ProxyResponse {
  success?: boolean
  message?: string
  data?: { text?: string; model?: string }
}

export class ChatError extends Error {
  readonly status?: number
  readonly retryable: boolean
  /** Server-specified wait, when it sent a Retry-After header. */
  readonly retryAfterMs?: number

  constructor(
    message: string,
    opts: { status?: number; retryable: boolean; retryAfterMs?: number }
  ) {
    super(message)
    this.name = 'ChatError'
    this.status = opts.status
    this.retryable = opts.retryable
    this.retryAfterMs = opts.retryAfterMs
  }
}

let credentials: ChatCredentials | null = null

/** Called once at startup with the same credentials passed to EdgeSpeechProvider. */
export function configureChat(next: ChatCredentials): void {
  credentials = next
}

/** Serialises requests so a burst of turns can't trip the proxy's per-app limiter. */
let queue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

export async function sendToChat(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  options: SendToChatOptions = {}
): Promise<string> {
  if (!credentials?.appId || !credentials?.appSecret) {
    throw new ChatError(
      'Chat is not configured — call configureChat() with your Switchboard App ID and Secret.',
      { retryable: false }
    )
  }

  const tuning: ChatTuning = { ...DEFAULT_TUNING, ...options }
  const doFetch = options.fetchImpl ?? fetch
  const messages = buildMessages(userMessage, conversationHistory, tuning)

  const run = () => requestWithRetry(messages, credentials as ChatCredentials, tuning, doFetch)
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/** Test seam: clears the spacing timer, in-flight queue and credentials. */
export function resetChatState(): void {
  queue = Promise.resolve()
  lastRequestAt = 0
  credentials = null
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
  creds: ChatCredentials,
  tuning: ChatTuning,
  doFetch: typeof fetch
): Promise<string> {
  const startedAt = Date.now()
  let lastError: ChatError | undefined

  for (let attempt = 1; attempt <= tuning.maxAttempts; attempt++) {
    await respectMinInterval(tuning)

    try {
      return await postChat(messages, creds, tuning, doFetch)
    } catch (error) {
      lastError = asChatError(error)

      const wait = lastError.retryAfterMs ?? backoffFor(attempt, tuning)
      const budgetLeft = tuning.totalBudgetMs - (Date.now() - startedAt)
      if (!lastError.retryable || attempt === tuning.maxAttempts || wait > budgetLeft) {
        break
      }

      console.warn(
        `[Chat] attempt ${attempt}/${tuning.maxAttempts} failed (${lastError.message}); ` +
          `retrying in ${Math.round(wait)}ms`
      )
      await sleep(wait)
    }
  }

  throw lastError ?? new ChatError('Chat request failed', { retryable: false })
}

async function postChat(
  messages: RequestMessage[],
  creds: ChatCredentials,
  tuning: ChatTuning,
  doFetch: typeof fetch
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), tuning.requestTimeoutMs)

  const baseUrl = (creds.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')

  let response: Response
  try {
    response = await doFetch(`${baseUrl}/openai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: creds.appId,
        appSecret: creds.appSecret,
        messages,
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
      retryAfterMs: retryAfterMs(response),
    })
  }

  let body: ProxyResponse
  try {
    body = (await response.json()) as ProxyResponse
  } catch (error) {
    throw new ChatError(`Malformed response: ${(error as Error).message}`, { retryable: false })
  }

  const text = body.data?.text?.trim()
  if (!text) {
    console.warn('[Chat] proxy returned no text; using fallback')
    return FALLBACK_REPLY
  }
  return text
}

async function describeFailure(response: Response): Promise<string> {
  const detail = await readErrorDetail(response)

  switch (response.status) {
    case 401:
      return `Switchboard rejected the app credentials.${detail}`
    case 429:
      return `Rate limited by the chat proxy.${detail}`
    default:
      return `Chat API error: ${response.status}${detail}`
  }
}

/** The proxy always answers with { success, message } — surface its message. */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ProxyResponse & { error?: { message?: string } }
    const message = body.message ?? body.error?.message
    return message ? ` (${message})` : ''
  } catch {
    return ''
  }
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers?.get?.('Retry-After')
  if (!header) {
    return undefined
  }
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined
}

async function respectMinInterval(tuning: ChatTuning): Promise<void> {
  const wait = tuning.minRequestIntervalMs - (Date.now() - lastRequestAt)
  if (wait > 0) {
    await sleep(wait)
  }
  lastRequestAt = Date.now()
}

/** Exponential backoff with full jitter, used when the server sends no Retry-After. */
function backoffFor(attempt: number, tuning: ChatTuning): number {
  const ceiling = Math.min(tuning.maxBackoffMs, tuning.baseBackoffMs * 2 ** (attempt - 1))
  return Math.random() * ceiling
}

function asChatError(error: unknown): ChatError {
  return error instanceof ChatError
    ? error
    : new ChatError((error as Error).message ?? 'Unknown chat error', { retryable: false })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
