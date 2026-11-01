/**
 * boot-stall-probe — how long the JS thread could NOT answer during the first
 * seconds after a cold start.
 *
 * ## Why the boot timeline is not enough
 *
 * `boot-timeline.ts` records when each STAGE finished, which says when the app
 * had something to show. It cannot say whether the thread was free to answer a
 * tap while it was getting there — and "it opens, then does not respond for a
 * few seconds" is exactly that gap. A timer that asks to run every
 * {@link PROBE_INTERVAL_MS} and is late by 80 ms was blocked for 80 ms; the sum
 * over the window is the time a tap would have waited.
 *
 * ## Cost and gating
 *
 * The probe samples for {@link PROBE_WINDOW_MS} (about 320 trivial timer ticks)
 * and then stops itself. It writes ONE line, at `debug` level, which the logger
 * keeps and ships only while debug mode is on — so a production launch adds no
 * line and no traffic. In a dev client (`__DEV__`) the same line is `info`, so
 * it is visible without turning anything on. The numbers are also left on the
 * User Timing buffer as `camstack:boot:stall-*` measures where the runtime has
 * one, for a profiler or a web trace to read.
 *
 * The recorder is pure (an injected clock, no timers), so the arithmetic is
 * testable without a device.
 */
import { log } from '../lib/logger.js'
import { BOOT_SCOPE, markUserTiming } from './boot-timeline.js'

/** How often the probe asks to run. A stall shorter than this is not seen. */
export const PROBE_INTERVAL_MS = 25
/** How long after the probe starts it keeps sampling. */
export const PROBE_WINDOW_MS = 8_000
/** A tick later than this (beyond its interval) counts as a stall. */
export const STALL_THRESHOLD_MS = 50

export interface StallSummary {
  /** Ticks later than {@link STALL_THRESHOLD_MS}. */
  readonly stalls: number
  /** The single longest wait, ms. */
  readonly worstMs: number
  /** Sum of the lateness of every stalled tick, ms — what a tap would have queued behind. */
  readonly blockedMs: number
  /** Ticks that ran at all. */
  readonly ticks: number
  /** When the last stalled tick ended, ms after the probe started; 0 when none. */
  readonly lastStallEndMs: number
}

/** Accumulates tick lateness. Pure: the caller supplies every timestamp. */
export class StallRecorder {
  private expectedAt: number
  private readonly startedAt: number
  private ticks = 0
  private stalls = 0
  private worst = 0
  private blocked = 0
  private lastStallEnd = 0

  constructor(
    startedAt: number,
    private readonly intervalMs: number = PROBE_INTERVAL_MS,
    private readonly thresholdMs: number = STALL_THRESHOLD_MS,
  ) {
    this.startedAt = startedAt
    this.expectedAt = startedAt + intervalMs
  }

  /** Record that the timer fired at `now`. */
  tick(now: number): void {
    this.ticks += 1
    const lateness = Math.max(0, now - this.expectedAt)
    if (lateness >= this.thresholdMs) {
      this.stalls += 1
      this.blocked += lateness
      this.worst = Math.max(this.worst, lateness)
      this.lastStallEnd = now - this.startedAt
    }
    // Re-anchor on the actual firing, so one long stall is one stall and not a
    // run of late ticks.
    this.expectedAt = now + this.intervalMs
  }

  summary(): StallSummary {
    return {
      stalls: this.stalls,
      worstMs: Math.round(this.worst),
      blockedMs: Math.round(this.blocked),
      ticks: this.ticks,
      lastStallEndMs: Math.round(this.lastStallEnd),
    }
  }
}

let started = false

/**
 * Start the probe once per process. Safe to call from module scope; a second
 * call (a fast-refresh re-evaluation) does nothing.
 */
export function startBootStallProbe(): void {
  if (started) return
  started = true
  const startedAt = Date.now()
  const recorder = new StallRecorder(startedAt)
  const timer = setInterval(() => {
    const now = Date.now()
    recorder.tick(now)
    if (now - startedAt < PROBE_WINDOW_MS) return
    clearInterval(timer)
    const summary = recorder.summary()
    markUserTiming(`camstack:boot:stall-blocked-${String(summary.blockedMs)}ms`)
    const emit = __DEV__ ? log.info : log.debug
    emit(BOOT_SCOPE, 'js-thread stalls in the first seconds', { windowMs: PROBE_WINDOW_MS, ...summary })
  }, PROBE_INTERVAL_MS)
}
