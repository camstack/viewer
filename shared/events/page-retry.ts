/**
 * page-retry — when a failed events page is asked again, and how long to wait.
 *
 * One policy for every surface on this feed (the cameras reel, a camera's reel,
 * the gallery, the embed). A blip — the app waking, a node that missed one
 * round — heals on the next try, and showing the error band for it is what the
 * operator reported. An answer that cannot change (the session was refused, the
 * procedure is not there) is shown at once: retrying it only delays the truth.
 *
 * The schedule is ~1s, then ~2s, then ~4s, each with a little jitter so a row
 * of clients that failed together do not retry together, and never past the
 * cap. Four attempts in all; the fourth failure is the one the surface admits.
 */

/** Tries before the surface admits the error. The first call counts as one. */
export const PAGE_RETRY_ATTEMPTS = 4

/** Delay before the retry that follows the first failure, before jitter. */
export const PAGE_RETRY_BASE_MS = 1_000

/** No wait grows past this, jitter included. The third step sits on it. */
export const PAGE_RETRY_CAP_MS = 4_000

const TERMINAL_CODES: ReadonlySet<string> = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'])
const TERMINAL_HTTP: ReadonlySet<number> = new Set([401, 403, 404])

/** Jitter band around a step: 0.8× … 1.2×. Tight on purpose — "~1s" must stay
 *  near a second, not collapse to nothing and flash the error anyway. */
const JITTER_MIN = 0.8
const JITTER_SPAN = 0.4

function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const found: unknown = Reflect.get(value, key)
  return typeof found === 'string' ? found : null
}

function readNumber(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) return null
  const found: unknown = Reflect.get(value, key)
  return typeof found === 'number' ? found : null
}

function dataOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return null
  return Reflect.get(error, 'data')
}

function shapeDataOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return null
  const shape: unknown = Reflect.get(error, 'shape')
  if (typeof shape !== 'object' || shape === null) return null
  return Reflect.get(shape, 'data')
}

function messageOf(error: unknown): string | null {
  if (typeof error === 'string') return error
  return readString(error, 'message')
}

function codeIsTerminal(code: string | null): boolean {
  return code !== null && TERMINAL_CODES.has(code)
}

function httpIsTerminal(status: number | null): boolean {
  return status !== null && TERMINAL_HTTP.has(status)
}

function messageIsTerminal(message: string | null): boolean {
  if (message === null) return false
  return message.includes('UNAUTHORIZED') || message.includes('FORBIDDEN') || message.includes('NOT_FOUND')
}

/**
 * True when another try cannot change the answer: auth refused, or the hub
 * has no such procedure. A timeout, a dropped socket and a 5xx are not this.
 */
export function isTerminalPageError(error: unknown): boolean {
  if (codeIsTerminal(readString(dataOf(error), 'code'))) return true
  if (httpIsTerminal(readNumber(dataOf(error), 'httpStatus'))) return true
  if (codeIsTerminal(readString(shapeDataOf(error), 'code'))) return true
  if (httpIsTerminal(readNumber(shapeDataOf(error), 'httpStatus'))) return true
  return messageIsTerminal(messageOf(error))
}

/**
 * How long to wait before the next try, after `failureIndex` failures of the
 * current page (0 = the first failure).
 *
 * `null` means do not retry: the budget is spent, or the error is terminal.
 * `random` is injectable so a spec can pin the jitter.
 */
export function pageRetryDelayMs(
  failureIndex: number,
  error: unknown,
  random: () => number = Math.random,
): number | null {
  if (isTerminalPageError(error)) return null
  if (!Number.isInteger(failureIndex) || failureIndex < 0) return null
  if (failureIndex + 1 >= PAGE_RETRY_ATTEMPTS) return null
  const step = Math.min(PAGE_RETRY_CAP_MS, PAGE_RETRY_BASE_MS * 2 ** failureIndex)
  const unit = Math.min(1, Math.max(0, random()))
  const jittered = Math.round(step * (JITTER_MIN + unit * JITTER_SPAN))
  return Math.min(PAGE_RETRY_CAP_MS, jittered)
}
