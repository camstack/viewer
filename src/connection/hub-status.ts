/**
 * Hub connection status — the pure decision core of the ONE root overlay
 * (`HubConnectionOverlay`, mounted once in `app/(app)/_layout.tsx`).
 *
 * The overlay used to be a pill each screen mounted on its own, next to an
 * in-page "Offline" text some screens put in place of their content. Every
 * return from the background closes the socket on purpose
 * (`SystemController.suspendForBackground` emits `connecting`) and reopens it
 * on the way back, so each app open showed both for the length of a redial —
 * two states, inserted into the page, for a connection that was fine
 * (operator, 2026-10-23).
 *
 * The rules, as pure transitions so they are unit-testable:
 *  - **Grace.** Losing the connection first enters `waiting`; only a loss that
 *    outlasts {@link HUB_STATUS_GRACE_MS} becomes visible. A cold start or a
 *    resume that connects within the grace shows nothing at all.
 *  - **Offline is honest, but not during startup.** `disconnected` (already
 *    debounced by `OfflineDebouncer`) shows `offline`, except while the first
 *    dial of a cold launch is still racing (`startingUp`), which reads as
 *    `connecting`.
 *  - **Back online, briefly.** Only a status the operator SAW is followed by
 *    `restored`, which clears itself after {@link HUB_STATUS_RESTORED_MS}. A
 *    loss that never surfaced ends silently.
 */
import type { ConnState } from './recheck-policy.js'

/** How long the hub may be unreachable before the overlay says so. */
export const HUB_STATUS_GRACE_MS = 1_500
/** How long "Back online" stays before the overlay leaves. */
export const HUB_STATUS_RESTORED_MS = 1_500

/** What the overlay shows; `hidden` and `waiting` show nothing. */
export type HubStatusPhase = 'hidden' | 'waiting' | 'connecting' | 'offline' | 'restored'

/** The visible half of {@link HubStatusPhase}. */
export type HubStatusVisible = Extract<HubStatusPhase, 'connecting' | 'offline' | 'restored'>

/** The phase plus what a `waiting` phase will become when the grace ends. */
export interface HubStatus {
  readonly phase: HubStatusPhase
  readonly pending: 'connecting' | 'offline'
}

export type HubStatusEvent =
  | { readonly type: 'connection'; readonly state: ConnState; readonly startingUp: boolean }
  | { readonly type: 'graceElapsed' }
  | { readonly type: 'restoredElapsed' }

export const HUB_STATUS_INITIAL: HubStatus = { phase: 'hidden', pending: 'connecting' }

/** The status a not-connected state is shown as. */
function lostAs(state: ConnState, startingUp: boolean): 'connecting' | 'offline' {
  return state === 'disconnected' && !startingUp ? 'offline' : 'connecting'
}

export function nextHubStatus(status: HubStatus, event: HubStatusEvent): HubStatus {
  switch (event.type) {
    case 'connection': {
      if (event.state === 'connected') {
        if (status.phase === 'connecting' || status.phase === 'offline') {
          return { ...status, phase: 'restored' }
        }
        if (status.phase === 'waiting') return { ...status, phase: 'hidden' }
        return status
      }
      const pending = lostAs(event.state, event.startingUp)
      if (status.phase === 'connecting' || status.phase === 'offline') {
        return { phase: pending, pending }
      }
      // hidden, waiting, or a `restored` the connection just left again: the
      // grace starts (or keeps running) before anything is said.
      return { phase: 'waiting', pending }
    }
    case 'graceElapsed':
      return status.phase === 'waiting' ? { ...status, phase: status.pending } : status
    case 'restoredElapsed':
      return status.phase === 'restored' ? { ...status, phase: 'hidden' } : status
  }
}

/** The visible phase, or `null` when the overlay shows nothing. */
export function visibleHubStatus(status: HubStatus): HubStatusVisible | null {
  return status.phase === 'hidden' || status.phase === 'waiting' ? null : status.phase
}
