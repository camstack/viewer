/**
 * use-tile-command — a scene tile press, from the tap to the device's report.
 *
 * `press` sends the resolved action (through the row's shared arm when the
 * action declares a `confirm`), then the tile stays PENDING until the row model
 * reports a different state — never optimistic. While it waits the hero is read
 * back on a short poll (the hub's live invalidation does not cover the hero
 * queries, and the five-minute backstop is too slow for a tap). It gives up
 * after {@link SETTLE_TIMEOUT_MS}, or when the call itself failed, and the tile
 * reverts with a shake (`shake` counts the failures).
 */
import { useCallback, useEffect, useState } from 'react'
import { hapticAction, hapticResult } from '../lib/haptics.js'
import type { RowArm } from './row-arm.js'
import type { TileAction } from './tile-action.js'
import { SETTLED, SETTLE_POLL_MS, SETTLE_TIMEOUT_MS, pressed, type SettleState, type TilePhase } from './tile-press.js'
import type { HeroCaller } from './use-hero.js'

export interface TileCommand {
  readonly phase: TilePhase
  /** This tile's action is armed and waiting for its second tap. */
  readonly armed: boolean
  /** Incremented on each failed or timed-out press; the tile shakes on a change. */
  readonly shake: number
  readonly press: () => void
}

export interface UseTileCommandArgs {
  readonly action: TileAction
  /** What the device reports of itself now; a change settles a press. */
  readonly stateKey: string
  readonly caller: HeroCaller
  readonly arm: RowArm
}

export function useTileCommand({ action, stateKey, caller, arm }: UseTileCommandArgs): TileCommand {
  const [settle, setSettle] = useState<SettleState>(SETTLED)
  const [shake, setShake] = useState(0)
  const [reported, setReported] = useState(0)
  // True once THIS press's call has answered; only then is `caller.error` this press's verdict.
  const [callDone, setCallDone] = useState(false)
  const { refresh, error } = caller

  // Adjusted during render (React's pattern for state derived from props), so
  // the tile never paints a spinner for a state the device already reported.
  if (settle.phase === 'pending') {
    if (settle.pressedAt !== stateKey) {
      setSettle(SETTLED)
      setReported((n) => n + 1)
    } else if (callDone && error !== null) {
      // This press's call was refused or never left: no report is coming. (An error left by
      // another control of the row is not read before the call has answered.)
      setSettle(SETTLED)
      setShake((n) => n + 1)
    }
  }

  const waiting = settle.phase === 'pending'
  useEffect(() => {
    if (!waiting) return undefined
    const poll = setInterval(() => void refresh(), SETTLE_POLL_MS)
    const giveUp = setTimeout(() => {
      setSettle(SETTLED)
      setShake((n) => n + 1)
    }, SETTLE_TIMEOUT_MS)
    return () => {
      clearInterval(poll)
      clearTimeout(giveUp)
    }
  }, [waiting, refresh])

  useEffect(() => {
    if (shake > 0) hapticResult(false)
  }, [shake])
  useEffect(() => {
    if (reported > 0) hapticResult(true)
  }, [reported])

  const press = useCallback((): void => {
    if (settle.phase === 'pending') return
    arm.press(action.id, action.confirm !== null, () => {
      hapticAction()
      setCallDone(false)
      setSettle(pressed(stateKey))
      void caller.runCall(action.call).then(() => setCallDone(true))
    })
  }, [settle.phase, arm, action, stateKey, caller])

  return { phase: settle.phase, armed: arm.armedId === action.id, shake, press }
}
