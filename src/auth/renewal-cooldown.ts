/**
 * No retry storm after a renewal that could not settle.
 *
 * A renewal that answers `renewed` is followed by the straggler window
 * (`use-session-renewal.ts`); one that answers `refused` signs out. The third
 * kind — `failed` (the hub unreachable, a 5xx) or `unavailable` (no
 * connection) — settles NOTHING, and every poll that fails behind it would ask
 * again: dozens of `auth.refreshSession` calls into the hub's per-address rate
 * limit. After such an answer, further `unauthorized` reports for the same
 * server get that same answer back for {@link RENEWAL_COOLDOWN_MS}.
 */
import type { RenewOutcome } from './refresh-session.js'

/** Long enough to absorb a poll cycle, short enough that recovery is not delayed noticeably. */
export const RENEWAL_COOLDOWN_MS = 30_000

interface Cooldown {
  readonly serverId: string
  readonly until: number
  readonly outcome: RenewOutcome
}

export interface RenewalCooldown {
  /** The answer to reuse for `serverId` right now, or `null` when a real renewal may run. */
  active(serverId: string): RenewOutcome | null
  /** Record what a renewal for `serverId` answered. */
  record(serverId: string, outcome: RenewOutcome): void
}

export function createRenewalCooldown(now: () => number = Date.now): RenewalCooldown {
  let current: Cooldown | null = null
  return {
    active: (serverId) =>
      current !== null && current.serverId === serverId && now() < current.until ? current.outcome : null,
    record: (serverId, outcome) => {
      current =
        outcome.status === 'failed' || outcome.status === 'unavailable'
          ? { serverId, until: now() + RENEWAL_COOLDOWN_MS, outcome }
          : null
    },
  }
}
