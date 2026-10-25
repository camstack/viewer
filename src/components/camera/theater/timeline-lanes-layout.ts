/**
 * timeline-lanes-layout — where the three activity lanes sit, and where the
 * cursor's line starts, as plain numbers.
 *
 * Three consumers have to agree on x: the lanes themselves
 * (`ActivityLanes`), the header row of icons above them
 * (`TimelineLaneHeader`) and the soft dots drawn where the cursor crosses each
 * lane (`TimelineCursorLayers`). One module, so none of them can drift from
 * another — the failure mode `side-nav-metrics.ts` and `bottom-nav-metrics.ts`
 * were written against.
 *
 * Order, left to right: audio, recording, motion. Each lane has a slot wide
 * enough for its mark and a gap to the next, so the three read as three lanes
 * instead of three strokes of one.
 */

export type LaneKey = 'audio' | 'recording' | 'motion'

/** Left to right. The header icons follow this order. */
export const LANE_ORDER: readonly LaneKey[] = ['audio', 'recording', 'motion']

/** Width of one lane's slot (px). Holds the 3 px line and the 7 px dot. */
export const LANE_SLOT_PX = 14
/** Clear space between two slots (px). */
export const LANE_GAP_PX = 6
/** Stroke width of an audio / motion / recording mark (px). */
export const LANE_LINE_PX = 3
/** A detection dot on the motion lane (px). */
export const LANE_DOT_PX = 7
/** Distance from the content's right edge to the lanes (px). */
export const LANE_RIGHT_INSET_PX = 12

/** Total width of the three slots and the two gaps (px). */
export const LANES_WIDTH_PX =
  LANE_ORDER.length * LANE_SLOT_PX + (LANE_ORDER.length - 1) * LANE_GAP_PX

/** Horizontal space the lanes take from the right edge, for the card band. */
export const LANES_RESERVE_PX = LANES_WIDTH_PX + LANE_RIGHT_INSET_PX

/** Left edge of a lane's slot, measured from the lanes' own left edge. */
export function laneSlotLeft(lane: LaneKey): number {
  return LANE_ORDER.indexOf(lane) * (LANE_SLOT_PX + LANE_GAP_PX)
}

/** Centre of a lane, measured from the lanes' own left edge. */
export function laneCentre(lane: LaneKey): number {
  return laneSlotLeft(lane) + LANE_SLOT_PX / 2
}

/** Where a lane's mark of `markPx` starts, centred in its slot. */
export function laneMarkLeft(lane: LaneKey, markPx: number): number {
  return Math.round(laneCentre(lane) - markPx / 2)
}

/**
 * Distance from the content's RIGHT edge to a lane's centre — how the cursor
 * layer, which is laid out from the edges, places its dot on the lane.
 */
export function laneCentreFromRight(lane: LaneKey): number {
  return LANE_RIGHT_INSET_PX + LANES_WIDTH_PX - laneCentre(lane)
}

/**
 * Width of the left time-label column (matches `styles.tickLabel.width` on the
 * scroller). Shared so the floating tools bar and the card band cannot drift.
 */
export const TICK_LABEL_WIDTH = 38

/**
 * Where the cursor's line begins (px from the row's left edge): the right edge
 * of the time-label column (the row's padding, `SPACING.md`, plus the labels'
 * {@link TICK_LABEL_WIDTH}). The line and its marker dot never enter the label
 * column — the readable hour labels own it.
 */
export const CURSOR_LINE_START_PX = 8 + TICK_LABEL_WIDTH

/** Diameter of the dot that marks the cursor's time at the line's left end. */
export const CURSOR_ORIGIN_DOT_PX = 8

interface Span {
  readonly startMs: number
  readonly endMs: number
}
interface Level extends Span {
  readonly intensity: number
}

/** The lane data a crossing is judged against. */
export interface LaneData {
  readonly recording: readonly Span[]
  readonly motion: readonly Level[]
  readonly audio: readonly Level[]
}

/**
 * The lanes with an ACTIVE segment at `epochMs` — where the cursor really meets
 * something. An empty lane at that time gets no crossing dot.
 */
export function lanesActiveAt(data: LaneData, epochMs: number): readonly LaneKey[] {
  const within = (s: Span): boolean => epochMs >= s.startMs && epochMs < s.endMs
  const hit: LaneKey[] = []
  if (data.audio.some((b) => b.intensity > 0 && within(b))) hit.push('audio')
  if (data.recording.some(within)) hit.push('recording')
  if (data.motion.some((b) => b.intensity > 0 && within(b))) hit.push('motion')
  return hit
}
