/**
 * Pure presentation logic for the `event-emitter` accessory row.
 *
 * An event emitter (wall switch, remote, scene controller) is a PURE INPUT
 * device: the row can never actuate it, only report what it last fired. Two
 * decisions live here so they can be asserted without a renderer — this repo's
 * unit suite is node-only:
 *
 *  - which button / event type / age to print, and
 *  - when the row should FLASH.
 *
 * The flash is keyed on `seq`, the cap's monotonic counter, and on nothing
 * else. Two presses of the same button carry the same `eventType` and can
 * carry the same wall-clock second; keyed on either of those the second press
 * would be invisible, which on an input-only device reads exactly like a dead
 * radio.
 *
 * `data.channel` is OPTIONAL and vendor-agnostic: a single-button emitter and
 * a generic bus event carry none, and the row must still render.
 */

/** The `lastEvent` fields this module reads (a structural subset of `EventFire`). */
export interface EventFireLike {
  readonly eventType: string
  readonly data: Record<string, unknown> | null
  readonly timestamp: number
  readonly seq: number
}

/**
 * The button index in `data.channel`, or `null` when the device reports none.
 * Non-integer / negative values are rejected — a bogus index reads as a real
 * button, which is worse than showing no button at all.
 */
export function channelIndexOf(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null
  const raw = data.channel
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return null
  return raw
}

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Compact age of the last event: `now`, `3s`, `5m`, `2h`, `3d`. Second-granular
 * on purpose — the window an operator watches while pressing the button is the
 * first ten seconds. `now` is injected so this is testable without a clock.
 */
export function formatEventAgo(timestampMs: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - timestampMs)
  if (delta < SECOND_MS) return 'now'
  if (delta < MINUTE_MS) return `${String(Math.floor(delta / SECOND_MS))}s`
  if (delta < HOUR_MS) return `${String(Math.floor(delta / MINUTE_MS))}m`
  if (delta < DAY_MS) return `${String(Math.floor(delta / HOUR_MS))}h`
  return `${String(Math.floor(delta / DAY_MS))}d`
}

/**
 * Compose the row text from its already-localised parts. Kept pure (and free of
 * `t`) so the ORDER and the separators are asserted once, in a test, rather
 * than trusted across two languages.
 */
export function composeEventLabel(
  buttonLabel: string | null,
  eventType: string,
  ago: string,
): string {
  return [buttonLabel, eventType, ago].filter((p): p is string => p !== null && p !== '').join(' · ')
}

/** What the row knows about flashing: the last seq it saw, and whether the
 *  highlight is currently lit. */
export interface FlashState {
  readonly seq: number | null
  readonly flashing: boolean
}

/** Nothing seen yet. */
export const IDLE_FLASH: FlashState = { seq: null, flashing: false }

/**
 * Advance the flash state for a newly observed `seq`.
 *
 * - no event at all → idle;
 * - FIRST seq observed → remembered, but NOT flashed: the row mounting on an
 *   hours-old press must not pretend the button was just pressed;
 * - the SAME seq re-delivered (a reconcile refetch re-running the guard) →
 *   the previous state, by identity, so the row does not re-render;
 * - a HIGHER (or simply different) seq → flash.
 */
export function nextFlashState(previous: FlashState, seq: number | null): FlashState {
  if (seq === null) return previous.seq === null && !previous.flashing ? previous : IDLE_FLASH
  if (previous.seq === null) return { seq, flashing: false }
  if (previous.seq === seq) return previous
  return { seq, flashing: true }
}

/** Clear a lit highlight; identity-stable when nothing is lit. */
export function clearFlash(previous: FlashState): FlashState {
  return previous.flashing ? { seq: previous.seq, flashing: false } : previous
}
