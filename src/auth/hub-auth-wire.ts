/**
 * Minimal raw-fetch client for the hub's auth mutations that run OUTSIDE the
 * live connection: the public ones (`auth.exchangeSession`,
 * `auth.redeemHandoffCode`, `auth.refreshSession`) and the bearer-authenticated
 * `auth.logout`.
 *
 * Deliberately NOT the SDK: the exchange must send the browser's httpOnly
 * session cookie (`credentials: 'include'`) plus a custom CSRF header — neither
 * is configurable on the SDK's tRPC links — and the handoff redeem, the
 * session refresh and a sign-out run when no System exists (cold start, a
 * server that is not the active one). The wire format below (single-call tRPC
 * v11 + superjson envelope) is pinned by a server-side HTTP contract test
 * (`auth-router-exchange-session.spec.ts`).
 */
import { z } from 'zod'

/** Superjson envelope of a successful single tRPC call. */
const TrpcResultEnvelopeSchema = z.object({
  result: z.object({
    data: z.object({ json: z.unknown() }),
  }),
})

/** Superjson envelope of a refused single tRPC call — only the message is read. */
const TrpcErrorEnvelopeSchema = z.object({
  error: z.object({ json: z.object({ message: z.string() }) }),
})

/**
 * What every session-minting auth mutation returns — the hub's LoginResult
 * wire shape. `refreshToken` is present only from a hub that has login
 * sessions (D812) AND was asked for one (`refreshable: true`); its absence is
 * how an older hub is told apart.
 */
const HubLoginResultSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string(),
    username: z.string(),
    isAdmin: z.boolean(),
  }),
  refreshToken: z.string().min(1).optional(),
})

export type HubAuthOutcome =
  | {
      readonly status: 'ok'
      readonly token: string
      readonly username: string
      /** `null` from a hub without refreshing sessions. */
      readonly refreshToken: string | null
    }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'error'; readonly message: string }

/** One raw tRPC mutation, as the transport saw it. */
export type WireOutcome =
  | { readonly status: 'ok'; readonly data: unknown }
  /** 401 — the credential presented was refused. */
  | { readonly status: 'unauthorized'; readonly message: string | null }
  /** 403 — the caller is known but this call is not allowed. */
  | { readonly status: 'forbidden'; readonly message: string | null }
  /** 404 — the hub has no such procedure (an older hub). */
  | { readonly status: 'missing' }
  /** Anything else: network, 5xx, 429, a 400 (an input this hub does not
   *  take), an unreadable answer. `httpStatus` when the hub answered. */
  | { readonly status: 'error'; readonly message: string; readonly httpStatus?: number }

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface TrpcMutationInput {
  readonly baseUrl: string
  readonly procedure: string
  /** Serialized as the superjson `json` payload; `undefined` for a void input. */
  readonly input?: unknown
  /** Sent as `Authorization: Bearer …`. */
  readonly bearer?: string
  readonly headers?: Record<string, string>
  /** 'include' on the cookie-authenticated exchange; omitted otherwise. */
  readonly credentials?: RequestCredentials
  readonly fetchFn?: FetchLike
  /** Abandon the request after this long (a network `error` outcome). Omitted = no bound. */
  readonly timeoutMs?: number
}

/** Superjson's own encoding of `undefined` — what a tRPC client sends for a
 *  procedure called with no input. An empty body is not valid JSON there. */
const VOID_BODY = '{"json":null,"meta":{"values":["undefined"],"v":1}}'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const parsed = TrpcErrorEnvelopeSchema.safeParse(await response.json())
    return parsed.success ? parsed.data.error.json.message : null
  } catch {
    return null
  }
}

/** POST one tRPC mutation. Never throws — callers branch on the outcome. */
export async function postTrpcMutation(opts: TrpcMutationInput): Promise<WireOutcome> {
  const fetchFn = opts.fetchFn ?? fetch
  const url = `${trimTrailingSlash(opts.baseUrl)}/trpc/${opts.procedure}`
  let response: Response
  const controller = opts.timeoutMs === undefined ? null : new AbortController()
  const timer = controller === null ? null : setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    response = await fetchFn(url, {
      ...(controller !== null ? { signal: controller.signal } : {}),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.bearer !== undefined ? { authorization: `Bearer ${opts.bearer}` } : {}),
        ...(opts.headers ?? {}),
      },
      ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
      body: opts.input === undefined ? VOID_BODY : JSON.stringify({ json: opts.input }),
    })
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network request failed',
    }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
  if (response.status === 401) return { status: 'unauthorized', message: await readErrorMessage(response) }
  if (response.status === 403) return { status: 'forbidden', message: await readErrorMessage(response) }
  if (response.status === 404) return { status: 'missing' }
  if (!response.ok) {
    return { status: 'error', message: `HTTP ${response.status}`, httpStatus: response.status }
  }
  try {
    const envelope = TrpcResultEnvelopeSchema.parse(await response.json())
    return { status: 'ok', data: envelope.result.data.json }
  } catch {
    return { status: 'error', message: 'Unexpected response shape' }
  }
}

/**
 * POST a session-minting auth mutation and narrow the answer into a login
 * outcome. 401/403 → `unauthorized`; anything else unexpected → `error`.
 */
export async function postHubAuthMutation(opts: TrpcMutationInput): Promise<HubAuthOutcome> {
  const outcome = await postTrpcMutation(opts)
  if (outcome.status === 'unauthorized' || outcome.status === 'forbidden') {
    return { status: 'unauthorized' }
  }
  if (outcome.status === 'missing') return { status: 'error', message: 'HTTP 404' }
  if (outcome.status === 'error') return { status: 'error', message: outcome.message }
  const result = HubLoginResultSchema.safeParse(outcome.data)
  if (!result.success) return { status: 'error', message: 'Unexpected response shape' }
  return {
    status: 'ok',
    token: result.data.token,
    username: result.data.user.username,
    refreshToken: result.data.refreshToken ?? null,
  }
}
