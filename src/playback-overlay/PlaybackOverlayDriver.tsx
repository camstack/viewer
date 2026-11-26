/**
 * PlaybackOverlayDriver — owns the playback clock tick and writes each frame
 * to the store. Renders nothing; it exists so the 5 Hz tick re-renders this
 * leaf instead of the camera screen.
 */
import { useEffect } from 'react'
import { usePlaybackOverlay, type PlaybackOverlayInput } from './use-playback-overlay.js'
import type { PlaybackOverlayStore } from './playback-overlay-store.js'

interface PlaybackOverlayDriverProps {
  readonly input: PlaybackOverlayInput
  readonly store: PlaybackOverlayStore
}

export function PlaybackOverlayDriver({ input, store }: PlaybackOverlayDriverProps): null {
  const frame = usePlaybackOverlay(input)
  useEffect(() => {
    store.set(frame)
  }, [store, frame])
  useEffect(() => () => store.set({ availability: 'unknown' }), [store])
  return null
}
