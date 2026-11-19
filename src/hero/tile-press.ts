/**
 * tile-press — the double-tap arm of a confirmed press, as pure functions so a
 * spec can drive them with a clock.
 *
 * An action that declares a `confirm` (unlock, open the door) is never asked
 * with a dialog — a `Modal` over the sheet the row lives in hangs iOS. The first
 * tap ARMS (the row says "Tap again to …"), a second tap of the SAME action
 * inside {@link ARM_WINDOW_MS} sends it, and the window closing disarms.
 */

/** How long an armed tile stays armed. */
export const ARM_WINDOW_MS = 3000

export interface ArmState {
  readonly armedId: string | null
  /** When it was armed, ms; meaningless while `armedId` is `null`. */
  readonly armedAt: number
}

export const DISARMED: ArmState = { armedId: null, armedAt: 0 }

export type PressDecision = 'fire' | 'arm'

export interface PressOutcome {
  readonly decision: PressDecision
  readonly next: ArmState
}

/** True while `id` is armed and the window is open. */
export function isArmed(state: ArmState, id: string, now: number): boolean {
  return state.armedId === id && now - state.armedAt < ARM_WINDOW_MS
}

/**
 * What a press of `id` does. An action with no `confirm` always fires; one with a
 * `confirm` arms on the first press and fires on a second of the same id inside
 * the window. Pressing a DIFFERENT confirmed action re-arms on that one.
 */
export function pressOutcome(state: ArmState, id: string, needsConfirm: boolean, now: number): PressOutcome {
  if (!needsConfirm) return { decision: 'fire', next: DISARMED }
  if (isArmed(state, id, now)) return { decision: 'fire', next: DISARMED }
  return { decision: 'arm', next: { armedId: id, armedAt: now } }
}
