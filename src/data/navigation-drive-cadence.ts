/**
 * The drive cadence — the ONE ticker behind both drive surfaces.
 *
 * The cap's `move` is momentary and the provider forwards every one to a
 * drive write without coalescing (`navigation.cap.ts`): the viewer owns the
 * rate. So: one nudge the moment a drive begins, then one per
 * `NAVIGATION_DRIVE_INTERVAL_MS` carrying the LATEST vector, and one `stop`
 * on release. The d-pad (`startDrive`) and the joystick (`driveVector`) share
 * it; a joystick with its own timer next to the d-pad's would be two
 * cadences that could both be running (operator, 2026-09-06).
 *
 * Pure: no React, no wire. The hook supplies the two sinks.
 */
import { NAVIGATION_DRIVE_INTERVAL_MS } from './navigation-controls.js'

export interface DriveVector {
  readonly pan: number
  readonly tilt: number
}

export interface DriveCadenceSinks {
  readonly move: (vector: DriveVector) => void
  readonly stop: () => void
}

export interface DriveCadence {
  /**
   * Drive with this vector. Starts the ticker (and nudges now) when idle;
   * while driving it only replaces what the next tick sends. A zero vector
   * while driving is a release; while idle it is nothing.
   */
  readonly drive: (vector: DriveVector) => void
  /** Halt: clear the ticker and send `stop` — unconditionally, so the Stop
   *  button always reaches the robot even when nothing was driving. */
  readonly stop: () => void
  readonly active: () => boolean
  /** Unmount path: clear the ticker and send `stop` ONLY if driving. */
  readonly dispose: () => void
}

function isZero(vector: DriveVector): boolean {
  return vector.pan === 0 && vector.tilt === 0
}

export function createDriveCadence(
  sinks: DriveCadenceSinks,
  intervalMs: number = NAVIGATION_DRIVE_INTERVAL_MS,
): DriveCadence {
  let timer: ReturnType<typeof setInterval> | null = null
  let latest: DriveVector | null = null

  const clear = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    latest = null
  }

  const stop = (): void => {
    clear()
    sinks.stop()
  }

  const drive = (vector: DriveVector): void => {
    if (isZero(vector)) {
      if (timer !== null) stop()
      return
    }
    latest = vector
    if (timer !== null) return
    sinks.move(vector)
    timer = setInterval(() => {
      if (latest !== null) sinks.move(latest)
    }, intervalMs)
  }

  return {
    drive,
    stop,
    active: () => timer !== null,
    dispose: () => {
      if (timer !== null) stop()
    },
  }
}
