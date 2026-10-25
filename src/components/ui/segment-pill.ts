/**
 * Where the glass pill sits behind the lit segment of a `SegmentedControl`,
 * as plain numbers. Segments share the track equally, inside its padding and
 * with a gap between them, so the target follows from the track's measured
 * width, the padding, the gap and the active index.
 */
import type { SlidingPillTarget } from './SlidingGlassPill.js'

export function segmentPillTarget(
  activeIndex: number,
  count: number,
  trackWidth: number,
  padding: number,
  gap: number,
): SlidingPillTarget {
  const inner = trackWidth - padding * 2 - gap * Math.max(count - 1, 0)
  const measured = Number.isFinite(trackWidth) && trackWidth > 0 && count > 0 && inner > 0
  const width = measured ? inner / count : 0
  const index = activeIndex >= 0 && activeIndex < count ? activeIndex : -1
  return { x: index >= 0 ? padding + index * (width + gap) : 0, width, visible: measured && index >= 0 }
}
