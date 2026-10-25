/** Pure activity-bar helpers for the theater timeline.
 *
 * All functions are stateless, return new arrays/objects (immutable), use no
 * React, and carry no `any`. Consumers: useTimelineActivity hook + the
 * ActivityLanes component.
 */

// ─── Types ────────────────────────────────────────────────────────────

/** A continuous recorded time range. */
export interface Range {
  readonly startMs: number
  readonly endMs: number
}

/** One time bucket with a normalized activity intensity (0..1). */
export interface Bucket {
  readonly startMs: number
  readonly endMs: number
  /** Activity level in [0, 1]. */
  readonly intensity: number
}

// ─── dbfsToUnit ───────────────────────────────────────────────────────

/**
 * Normalize a dBFS value to a [0, 1] unit range and clamp it.
 *
 * Default floor = -60 dBFS (silence), ceil = 0 dBFS (full scale).
 *
 * @param dbfs  - Input dBFS value.
 * @param floor - dBFS value mapped to 0 (default -60).
 * @param ceil  - dBFS value mapped to 1 (default 0).
 */
export function dbfsToUnit(dbfs: number, floor = -60, ceil = 0): number {
  const raw = (dbfs - floor) / (ceil - floor)
  return Math.min(1, Math.max(0, raw))
}

// ─── densityToMotionBuckets ───────────────────────────────────────────

/** One row returned by getEventDensity (slim shape used here). */
export interface DensityRow {
  readonly bucketStart: number
  readonly motion: number
  /** How MANY audio events fell in the bucket. Not a level — see below. */
  readonly audio?: number
  /**
   * Peak level of the bucket (device-history), dBFS, from the hub. ABSENT when the bucket holds no audio event, or when an older hub
   * did not send one — and absence means "not measured", which the lane draws
   * as nothing rather than as silence.
   */
  readonly audioDbfs?: number
}

/** Floor so a quiet overnight bucket still paints on the 24h tape.
 *  Linear max-norm against a busy afternoon (~50 vs ~2000) crushed night
 *  to ~2% — invisible on a ~28px strip. */
export const TAPE_MIN_VISIBLE = 0.35

/**
 * Sum raw counts that share a `bucketStart` across cameras, so a fused heatmap
 * is one density — not N independently normalised charts glued together (a
 * quiet camera's 1.0 must not equal a busy one's).
 *
 * BOTH counts are summed. Summing only motion left every fused bucket at
 * `audio: 0`, which the tape draws as a day with no sound at all — and the lane
 * that would have shown the loss is precisely the one being dropped. A row
 * without an `audio` field counts as zero rather than being skipped: `slim`
 * projections and older hubs omit it, and a missing field is not silence for
 * the other cameras in the same bucket.
 *
 * `audioDbfs` is a peak, so it merges by MAX per bucket, not by sum; a bucket
 * no camera measured stays level-less. A level-only bucket (counts 0) is kept.
 */
export function mergeDensityRows(
  groups: readonly (readonly DensityRow[])[],
): DensityRow[] {
  const byStart = new Map<number, { motion: number; audio: number; audioDbfs?: number }>()
  for (const rows of groups) {
    for (const r of rows) {
      const acc = byStart.get(r.bucketStart) ?? { motion: 0, audio: 0 }
      acc.motion += r.motion
      acc.audio += r.audio ?? 0
      if (r.audioDbfs !== undefined) {
        acc.audioDbfs = acc.audioDbfs === undefined ? r.audioDbfs : Math.max(acc.audioDbfs, r.audioDbfs)
      }
      byStart.set(r.bucketStart, acc)
    }
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, sums]): DensityRow => ({
      bucketStart,
      motion: sums.motion,
      audio: sums.audio,
      // The loudest camera's peak; absent when no camera measured one — never 0.
      ...(sums.audioDbfs === undefined ? {} : { audioDbfs: sums.audioDbfs }),
    }))
}

/**
 * Map a raw event count onto the 24h tape.
 *
 * Zero stays zero. The day's peak is 1. Everything in between is log1p so
 * a night with tens of motion events stays readable next to an afternoon
 * with thousands, then floored at `minVisible` (motion uses
 * {@link TAPE_MIN_VISIBLE}; audio uses 0 so a lone click stays faint).
 */
export function tapeCountIntensity(
  count: number,
  maxCount: number,
  minVisible: number = TAPE_MIN_VISIBLE,
): number {
  if (count <= 0 || maxCount <= 0) return 0
  const logged = Math.log1p(count) / Math.log1p(maxCount)
  return Math.min(1, Math.max(minVisible, logged))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Pull motion+audio counts out of `getEventDensity`. Object counts are
 *  ignored here — detections on the tape come from `listTracks`. */
export function parseDensityRows(raw: unknown): DensityRow[] {
  if (!Array.isArray(raw)) return []
  const out: DensityRow[] = []
  for (const r of raw) {
    if (!isRecord(r)) continue
    if (typeof r.bucketStart !== 'number' || typeof r.motion !== 'number') continue
    out.push({
      bucketStart: r.bucketStart,
      motion: r.motion,
      audio: typeof r.audio === 'number' ? r.audio : 0,
      // Only a real number is a level. Anything else is not-measured, and the
      // lane must be able to tell that from silence.
      ...(typeof r.audioDbfs === 'number' && Number.isFinite(r.audioDbfs)
        ? { audioDbfs: r.audioDbfs }
        : {}),
    })
  }
  return out
}

function densityToCountBuckets(
  rows: readonly DensityRow[],
  bucketMs: number,
  pick: (row: DensityRow) => number,
): Bucket[] {
  if (rows.length === 0) return []
  const maxCount = rows.reduce((m, r) => Math.max(m, pick(r)), 0)
  return rows.map((row): Bucket => ({
    startMs: row.bucketStart,
    endMs: row.bucketStart + bucketMs,
    intensity: tapeCountIntensity(pick(row), maxCount),
  }))
}

/**
 * Convert event-density rows into motion Bucket[] on the tape scale.
 * Each bucket spans `[bucketStart, bucketStart + bucketMs)`.
 */
export function densityToMotionBuckets(rows: readonly DensityRow[], bucketMs: number): Bucket[] {
  return densityToCountBuckets(rows, bucketMs, (r) => r.motion)
}

/**
 * The audio lane, from the hub's per-bucket LEVEL.
 *
 * This used to read the event COUNT and paint it on the six-rung dBFS meter:
 * 50 brief clicks in a quiet hour lit every rung, whatever their volume
 * (`__tests__/audio-lane-shows-a-level.spec.ts` has the measured table). A
 * count is not a level, and no amount of rescaling makes it one.
 *
 * `audioDbfs` is the bucket's peak level (device-history) the hub computes where
 * the samples already are. A bucket without one draws NOTHING — not a hairline, and
 * emphatically not the count as a stand-in, which is the substitution the whole
 * defect was made of.
 */
export function densityToAudioBuckets(rows: readonly DensityRow[], bucketMs: number): Bucket[] {
  return rows.map((row): Bucket => ({
    startMs: row.bucketStart,
    endMs: row.bucketStart + bucketMs,
    intensity: row.audioDbfs === undefined ? 0 : dbfsToUnit(row.audioDbfs),
  }))
}

// ─── audioEventsToBuckets ─────────────────────────────────────────────

/** Slim shape for an audio event used in bucketing. */
export interface AudioEventSlim {
  readonly timestamp: number
  readonly dbfs: number
}

/**
 * Bin audio events into fixed-width time buckets.
 *
 * For each bucket the intensity is `dbfsToUnit(max dbfs in bucket)`. Buckets
 * with no events get intensity 0. Events outside
 * `[fromMs, fromMs + count * bucketMs)` are silently ignored.
 *
 * @param events   - Audio events (timestamp + dbfs).
 * @param fromMs   - Start of the first bucket.
 * @param bucketMs - Bucket width in milliseconds.
 * @param count    - Number of output buckets.
 */
export function audioEventsToBuckets(
  events: readonly AudioEventSlim[],
  fromMs: number,
  bucketMs: number,
  count: number,
): Bucket[] {
  // Accumulate max dbfs per bucket index (undefined = no event in bucket)
  const maxDbfs: (number | undefined)[] = Array.from({ length: count }, () => undefined)

  for (const ev of events) {
    const idx = Math.floor((ev.timestamp - fromMs) / bucketMs)
    if (idx < 0 || idx >= count) continue
    const prev = maxDbfs[idx]
    maxDbfs[idx] = prev === undefined ? ev.dbfs : Math.max(prev, ev.dbfs)
  }

  return maxDbfs.map((dbfs, i): Bucket => ({
    startMs: fromMs + i * bucketMs,
    endMs: fromMs + (i + 1) * bucketMs,
    intensity: dbfs !== undefined ? dbfsToUnit(dbfs) : 0,
  }))
}

// ─── pickBucketMs ─────────────────────────────────────────────────────

const MIN_BUCKET_MS = 5_000
const MAX_BUCKET_MS = 3_600_000

/**
 * Choose a bucket duration that produces approximately `target` buckets for
 * the given time span.
 *
 * The result is clamped to `[5_000, 3_600_000]` ms.
 *
 * @param fromMs - Range start (inclusive).
 * @param toMs   - Range end (exclusive).
 * @param target - Desired number of buckets (default 240).
 */
export function pickBucketMs(fromMs: number, toMs: number, target = 240): number {
  const span = Math.abs(toMs - fromMs)
  // getEventDensity requires an INTEGER bucketMs (z.number().int()), so round.
  const raw = Math.round(span / target)
  return Math.min(MAX_BUCKET_MS, Math.max(MIN_BUCKET_MS, raw))
}
