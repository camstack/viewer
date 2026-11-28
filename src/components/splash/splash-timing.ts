/** Timing and readiness rules of the splash overlay (pure; the component only wires them). */

/** One intro pass of the logo. */
export const INTRO_MS = 1800
/** The overlay's fade-out into the app. */
export const FADE_MS = 250
/** Hard cap: the overlay never holds the app longer than this, ready or not. */
export const MAX_HOLD_MS = 4000

export interface FadeInput {
  /** The app's readiness signal (the persisted server state has loaded). */
  readonly ready: boolean
  /** `null` while the OS answer is still pending. */
  readonly reduceMotion: boolean | null
  /** Time since the overlay laid out. */
  readonly elapsedMs: number
}

/**
 * Milliseconds from now until the fade-out must start. Ready before the pass
 * ends finishes the pass first; reduce-motion shows only the rest frame, so it
 * fades the moment the app is ready; never past `MAX_HOLD_MS`.
 */
export function fadeDelayMs({ ready, reduceMotion, elapsedMs }: FadeInput): number {
  const capLeft = Math.max(0, MAX_HOLD_MS - elapsedMs)
  if (!ready || reduceMotion === null) return capLeft
  if (reduceMotion) return 0
  return Math.min(capLeft, Math.max(0, INTRO_MS - elapsedMs))
}
