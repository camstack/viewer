/**
 * crash-record — the pure rules for answering ONE question after the fact:
 * why did the previous JS runtime stop?
 *
 * ## The gap this closes
 *
 * On 2026-08-20 the operator reported "since the last OTA the app often crashes
 * when I open it". The hub's forwarded app logs proved it — `markBoot` is
 * one-shot per runtime (`connection/boot-timeline.ts`), and four separate
 * `stage transportReady` lines with a resetting `atMs` arrived inside one hour,
 * two of them with no `app background` in between. The app restarted itself.
 *
 * And that is ALL the logs could say, because a viewer runtime cannot currently
 * explain its own death:
 *
 *  - `ErrorUtils` had no handler, so a fatal JS error killed the app silently.
 *  - There was no root error boundary, so a render throw did the same.
 *  - The shipper flushes on a 4 s interval with no persistence (`lib/logger.ts`),
 *    so whatever WAS logged in the final moments died with the process.
 *  - Nothing recorded why a runtime STARTED, and `OtaUpdateGate` legitimately
 *    calls `Updates.reloadAsync()` at launch — which produces a brand-new
 *    runtime, a fresh `BootTimeline` and a second `transportReady`, completely
 *    indistinguishable from a crash in the hub's logs.
 *
 * So the same evidence fits "the app crashed" and "the app applied an update",
 * and no amount of reading the logs harder separates them.
 *
 * ## The marker, and why "vanished" is the important answer
 *
 * A runtime writes a marker saying it is RUNNING, and overwrites it on the way
 * out with the reason — an OTA reload, a fatal, a caught render error. The next
 * launch reads it, states it, and re-arms it.
 *
 * The valuable outcome is the one nobody writes: a marker still saying
 * `running` means the previous runtime was alive and never got to say goodbye.
 * That is an OS kill (jetsam / memory), a NATIVE crash, or a force-quit — the
 * three causes no JS handler can ever observe, and precisely the ones a
 * "crashes on open" report is most likely to be. Naming it separates them from
 * the reloads for good.
 *
 * Everything here is pure and total: a parse that throws while classifying a
 * crash would be its own outage.
 */

/** How the previous runtime ended, as the next launch is able to state it. */
export type PreviousExit =
  /** No marker at all: a first install, cleared storage, or a downgrade. */
  | 'first-launch'
  /** `OtaUpdateGate` fetched an update and reloaded on purpose. NOT a crash. */
  | 'ota-reload'
  /** A JS error reached the global handler. `message`/`stack` are carried. */
  | 'js-fatal'
  /** A React render threw and the root boundary caught it. */
  | 'render-error'
  /** The app went to the background and was never resumed — the operator
   *  swiped it away, or the OS reclaimed a suspended process. **Not a crash.**
   *
   *  This state exists because without it there was nothing to write on a
   *  normal close, so the marker stayed `running` and every close came back as
   *  `vanished`: 57 of them in 72 hours across twelve app versions
   *  (2026-08-26). The false alarms were the smaller half of the damage — the
   *  real one was that a FOREGROUND kill, the failure actually being reported,
   *  looked exactly like quitting the app and could never be isolated. */
  | 'backgrounded'
  /** The marker still said `running`: the runtime died **while frontmost**,
   *  without a JS-visible cause — an OS memory kill or a native crash.
   *
   *  Force-quitting no longer lands here. It used to, and this comment used to
   *  say so, which meant the union openly could not tell a crash from the
   *  operator closing the app while `isCrashExit` counted both. */
  | 'vanished'

/** What a runtime writes about itself. `running` is re-armed at every launch,
 *  and again on every return to the foreground — otherwise a session that was
 *  backgrounded once would report `backgrounded` for a kill that happened much
 *  later, with the app in the operator's hands. */
export type ExitKind = 'running' | 'backgrounded' | 'ota-reload' | 'js-fatal' | 'render-error'

export interface ExitMarker {
  readonly kind: ExitKind
  /** When the marker was written, epoch ms. */
  readonly at: number
  /** Present for the two failure kinds. */
  readonly message?: string
  readonly stack?: string
}

/** A thrown value reduced to the two fields worth shipping. */
export interface ThrownDescription {
  readonly message: string
  readonly stack: string | null
}

/** How much stack to carry. A marker lives in AsyncStorage and is re-shipped on
 *  the next launch; the top frames are the ones that name the module. */
export const CRASH_STACK_MAX_CHARS = 2_000

/** Reduce anything a `throw` can produce to a message and a bounded stack. */
export function describeThrown(thrown: unknown): ThrownDescription {
  if (thrown instanceof Error) {
    const stack = typeof thrown.stack === 'string' ? thrown.stack : null
    return {
      message: `${thrown.name}: ${thrown.message}`,
      stack: stack === null ? null : stack.slice(0, CRASH_STACK_MAX_CHARS),
    }
  }
  // A string, a rejected non-Error, `undefined` from a bad `throw` — all real,
  // and all previously invisible. Never let the description itself throw.
  try {
    return { message: String(thrown), stack: null }
  } catch {
    return { message: 'unstringifiable thrown value', stack: null }
  }
}

/** Serialise a marker. Total: a marker that cannot be written is a marker that
 *  reads as `vanished` next launch, which is the wrong answer, so this never
 *  throws and falls back to the minimum that still classifies. */
export function serializeExitMarker(marker: ExitMarker): string {
  try {
    return JSON.stringify(marker)
  } catch {
    return JSON.stringify({ kind: marker.kind, at: marker.at })
  }
}

function readStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isExitKind(value: unknown): value is ExitKind {
  return (
    value === 'running' ||
    value === 'backgrounded' ||
    value === 'ota-reload' ||
    value === 'js-fatal' ||
    value === 'render-error'
  )
}

/**
 * Parse a stored marker. Anything unrecognised answers null, which classifies
 * as `first-launch` — never as a crash. A corrupt marker inventing a fatal
 * would send the next session chasing a crash that did not happen.
 */
export function parseExitMarker(raw: string | null): ExitMarker | null {
  if (raw === null || raw.length === 0) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null
  const source: Record<string, unknown> = { ...decoded }
  const kind: unknown = source['kind']
  if (!isExitKind(kind)) return null
  const at: unknown = source['at']
  return {
    kind,
    at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    message: readStringField(source, 'message'),
    stack: readStringField(source, 'stack'),
  }
}

/** What the previous runtime's last marker means. */
export function classifyPreviousExit(marker: ExitMarker | null): PreviousExit {
  if (marker === null) return 'first-launch'
  return marker.kind === 'running' ? 'vanished' : marker.kind
}

/** Did the previous runtime end in a way the operator would call a crash?
 *
 *  An OTA reload is a restart the app performed ON PURPOSE and must never be
 *  counted as one — conflating the two is the whole reason this module exists.
 *  `backgrounded` is here for the same reason and was added later, at the cost
 *  of a real bug hiding for weeks behind the noise it made.
 *
 *  What is deliberately NOT distinguished: an app the OS reclaimed while
 *  suspended reads `backgrounded`, same as one the operator swiped away. That
 *  is the right trade — reclaiming a backgrounded app is ordinary OS behaviour
 *  on both platforms, and treating it as a crash is what buried the foreground
 *  kill in the first place. */
export function isCrashExit(exit: PreviousExit): boolean {
  return exit === 'js-fatal' || exit === 'render-error' || exit === 'vanished'
}
