/**
 * snapshot-file-store — the one place a camera's last good frame is written to,
 * and read from, the device file system.
 *
 * Read `snapshot-file-cache.ts` first: it explains WHY the frame lives in a file
 * we name instead of `expo-image`'s disk cache, and it owns every naming and
 * decision rule (all pure, all unit-tested). This file is the effects, behind a
 * narrow port so the rules can be tested against a fake file system rather than
 * a simulator.
 *
 * ## The five rules that make a persisted frame safe to paint
 *
 *  1. **Promote only what fully landed.** The download writes a `.tmp` with no
 *     identity in its name; a rename publishes it. A killed download can only
 *     leave something the sweep deletes — never a truncated JPEG under a name
 *     that claims a good capture.
 *  2. **Refuse bytes with no stateable provenance.** A 200 whose ETag is absent,
 *     unreadable, or names another device is DISCARDED. An age we cannot state
 *     is the defect, not the frame.
 *  3. **Never move backwards.** A response older than the frame on disk is
 *     discarded. Twice a merely-SLOW server put a two-week-old JPEG back on
 *     screen; a capture time that regresses is now refused outright.
 *  4. **A failure keeps the last good frame.** Offline, or a hub that is merely
 *     slow, paints the newest real frame plus its age badge. Blanking was the
 *     regression; a stale photograph masquerading as live was the other one, and
 *     the badge is what separates them.
 *  5. **One download per identity, and no timer of its own.** See
 *     {@link decideSnapshotFetch}.
 *  6. **The plane degrades into a QUEUE, never into a burst.** See
 *     {@link SNAPSHOT_FETCH_CONCURRENCY}.
 *
 * State is published through a `subscribe`/`get` pair so React can read it with
 * `useSyncExternalStore` (see `use-snapshot-file.ts`), and every published state
 * object is frozen and replaced rather than mutated.
 */
import { log } from '../lib/logger.js'
import {
  decideSnapshotFetch,
  parseSnapshotCacheFileName,
  planSnapshotCacheSweep,
  snapshotCacheEntryFor,
  snapshotCacheTmpFileName,
  snapshotCacheWidthKey,
  type SnapshotCacheEntry,
} from './snapshot-file-cache.js'

/** What one HTTP download told us. `etag` is the frame's identity. */
export interface SnapshotDownloadResult {
  readonly status: number
  readonly etag: string | null
}

/**
 * Everything this store needs from a file system, and nothing more.
 *
 * File NAMES only — the store owns one directory and composes paths itself, so
 * no caller can reach outside it. The native binding is in
 * `snapshot-file-system.ts`; the tests bind an in-memory fake.
 */
export interface SnapshotFileSystemPort {
  /** Absolute `file://…/` directory URI, with a trailing slash. */
  readonly directory: string
  ensureDirectory: () => Promise<void>
  list: () => Promise<readonly string[]>
  download: (
    url: string,
    targetFileName: string,
    headers: Readonly<Record<string, string>>,
  ) => Promise<SnapshotDownloadResult>
  move: (fromFileName: string, toFileName: string) => Promise<void>
  remove: (fileName: string) => Promise<void>
}

/** What one surface can paint right now. */
export interface SnapshotFileState {
  /** False only on web, where there is no file system to cache into. */
  readonly supported: boolean
  /** `file://…` URI of the newest frame we hold, or null when we hold none. */
  readonly uri: string | null
  /** Epoch ms of the capture inside that file, as stated by the server. */
  readonly capturedAt: number | null
  /** A download for this surface is in flight. */
  readonly fetching: boolean
  /** The last attempt failed AND we have nothing to paint. */
  readonly failed: boolean
}

const IDLE: SnapshotFileState = Object.freeze({
  supported: true,
  uri: null,
  capturedAt: null,
  fetching: false,
  failed: false,
})

export const SNAPSHOT_FILE_UNSUPPORTED: SnapshotFileState = Object.freeze({
  supported: false,
  uri: null,
  capturedAt: null,
  fetching: false,
  failed: false,
})

export interface SnapshotFileRequest {
  readonly deviceId: number
  readonly width: number | undefined
  /** The identity-versioned hub URL, from `resolveSnapshotUri`. */
  readonly remoteUrl: string | null
  /** Auth headers the rest of the app already uses for hub media. */
  readonly headers: Readonly<Record<string, string>>
  readonly enabled: boolean
}

/**
 * How many snapshot downloads may be on the wire at once, across the whole app.
 *
 * ## What this is a net under
 *
 * `request` is called from an effect keyed on the identity-versioned URL. That
 * identity moves for EVERY tile in the same tick — one `getSnapshotLinks` poll
 * answers for the whole demand set — so before this gate the fan-out was
 * exactly the number of mounted surfaces. Measured on the live hub with 30
 * cameras (viewer v1.0.369): bursts of up to 71 simultaneous media fetches
 * every ~5 s, and a request that landed inside a burst had a p50 of 4540 ms
 * against 486 ms for one that did not.
 *
 * Bounding it does not make the fleet load faster — total time to paint N tiles
 * is set by the hub's throughput, not by how many requests are outstanding. It
 * changes who pays: 71 outstanding requests share one connection pool and one
 * JS thread with everything else the app is doing, so an unrelated 50 ms call
 * queues behind the whole grid. Six at a time keeps the plane busy and leaves
 * the rest of the app a lane.
 *
 * ## Why six, and why not a number of our own
 *
 * The embed's media plane already reached this conclusion and wrote down the
 * reasoning: `MEDIA_FETCH_CONCURRENCY` in `embed/src/embed/use-authed-image.ts`.
 * Two media planes in one product with two different caps is the kind of
 * disagreement nobody notices until one of them is wrong, so this is pinned to
 * that number by a guard — `snapshot-fetch-concurrency.spec.ts` reads the
 * embed's source and fails if they drift apart. The app cannot import it
 * directly: that module is a browser one (blobs, object URLs) and pulling it
 * into the native bundle to reach one integer is not a trade worth making.
 *
 * This is the SAFETY NET, not the mechanism. What decides which tiles are
 * fetched at all is viewport-scoped demand (`SnapshotOverviewProvider`).
 */
export const SNAPSHOT_FETCH_CONCURRENCY = 6

/**
 * A slot in the download plane, or a place in the queue for one.
 *
 * A plain counting semaphore, with one rule that is easy to get wrong: a slot
 * is HANDED to the next waiter rather than released and re-taken. Decrementing
 * first would let a fresh caller slip into the free slot before the woken
 * waiter resumes, and the cap would drift up by one on every handoff.
 */
class FetchGate {
  private active = 0
  private waiters: (() => void)[] = []

  constructor(private readonly limit: number) {}

  /** Number of callers currently waiting for a slot — for the log line. */
  get queued(): number {
    return this.waiters.length
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
    // The slot was transferred, not re-acquired — `active` already counts it.
  }

  release(): void {
    const next = this.waiters.shift()
    if (next !== undefined) {
      next()
      return
    }
    this.active = Math.max(0, this.active - 1)
  }
}

/** A queue wait worth a log line. Below this it is indistinguishable from
 *  scheduling noise, and one line per tile per poll would be the noise. */
const SLOW_QUEUE_WAIT_MS = 750

/** `101` + `w320` → the coalescing key for one surface. */
function surfaceKey(deviceId: number, widthKey: string): string {
  return `${String(deviceId)}:${widthKey}`
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class SnapshotFileStore {
  private readonly states = new Map<string, SnapshotFileState>()
  private readonly entries = new Map<string, SnapshotCacheEntry>()
  /** Per surface: the URL whose request already settled in this process. */
  private readonly settled = new Map<string, string>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private hydrating: Promise<void> | null = null
  /** Rule 6. Per store rather than per module so a test cannot inherit another
   *  test's queue; there is one store per process in production. */
  private readonly gate = new FetchGate(SNAPSHOT_FETCH_CONCURRENCY)

  constructor(
    private readonly fs: SnapshotFileSystemPort,
    private readonly now: () => number = Date.now,
  ) {}

  /** Subscribe to state changes (`useSyncExternalStore`). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * What this surface can paint. The same object identity until the state
   * actually changes — `useSyncExternalStore` re-renders forever otherwise.
   */
  get = (deviceId: number, widthKey: string): SnapshotFileState =>
    this.states.get(surfaceKey(deviceId, widthKey)) ?? IDLE

  /**
   * Read the directory once per process: the frames already on disk are what a
   * cold start paints while the hub is unreachable, and the sweep is the only
   * thing bounding the directory.
   */
  hydrate = (): Promise<void> => {
    this.hydrating ??= this.runHydrate()
    return this.hydrating
  }

  /** Fetch this surface's frame if the identity is one we have not asked for. */
  request = async (req: SnapshotFileRequest): Promise<void> => {
    await this.hydrate()
    const widthKey = snapshotCacheWidthKey(req.width)
    const key = surfaceKey(req.deviceId, widthKey)
    const decision = decideSnapshotFetch({
      enabled: req.enabled,
      remoteUrl: req.remoteUrl,
      cached: this.entries.get(key) ?? null,
      settledUrl: this.settled.get(key) ?? null,
      inFlight: this.inFlight.has(key),
    })
    if (decision.kind !== 'fetch') return
    const task = this.runFetch(key, req, widthKey, decision.url, decision.ifNoneMatch)
    this.inFlight.set(key, task)
    try {
      await task
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async runHydrate(): Promise<void> {
    try {
      await this.fs.ensureDirectory()
      const names = await this.fs.list()
      const plan = planSnapshotCacheSweep(names, this.now())
      for (const name of plan.remove) await this.remove(name)
      for (const name of plan.keep) {
        const entry = parseSnapshotCacheFileName(name)
        if (entry === null) continue
        const key = surfaceKey(entry.deviceId, entry.widthKey)
        this.entries.set(key, entry)
        this.publish(key, { uri: this.uriFor(entry), capturedAt: entry.capturedAt })
      }
      log.info('media:snapshot', 'snapshot file cache hydrated', {
        kept: plan.keep.length,
        swept: plan.remove.length,
      })
    } catch (e) {
      // A cache we cannot read is a cache we do not use. Every surface then
      // behaves as it did before this cache existed.
      log.warn('media:snapshot', 'snapshot file cache unavailable', { error: errorMessage(e) })
    }
  }

  private async runFetch(
    key: string,
    req: SnapshotFileRequest,
    widthKey: string,
    url: string,
    ifNoneMatch: string | null,
  ): Promise<void> {
    const tmp = snapshotCacheTmpFileName(req.deviceId, widthKey)
    this.publish(key, { fetching: true, failed: false })
    let promoted = false
    try {
      const headers: Record<string, string> = { ...req.headers }
      if (ifNoneMatch !== null) headers['If-None-Match'] = ifNoneMatch
      const result = await this.download(req.deviceId, widthKey, url, tmp, headers)
      // Settled includes a 304 and a refusal: the identity is the retry driver,
      // and a schedule of our own would be a second refresh mechanism.
      this.settled.set(key, url)
      if (result.status === 304) {
        this.publish(key, { fetching: false })
        return
      }
      if (result.status !== 200) {
        log.warn('media:snapshot', 'snapshot file cache fetch rejected', {
          deviceId: req.deviceId,
          widthKey,
          status: result.status,
        })
        this.publishSettledFailure(key)
        return
      }
      const next = snapshotCacheEntryFor(req.deviceId, req.width, result.etag)
      if (next === null) {
        // Rule 2. Painting bytes nobody can date is the shared root of every
        // snapshot incident this cache exists to close.
        log.warn('media:snapshot', 'snapshot bytes discarded (no capture identity)', {
          deviceId: req.deviceId,
          widthKey,
          etag: result.etag,
        })
        this.publishSettledFailure(key)
        return
      }
      const previous = this.entries.get(key) ?? null
      if (previous !== null && next.capturedAt < previous.capturedAt) {
        // Rule 3.
        log.warn('media:snapshot', 'snapshot bytes discarded (older than the frame on disk)', {
          deviceId: req.deviceId,
          widthKey,
          capturedAt: next.capturedAt,
          heldCapturedAt: previous.capturedAt,
        })
        this.publish(key, { fetching: false })
        return
      }
      await this.fs.move(tmp, next.fileName)
      promoted = true
      this.entries.set(key, next)
      this.publish(key, {
        uri: this.uriFor(next),
        capturedAt: next.capturedAt,
        fetching: false,
        failed: false,
      })
      if (previous !== null && previous.fileName !== next.fileName) {
        await this.remove(previous.fileName)
      }
    } catch (e) {
      // Rule 4: offline keeps the last good frame. Silence would read as "never
      // happened" — the 3-hour media blackout produced not one line.
      log.warn('media:snapshot', 'snapshot file cache fetch failed', {
        deviceId: req.deviceId,
        widthKey,
        error: errorMessage(e),
      })
      this.publishSettledFailure(key)
    } finally {
      if (!promoted) await this.remove(tmp)
    }
  }

  /**
   * The one place bytes are asked for — everything else in this store is local
   * file work. Rule 6 lives here rather than around `runFetch` so the queue
   * bounds the WIRE and nothing else: a rename waiting behind five downloads
   * would be a queue that costs without buying anything.
   *
   * The wait is reported per camera (`deviceId` tag, per the logging rule) and
   * only when it is real. Until this existed the snapshot plane had no
   * equivalent of the events feed's `blockedMs`: a tile that took four seconds
   * because it was seventieth in line was indistinguishable, in every log the
   * app produced, from a hub that took four seconds to answer.
   */
  private async download(
    deviceId: number,
    widthKey: string,
    url: string,
    tmp: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<SnapshotDownloadResult> {
    const queuedAt = this.now()
    const depth = this.gate.queued
    await this.gate.acquire()
    const waitMs = this.now() - queuedAt
    try {
      const startedAt = this.now()
      const result = await this.fs.download(url, tmp, headers)
      if (waitMs >= SLOW_QUEUE_WAIT_MS) {
        log.info('media:snapshot', 'snapshot fetch queued behind the plane', {
          waitMs,
          netMs: this.now() - startedAt,
          queueDepth: depth,
          widthKey,
          tags: { deviceId },
        })
      }
      return result
    } finally {
      // Also on a throw. A gate that only released on success would wedge the
      // whole plane on the first camera that refuses.
      this.gate.release()
    }
  }

  /** Attempt finished with nothing new: fail only if there is nothing to paint. */
  private publishSettledFailure(key: string): void {
    const current = this.states.get(key) ?? IDLE
    this.publish(key, { fetching: false, failed: current.uri === null })
  }

  private uriFor(entry: SnapshotCacheEntry): string {
    return `${this.fs.directory}${entry.fileName}`
  }

  /** Best-effort delete: a file we cannot remove must not fail a paint. */
  private async remove(fileName: string): Promise<void> {
    try {
      await this.fs.remove(fileName)
    } catch {
      // Already gone, or not ours to delete. Either way nothing to do.
    }
  }

  private publish(key: string, patch: Partial<Omit<SnapshotFileState, 'supported'>>): void {
    const current = this.states.get(key) ?? IDLE
    const next: SnapshotFileState = Object.freeze({ ...current, ...patch })
    if (
      next.uri === current.uri &&
      next.capturedAt === current.capturedAt &&
      next.fetching === current.fetching &&
      next.failed === current.failed &&
      this.states.has(key)
    ) {
      return
    }
    this.states.set(key, next)
    for (const listener of this.listeners) listener()
  }
}
