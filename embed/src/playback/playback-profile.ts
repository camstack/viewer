/**
 * The profile recorded playback ENTERS at, and the rung a bandwidth probe
 * may climb to. Adaptive always starts on `low` so the first picture is the
 * cheapest available; mid is a real step on the probe ladder.
 */

export type EmbedPlaybackTarget =
  | { readonly kind: 'adaptive' }
  | { readonly kind: 'profile'; readonly profile: string }

export const DOWNLINK_HIGH_MBPS = 8
export const DOWNLINK_MID_MBPS = 2.5

export function suggestedPlaybackTier(mbps: number): 'high' | 'mid' | 'low' {
  if (mbps >= DOWNLINK_HIGH_MBPS) return 'high'
  if (mbps >= DOWNLINK_MID_MBPS) return 'mid'
  return 'low'
}

/** Adaptive always enters on the lowest rung; a pinned profile is honoured. */
export function resolvePlaybackEntryProfile(
  target: EmbedPlaybackTarget,
  _liveProfile: 'high' | 'mid' | 'low',
): string {
  return target.kind === 'profile' ? target.profile : 'low'
}

/** After a probe: adaptive climbs through mid/high; a pin is unchanged. */
export function resolvePlaybackUpgradeProfile(
  target: EmbedPlaybackTarget,
  mbps: number,
): string {
  return target.kind === 'profile' ? target.profile : suggestedPlaybackTier(mbps)
}
