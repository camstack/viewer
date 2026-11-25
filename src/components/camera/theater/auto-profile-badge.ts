/**
 * auto-profile-badge — what the transport's profile badge says while the
 * stream quality is Auto (planning#733).
 *
 * Under Auto the operator does not choose a rung, so the only place that tells
 * him which one he is on is this badge. It used to be drawn only for a
 * RECORDED player that had reported a served tier (`mode !== 'live'` and a
 * non-null report) — hidden live, and hidden on a recorded view until the first
 * report landed, which a camera switch resets. Now Auto decides, and nothing
 * else: the badge is there live and recorded, and while the profile is not yet
 * known it says so (`pending`) rather than showing a stale or guessed rung
 * (D315 — not-yet-known is never a value).
 */
import type { StreamQuality } from '../../../store/settings-store.js'
import type { ServedProfileReport } from '../../../recording/recording-messages.js'
import type { StreamDebugSample } from '../../../live/stream-debug-sample.js'
import { STREAM_STATS_STALE_MS } from '../../../live/embed-log-route.js'

export type AutoProfileTier = 'high' | 'mid' | 'low'

export type AutoProfileBadge =
  | { readonly state: 'pending' }
  | {
      readonly state: 'known'
      readonly profile: AutoProfileTier
      /** Picture height in pixels (`1080` → "1080p"); null when not measured. */
      readonly heightPx: number | null
    }

export interface AutoProfileInput {
  readonly quality: StreamQuality
  readonly isLive: boolean
  /** What the recorded player reported it is serving. */
  readonly recorded: ServedProfileReport | null
  /** The player's last stream-debug sample (hub half = the live rung). */
  readonly sample: StreamDebugSample | null
  readonly nowMs: number
}

function asTier(value: string | null): AutoProfileTier | null {
  return value === 'high' || value === 'mid' || value === 'low' ? value : null
}

/** Null = no badge (quality is not Auto). */
export function resolveAutoProfileBadge(input: AutoProfileInput): AutoProfileBadge | null {
  if (input.quality !== 'auto') return null
  const fresh = input.sample !== null && input.nowMs - input.sample.at <= STREAM_STATS_STALE_MS
  const heightPx = fresh ? (input.sample?.stats?.height ?? null) : null
  const tier = input.isLive
    ? fresh && input.sample?.server?.alive === true
      ? asTier(input.sample.server.servedTier)
      : null
    : (input.recorded?.profile ?? null)
  if (tier === null) return { state: 'pending' }
  return { state: 'known', profile: tier, heightPx: heightPx !== null && heightPx > 0 ? heightPx : null }
}

/** " 1080p", or nothing when the height was not measured. */
export function autoProfileResolutionSuffix(heightPx: number | null): string {
  return heightPx === null ? '' : ` ${heightPx}p`
}

/** The badge's visible text: the rung's initial and the height, or an ellipsis
 *  while the profile is pending. */
export function autoProfileBadgeText(badge: AutoProfileBadge): string {
  if (badge.state === 'pending') return '\u2026'
  return `${badge.profile.charAt(0).toUpperCase()}${autoProfileResolutionSuffix(badge.heightPx)}`
}
