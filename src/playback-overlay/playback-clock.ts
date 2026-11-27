/**
 * playback-clock — the recorded playback time between two position ticks.
 *
 * The embed reports the recorded cursor about once a second, and that cursor is
 * the SEND cursor (what the hub has pushed), not the frame on screen. The
 * overlays need a smoother time than 1 Hz, so this projects the last report
 * forward at the play rate, on the wall clock the caller passes in.
 *
 * Where the player can name the frame it PRESENTED (`requestVideoFrameCallback`
 * plus the hub's RTP anchor, planning#728 P2), that report is the truth and the
 * send cursor is ignored while it keeps arriving. Without it (no rvfc, no RTP
 * stamp from the hub, a native player) the cursor, interpolated, is the clock.
 *
 * Pure and immutable: every function returns a new state.
 */

export interface PlaybackClock {
  /** Epoch ms of the recorded instant at `anchorWall`; null until a report. */
  readonly anchorEpoch: number | null
  readonly anchorWall: number
  /** Play rate (1 = real time). */
  readonly rate: number
  readonly paused: boolean
  /** Wall time of the last presented-frame anchor; null = none (cursor mode). */
  readonly presentedWall: number | null
}

export const initialClock: PlaybackClock = {
  anchorEpoch: null,
  anchorWall: 0,
  rate: 1,
  paused: false,
  presentedWall: null,
}

/** A presented-frame report this recent keeps the send cursor out of the clock. */
export const PRESENTED_FRESH_MS = 1_000

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
  if (clock.presentedWall !== null && wall - clock.presentedWall < PRESENTED_FRESH_MS) return clock
  const projected = clockAt(clock, wall)
  if (projected === null) return anchored(clock, epoch, wall)
  const delta = epoch - projected
  if (Math.abs(delta) > CLOCK_JUMP_MS) return anchored(clock, epoch, wall)
  if (delta < 0) return clock
  return anchored(clock, epoch, wall)
}

/** A seek: the previous interpolation is dropped, the rate survives. */
export function clockSeek(clock: PlaybackClock, epoch: number, wall: number): PlaybackClock {
  return { ...anchored(clock, epoch, wall), presentedWall: null }
}

/**
 * The epoch of the frame the player presented at `wall`: a hard anchor (it is
 * the truth, not a jittery estimate). Wall times are the caller's single clock.
 */
export function clockPresented(clock: PlaybackClock, epoch: number, wall: number): PlaybackClock {
  return { ...anchored(clock, epoch, wall), presentedWall: wall }
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

/** The presented-frame report the player bridge writes (a ref: no re-render per frame). */
export interface PresentedReport {
  readonly epochMs: number
  /** Wall time the report was received (`Date.now()`). */
  readonly atWall: number
}

/**
 * Take a presented report into the clock. Dropped while a seek still waits for
 * its anchor (a frame of the OLD pointer), and each report is taken once.
 */
export function takePresented(
  clock: PlaybackClock,
  report: PresentedReport | null,
  lastAtWall: number | null,
  awaitingAnchor: boolean,
): { readonly clock: PlaybackClock; readonly lastAtWall: number | null } {
  if (report === null || report.atWall === lastAtWall) return { clock, lastAtWall }
  if (awaitingAnchor) return { clock, lastAtWall: report.atWall }
  return { clock: clockPresented(clock, report.epochMs, report.atWall), lastAtWall: report.atWall }
}

