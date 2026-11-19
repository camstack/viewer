/**
 * tile-press — the two small state machines behind a pressable scene tile, as
 * pure functions so a spec can drive them with a clock.
 *
 *  - ARM: an action that declares a `confirm` (unlock, open the door) is never
 *    asked with a dialog — a `Modal` over the sheet the row lives in hangs iOS.
 *    The first tap ARMS (the tile turns warning and the row says "Tap again to
 *    unlock"), a second tap of the SAME action inside {@link ARM_WINDOW_MS}
 *    sends it, and the window closing disarms.
 *  - SETTLE: after a press the tile waits for the device to REPORT the new state
 *    (the row model's `stateKey` changes) — never optimistic. It gives up after
 *    {@link SETTLE_TIMEOUT_MS} and reverts.
 */

/** How long an armed tile stays armed. */
export const ARM_WINDOW_MS = 3000

/** How long the tile waits for the device to report the new state. */
export const SETTLE_TIMEOUT_MS = 10_000

/** How often the hero is read back while a press is unsettled. */
export const SETTLE_POLL_MS = 1500

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

/** What the tile shows between a press and the device's report. */
export type TilePhase = 'idle' | 'pending'

export interface SettleState {
  readonly phase: TilePhase
  /** The row model's `stateKey` at the press; the report is any other value. */
  readonly pressedAt: string | null
}

export const SETTLED: SettleState = { phase: 'idle', pressedAt: null }

export function pressed(stateKey: string): SettleState {
  return { phase: 'pending', pressedAt: stateKey }
}

/**
 * The key a press is settled against: what the device reports of itself. The
 * state word and the look the hub drew for it, so a change of either counts.
 */
export function tileStateKey(model: { readonly state: string; readonly look: { readonly icon: string; readonly tone: string } }): string {
  return `${model.state}|${model.look.icon}|${model.look.tone}`
}
