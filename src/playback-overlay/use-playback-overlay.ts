/**
 * usePlaybackOverlay — the `PlaybackOverlaySource` for the camera detail
 * screen: stored tracks around the recorded playback time, interpolated at a
 * clock that runs between the embed's ~1 Hz position ticks.
 *
 * Off the recorded path (`enabled` false) it reads nothing and answers
 * `unknown`, so a live camera never pays for it. See `playback-overlay-source`
 * for what is drawn and for the unknown-versus-empty rule.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { BULK_QUERY_DEADLINE_MS, capQuery } from '../data/cap-query.js'
import {
  clockAt,
  clockReport,
  clockSeek,
  clockSetPaused,
  clockSetRate,
  initialClock,
  type PlaybackClock,
} from './playback-clock.js'
import {
  frameAt,
  normalizeTracks,
  resolveCoverage,
  type OverlayTrack,
  type PlaybackOverlayFrame,
} from './playback-overlay-source.js'

/** Width of the stored-track window fetched around the playback time. */
export const OVERLAY_WINDOW_MS = 60_000
/** Tracks that began before the window and are still alive in it have a
 *  `lastSeen` later than the window; the read reaches this far past it. */
export const OVERLAY_LOOKAHEAD_MS = 600_000
/** How often the interpolated time is re-read. */
const TICK_MS = 200
const WINDOW_TRACK_LIMIT = 500

export interface PlaybackOverlayInput {
  readonly deviceId: number
  /** True on the recorded path (not the live edge). */
  readonly enabled: boolean
  /** The machine's playhead: the ~1 Hz position cursor (epoch ms). */
  readonly playhead: number | null
  /** The drag preview while scrubbing. */
  readonly seekTarget: number | null
  /** Set when a seek / commit asked the server for an instant. */
  readonly seekAnchor: number | null
  readonly scrubbing: boolean
  readonly paused: boolean
  readonly rate: number
}

interface WindowRead {
  readonly tracks: readonly OverlayTrack[]
  readonly windowTracks: number
  readonly probeTracks: number
}

/** The window block a time falls in. */
export function windowStartFor(t: number): number {
  return Math.floor(t / OVERLAY_WINDOW_MS) * OVERLAY_WINDOW_MS
}

function rows(raw: unknown): readonly unknown[] {
  if (!Array.isArray(raw)) throw new Error('listTracks did not answer')
  return raw
}

export function usePlaybackOverlay(input: PlaybackOverlayInput): PlaybackOverlayFrame {
  const { deviceId, enabled, playhead, seekTarget, seekAnchor, scrubbing, paused, rate } = input
  const { controller, state } = useConnection()

  const clockRef = useRef<PlaybackClock>(initialClock)
  const awaitingAnchorRef = useRef(false)
  const [t, setT] = useState<number | null>(null)

  // Leaving the recorded path forgets the clock: the next entry starts clean.
  useEffect(() => {
    if (enabled) return
    clockRef.current = initialClock
    awaitingAnchorRef.current = false
    setT(null)
  }, [enabled])

  // A seek resets the interpolation; the first cursor report after it is the
  // new anchor (a pre-seek straggler is already dropped by the machine).
  useEffect(() => {
    if (!enabled || seekAnchor === null) return
    clockRef.current = clockSeek(clockRef.current, seekAnchor, Date.now())
    awaitingAnchorRef.current = true
    setT(seekAnchor)
  }, [enabled, seekAnchor])

  // The scrub preview is the time shown while dragging.
  useEffect(() => {
    if (!enabled || !scrubbing || seekTarget === null) return
    clockRef.current = clockSeek(clockRef.current, seekTarget, Date.now())
    setT(seekTarget)
  }, [enabled, scrubbing, seekTarget])

  useEffect(() => {
    if (!enabled || playhead === null) return
    const now = Date.now()
    clockRef.current = awaitingAnchorRef.current
      ? clockSeek(clockRef.current, playhead, now)
      : clockReport(clockRef.current, playhead, now)
    awaitingAnchorRef.current = false
    setT(clockAt(clockRef.current, now))
  }, [enabled, playhead])

  useEffect(() => {
    if (!enabled) return
    const now = Date.now()
    clockRef.current = clockSetRate(clockSetPaused(clockRef.current, paused || scrubbing, now), rate, now)
  }, [enabled, paused, scrubbing, rate])

  useEffect(() => {
    if (!enabled || paused || scrubbing) return
    const id = setInterval(() => setT(clockAt(clockRef.current, Date.now())), TICK_MS)
    return () => clearInterval(id)
  }, [enabled, paused, scrubbing])

  const block = t === null ? null : windowStartFor(t)
  const read = useQuery<WindowRead>({
    queryKey: ['v2', 'playback-overlay', deviceId, block],
    enabled: enabled && block !== null && state === 'connected',
    staleTime: OVERLAY_WINDOW_MS,
    retry: 1,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || block === null) throw new Error('no connection')
      const client = system.trpcClient as Record<string, unknown>
      const opts = { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true }
      const [windowRaw, probeRaw] = await Promise.all([
        capQuery(
          client,
          'pipelineAnalytics',
          'listTracks',
          {
            deviceId,
            since: block,
            until: block + OVERLAY_WINDOW_MS + OVERLAY_LOOKAHEAD_MS,
            limit: WINDOW_TRACK_LIMIT,
            projection: 'full',
          },
          opts,
        ),
        capQuery(
          client,
          'pipelineAnalytics',
          'listTracks',
          { deviceId, until: block + OVERLAY_WINDOW_MS, limit: 1, projection: 'slim' },
          opts,
        ),
      ])
      const windowRows = rows(windowRaw)
      return {
        tracks: normalizeTracks(windowRows),
        windowTracks: windowRows.length,
        probeTracks: rows(probeRaw).length,
      }
    },
  })

  const data = read.data
  return useMemo<PlaybackOverlayFrame>(() => {
    if (!enabled || t === null) return { availability: 'unknown' }
    const coverage = resolveCoverage({
      answered: data !== undefined,
      windowTracks: data?.windowTracks ?? 0,
      probeTracks: data?.probeTracks ?? 0,
    })
    return frameAt({ tracks: data?.tracks ?? [], coverage }, t)
  }, [enabled, t, data])
}
