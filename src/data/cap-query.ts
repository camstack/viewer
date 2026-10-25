/**
 * Shared defensive helpers for accessing device-scoped tRPC cap endpoints.
 *
 * The viewer's tRPC client is a v11 proxy (`createTRPCClient`). Its nodes are
 * callable PROXIES — `typeof` is 'function', NOT 'object' — so an `isRecord`
 * guard would wrongly report a router or method as missing. We instead read the
 * leaf `.query` (the proxy yields a function for any path) and call it; a
 * genuinely-absent server procedure surfaces as a thrown NOT_FOUND, which we
 * swallow to null. No SDK type regen needed.
 *
 * Both helpers are used by every data hook that accesses device-scoped caps
 * (recording, pipelineAnalytics, etc.).
 */

import { reportSessionEnded } from '../auth/session-ended.js'
import { isForbiddenError, signalForbidden } from '../auth/forbidden.js'
import { log } from '../lib/logger.js'
import {
  BOOT_QUERY_DEADLINE_MS,
  withQueryDeadline,
  isQueryDeadlineError,
} from './query-deadline.js'

/**
 * Deadline for a single device-scoped cap call.
 *
 * These are the calls that reach a device's OWNING node — `motion.getStatus`,
 * `battery.getStatus`, `doorbell.getStatus`, the per-camera switch reads. When
 * that node is crash-looping the hub routes the call and then waits its full
 * 60s transport ceiling, and `capQuery` (which already absorbs the ERROR) had
 * no answer for the LATENCY: the caller simply never got its `null`.
 *
 * Shorter than the boot-query default: one camera's badge is worth far less
 * waiting than the camera list itself, and every one of these already has a
 * defined "we don't know" answer (`null`) that the UI renders happily.
 */
export const CAP_QUERY_DEADLINE_MS = 6_000

/**
 * Deadline for a cap call that reads a PAGE OF HISTORY rather than one device's
 * current state.
 *
 * {@link CAP_QUERY_DEADLINE_MS} is sized against a badge — "one camera's badge
 * is worth far less waiting than the camera list itself" — and for a while it
 * was the only bound this module had, applied uniformly to every cap call
 * including the heaviest read in the app. That is how the camera timeline came
 * to draw an empty day: `pipelineAnalytics.listTracks` for a busy camera
 * measured 7.9 MB, which does not deserialize on a phone in six seconds, so the
 * call was abandoned and the screen showed a quiet camera instead of a failure.
 *
 * A bulk read has none of the badge's properties. It is issued once per screen
 * rather than per camera, it has no cheap "we don't know" rendering, and its
 * honest cost is dominated by bytes rather than by whether some node is
 * answering — so the number that must bound it is the one sized against a real
 * healthy payload, not against a status probe.
 *
 * Deliberately equal to {@link BOOT_QUERY_DEADLINE_MS}: these calls are the same
 * kind of thing as the camera list, and two constants that mean "a big read"
 * would drift apart.
 */
export const BULK_QUERY_DEADLINE_MS = BOOT_QUERY_DEADLINE_MS

/**
 * How a caller wants a cap failure handled.
 *
 * `rethrow` exists because {@link capQuery}'s `null` collapses three different
 * events into one: the hub has no such cap, the call failed, and the call never
 * answered. For a badge that is right — all three render as "unknown". For a
 * list that fills a screen it is a lie: React Query records a SUCCESS with an
 * empty array, so `isError` is false, no retry runs, and an unreadable day is
 * painted as an empty one. With `rethrow` the first case still returns `null`
 * (an absent feature is a real answer) while the other two propagate.
 */
export interface CapQueryOptions {
  /** Override the default {@link CAP_QUERY_DEADLINE_MS}. */
  readonly deadlineMs?: number
  /** Propagate a deadline expiry / server error instead of swallowing it. */
  readonly rethrow?: boolean
}

/**
 * Any cap input object.
 *
 * Deliberately NOT `Record<string, unknown>`. A request shape declared the way
 * this codebase requires — a named `interface` — has no implicit index
 * signature, so that constraint rejects precisely the well-typed callers and
 * accepts only the loose ones. The parameter is read back through
 * {@link isRecord}, which is where the narrowing belongs.
 */
export type CapQueryInput = object

/** True when `v` is a non-null object (narrows to Record). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** The `deviceId` a cap input carries, when it carries one — the tag every log
 *  line about a device is required to have. */
function inputDeviceId(input: CapQueryInput | undefined): unknown {
  return isRecord(input) ? input.deviceId : undefined
}

/**
 * Call `<cap>.<method>.query(input)` defensively; returns null on any
 * error, missing router, or missing method.
 *
 * @param client  - tRPC proxy client cast as Record.
 * @param cap     - Top-level router name (e.g. `'recording'`, `'pipelineAnalytics'`).
 * @param method  - Procedure name under that router (e.g. `'getAvailability'`).
 * @param input   - Input object forwarded verbatim to the query. Omit for
 *                  `z.void()` procedures (e.g. `faceGallery.listIdentities`) —
 *                  passing `{}` would fail their input validation.
 * @param options - See {@link CapQueryOptions}. Omitted = today's exact
 *                  behaviour (badge deadline, every failure swallowed to null).
 */
export async function capQuery(
  client: Record<string, unknown>,
  cap: string,
  method: string,
  input?: CapQueryInput,
  options?: CapQueryOptions,
): Promise<unknown> {
  try {
    const router = (client as Record<string, unknown>)[cap]
    if (router === undefined || router === null) return null
    const fn = (router as Record<string, unknown>)[method]
    const query = fn != null ? (fn as { query?: unknown }).query : undefined
    if (typeof query !== 'function') return null
    // Bounded. A cap call routed at a node that is crash-looping never settles,
    // and an unbounded `await` here means the calling hook stays `isLoading`
    // for the rest of the session — the shape of the 2026-08-08 outage.
    // A void procedure (`z.void()`, e.g. `auth.me`) MUST be called with no
    // argument. Forwarding the omitted `input` as `undefined` lets SuperJSON
    // serialize `{ json: null }`, Zod rejects it, and this function then
    // swallows the error to `null` — which is how `useMe` cached "not admin"
    // for a session that `auth.me` would have confirmed.
    const pending =
      input === undefined
        ? (query as () => Promise<unknown>)()
        : (query as (i: CapQueryInput) => Promise<unknown>)(input)
    return await withQueryDeadline(
      pending,
      `${cap}.${method}`,
      options?.deadlineMs ?? CAP_QUERY_DEADLINE_MS,
    )
  } catch (e) {
    // This helper turns every failure into `null` BY DESIGN, which made a
    // revoked session invisible: the poll kept "succeeding" as anonymous.
    // Report an UNAUTHORIZED before it is swallowed (one renewal per burst).
    reportSessionEnded(e)
    // A refusal is news about the role: ask `auth.me` again (cool-down bound).
    if (isForbiddenError(e)) signalForbidden()
    // A deadline expiry is NOT the same event as a provider failing, and
    // conflating them is how "one node is down" reads as "the app is broken".
    // Both still yield `null` — the caller's contract is unchanged — but the
    // line says which happened, and a deviceId in the input is carried through
    // so the fault can be asked per-camera.
    if (isQueryDeadlineError(e)) {
      log.warn('cap', `"${cap}.${method}" hit its deadline — node not answering`, {
        deviceId: inputDeviceId(input),
        deadlineMs: e.deadlineMs,
      })
      if (options?.rethrow === true) throw e
      return null
    }
    log.warn('cap', `"${cap}.${method}" failed`, {
      error: e instanceof Error ? e.message : String(e),
      deviceId: inputDeviceId(input),
    })
    if (options?.rethrow === true) throw e
    return null
  }
}

/**
 * Call `<cap>.<method>.mutate(input)` defensively; returns null on any error,
 * missing router, or missing method. Mutation twin of {@link capQuery} — used
 * for endpoints newer than the pinned SDK router types, whose responses callers
 * validate at the boundary.
 */
export async function capMutate(
  client: Record<string, unknown>,
  cap: string,
  method: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    const router = (client as Record<string, unknown>)[cap]
    if (router === undefined || router === null) return null
    const fn = (router as Record<string, unknown>)[method]
    const mutate = fn != null ? (fn as { mutate?: unknown }).mutate : undefined
    if (typeof mutate !== 'function') return null
    return await (mutate as (i: Record<string, unknown>) => Promise<unknown>)(input)
  } catch (e) {
    reportSessionEnded(e)
    log.warn('cap', `"${cap}.${method}" failed`, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Mutation variant that KEEPS the reason it failed.
 *
 * {@link capMutate} collapses a refused write, an absent router and an absent
 * method into the same `null`, which is right for a fire-and-forget control but
 * wrong wherever the operator has to be TOLD. A per-camera function switch is
 * the second kind: an optimistic toggle that reverts with no explanation is
 * indistinguishable from a UI glitch, and "the hub refused this because you are
 * not an admin" is the one message that stops the operator retrying forever.
 *
 * Throws with the server's message; a missing router/method throws too, because
 * a hub too old to have the procedure is a real answer and not a silent no-op.
 */
export async function capMutateOrThrow(
  client: Record<string, unknown>,
  cap: string,
  method: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const router = (client as Record<string, unknown>)[cap]
  if (router === undefined || router === null) throw new Error(`${cap} is not available`)
  const fn = (router as Record<string, unknown>)[method]
  const mutate = fn != null ? (fn as { mutate?: unknown }).mutate : undefined
  if (typeof mutate !== 'function') throw new Error(`${cap}.${method} is not available`)
  try {
    return await (mutate as (i: Record<string, unknown>) => Promise<unknown>)(input)
  } catch (e) {
    reportSessionEnded(e)
    throw e
  }
}
