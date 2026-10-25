/** One bucket from `pipeline-analytics.getEventDensity`. */
export interface DensityBucket {
  readonly bucketStart: number
  readonly motion: number
  readonly object: number
  readonly audio: number
}

/** A timeline heatmap bucket: motion/audio intensities normalized to 0..1.
 *  `object` is intentionally dropped (bands-only scope; no event markers). */
export interface ActivityBand {
  readonly bucketStart: number
  readonly motion: number
  readonly audio: number
}

/** Map density buckets to normalized motion/audio bands. Each kind is scaled to
 *  its OWN max across the window so each band uses its full dynamic range; an
 *  all-zero kind maps to all zeros (no divide-by-zero). */
export function toBands(buckets: readonly DensityBucket[]): ActivityBand[] {
  if (buckets.length === 0) return []
  const maxMotion = Math.max(...buckets.map((x) => x.motion))
  const maxAudio = Math.max(...buckets.map((x) => x.audio))
  const norm = (v: number, max: number): number => (max > 0 ? v / max : 0)
  return buckets.map((x) => ({
    bucketStart: x.bucketStart,
    motion: norm(x.motion, maxMotion),
    audio: norm(x.audio, maxAudio),
  }))
}
