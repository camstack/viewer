/**
 * activity-start-pulse — "something just started", for the Activity button.
 *
 * Starting a download has no confirmation step: the button in the bar is the
 * acknowledgement. It plays a short pulse when a NEW running activity appears.
 *
 * "New" is decided off the list, not off an event: an item that is running and
 * was created a moment ago, and that this button has not pulsed for yet. That
 * also covers the button mounting AFTER the item (the very first activity is
 * what makes the button appear), while a list restored from storage — whose
 * items are old — never pulses.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { isRunning, type ActivityList } from './activity-model.js'

/** An item younger than this counts as "just started". */
export const START_FRESH_MS = 2_500
/** How long the pulse state lasts (the animation fits inside it). */
export const START_PULSE_MS = 900

/** The newest running item created within {@link START_FRESH_MS}, if any. */
export function justStartedId(items: ActivityList, nowMs: number): string | null {
  let best: { readonly id: string; readonly at: number } | null = null
  for (const item of items) {
    if (!isRunning(item)) continue
    if (nowMs - item.createdAt > START_FRESH_MS || item.createdAt > nowMs) continue
    if (best === null || item.createdAt > best.at) best = { id: item.id, at: item.createdAt }
  }
  return best === null ? null : best.id
}

/**
 * True for {@link START_PULSE_MS} after a new activity started, once per
 * activity. `now` is injectable for specs.
 */
export function useActivityStartPulse(items: ActivityList, now: () => number = Date.now): boolean {
  const startedId = useMemo(() => justStartedId(items, now()), [items, now])
  const pulsedFor = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    if (startedId === null || startedId === pulsedFor.current) return
    pulsedFor.current = startedId
    setPulsing(true)
    if (timer.current !== null) clearTimeout(timer.current)
    // Not cleared when the item finishes first: the pulse still has to end.
    timer.current = setTimeout(() => setPulsing(false), START_PULSE_MS)
  }, [startedId])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return pulsing
}
