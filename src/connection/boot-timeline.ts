/**
 * boot-timeline — one clock for the whole cold launch.
 *
 * ## Why this exists
 *
 * "It takes several seconds before I see a picture" is not a measurement, and
 * neither is a trace of the last stage. The client boot is a chain — app start
 * → persisted server restored → transport created → socket open → session
 * verified → device list → embed loaded → first frame — and every previous
 * attempt to shorten it argued about which link was heavy from the code alone.
 *
 * The stages are recorded on ONE monotonic clock and emitted as ONE line per
 * stage plus ONE summary, so a launch is readable in Loki as a single record
 * instead of hand-correlated timestamps. Every viewer log line already ships to
 * the hub through `LoggerBridge`.
 *
 * ## Why it is a module singleton and not a hook
 *
 * The first stages happen before React renders anything, and several happen in
 * modules (`system-controller`, `camera-list-cache`) that deliberately import
 * no `react-native` so they stay loadable in the node-env vitest suite. A
 * plain module with an injectable clock is reachable from all of them and is
 * unit-testable without a renderer.
 *
 * ## Contamination warning
 *
 * The hub this runs against is measured at 70-95% main-thread with ~42 s of
 * synchronous blocks per 120 s. Any stage that waits on a hub round-trip
 * carries that contention in its number. Compare stages WITHIN one launch, and
 * compare launches only in aggregate — a single slow boot proves nothing about
 * client code.
 */
import { log } from '../lib/logger.js'

/** Scope for every line this module writes — one grep away in Loki. */
export const BOOT_SCOPE = 'boot'

/**
 * The stages of a cold launch, in the order they are expected to occur.
 *
 * Named for what the USER is waiting on, not for the function that finishes:
 * a stage that never appears is as much a finding as one that is slow, and a
 * name like `transportReady` says what is missing when it is absent.
 */
export type BootStage =
  /** Module evaluation of the app entry — the earliest instant we can observe. */
  | 'appStart'
  /** The persisted active server + token have been read back from storage. */
  | 'serverRestored'
  /** `createSystem` returned; a transport object exists (not yet open). */
  | 'transportCreated'
  /** The hub answered an authenticated round-trip: queries may now be issued. */
  | 'transportReady'
  /** The endpoint race settled on a route. */
  | 'routeDecided'
  /** The transport was torn down and rebuilt onto a different base URL. */
  | 'routeSwitched'
  /** A camera list was painted from the on-device cache (no network). */
  | 'camerasFromCache'
  /** The authoritative camera list arrived from the hub. */
  | 'camerasLive'
  /** The embed bundle finished loading in a WebView (warm-up or real player). */
  | 'embedLoaded'
  /** A player was mounted and began signalling. */
  | 'signalingStart'
  /** The first live frame painted. */
  | 'firstFrame'

/** One recorded stage. */
export interface BootMark {
  readonly stage: BootStage
  /** Milliseconds since the timeline started. */
  readonly atMs: number
  /** Milliseconds since the PREVIOUS mark — the cost of this link alone. */
  readonly sincePrevMs: number
}

/**
 * Records the stages of one launch. Pure apart from the injected clock, so the
 * sequencing is testable without a device.
 *
 * Every stage is recorded at most once: a cold launch has one first frame, and
 * a later re-render must not overwrite the number that describes the launch.
 * `mark` returns the recorded mark, or `null` when the stage was already seen —
 * the caller can then skip the log line rather than repeating it.
 */
export class BootTimeline {
  private readonly startedAt: number
  private readonly marks: BootMark[] = []
  private readonly seen = new Set<BootStage>()
  private readonly now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
    this.startedAt = this.now()
  }

  /** Record a stage. Returns `null` if this stage was already recorded. */
  mark(stage: BootStage): BootMark | null {
    if (this.seen.has(stage)) return null
    this.seen.add(stage)
    const atMs = this.now() - this.startedAt
    const prev = this.marks[this.marks.length - 1]
    const mark: BootMark = { stage, atMs, sincePrevMs: prev ? atMs - prev.atMs : atMs }
    this.marks.push(mark)
    return mark
  }

  has(stage: BootStage): boolean {
    return this.seen.has(stage)
  }

  /** Every mark so far, in the order recorded. */
  timeline(): readonly BootMark[] {
    return [...this.marks]
  }

  /** `{ appStart: 0, serverRestored: 41, … }` — the shape a log line carries. */
  summary(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const m of this.marks) out[m.stage] = m.atMs
    return out
  }
}

/** The launch currently being measured. */
let current = new BootTimeline()

/**
 * Record a boot stage and log it.
 *
 * Silent on a repeat, so a component that remounts cannot flood the scope or
 * move a number that already described the launch.
 */
export function markBoot(stage: BootStage, meta?: Record<string, unknown>): void {
  const mark = current.mark(stage)
  if (mark === null) return
  log.info(BOOT_SCOPE, `stage ${stage}`, {
    stage,
    atMs: mark.atMs,
    sincePrevMs: mark.sincePrevMs,
    ...meta,
  })
  // The first frame is the end of the thing the operator is complaining about.
  // Emit the whole chain on one line there so a launch can be read — and
  // compared against another launch — without stitching eleven lines together.
  if (stage === 'firstFrame') {
    log.info(BOOT_SCOPE, 'timeline', { totalMs: mark.atMs, ...current.summary() })
  }
}

/** The live timeline (diagnostics, tests). */
export function bootTimeline(): BootTimeline {
  return current
}

/** Start a new launch. Only for tests — a process has exactly one cold start. */
export function resetBootTimeline(now?: () => number): BootTimeline {
  current = new BootTimeline(now)
  return current
}
