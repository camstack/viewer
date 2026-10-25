/**
 * Shared prop and model types for the activity-bar renderers (ActivityLanes,
 * the activity lanes). Kept in a dedicated file so both the hook return type and
 * the component props can import from one place without circular dependencies.
 */

import type { Range, Bucket } from './activity-bars.js'

// Re-export the primitive types so callers need only one import.
export type { Range, Bucket }

/**
 * The activity model consumed by ActivityLanes.
 * Structurally identical to the `TimelineActivity` returned by
 * `useTimelineActivity` — no cast needed; TypeScript is satisfied by
 * structural compatibility.
 */
export interface ActivityModel {
  readonly recording: readonly Range[]
  readonly motion: readonly Bucket[]
  readonly audio: readonly Bucket[]
}

/**
 * Props for the activity-lane views (ActivityLanes).
 *
 * - `model`         — The activity data (recording ranges, motion/audio buckets).
 * - `topMs`         — The epoch ms at scroll offset 0 (newest visible row).
 * - `zoomIndex`     — Current zoom level index (drives epochToOffset).
 * - `height`        — Viewport height in pixels (used to clip rendering).
 * - `scrollOffsetY` — Current vertical scroll offset in pixels.
 * - `width`         — Column width in pixels.
 */
export interface ActivityRendererProps {
  readonly model: ActivityModel
  readonly topMs: number
  readonly zoomIndex: number
  readonly height: number
  readonly scrollOffsetY: number
  readonly width: number
}

/**
 * The period being selected for an export or a delete, painted across the
 * lanes like a recording segment (`ActivityLanes`).
 */
export interface LaneSelection {
  readonly startMs: number
  readonly endMs: number
  /** Export is the accent; a delete is the danger colour, dashed. */
  readonly kind: 'export' | 'delete'
}
