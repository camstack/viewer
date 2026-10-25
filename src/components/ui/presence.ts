/** Presence state machine for transient indicators (e.g. the connecting pill).
 *
 *  Encodes two UX rules as pure transitions so they are unit-testable:
 *  - **Delay-in:** activation passes through `waiting` first; a deactivation
 *    during the wait returns straight to `hidden`, so a brief blip (shorter
 *    than the delay) never flashes the indicator at all.
 *  - **Animate-out:** deactivation from `shown` passes through `leaving` so the
 *    component can play an exit animation before unmounting (`exitDone`).
 */
export type PresencePhase = 'hidden' | 'waiting' | 'shown' | 'leaving'

export type PresenceEvent = 'activate' | 'deactivate' | 'delayElapsed' | 'exitDone'

export function nextPhase(phase: PresencePhase, event: PresenceEvent): PresencePhase {
  switch (event) {
    case 'activate':
      if (phase === 'hidden') return 'waiting'
      if (phase === 'leaving') return 'shown'
      return phase
    case 'deactivate':
      if (phase === 'waiting') return 'hidden'
      if (phase === 'shown') return 'leaving'
      return phase
    case 'delayElapsed':
      return phase === 'waiting' ? 'shown' : phase
    case 'exitDone':
      return phase === 'leaving' ? 'hidden' : phase
  }
}
