import { useEffect, useState } from 'react'

import { FRAME_SETTLE_MS, settleInstant } from './cursor-frames.js'

/**
 * The instant the cursor frames are loaded for: `instant` held back until the
 * drag has ended and the cursor has been still for {@link FRAME_SETTLE_MS}.
 *
 * The first value is taken at once — a tile never waits to draw its first
 * frame — and a drag in flight cancels the pending timer, so a scrub that keeps
 * moving never commits an intermediate instant.
 */
export function useSettledInstant(instant: number, scrubbing: boolean): number {
  const [settled, setSettled] = useState(instant)

  useEffect(() => {
    if (scrubbing) return
    if (instant === settled) return
    const timer = setTimeout(() => {
      setSettled((current) => settleInstant({ settled: current, pending: instant, scrubbing: false }))
    }, FRAME_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [instant, scrubbing, settled])

  return settled
}
