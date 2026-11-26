/**
 * playback-overlay-store — the current playback frame, held outside React
 * state so the 200 ms tick re-renders only the components that read it (the
 * box layer), not the camera screen. Consumers select a slice and re-render
 * when that slice changes.
 */
import { useRef, useSyncExternalStore } from 'react'
import type { PlaybackOverlayFrame } from './playback-overlay-source.js'

export interface PlaybackOverlayStore {
  readonly get: () => PlaybackOverlayFrame
  readonly set: (frame: PlaybackOverlayFrame) => void
  readonly subscribe: (listener: () => void) => () => void
}

export const UNKNOWN_FRAME: PlaybackOverlayFrame = { availability: 'unknown' }

export function createPlaybackOverlayStore(): PlaybackOverlayStore {
  let frame: PlaybackOverlayFrame = UNKNOWN_FRAME
  const listeners = new Set<() => void>()
  return {
    get: () => frame,
    set: (next) => {
      frame = next
      for (const l of listeners) l()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** A slice of the frame; the previous slice is kept while `isEqual` holds. */
export function usePlaybackSlice<T>(
  store: PlaybackOverlayStore,
  select: (frame: PlaybackOverlayFrame) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const last = useRef<{ value: T } | null>(null)
  const read = (): T => {
    const next = select(store.get())
    if (last.current !== null && isEqual(last.current.value, next)) return last.current.value
    last.current = { value: next }
    return next
  }
  return useSyncExternalStore(store.subscribe, read, read)
}
