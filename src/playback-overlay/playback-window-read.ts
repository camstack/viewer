/**
 * playback-window-read — one stored-track window for the playback overlays.
 *
 * `listTracks` filters `since` / `until` on a track's FIRSTSEEN and returns
 * newest first under a row limit. So a track alive at time t was born at or
 * before t, and the window reaches back {@link OVERLAY_LOOKBACK_MS} to catch
 * the ones that began earlier; aliveness itself is tested client-side
 * (`firstSeen <= t <= lastSeen`). `listRecentTracks` filters on lastSeen but
 * pages by an opaque cursor across cameras; this is one camera and one page,
 * so `listTracks` is the smaller fit.
 */
import { BULK_QUERY_DEADLINE_MS, capQuery } from '../data/cap-query.js'
import {
  frameAt,
  normalizeTracks,
  resolveCoverage,
  type OverlayTrack,
  type PlaybackOverlayFrame,
} from './playback-overlay-source.js'

/** Width of the firstSeen window. */
export const OVERLAY_WINDOW_MS = 60_000
/** How far before the window a still-alive track may have begun. A track
 *  longer than this is missed — a bound, not a fact about the camera. */
export const OVERLAY_LOOKBACK_MS = 600_000
/** The next window is read this early, so the one on screen still covers the
 *  playback time while it loads. */
export const OVERLAY_PREFETCH_MS = 10_000
/** Row limit of the window read; a full answer is treated as truncated. */
export const WINDOW_TRACK_LIMIT = 500

export interface WindowRead {
  /** The camera this window belongs to. */
  readonly deviceId: number
  readonly validFrom: number
  readonly validTo: number
  readonly tracks: readonly OverlayTrack[]
  readonly windowTracks: number
  readonly truncated: boolean
  readonly probeTracks: number
}

/** The window block a playback time reads (an early switch, see PREFETCH). */
export function windowStartFor(t: number): number {
  return Math.floor((t + OVERLAY_PREFETCH_MS) / OVERLAY_WINDOW_MS) * OVERLAY_WINDOW_MS
}

export function windowCovers(read: WindowRead, t: number): boolean {
  return t >= read.validFrom && t <= read.validTo
}

/** The previous window may stand in while the next loads only for the SAME
 *  camera and only while it still covers `t`. */
export function keepPreviousWindow(
  previous: WindowRead | undefined,
  deviceId: number,
  t: number | null,
): WindowRead | undefined {
  return previous !== undefined && t !== null && previous.deviceId === deviceId && windowCovers(previous, t)
    ? previous
    : undefined
}

function rows(raw: unknown): readonly unknown[] {
  if (!Array.isArray(raw)) throw new Error('listTracks did not answer')
  return raw
}

/** Reads one window. Throws when either read fails or does not answer. */
export async function readPlaybackWindow(
  client: Record<string, unknown>,
  deviceId: number,
  block: number,
): Promise<WindowRead> {
  const opts = { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true }
  const until = block + OVERLAY_WINDOW_MS
  const [windowRaw, probeRaw] = await Promise.all([
    capQuery(
      client,
      'pipelineAnalytics',
      'listTracks',
      { deviceId, since: block - OVERLAY_LOOKBACK_MS, until, limit: WINDOW_TRACK_LIMIT, projection: 'full' },
      opts,
    ),
    capQuery(
      client,
      'pipelineAnalytics',
      'listTracks',
      { deviceId, until, limit: 1, projection: 'slim' },
      opts,
    ),
  ])
  const windowRows = rows(windowRaw)
  return {
    deviceId,
    validFrom: block - OVERLAY_PREFETCH_MS,
    validTo: until,
    tracks: normalizeTracks(windowRows),
    windowTracks: windowRows.length,
    truncated: windowRows.length >= WINDOW_TRACK_LIMIT,
    probeTracks: rows(probeRaw).length,
  }
}

/** What the overlays draw at `t` from a window read (or none yet). */
export function frameFromWindow(read: WindowRead | undefined, t: number): PlaybackOverlayFrame {
  if (read === undefined || !windowCovers(read, t)) return { availability: 'unknown' }
  const coverage = resolveCoverage({
    answered: true,
    windowTracks: read.windowTracks,
    probeTracks: read.probeTracks,
    truncated: read.truncated,
  })
  return frameAt({ tracks: read.tracks, coverage }, t)
}
