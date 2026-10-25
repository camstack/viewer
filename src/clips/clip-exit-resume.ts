/**
 * Where leaving clips mode should land on the recorded axis.
 *
 * > *"quando chiudo la modalità clip deve tornare sul playback sul punto che
 * > lasciamo dalla modalità clip"*
 *
 * A clip's own progress is FILE-RELATIVE (`ClipProgress.positionMs`), and the
 * recorded axis is wall-clock. The instant the operator was looking at is the
 * clip's start plus that offset, and this is the only place the two are added.
 */

/** What the timeline knows when the operator leaves clips mode. */
export interface ClipExitPoint {
  /** The clip ON THE FRAME, or null when none is. */
  readonly heldClipId: string | null
  /**
   * The held clip's START in wall-clock ms.
   *
   * This is the timeline's `activeEpoch`, which is the clip's start ONLY while
   * a clip is on the frame — otherwise it is the recorded playhead. That is
   * why {@link heldClipId} is the gate and not a convenience: without it, a
   * camera with no clip held would "resume" at the position it was already at
   * plus an offset belonging to nothing.
   */
  readonly clipStartMs: number | null
  /** File-relative position within the clip, or null before the first report. */
  readonly clipPositionMs: number | null
}

/**
 * The wall-clock instant to resume at, or `null` when there is nothing to
 * resume to.
 *
 * `null` is a real answer and the caller must treat it as one: no clip held,
 * or a clip that never reported a position. Seeking on a guess would move the
 * recorded playhead away from where the operator left it, which is worse than
 * not moving it at all.
 */
export function clipExitResumeMs(point: ClipExitPoint): number | null {
  if (point.heldClipId === null) return null
  if (point.clipStartMs === null || point.clipPositionMs === null) return null
  return point.clipStartMs + point.clipPositionMs
}
