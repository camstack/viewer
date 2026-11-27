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
import {
  clockAt,
  clockReport,
  clockSeek,
  clockSetPaused,
  clockSetRate,
  initialClock,
  takePresented,
  type PlaybackClock,
  type PresentedReport,
} from './playback-clock.js'
import {
  OVERLAY_WINDOW_MS,
  frameFromWindow,
  readPlaybackWindow,
  keepPreviousWindow,
  windowStartFor,
  type WindowRead,
} from './playback-window-read.js'
export type { PresentedReport } from './playback-clock.js'
import type { PlaybackOverlayFrame } from './playback-overlay-source.js'

/** How often the interpolated time is re-read. */
const TICK_MS = 200

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
  /** The newest presented-frame report; null/absent = cursor-only clock. */
  readonly presentedRef?: { current: PresentedReport | null }
}

/** tRPC clients are proxies (functions), so `isRecord` rejects them. */
function isCapClient(v: unknown): v is Record<string, unknown> {
  return v !== null && (typeof v === 'object' || typeof v === 'function')
}

export function usePlaybackOverlay(input: PlaybackOverlayInput): PlaybackOverlayFrame {
  const { deviceId, enabled, playhead, seekTarget, seekAnchor, scrubbing, paused, rate, presentedRef } = input
  const { controller, state } = useConnection()

  const clockRef = useRef<PlaybackClock>(initialClock)
  const awaitingAnchorRef = useRef(false)
  const lastPresentedRef = useRef<number | null>(null)
  const [t, setT] = useState<number | null>(null)

  // Leaving the recorded path, or another camera, forgets the clock: the next
  // entry starts clean.
  useEffect(() => {
    clockRef.current = initialClock
    awaitingAnchorRef.current = false
    lastPresentedRef.current = null
    if (presentedRef) presentedRef.current = null
    setT(null)
  }, [enabled, deviceId, presentedRef])

  // A seek resets the interpolation; the first cursor report after it is the
  // new anchor (a pre-seek straggler is already dropped by the machine).
  useEffect(() => {
    if (!enabled || seekAnchor === null) return
    clockRef.current = clockSeek(clockRef.current, seekAnchor, Date.now())
    awaitingAnchorRef.current = true
    // A frame presented before the seek belongs to the old pointer.
    if (presentedRef) presentedRef.current = null
    setT(seekAnchor)
  }, [enabled, seekAnchor, presentedRef])

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
    const id = setInterval(() => {
      const taken = takePresented(
        clockRef.current,
        presentedRef?.current ?? null,
        lastPresentedRef.current,
        awaitingAnchorRef.current,
      )
      clockRef.current = taken.clock
      lastPresentedRef.current = taken.lastAtWall
      setT(clockAt(clockRef.current, Date.now()))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [enabled, paused, scrubbing, presentedRef])

  const block = t === null ? null : windowStartFor(t)
  const read = useQuery<WindowRead>({
    queryKey: ['v2', 'playback-overlay', deviceId, block],
    enabled: enabled && block !== null && state === 'connected',
    staleTime: OVERLAY_WINDOW_MS,
    retry: 1,
    // Across a block boundary the previous window keeps drawing while it still
    // covers `t` (the next one is read early); a seek away drops it.
    placeholderData: (previous) => keepPreviousWindow(previous, deviceId, t),
    queryFn: async () => {
      const system = controller.getSystem()
      const client = system?.trpcClient
      if (!isCapClient(client) || block === null) throw new Error('no connection')
      return readPlaybackWindow(client, deviceId, block)
    },
  })

  const data = read.data
  return useMemo<PlaybackOverlayFrame>(() => {
    if (!enabled || t === null) return { availability: 'unknown' }
    return frameFromWindow(data, t)
  }, [enabled, t, data])
}
