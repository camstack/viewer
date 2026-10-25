/**
 * main-thread-lag — how much of a "slow request" was never a request at all.
 *
 * ## The number that was lying
 *
 * Every latency the embed reports is a delta of `performance.now()` around an
 * `await`. That delta contains three different things summed into one:
 *
 *   1. time the request spent queued on the CLIENT before it was issued,
 *   2. time on the wire and at the hub,
 *   3. time the JS thread was BUSY and therefore unable to run the
 *      continuation that stops the clock.
 *
 * (3) is not latency. A response that arrived in 40 ms and then waited 4 s for
 * the thread to be free is reported as a 4 s request, and the 2026-08-21
 * session did exactly that: the feed's own `ms` had a p50 of 1047 ms and 77 of
 * 159 requests over 2 s, while the identical query measured from a laptop on
 * the same hub answered in 10-30 ms over the LAN and 47-89 ms over the public
 * tunnel — and both channels were probed at the same 15 s cadence, warm, at the
 * same time of night. A number that mixes those together cannot be acted on,
 * and worse, it points at the server every single time.
 *
 * ## How this measures it
 *
 * A timer scheduled every `intervalMs` can only be late — never early — and it
 * is late by exactly as long as the thread was unavailable. Sampling that
 * lateness gives a lower bound on how blocked the thread was, with no
 * cooperation from the code being measured. Samples are kept in a bounded ring
 * and summarised over an arbitrary window afterwards, so a request does not
 * have to know in advance that it will be worth measuring.
 *
 * It is a LOWER bound on purpose. A block that starts and ends between two
 * samples is invisible, and inflating the estimate to cover that would make the
 * one thing this exists to prove — "the thread was busy, not the network" —
 * unfalsifiable.
 *
 * The summarising half is pure and is where the tests are; the sampler is a
 * thin timer over it.
 */

/** One observation: at `at`, the timer was `lagMs` late. */
export interface LagSample {
  readonly at: number
  readonly lagMs: number
}

/** What the thread was doing across one request's lifetime. */
export interface LagWindow {
  /** Lower bound on milliseconds the thread was unavailable inside the window.
   *  Subtract this from a measured duration to get what is left for the wire. */
  readonly blockedMs: number
  /** The single worst stall — a 4 s block and forty 100 ms blocks add up the
   *  same and mean completely different things. */
  readonly maxLagMs: number
  /** How many samples landed in the window. ZERO is itself a finding: the
   *  sampler could not run either, so the thread was blocked for the whole of
   *  it and `blockedMs` understates the truth. */
  readonly samples: number
}

export const EMPTY_LAG_WINDOW: LagWindow = { blockedMs: 0, maxLagMs: 0, samples: 0 }

/**
 * Sum the lateness observed inside `[from, to]`.
 *
 * A sample is attributed to the window when the stall it measured OVERLAPS the
 * window — a timer that fires at `to + 3000` having been 4 s late was blocked
 * almost entirely inside it, and dropping it because its timestamp is outside
 * would discard precisely the sample that explains the request. Only the
 * overlapping part is counted.
 */
export function summariseLag(
  samples: readonly LagSample[],
  from: number,
  to: number,
): LagWindow {
  if (to <= from) return EMPTY_LAG_WINDOW
  let blockedMs = 0
  let maxLagMs = 0
  let count = 0
  for (const s of samples) {
    // The stall this sample measured ran from `at - lagMs` to `at`.
    const stallStart = s.at - s.lagMs
    const overlap = Math.min(s.at, to) - Math.max(stallStart, from)
    if (overlap <= 0) continue
    blockedMs += overlap
    maxLagMs = Math.max(maxLagMs, s.lagMs)
    count += 1
  }
  return { blockedMs: Math.round(blockedMs), maxLagMs: Math.round(maxLagMs), samples: count }
}

/**
 * Split a measured duration into the part the thread was blocked and the part
 * that is left for everything else.
 *
 * `netMs` is clamped at zero: overlapping stalls can in principle sum past the
 * window, and a negative "network time" would read as a bug in the transport
 * rather than in the estimate.
 */
export interface DurationSplit {
  readonly ms: number
  readonly blockedMs: number
  readonly netMs: number
  readonly maxLagMs: number
  readonly lagSamples: number
}

export function splitDuration(ms: number, window: LagWindow): DurationSplit {
  const blockedMs = Math.min(Math.round(ms), window.blockedMs)
  return {
    ms: Math.round(ms),
    blockedMs,
    netMs: Math.max(0, Math.round(ms) - blockedMs),
    maxLagMs: window.maxLagMs,
    lagSamples: window.samples,
  }
}

/** Sampling period. Fine enough to catch the ~500 ms stalls a render burst
 *  produces, coarse enough that the sampler is not itself the load. */
export const LAG_SAMPLE_INTERVAL_MS = 250

/** How many samples are retained. 600 × 250 ms = 150 s of history — longer than
 *  any single request this embed makes, including the 30 s outliers. */
const RING_CAPACITY = 600

/** Lateness below this is scheduler noise, not contention, and recording it
 *  would put a floor under every window. */
const NOISE_FLOOR_MS = 8

interface SamplerHandle {
  readonly stop: () => void
}

/** Schedule a repeating callback; returns the function that stops it. */
export type LagScheduler = (fn: () => void, ms: number) => () => void

let ring: LagSample[] = []
let running: SamplerHandle | null = null

/** Record a sample. Exported for tests; the sampler is the only caller. */
export function recordLagSample(sample: LagSample): void {
  if (sample.lagMs < NOISE_FLOOR_MS) return
  ring.push(sample)
  if (ring.length > RING_CAPACITY) ring = ring.slice(ring.length - RING_CAPACITY)
}

/** Drop everything. Tests only — a shared ring between cases is a shared bug. */
export function resetLagSamples(): void {
  ring = []
}

/** Summarise the recorded samples over a window. */
export function lagWindow(from: number, to: number): LagWindow {
  return summariseLag(ring, from, to)
}

/**
 * Start sampling. Idempotent: a second call is a no-op, so a remount cannot end
 * up with two samplers double-counting every stall.
 *
 * `now` and `schedule` are injected for tests. In the embed both default to the
 * real thing.
 */
export function startLagSampler(
  intervalMs: number = LAG_SAMPLE_INTERVAL_MS,
  now: () => number = () => performance.now(),
  // Returns its OWN canceller rather than a timer handle: a handle would have
  // to be typed as whatever `setInterval` returns on this platform, and a fake
  // would need a cast to produce one. This repo does not do casts.
  schedule: LagScheduler = (fn, ms) => {
    const handle = setInterval(fn, ms)
    return () => clearInterval(handle)
  },
): void {
  if (running !== null) return
  let expected = now() + intervalMs
  const stop = schedule(() => {
    const at = now()
    recordLagSample({ at, lagMs: Math.max(0, at - expected) })
    expected = at + intervalMs
  }, intervalMs)
  running = { stop }
}

/** Stop sampling (unmount, and tests). */
export function stopLagSampler(): void {
  running?.stop()
  running = null
}
