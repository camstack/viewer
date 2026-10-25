/**
 * quality-target — map a user-facing stream-quality hint to a `WebrtcTarget`.
 *
 * This file used to RECONCILE two scales. The settings store said
 * `'auto'|'high'|'mid'|'low'` and per-grid options said
 * `'auto'|'high'|'medium'|'low'`, and the translation lived here so that
 * nothing downstream had to know there were two. That was the wrong place for
 * it: a translation at the boundary is what lets a second spelling survive
 * upstream forever. The operator retired it on 2026-09-02 — there is ONE scale,
 * {@link StreamQuality}, and it is the system's `CamProfileSchema` plus `auto`.
 *
 * So all this does now is the one thing that genuinely is a mapping: `auto` is
 * not a tier the broker can be asked for — plus the remote-route clamp that
 * keeps recorded playback (and the live edge that shares its target) on `low`
 * whenever the app is not on the LAN / loopback.
 */
import { isLocalRouteChannel, type RouteChannel } from '../connection/route-channel.js'
import type { StreamQuality } from '../store/settings-store.js'
import type { WebrtcTarget } from './signaling-types.js'

/**
 * The quality the player may ASK for on this route.
 *
 * Off the local network the ask is always `low`, pinned — not `auto`. Adaptive
 * enters on low and then climbs from a downlink probe; on a tunnel that climb
 * is exactly the bandwidth waste this clamp exists to prevent. The operator's
 * stored preference is untouched; it applies again the moment the route is
 * local.
 */
export function qualityForRoute(quality: StreamQuality, channel: RouteChannel): StreamQuality {
  return isLocalRouteChannel(channel) ? quality : 'low'
}

/** 'auto' → adaptive (the broker picks the tier); any profile → that profile,
 *  verbatim. Pure — safe to call from render (wrap in `useMemo` to keep the
 *  returned object reference stable across renders). */
export function qualityToTarget(quality: StreamQuality): WebrtcTarget {
  if (quality === 'auto') return { kind: 'adaptive' }
  return { kind: 'profile', profile: quality }
}

/** Preference → broker target, after the remote-route clamp. */
export function qualityToTargetForRoute(
  quality: StreamQuality,
  channel: RouteChannel,
): WebrtcTarget {
  return qualityToTarget(qualityForRoute(quality, channel))
}
