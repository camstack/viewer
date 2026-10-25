/**
 * wall-back-visibility — when the wall's back button is on screen.
 *
 * The wall is full-bleed video, so its back button is shown on entry and on
 * every touch, then fades out after {@link WALL_BACK_HIDE_MS} of quiet. This is
 * the timer alone: a scheduler is injected so the rule is testable without a
 * clock, and the component owns only the animation.
 *
 * Pure — no React, no I/O.
 */

/** Quiet time before the button fades out. */
export const WALL_BACK_HIDE_MS = 3000

export interface WallBackScheduler {
  readonly set: (fn: () => void, ms: number) => unknown
  readonly clear: (handle: unknown) => void
}

export interface WallBackTimer {
  /** A touch (or the first mount): show now and restart the countdown. */
  readonly touch: () => void
  /** Stop the countdown (unmount). */
  readonly dispose: () => void
}

/**
 * `onChange(true)` fires on every touch, `onChange(false)` once the quiet time
 * elapses. A touch while the countdown runs restarts it rather than stacking.
 */
export function createWallBackTimer(
  onChange: (visible: boolean) => void,
  scheduler: WallBackScheduler,
  hideMs: number = WALL_BACK_HIDE_MS,
): WallBackTimer {
  let handle: unknown = null
  const cancel = (): void => {
    if (handle !== null) scheduler.clear(handle)
    handle = null
  }
  return {
    touch: () => {
      cancel()
      onChange(true)
      handle = scheduler.set(() => {
        handle = null
        onChange(false)
      }, hideMs)
    },
    dispose: cancel,
  }
}

/**
 * A touch relay between the wall's root (which sees every touch) and the back
 * button (which reacts to them). A relay instead of state: a touch must not
 * re-render the wall.
 */
export interface WallTouchRelay {
  readonly notify: () => void
  readonly subscribe: (listener: () => void) => () => void
}

export function createWallTouchRelay(): WallTouchRelay {
  const listeners = new Set<() => void>()
  return {
    notify: () => {
      for (const l of listeners) l()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
