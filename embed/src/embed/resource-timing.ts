/**
 * resource-timing — the one network measurement in a browser that a busy JS
 * thread cannot inflate.
 *
 * ## Why it is worth a module
 *
 * Everything else the embed reports is a `performance.now()` delta around an
 * `await`, and an await resumes on the main thread: if the thread is busy, the
 * delta grows even though the bytes arrived on time. `main-thread-lag.ts`
 * estimates that inflation. This module removes the estimate for `fetch()`,
 * because the browser records the *network* phases of every request itself, in
 * the networking stack, and hands them back as a `PerformanceResourceTiming`.
 *
 * So for the media plane the split stops being an inference:
 *
 *   `ms`          — what the JS thread saw (queue + wire + its own busyness)
 *   `responseMs`  — what the network actually took, per the browser
 *   `stallMs`     — `ms - responseMs`, i.e. the part that was never the server
 *
 * A media fetch and the feed's WS query share one origin, one channel and one
 * device, so proving the media plane's time is or is not on the wire settles
 * the same question for the feed — which has no Resource Timing to consult,
 * because WebSocket frames are not resources.
 *
 * ## Defensive on purpose
 *
 * `performance.getEntriesByName` is absent in some WebView configurations, and
 * cross-origin entries are zeroed unless the server sends
 * `Timing-Allow-Origin`. Both cases return null rather than a plausible-looking
 * zero: a fabricated "0 ms on the network" would read as proof of exactly the
 * conclusion this exists to test.
 */

/** The network phases of one request, as the browser measured them. */
export interface NetworkTiming {
  /** `startTime` → `responseEnd`, the whole browser-side request. */
  readonly totalMs: number
  /** Time before the request was actually sent — the browser's OWN queue
   *  (per-host connection limit, socket pool), which no JS timer can see. */
  readonly queuedMs: number
  /** Request sent → first byte of the response. Server think time plus the
   *  wire. */
  readonly ttfbMs: number
  /** Bytes transferred, per the browser. 0 for a cache hit. */
  readonly transferSize: number
}

/** The shape of `PerformanceResourceTiming` this module reads. Declared rather
 *  than imported so the module builds in a DOM-less test environment. */
export interface ResourceEntryLike {
  readonly startTime: number
  readonly requestStart: number
  readonly responseStart: number
  readonly responseEnd: number
  readonly transferSize?: number
}

/**
 * Reduce a resource entry to the phases worth logging.
 *
 * Returns null when the entry is zeroed — a cross-origin response without
 * `Timing-Allow-Origin` reports `requestStart === 0 && responseStart === 0`,
 * and reporting that as "0 ms of network" is a lie in the direction of the
 * hypothesis under test.
 */
export function summariseEntry(entry: ResourceEntryLike): NetworkTiming | null {
  if (entry.responseEnd <= 0) return null
  const opaque = entry.requestStart === 0 && entry.responseStart === 0
  if (opaque) return null
  return {
    totalMs: Math.round(entry.responseEnd - entry.startTime),
    queuedMs: Math.round(Math.max(0, entry.requestStart - entry.startTime)),
    ttfbMs: Math.round(Math.max(0, entry.responseStart - entry.requestStart)),
    transferSize: Math.round(entry.transferSize ?? 0),
  }
}

/**
 * Pick the entry for a request that started at or after `notBefore`.
 *
 * The same media URL can be fetched more than once in a session (a retry, an
 * eviction and a re-mount), and `getEntriesByName` returns every one of them.
 * Taking the last is wrong when a later request is still in flight; taking the
 * first is wrong after any repeat. The one that belongs to this attempt is the
 * earliest that did not start before the attempt did.
 */
export function pickEntry(
  entries: readonly ResourceEntryLike[],
  notBefore: number,
): ResourceEntryLike | null {
  let best: ResourceEntryLike | null = null
  for (const e of entries) {
    // 1 ms of slack: the fetch call and the entry's clock are the same
    // timebase, but rounding at the boundary drops a legitimate match.
    if (e.startTime + 1 < notBefore) continue
    if (best === null || e.startTime < best.startTime) best = e
  }
  return best
}

/** The `performance` surface this module needs — injected in tests. */
export interface ResourceTimingSource {
  readonly getEntriesByName: (name: string, type: string) => readonly ResourceEntryLike[]
}

function defaultSource(): ResourceTimingSource | null {
  if (typeof performance === 'undefined') return null
  const p: unknown = performance
  if (typeof p !== 'object' || p === null || !('getEntriesByName' in p)) return null
  const fn = (p as { getEntriesByName?: unknown }).getEntriesByName
  if (typeof fn !== 'function') return null
  return {
    getEntriesByName: (name, type) =>
      (fn as (n: string, t: string) => readonly ResourceEntryLike[]).call(performance, name, type),
  }
}

/**
 * The browser's own timing for a `fetch` of `url` that began at `startedAt`.
 * Null when Resource Timing is unavailable, not yet recorded, or opaque.
 */
export function networkTimingFor(
  url: string,
  startedAt: number,
  source: ResourceTimingSource | null = defaultSource(),
): NetworkTiming | null {
  if (source === null) return null
  try {
    const entry = pickEntry(source.getEntriesByName(url, 'resource'), startedAt)
    return entry === null ? null : summariseEntry(entry)
  } catch {
    return null
  }
}
