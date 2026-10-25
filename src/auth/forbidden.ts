/**
 * Central detection of a hub `FORBIDDEN` — the scope gate refusing a call.
 *
 * `UNAUTHORIZED` means the session is gone and the app must bounce to login
 * (`unauthorized.ts`). `FORBIDDEN` means the session is fine and this specific
 * call is outside its scope, so the app must NOT log anyone out and must NOT
 * shout: the hub is the authority, it refused, and nothing is broken.
 *
 * It is, however, always a viewer BUG. Every actuating surface is supposed to
 * be hidden from a session that cannot use it (`hooks/user-scope.ts`), so a
 * FORBIDDEN means either a control was drawn that should not have been, or a
 * query fired for a device the session cannot reach. There is exactly one way
 * to find that out after the fact, and it is a log line with a name you can
 * grep for — the alternative, the silent swallow this cache already does with
 * every non-auth error, reads as "it never happened".
 *
 * Matched structurally, for the same reason `unauthorized.ts` is: the SDK
 * crosses a self-contained-addon boundary, so its error class identity is not
 * stable here.
 */
import { log } from '../lib/logger.js'

/** Grep for this in the device logs, in Settings → Logs, and in Loki. */
export const SCOPE_GATE_LOG_SCOPE = 'scope-gate'

function readCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const code: unknown = Reflect.get(value, 'code')
  return typeof code === 'string' ? code : null
}

/** True when `err` is (or wraps) a tRPC `FORBIDDEN` rejection. */
export function isForbiddenError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false

  const data: unknown = Reflect.get(err, 'data')
  if (readCode(data) === 'FORBIDDEN') return true
  const shape: unknown = Reflect.get(err, 'shape')
  if (typeof shape === 'object' && shape !== null && readCode(Reflect.get(shape, 'data')) === 'FORBIDDEN') {
    return true
  }

  const message: unknown = Reflect.get(err, 'message')
  return typeof message === 'string' && message.includes('FORBIDDEN')
}

/** A short, greppable description of what the hub refused. */
export function describeRefusal(err: unknown, source: string): string {
  const message: unknown = typeof err === 'object' && err !== null ? Reflect.get(err, 'message') : null
  return `${source}: ${typeof message === 'string' && message.length > 0 ? message : 'FORBIDDEN'}`
}

/**
 * Record a refusal the UI should never have provoked.
 *
 * Deliberately NOT user-facing: the operator did nothing wrong, and this app
 * has no toast layer to abuse anyway. Two sinks because they answer different
 * questions — `console.warn` is what a developer sees live with the app
 * attached, `log.warn` is what reaches the hub (warn always ships) so the same
 * fault is findable from a phone nobody is holding.
 */
export function reportOutOfScopeCall(source: string, err: unknown): void {
  const detail = describeRefusal(err, source)
  console.warn(`[${SCOPE_GATE_LOG_SCOPE}]`, 'hub refused an out-of-scope call the UI offered anyway', detail)
  log.warn(SCOPE_GATE_LOG_SCOPE, 'refused out-of-scope call', { source, detail })
}

// ── What a refusal means for the session's role ─────────────────────────────

/**
 * A refusal is also news about the ROLE: the hub re-reads a person's scope
 * every minute, while `auth.me` is fetched once per session. A viewer whose
 * feature an admin just switched off keeps the section until the role is
 * asked again — so every refusal asks again, at most once per
 * {@link FORBIDDEN_ROLE_REFRESH_COOLDOWN_MS}, and the section disappears
 * instead of failing on every open.
 *
 * Module-level like `unauthorized-signal.ts`: the QueryClient is built before
 * the React tree, and `capQuery` swallows its errors before any cache sees
 * them.
 */
export const FORBIDDEN_ROLE_REFRESH_COOLDOWN_MS = 30_000

let forbiddenHandler: (() => void) | null = null
let lastForbiddenSignalAt = Number.NEGATIVE_INFINITY

/** Wire the role refresh. Idempotent; `null` detaches. */
export function setForbiddenHandler(handler: (() => void) | null): void {
  forbiddenHandler = handler
  lastForbiddenSignalAt = Number.NEGATIVE_INFINITY
}

/** Report one refusal; the handler runs at most once per cool-down. */
export function signalForbidden(now: number = Date.now()): void {
  if (forbiddenHandler === null) return
  if (now - lastForbiddenSignalAt < FORBIDDEN_ROLE_REFRESH_COOLDOWN_MS) return
  lastForbiddenSignalAt = now
  forbiddenHandler()
}

// ── What the operator is told ───────────────────────────────────────────────

/** The one sentence a refused action shows, in both locales. */
export const NOT_FOR_YOUR_ACCOUNT_KEY = 'v2.access.notForYourAccount'

/**
 * The i18n key for a failed action's message: a refusal says the action is
 * not available for this account — never the generic failure, which would
 * send the person looking for a fault that is not there.
 */
export function refusalAwareKey(err: unknown, fallbackKey: string): string {
  return isForbiddenError(err) ? NOT_FOR_YOUR_ACCOUNT_KEY : fallbackKey
}
