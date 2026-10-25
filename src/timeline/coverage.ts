/** A half-open recorded interval [startMs, endMs). Profile is dropped here —
 *  coverage is the union across all recorded profiles. */
export interface TimeRange {
  readonly startMs: number
  readonly endMs: number
}

/** Union of recorded ranges (possibly per-profile / overlapping / unsorted)
 *  into sorted, non-overlapping intervals. Adjacent ranges (a.end === b.start)
 *  merge into one. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs)
  const out: TimeRange[] = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.startMs <= last.endMs) {
      out[out.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, cur.endMs) }
    } else {
      out.push({ startMs: cur.startMs, endMs: cur.endMs })
    }
  }
  return out
}

/** True when t falls in a recorded interval (inclusive start, exclusive end). */
export function isCovered(t: number, merged: readonly TimeRange[]): boolean {
  return merged.some((r) => t >= r.startMs && t < r.endMs)
}

/** The nearest covered time to t: t itself when covered, else the closest range
 *  edge (start or end). Null when there is no coverage. */
export function nearestCoveredEdge(t: number, merged: readonly TimeRange[]): number | null {
  if (merged.length === 0) return null
  if (isCovered(t, merged)) return t
  let best: number | null = null
  let bestDist = Infinity
  for (const r of merged) {
    for (const edge of [r.startMs, r.endMs]) {
      const d = Math.abs(edge - t)
      if (d < bestDist) {
        bestDist = d
        best = edge
      }
    }
  }
  return best
}
