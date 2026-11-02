/**
 * first-connect — timing and state of the central overlay shown while the app
 * connects for the FIRST time in a session (per bound server).
 *
 * Pure: `firstConnectPhase` says what to draw from the facts, so the component
 * only owns the clock. "Has connected" is one-way (false → true once), which is
 * what keeps a later connecting/connected flap from ever bringing it back.
 */

/** A first connection faster than this never paints the overlay. */
export const FIRST_CONNECT_DELAY_MS = 300
/** Still not connected after this long: offer Retry and Change server. */
export const FIRST_CONNECT_ACTIONS_MS = 10_000

export type FirstConnectPhase = 'hidden' | 'connecting' | 'stuck'

export function firstConnectPhase(input: {
  readonly hasConnected: boolean
  readonly dismissed: boolean
  readonly elapsedMs: number
}): FirstConnectPhase {
  if (input.hasConnected || input.dismissed) return 'hidden'
  if (input.elapsedMs < FIRST_CONNECT_DELAY_MS) return 'hidden'
  return input.elapsedMs >= FIRST_CONNECT_ACTIONS_MS ? 'stuck' : 'connecting'
}
