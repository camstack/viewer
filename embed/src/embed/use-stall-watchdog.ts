/**
 * use-stall-watchdog — a connected stream whose frames stopped advancing.
 *
 * ## The symptom this exists for
 *
 * A grid tile froze and stayed frozen: the operator had to close and reopen the
 * grid. Nothing was in an error state — the peer connection was up, the player
 * said `playing`, and the last decoded frame simply never changed. **A FROZEN
 * video is not an errored one**, and every recovery path in this bundle keys off
 * an error, so nothing was ever going to fire.
 *
 * ## Detection
 *
 * `requestVideoFrameCallback` when the browser has it — it fires per PRESENTED
 * frame, which is the exact question being asked, and costs nothing when frames
 * stop (the callback simply is not invoked). WKWebView and Chrome both have it;
 * where it is missing the fallback polls `video.currentTime`, which advances
 * only while frames are being rendered.
 *
 * ## Two traps taken from the WebRTC gotchas, deliberately
 *
 * The adaptive-ladder entry records that a hysteresis field left at `0` reads as
 * "healthy since 1970", so a fresh session took a free upgrade on its first
 * tick. The same shape would be fatal here in the other direction: a watchdog
 * whose "last frame at" starts at 0 declares every tile stalled the instant it
 * mounts and reconnect-loops the whole grid. The clock is therefore seeded with
 * `now` and, more importantly, **the watchdog does not arm until the FIRST
 * frame has actually been seen** — a stream that never started is not a stream
 * that stalled, and it has its own (error) path.
 *
 * The same entry's "not failing is also not health" applies too: `playing` with
 * no frames is precisely the state this catches.
 *
 * ## Threshold
 *
 * {@link DEFAULT_STALL_MS} is 10 s. Long enough to survive a night-time camera
 * dropping to a very low frame rate (a 1 fps sub-stream still ticks ten times
 * inside the window) and a brief network hiccup that WebRTC will itself repair;
 * short enough that an operator watching a frozen tile does not have time to go
 * and reopen the grid by hand. Below ~5 s the low-fps false positives start;
 * above ~15 s the feature stops being a recovery and becomes an epitaph.
 *
 * Recovery is bounded and backed off: a tile that cannot be repaired must not
 * rebuild its session forever.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** No presented frame for this long, while the player says it is playing. */
export const DEFAULT_STALL_MS = 10_000

/** Polling cadence for the `currentTime` fallback, and for the arm check. */
const TICK_MS = 1_000

/**
 * Backoff between recovery attempts. A stall that a session rebuild cannot fix
 * is usually upstream (the camera itself), and hammering it makes the hub's
 * life worse without making the tile any better.
 */
export const RECOVERY_BACKOFF_MS = [0, 5_000, 15_000, 30_000] as const

/** Attempts before the watchdog gives up and leaves the tile alone. */
export const MAX_RECOVERY_ATTEMPTS = 4

/** Delay before the Nth recovery attempt (clamped to the last rung). */
export function recoveryBackoffMs(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, RECOVERY_BACKOFF_MS.length - 1))
  return RECOVERY_BACKOFF_MS[i] ?? 0
}

/**
 * Is this a stall? Pure, so the rule is testable without a video element.
 *
 * `lastFrameAt === null` means no frame has EVER arrived — not a stall, a
 * stream that has not started, which the error path owns.
 */
export function isStalled(input: {
  readonly lastFrameAt: number | null
  readonly nowMs: number
  readonly stallMs: number
  readonly playing: boolean
}): boolean {
  if (!input.playing) return false
  if (input.lastFrameAt === null) return false
  return input.nowMs - input.lastFrameAt >= input.stallMs
}

/**
 * `requestVideoFrameCallback` is in the DOM lib of newer TypeScript versions
 * with a richer signature than the one used here, so this describes the two
 * methods structurally rather than extending `HTMLVideoElement` (which would
 * conflict on the callback's parameters). Both are optional: Safari shipped
 * them years apart from the fallback path this file also carries.
 */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export interface StallWatchdogOptions {
  /** Element containing the `<video>` (the embed owns the tile wrapper). */
  readonly containerRef: React.RefObject<HTMLElement | null>
  /** The player believes it is streaming. A watchdog that ignores this would
   *  fight the error path over a tile that is legitimately connecting. */
  readonly playing: boolean
  /** Fired when a stall is confirmed. The caller rebuilds the session. */
  readonly onRecover: () => void
  readonly stallMs?: number
  /** Test seam — injected clock. */
  readonly now?: () => number
}

export interface StallWatchdogState {
  /** A recovery is in flight (a rebuild was just asked for). */
  readonly recovering: boolean
  /** Recoveries attempted since the last healthy run of frames. */
  readonly attempts: number
}

export function useStallWatchdog(options: StallWatchdogOptions): StallWatchdogState {
  const { containerRef, playing, onRecover, stallMs = DEFAULT_STALL_MS } = options
  const nowFn = options.now ?? Date.now
  const [state, setState] = useState<StallWatchdogState>({ recovering: false, attempts: 0 })

  // NEVER 0 — see the module note. `null` means "no frame yet", which is a
  // different thing from "a frame arrived at the epoch".
  const lastFrameAtRef = useRef<number | null>(null)
  const attemptsRef = useRef(0)
  const cooldownUntilRef = useRef(0)
  const onRecoverRef = useRef(onRecover)
  onRecoverRef.current = onRecover
  const nowRef = useRef(nowFn)
  nowRef.current = nowFn

  /** A frame was presented. Clears the stall clock and, once frames have been
   *  flowing again, the attempt counter — a repaired tile starts fresh. */
  const markFrame = useCallback((): void => {
    const now = nowRef.current()
    const previous = lastFrameAtRef.current
    lastFrameAtRef.current = now
    // A recovery counts as SUCCESSFUL once frames resume; without this the
    // counter would ratchet across unrelated stalls hours apart and the fourth
    // one would find the watchdog already exhausted.
    if (attemptsRef.current > 0 && previous !== null && now - previous < stallMs) {
      attemptsRef.current = 0
      setState({ recovering: false, attempts: 0 })
    }
  }, [stallMs])

  // ── frame source ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) {
      // Not streaming: stop the clock rather than accumulating a fake stall.
      lastFrameAtRef.current = null
      return
    }
    const container = containerRef.current
    const video = container?.querySelector('video') as VideoWithFrameCallback | null
    if (!video) return

    let cancelled = false
    let rvfcHandle: number | null = null

    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = (): void => {
        if (cancelled) return
        markFrame()
        rvfcHandle = video.requestVideoFrameCallback?.(onFrame) ?? null
      }
      rvfcHandle = video.requestVideoFrameCallback(onFrame)
      return () => {
        cancelled = true
        if (rvfcHandle !== null) video.cancelVideoFrameCallback?.(rvfcHandle)
      }
    }

    // Fallback: `currentTime` only advances while frames render.
    let lastTime = video.currentTime
    const iv = setInterval(() => {
      if (cancelled) return
      const t = video.currentTime
      if (t !== lastTime) {
        lastTime = t
        markFrame()
      }
    }, TICK_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [playing, containerRef, markFrame])

  // ── the verdict ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return
    const iv = setInterval(() => {
      const now = nowRef.current()
      if (now < cooldownUntilRef.current) return
      if (!isStalled({ lastFrameAt: lastFrameAtRef.current, nowMs: now, stallMs, playing })) return
      if (attemptsRef.current >= MAX_RECOVERY_ATTEMPTS) return

      const attempt = attemptsRef.current
      attemptsRef.current = attempt + 1
      // Re-arm the clock so one stall produces ONE recovery, not one per tick.
      lastFrameAtRef.current = now
      cooldownUntilRef.current = now + recoveryBackoffMs(attempt + 1) + stallMs
      setState({ recovering: true, attempts: attempt + 1 })
      onRecoverRef.current()
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [playing, stallMs])

  return state
}
