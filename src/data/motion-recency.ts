/**
 * motion-recency — the pure half of the cameras list's "Motion" order.
 *
 * The list can be ordered by which camera most recently STARTED seeing motion.
 * Motion flips many times a minute on a busy site, so applying every flip
 * straight to the order would make the tiles jump under the operator's thumb.
 * The order is therefore re-applied at most once per
 * {@link MOTION_REORDER_INTERVAL_MS}: motion updates are coalesced, and the
 * NEWEST recency wins when the window opens.
 *
 * Pure and clock-injected: ids and timestamps in, ids and delays out. The hook
 * in `use-motion-recency.ts` is thin glue over these.
 */
import { motionEventPayload, parseMotionEvent } from './use-motion.js'

/** The order is reshuffled at most once per this many milliseconds. */
export const MOTION_REORDER_INTERVAL_MS = 5_000

/** Device id → ms epoch of the last motion START seen for it. */
export type MotionRecency = ReadonlyMap<number, number>

/** A camera, reduced to what ordering needs. */
export interface OrderableCamera {
  readonly id: number
}

/** One motion START, as the recency map records it. */
export interface MotionStart {
  readonly deviceId: number
  readonly at: number
}

/**
 * Narrow a `motion.on-motion-changed` payload to a motion START.
 *
 * Only the rising edge counts — "had motion most recently" is the instant
 * something began moving, and the falling edge arrives a close-after window
 * later, which would rank a camera that went quiet above one that just woke.
 * The payload's own `timestamp` is used (the hub's clock, the same clock the
 * `getStatus` seed's `lastDetectedAt` is on); `fallbackAt` covers a payload
 * without one.
 */
export function parseMotionStart(event: unknown, fallbackAt: number): MotionStart | null {
  const parsed = parseMotionEvent(event)
  if (parsed === null || !parsed.detected) return null
  // The PAYLOAD's ms epoch — never the envelope's `timestamp`, a Date (string
  // on the wire) stamped when the bus saw it.
  const raw = motionEventPayload(event)?.timestamp
  const at = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallbackAt
  return { deviceId: parsed.deviceId, at }
}

/** Device id → whether the last motion state seen for it was `detected`. */
export type MotionEdgeState = ReadonlyMap<number, boolean>

/**
 * Keep only RISING edges of the live stream. The hub re-sends `detected: true`
 * while a camera keeps moving (a heartbeat every second, plus the analyzer's
 * raw events), and every one of them used to count as a fresh start — a camera
 * that never stopped moving stayed pinned to the top. A `true` is a start only
 * when the last state seen for that device was not `true`; a `false` re-arms it.
 * Returns the next edge state (a NEW map) and the start, if this event was one.
 */
export function motionRisingEdge(
  edges: MotionEdgeState,
  event: unknown,
  fallbackAt: number,
): { readonly edges: MotionEdgeState; readonly start: MotionStart | null } {
  const parsed = parseMotionEvent(event)
  if (parsed === null) return { edges, start: null }
  const wasMoving = edges.get(parsed.deviceId) === true
  const next = new Map(edges)
  next.set(parsed.deviceId, parsed.detected)
  if (!parsed.detected || wasMoving) return { edges: next, start: null }
  return { edges: next, start: parseMotionStart(event, fallbackAt) }
}

/** The seed's `detected` per device, so a camera already moving when the list opens is not re-started by its next heartbeat. */
export function motionEdgesFromStatuses(
  statuses: readonly { readonly deviceId: number; readonly detected: boolean }[],
): MotionEdgeState {
  return new Map(statuses.map((s) => [s.deviceId, s.detected]))
}

/**
 * The seed half: a `motion.getStatus` answer reduced to a motion START, or null
 * when the camera has no `lastDetectedAt` (never moved since the hub started,
 * or the hub answered `null`). Such a camera has no recency and sorts after
 * every camera that has one — it is never given a made-up time.
 */
export function motionStartFromStatus(deviceId: number, status: unknown): MotionStart | null {
  if (typeof status !== 'object' || status === null || !('lastDetectedAt' in status)) return null
  const at = status.lastDetectedAt
  return typeof at === 'number' && Number.isFinite(at) ? { deviceId, at } : null
}

/**
 * Fold motion starts into a recency map. Returns a NEW map; keeps the later of
 * the two timestamps per device, so a late seed can never move a camera
 * backwards past a live event that already arrived.
 */
export function mergeMotionRecency(
  recency: MotionRecency,
  starts: readonly MotionStart[],
): MotionRecency {
  const next = new Map(recency)
  for (const { deviceId, at } of starts) {
    const prev = next.get(deviceId)
    if (prev === undefined || at > prev) next.set(deviceId, at)
  }
  return next
}

/**
 * Cameras ordered by last motion, most recent first. Cameras never seen in
 * motion follow, in the order they came in. Ties keep the incoming order too.
 */
export function orderByMotionRecency<T extends OrderableCamera>(
  cameras: readonly T[],
  recency: MotionRecency,
): readonly T[] {
  const seen: { readonly camera: T; readonly at: number; readonly index: number }[] = []
  const never: T[] = []
  cameras.forEach((camera, index) => {
    const at = recency.get(camera.id)
    if (at === undefined) never.push(camera)
    else seen.push({ camera, at, index })
  })
  // `.sort()` on a fresh array, NOT `toSorted` — Hermes does not implement it.
  const ordered = [...seen].sort((a, b) => b.at - a.at || a.index - b.index)
  return [...ordered.map((entry) => entry.camera), ...never]
}

/**
 * How long to wait before the next order may be applied: `0` when the window
 * since the last application has already elapsed (or nothing was applied yet),
 * otherwise the remainder of it.
 */
export function reorderDelay(
  now: number,
  lastAppliedAt: number | null,
  intervalMs: number = MOTION_REORDER_INTERVAL_MS,
): number {
  if (lastAppliedAt === null) return 0
  return Math.max(0, lastAppliedAt + intervalMs - now)
}
