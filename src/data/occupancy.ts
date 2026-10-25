/**
 * occupancy — pure helpers over the hub's `zone-analytics` occupancy snapshot.
 *
 * The hub's `zoneAnalytics` cap exposes the LIVE per-camera occupancy snapshot
 * (`getCurrentSnapshot`). This module narrows the (defensive, `unknown`) cap
 * payload into a typed shape and derives the per-class counts the UI renders —
 * stateless + side-effect-free, unit-tested in `__tests__`.
 *
 * History is NOT here. `zoneAnalytics.getCameraHistory` and its two siblings
 * are served from a 60-minute in-memory ring that dies with the process, and
 * they are deprecated: the durable answer is
 * `pipelineAnalytics.readLongTermSeries({ series: 'occupancy', scope })`, whose
 * rows are ~60 bytes per 5-minute bucket and kept for a year. The narrowing
 * helper that used to live here went with the hook that called it — a helper
 * kept "just in case" for a deprecated surface reads as a recommendation.
 */
import { isRecord } from './cap-query.js'

/** A per-scope occupancy breakdown (frame-wide / per-zone / unzoned). */
export interface OccupancyBreakdown {
  /** Total tracked objects in this scope. */
  readonly totalObjects: number
  /** Per-macro-class counts (e.g. `{ person: 2, car: 1 }`). */
  readonly byClass: Readonly<Record<string, number>>
}

/** A parked ("stationary") object with everything the live overlay needs: the
 *  LAST confirmed bbox in NORMALIZED [0,1] coords (derived from the snapshot's
 *  pixel bbox ÷ its frame dims), the class, the enrichment label (identity /
 *  plate) when known, and when it settled (drives the "parked Xm" tag). */
export interface StationaryOverlayObject {
  readonly id: string
  readonly className: string
  /** Normalized [0,1] bbox — same convention as the live detection boxes. */
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly becameStationaryAt: number
  readonly label?: string
}

/** The live occupancy snapshot for one camera (subset the UI needs). */
export interface CameraOccupancy {
  /** Frame timestamp (epoch ms) the snapshot was computed from. */
  readonly ts: number
  /** Frame-wide aggregate (everywhere, incl. confirmed stationary objects). */
  readonly frame: OccupancyBreakdown
  /** Count of parked ("stationary") objects surfaced alongside occupancy. */
  readonly stationaryCount: number
  /** Parked objects with their LAST confirmed bbox (normalized) — rendered by
   *  the bounding-box overlay in a distinct "parked" style. */
  readonly stationaryObjects: readonly StationaryOverlayObject[]
}

/** One time-series bucket (epoch-ms midpoint + averaged object count). */

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Narrow an unknown `byClass` record to `{ [class]: nonNegativeInt }`. */
function toByClass(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v)
  }
  return out
}

function toBreakdown(raw: unknown): OccupancyBreakdown {
  const r = isRecord(raw) ? raw : {}
  return { totalObjects: Math.max(0, Math.round(num(r.totalObjects))), byClass: toByClass(r.byClass) }
}

/**
 * Narrow a raw `zoneAnalytics.getCurrentSnapshot` payload into a
 * {@link CameraOccupancy}, or null when absent/malformed (the cap returns null
 * before the analytics pipeline has seen a frame for the device).
 */
/** Narrow one raw snapshot `stationaryObjects[]` entry; null when malformed or
 *  its bbox/frame dims are degenerate (nothing drawable). */
function toStationaryObject(raw: unknown): StationaryOverlayObject | null {
  if (!isRecord(raw)) return null
  const bbox = isRecord(raw.bbox) ? raw.bbox : null
  const fw = num(raw.frameWidth)
  const fh = num(raw.frameHeight)
  if (!bbox || fw <= 0 || fh <= 0) return null
  const x = num(bbox.x)
  const y = num(bbox.y)
  const w = num(bbox.w)
  const h = num(bbox.h)
  if (w <= 0 || h <= 0) return null
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
  return {
    id: typeof raw.id === 'string' ? raw.id : `${x},${y},${w},${h}`,
    className: typeof raw.className === 'string' ? raw.className : 'object',
    x1: clamp01(x / fw),
    y1: clamp01(y / fh),
    x2: clamp01((x + w) / fw),
    y2: clamp01((y + h) / fh),
    becameStationaryAt: Math.round(num(raw.becameStationaryAt)),
    ...(typeof raw.label === 'string' && raw.label.length > 0 ? { label: raw.label } : {}),
  }
}

export function toCameraOccupancy(raw: unknown): CameraOccupancy | null {
  if (!isRecord(raw)) return null
  const rawStationary = Array.isArray(raw.stationaryObjects) ? raw.stationaryObjects : []
  return {
    ts: Math.round(num(raw.ts)),
    frame: toBreakdown(raw.frame),
    // Badge count = every reported parked object; the overlay list below keeps
    // only the DRAWABLE ones (valid bbox + frame dims).
    stationaryCount: rawStationary.length,
    stationaryObjects: rawStationary
      .map(toStationaryObject)
      .filter((s): s is StationaryOverlayObject => s !== null),
  }
}


/** One class row for the occupancy UI. */
export interface OccupancyClassCount {
  readonly className: string
  readonly count: number
}

/**
 * Per-class counts of what is MOVING, highest first (ties → class name asc).
 *
 * The hub's `frame.byClass` is occupancy — and a parked car IS occupying, so it
 * is right to be in there. The chips are not occupancy though: they answer
 * "what is in the scene right now", and on a driveway that had been reading
 * `vehicle 3` for hours beside a PARKED chip also reading 3. The same three
 * cars, counted twice, in a number that never moved and that would have gone to
 * 4 for a car actually driving past with nothing to say which one was new.
 *
 * Subtracted per CLASS, not total-from-total: every entry in `stationaryObjects`
 * carries its own `className`, taken from the same snapshot instant, so this is
 * exact rather than a guess that a `3 - 3` happened to line up. A class whose
 * live count reaches zero drops out entirely — the parked ones are still
 * reported, by the PARKED chip that exists for them.
 *
 * Clamped at zero: the two halves come from one snapshot so they should never
 * disagree, but a negative chip would be visible nonsense.
 */
export function occupancyClassCounts(snap: CameraOccupancy | null): readonly OccupancyClassCount[] {
  if (!snap) return []
  const parked = new Map<string, number>()
  for (const s of snap.stationaryObjects) {
    parked.set(s.className, (parked.get(s.className) ?? 0) + 1)
  }
  return Object.entries(snap.frame.byClass)
    .map(([className, count]) => ({
      className,
      count: Math.max(0, count - (parked.get(className) ?? 0)),
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.className.localeCompare(b.className))
}

/** True when the snapshot carries at least one tracked object. */
export function hasOccupancy(snap: CameraOccupancy | null): boolean {
  return snap !== null && snap.frame.totalObjects > 0
}

/** A camera's `zoneId → zoneName` dictionary. */
export type ZoneNames = Readonly<Record<string, string>>

/**
 * Extract a `zoneId → zoneName` dictionary from a raw
 * `zoneAnalytics.getCurrentSnapshot` payload. The snapshot's `zones[]` carries
 * ONE entry per DEFINED zone (user + onboard) with both `zoneId` and
 * `zoneName`, so it is the canonical id→name source for a camera. Tolerant:
 * skips malformed rows, returns an empty dictionary for a null/absent snapshot
 * (before the pipeline has emitted a frame). Pure.
 *
 * ## A PLAIN OBJECT, deliberately — never a `Map`
 *
 * React Query's structural sharing (`replaceEqualDeep`) walks plain objects and
 * arrays and returns the PREVIOUS value when the new one is deeply equal;
 * anything else — a `Map`, a `Set` — it hands back verbatim. A `Map` returned
 * from a `queryFn` therefore has a NEW identity after every refetch even when
 * the hub answered exactly the same zones, and every consumer memo keyed on it
 * recomputes and every consumer component re-renders. That is not theoretical
 * here: {@link useZoneNames} is refetched by the live-invalidation bridge, and
 * its one consumer is the open track detail. Keep this a plain object.
 */
export function parseZoneNames(raw: unknown): ZoneNames {
  const names: Record<string, string> = {}
  if (!isRecord(raw) || !Array.isArray(raw.zones)) return names
  for (const zone of raw.zones) {
    if (
      isRecord(zone) &&
      typeof zone.zoneId === 'string' && zone.zoneId.length > 0 &&
      typeof zone.zoneName === 'string' && zone.zoneName.length > 0 &&
      // Assigning `__proto__` on an object literal REPLACES the prototype
      // instead of adding a key. The ids come off the wire, so the one id that
      // could do that is refused rather than trusted.
      zone.zoneId !== '__proto__'
    ) {
      names[zone.zoneId] = zone.zoneName
    }
  }
  return names
}
