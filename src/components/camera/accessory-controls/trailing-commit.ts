/**
 * A tiny trailing debouncer for accessory steppers.
 *
 * An arrow tap moves the OPTIMISTIC readout immediately, but must NOT become a
 * cap mutation per tap: nudging a thermostat from 19° to 23° is eight taps, and
 * eight `setTarget` calls make the device chase the intermediate values (and
 * the row disable itself mid-burst). `schedule()` on every tap; `commit` runs
 * ONCE, `delayMs` after the last one, and the caller writes whatever the
 * optimistic state has accumulated by then.
 *
 * Deliberately React-free so the timing is unit-tested with fake timers — the
 * viewer's vitest environment is `node` and has no renderer.
 */

export interface TrailingCommit {
  /** (Re)start the trailing window. The commit fires `delayMs` after the last call. */
  readonly schedule: () => void
  /** Drop a pending commit (unmount). */
  readonly cancel: () => void
  /** True while a commit is scheduled and has not fired yet. */
  readonly isScheduled: () => boolean
}

/**
 * Build a trailing debouncer. A non-positive `delayMs` still defers to a
 * macrotask (delay 0) rather than committing synchronously, so a burst
 * dispatched in one tick still folds into one commit.
 */
export function createTrailingCommit(delayMs: number, commit: () => void): TrailingCommit {
  const delay = delayMs > 0 ? delayMs : 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const schedule = (): void => {
    cancel()
    timer = setTimeout(() => {
      timer = null
      commit()
    }, delay)
  }

  return { schedule, cancel, isScheduled: () => timer !== null }
}
