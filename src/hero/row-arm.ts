/**
 * row-arm — the double-tap confirm of ONE device row, shared by everything in
 * the row that can ask for it.
 *
 * The row's scene tile (unlock) and the lock's "Open door" button both arm the
 * same way — first tap arms, a second tap of the same action inside
 * {@link ARM_WINDOW_MS} sends — and both show the same caption under the name.
 * `HeroRowBody` owns one `useArmedConfirm` and provides it here, so the caption
 * and the tone follow whichever control armed. A control used outside a row
 * (no provider) keeps its own, with no caption.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ARM_WINDOW_MS, DISARMED, pressOutcome, type ArmState } from './tile-press.js'

export interface RowArm {
  /** The id of the action that is armed right now, or `null`. */
  readonly armedId: string | null
  /**
   * A press of `id`. `needsConfirm` false sends at once; true arms, and a
   * second press of the same id inside the window calls `fire`.
   */
  readonly press: (id: string, needsConfirm: boolean, fire: () => void) => void
}

/** One armed action at a time, disarmed by the clock. */
export function useArmedConfirm(): RowArm {
  const [state, setState] = useState<ArmState>(DISARMED)
  // The latest state for the press handler, written where the state is written.
  const latest = useRef<ArmState>(DISARMED)
  useEffect(() => {
    if (state.armedId === null) return undefined
    const timer = setTimeout(() => {
      latest.current = DISARMED
      setState(DISARMED)
    }, ARM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [state])
  const press = useCallback((id: string, needsConfirm: boolean, fire: () => void): void => {
    const outcome = pressOutcome(latest.current, id, needsConfirm, Date.now())
    latest.current = outcome.next
    setState(outcome.next)
    if (outcome.decision === 'fire') fire()
  }, [])
  return { armedId: state.armedId, press }
}

export const RowArmContext = createContext<RowArm | null>(null)

/** The row's shared arm when there is one, else this control's own. */
export function useRowArm(): RowArm {
  const own = useArmedConfirm()
  const shared = useContext(RowArmContext)
  return shared ?? own
}
