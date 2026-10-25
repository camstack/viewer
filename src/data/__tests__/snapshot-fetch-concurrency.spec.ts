/**
 * The snapshot download plane must degrade into a QUEUE, never into a burst.
 *
 * ## The measurement this suite exists to hold down
 *
 * `SnapshotFileStore.request` is called once per mounted surface, from an
 * effect keyed on `remoteUrl`. That URL carries the frame identity, so when a
 * `getSnapshotLinks` poll answers, EVERY tile's identity moves in the same
 * tick and every effect re-runs together. Measured on the live hub with 30
 * cameras (viewer v1.0.369): bursts of up to 71 simultaneous media fetches
 * every ~5 s, and a request that landed inside a burst had a p50 of 4540 ms
 * against 486 ms for one that did not — a 9.3x penalty paid by a request whose
 * server work was identical.
 *
 * Nothing in the store bounded that. It had no queue at all: `request` went
 * straight to `fs.download`, so the fan-out was exactly the number of surfaces
 * that happened to be mounted.
 *
 * The embed's media plane already solved this — `MEDIA_FETCH_CONCURRENCY` in
 * `embed/src/embed/use-authed-image.ts`, with the reasoning for the number
 * written there. This suite pins the app's snapshot plane to the SAME number
 * rather than letting a second one drift into existence, and the pin is a
 * guard (it reads the embed's source) rather than a comment, because a comment
 * that the two "should match" is a rule nothing checks.
 *
 * ## Why a cap and not just fewer tiles
 *
 * Viewport scoping (see `snapshot-demand-viewport.spec.ts`) is the mechanism
 * that decides what gets fetched at all. This is the SAFETY NET underneath it:
 * a surface that somehow asks for the whole install — a grid wall, a screen
 * that forgets to declare visibility, a future caller — degrades into a queue
 * instead of into the timeout storm above.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import {
  SNAPSHOT_FETCH_CONCURRENCY,
  SnapshotFileStore,
  type SnapshotDownloadResult,
  type SnapshotFileSystemPort,
} from '../snapshot-file-store.js'

const DIR = 'file:///docs/snapshots/'

/** One download the test holds open until it chooses to settle it. */
interface PendingDownload {
  readonly target: string
  readonly settle: (result: SnapshotDownloadResult) => void
}

interface GatedPort extends SnapshotFileSystemPort {
  /** Downloads that have STARTED and not yet settled. */
  readonly pending: PendingDownload[]
  /** The highest number ever in flight at once — the burst size. */
  readonly peak: () => number
  readonly started: () => number
}

function gatedPort(): GatedPort {
  const files = new Set<string>()
  const pending: PendingDownload[] = []
  let inFlight = 0
  let peak = 0
  let started = 0

  const port: GatedPort = {
    pending,
    peak: () => peak,
    started: () => started,
    directory: DIR,
    ensureDirectory: () => Promise.resolve(),
    list: () => Promise.resolve([...files]),
    download: (_url, target) => {
      started += 1
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      return new Promise<SnapshotDownloadResult>((resolve) => {
        pending.push({
          target,
          settle: (result) => {
            inFlight -= 1
            if (result.status === 200) files.add(target)
            resolve(result)
          },
        })
      })
    },
    move: (from, to) => {
      files.delete(from)
      files.add(to)
      return Promise.resolve()
    },
    remove: (name) => {
      files.delete(name)
      return Promise.resolve()
    },
  }
  return port
}

/**
 * Let every already-resolved microtask run.
 *
 * Deep on purpose: a handoff is not one tick. Settling a download resumes
 * `runFetch`, which narrows the ETag, renames, publishes, removes the temp file
 * and only then releases the slot — at which point the woken waiter still has
 * its own `acquire` continuation to run before it reaches `fs.download`. A
 * shallow drain makes the queue look stalled when it is merely mid-handoff.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

/**
 * Ask for `count` tiles in one tick — the shape of a links poll landing.
 * Returns the promises so a test can assert they all eventually settle.
 */
function requestAll(
  store: SnapshotFileStore,
  count: number,
  capturedAt: number,
): readonly Promise<void>[] {
  return Array.from({ length: count }, (_, i) => {
    const deviceId = 600 + i
    return store.request({
      deviceId,
      width: 320,
      remoteUrl: `https://hub/snap/${String(deviceId)}?v=${String(capturedAt)}`,
      headers: {},
      enabled: true,
    })
  })
}

describe('snapshot fetch concurrency', () => {
  it('is pinned to the embed media plane, not a second number of its own', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../embed/src/embed/use-authed-image.ts', import.meta.url)),
      'utf8',
    )
    const match = /export const MEDIA_FETCH_CONCURRENCY = (\d+)/.exec(source)
    expect(match, 'the embed still declares MEDIA_FETCH_CONCURRENCY').not.toBeNull()
    expect(SNAPSHOT_FETCH_CONCURRENCY).toBe(Number(match?.[1]))
  })

  it('caps the burst: 30 tiles refreshing together start at most the cap', async () => {
    const port = gatedPort()
    const store = new SnapshotFileStore(port)

    void requestAll(store, 30, 1_000)
    await drain()

    // RED before the gate exists: this is 30.
    expect(port.started()).toBe(SNAPSHOT_FETCH_CONCURRENCY)
    expect(port.peak()).toBe(SNAPSHOT_FETCH_CONCURRENCY)
  })

  it('never exceeds the cap while a whole install drains', async () => {
    const port = gatedPort()
    const store = new SnapshotFileStore(port)

    const all = requestAll(store, 71, 2_000)
    await drain()

    // Settle the queue front-to-back, exactly as real completions would. Each
    // settle should free exactly one slot and admit exactly one waiter.
    for (let guard = 0; guard < 300 && port.pending.length > 0; guard += 1) {
      // A 304 keeps the assertion about the QUEUE and not about the identity
      // rules, which `snapshot-file-store.spec.ts` already owns.
      port.pending.shift()?.settle({ status: 304, etag: null })
      await drain()
      expect(port.peak()).toBeLessThanOrEqual(SNAPSHOT_FETCH_CONCURRENCY)
    }

    await Promise.all(all)
    // Every tile is served — a cap that DROPPED work would be worse than none.
    expect(port.started()).toBe(71)
  })

  it('hands a slot to the next waiter when a download FAILS', async () => {
    const port = gatedPort()
    const store = new SnapshotFileStore(port)

    const all = requestAll(store, SNAPSHOT_FETCH_CONCURRENCY + 2, 3_000)
    await drain()
    expect(port.started()).toBe(SNAPSHOT_FETCH_CONCURRENCY)

    // A refusal still settles, so it must release. A gate that only released on
    // success would wedge the whole plane after one bad camera.
    const first = port.pending.shift()
    first?.settle({ status: 500, etag: null })
    await drain()
    expect(port.started()).toBe(SNAPSHOT_FETCH_CONCURRENCY + 1)

    for (let guard = 0; guard < 200 && port.pending.length > 0; guard += 1) {
      port.pending.shift()?.settle({ status: 304, etag: null })
      await drain()
    }
    await Promise.all(all)
  })
})
