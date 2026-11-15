import { useEffect, useRef, useState } from 'react'

import { FRAME_SETTLE_MS, SCRUB_FRAME_INTERVAL_MS, settleInstant } from './cursor-frames.js'

/**
 * The instant the cursor frames are loaded for.
 *
 * On a large scope, `instant` is held back until the drag has ended and the
 * cursor has been still for {@link FRAME_SETTLE_MS}; a drag in flight cancels
 * the pending timer, so a scrub that keeps moving never commits an
 * intermediate instant.
 *
 * On a live-scrub scope (`live`), a drag is THROTTLED instead: the frames
 * follow the cursor at most once per {@link SCRUB_FRAME_INTERVAL_MS}, and the
 * last position is always committed.
 *
 * The first value is taken at once — a tile never waits to draw its first
 * frame.
 */
export function useSettledInstant(instant: number, scrubbing: boolean, live = false): number {
  const [settled, setSettled] = useState(instant)
  const lastCommit = useRef(0)

  useEffect(() => {
    if (scrubbing && !live) return
    if (instant === settled) return
    const followDrag = scrubbing && live
    const wait = followDrag
      ? Math.max(0, SCRUB_FRAME_INTERVAL_MS - (Date.now() - lastCommit.current))
      : FRAME_SETTLE_MS
    const timer = setTimeout(() => {
      lastCommit.current = Date.now()
      setSettled((current) => settleInstant({ settled: current, pending: instant, scrubbing, live }))
    }, wait)
    return () => clearTimeout(timer)
  }, [instant, scrubbing, live, settled])

  return settled
}
