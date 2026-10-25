/**
 * stream-aspect — the shape of the picture a camera is ACTUALLY sending.
 *
 * The overlay frame letterboxes the picture inside the player's box, and it
 * needs the picture's aspect to know where the bars are. Every surface lays out
 * for 16:9 (`DEFAULT_VIDEO_ASPECT`); a camera that is genuinely 4:3 or 21:9
 * says so in its first stream-debug sample (width × height of the decoded
 * video), and from then on the frame follows it.
 */
import { DEFAULT_VIDEO_ASPECT } from '../components/camera/overlay/overlay-size.js'
import { useStreamDebugStore } from '../store/stream-debug-store.js'
import type { StreamDebugSample } from './stream-debug-sample.js'

/** Narrowest / widest aspect believed — a decoder reporting 1×900 is a glitch. */
const MIN_ASPECT = 0.5
const MAX_ASPECT = 4

/** The aspect the sample reports, or the 16:9 default when it reports none. */
export function aspectFromSample(sample: StreamDebugSample | null): number {
  const w = sample?.stats?.width ?? null
  const h = sample?.stats?.height ?? null
  if (w === null || h === null || w <= 0 || h <= 0) return DEFAULT_VIDEO_ASPECT
  const aspect = w / h
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT ? aspect : DEFAULT_VIDEO_ASPECT
}

/** This camera's picture aspect, following the player's latest sample. */
export function useStreamAspect(deviceId: number): number {
  return useStreamDebugStore((s) => aspectFromSample(s.samples[deviceId] ?? null))
}
