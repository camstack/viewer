/**
 * playback-clock — the recorded playback time between two position ticks.
 *
 * The embed reports the recorded cursor about once a second, and that cursor is
 * the SEND cursor (what the hub has pushed), not the frame on screen. The
 * overlays need a smoother time than 1 Hz, so this projects the last report
 * forward at the play rate, on the wall clock the caller passes in.
 *
 * Pure and immutable: every function returns a new state. Frame accuracy
 * (a receiver-side clock) is a separate piece of work; this is the best the
 * 1 Hz cursor can honestly give.
 */

export interface PlaybackClock {
  /** Epoch ms of the recorded instant at `anchorWall`; null until a report. */
  readonly anchorEpoch: number | null
  readonly anchorWall: number
  /** Play rate (1 = real time). */
  readonly rate: number
  readonly paused: boolean
}

export const initialClock: PlaybackClock = { anchorEpoch: null, anchorWall: 0, rate: 1, paused: false }

/** A tick further than this from the projection is a jump, not jitter. */
export const CLOCK_JUMP_MS = 2_500

/** The recorded epoch at wall time `wall`; null before the first report. */
export function clockAt(clock: PlaybackClock, wall: number): number | null {
  if (clock.anchorEpoch === null) return null
  if (clock.paused) return clock.anchorEpoch
  return clock.anchorEpoch + (wall - clock.anchorWall) * clock.rate
}

/** Re-anchor at `wall`, keeping rate and pause. */
function anchored(clock: PlaybackClock, epoch: number, wall: number): PlaybackClock {
  return { ...clock, anchorEpoch: epoch, anchorWall: wall }
}

/**
 * A position tick. Small backwards jitter is ignored (the overlay must not
 * step back); a forward tick advances; a tick beyond {@link CLOCK_JUMP_MS}
 * from the projection re-anchors.
 */
export function clockReport(clock: PlaybackClock, epoch: number, wall: number): PlaybackClock {
  const projected = clockAt(clock, wall)
  if (projected === null) return anchored(clock, epoch, wall)
  const delta = epoch - projected
  if (Math.abs(delta) > CLOCK_JUMP_MS) return anchored(clock, epoch, wall)
  if (delta < 0) return clock
  return anchored(clock, epoch, wall)
}

/** A seek: the previous interpolation is dropped, the rate survives. */
export function clockSeek(clock: PlaybackClock, epoch: number, wall: number): PlaybackClock {
  return anchored(clock, epoch, wall)
}

export function clockSetRate(clock: PlaybackClock, rate: number, wall: number): PlaybackClock {
  const now = clockAt(clock, wall)
  const next = { ...clock, rate: rate > 0 ? rate : 1 }
  return now === null ? next : anchored(next, now, wall)
}

export function clockSetPaused(clock: PlaybackClock, paused: boolean, wall: number): PlaybackClock {
  if (clock.paused === paused) return clock
  const now = clockAt(clock, wall)
  const next = { ...clock, paused }
  return now === null ? next : anchored(next, now, wall)
}
