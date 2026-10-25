/**
 * still-media-url — build absolute URLs for the recorder's on-demand single
 * still data-plane (served by the hub reverse-proxy at
 * `/addon/recorder/still/<deviceId>/<epochSec>`).
 *
 * The server decodes ONE JPEG near the requested wall-clock instant from the
 * recorded LOW footage (a stateless ffmpeg one-shot); the client just renders a
 * plain image URL (`<Image source={{ uri }}>`) and lets the platform image layer
 * (browser HTTP cache on web, `expo-image` memory+disk cache on native) handle
 * caching — the endpoint answers `Cache-Control: immutable` for closed windows.
 * A 204 (no footage covers the instant) surfaces as an image load error, so the
 * caller shows its placeholder.
 *
 * Pure + side-effect-free (no React). Unit-tested in `__tests__/still-media-url.spec.ts`.
 */

/** The hub-proxied path prefix for the recorder still data-plane (addonId = `recorder`). */
export const STILL_MEDIA_PATH = '/addon/recorder/still'

/** Whether `atMs` is the inclusive start or exclusive end of an export range. */
export type StillBound = 'start' | 'end'

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '')
}

/**
 * Whole-second epoch the still route addresses.
 *
 * Start is inclusive (`floor`). End is the exclusive bound of `[fromMs, toMs)`:
 * asking for `toMs` exactly is the first uncovered millisecond and the route
 * replies 204 on a closed segment. Snap inward by 1 ms first.
 */
export function stillEpochSec(atMs: number, bound: StillBound = 'start'): number {
  if (bound === 'end') return Math.floor(Math.max(0, atMs - 1) / 1000)
  return Math.floor(atMs / 1000)
}

/**
 * Failure is latched to the instant that 204'd. A new `atMs` (range change)
 * must retry — a boolean `failed` flag would stick across preview updates.
 */
export function isStillPreviewFailed(failedAtMs: number | null, atMs: number): boolean {
  return failedAtMs === atMs
}

/**
 * The still route's SERVER-RELATIVE path for a device at a wall-clock instant.
 *
 * For the callers that cannot see the hub base: a pure derivation
 * (`clips-from-clusters.ts` stamps it on a footage-only card) hands the path to
 * a renderer that already resolves relative media against the connected server
 * (`EventThumb`). Building the absolute URL there would mean threading the
 * connection into a module that is deliberately React-free and network-free.
 */
export function stillMediaPath(
  deviceId: number,
  atMs: number,
  bound: StillBound = 'start',
): string {
  return `${STILL_MEDIA_PATH}/${deviceId}/${stillEpochSec(atMs, bound)}`
}

/**
 * Absolute still-image URL for a device at a wall-clock instant, against the
 * connected hub base. The instant is truncated to whole seconds (the route's
 * granularity). Pass `bound: 'end'` for the exclusive end of an export range.
 */
export function buildStillMediaUrl(
  serverUrl: string,
  deviceId: number,
  atMs: number,
  bound: StillBound = 'start',
): string {
  return `${trimTrailingSlashes(serverUrl)}${stillMediaPath(deviceId, atMs, bound)}`
}
