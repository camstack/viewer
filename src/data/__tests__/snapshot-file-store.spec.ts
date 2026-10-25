/**
 * The effectful half of the native snapshot file cache, against a fake file
 * system port.
 *
 * The point of the store is that a snapshot the operator can see is a file WE
 * wrote, under a name WE chose, whose capture time the SERVER stated. Three
 * incidents came from the opposite arrangement — `expo-image`'s disk cache,
 * URL-keyed, never revalidated, unnameable and uninspectable — so the rules
 * asserted here are the ones that make a persisted frame safe to paint:
 *
 *  - a frame is promoted only after it has fully landed (`.tmp` → rename);
 *  - bytes with no stateable identity are DISCARDED, never painted;
 *  - a download that turns out to be OLDER than what we hold is discarded;
 *  - a failure keeps the last good frame instead of blanking the tile;
 *  - one download per identity, per surface, ever.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useLogStore } from '../../lib/logger.js'
import {
  SnapshotFileStore,
  type SnapshotDownloadResult,
  type SnapshotFileSystemPort,
} from '../snapshot-file-store.js'

const DIR = 'file:///docs/snapshots/'

interface DownloadCall {
  readonly url: string
  readonly target: string
  readonly headers: Readonly<Record<string, string>>
}

interface FakePort extends SnapshotFileSystemPort {
  readonly files: Set<string>
  readonly downloads: DownloadCall[]
  readonly removed: string[]
  respond: (r: SnapshotDownloadResult | Error) => void
}

function fakePort(initial: readonly string[] = []): FakePort {
  const files = new Set<string>(initial)
  const downloads: DownloadCall[] = []
  const removed: string[] = []
  let next: SnapshotDownloadResult | Error = { status: 200, etag: null }
  const port: FakePort = {
    files,
    downloads,
    removed,
    directory: DIR,
    respond: (r) => {
      next = r
    },
    ensureDirectory: () => Promise.resolve(),
    list: () => Promise.resolve([...files]),
    download: (url, target, headers) => {
      downloads.push({ url, target, headers })
      if (next instanceof Error) return Promise.reject(next)
      // A real download writes its bytes before resolving.
      if (next.status === 200) files.add(target)
      return Promise.resolve(next)
    },
    move: (from, to) => {
      files.delete(from)
      files.add(to)
      return Promise.resolve()
    },
    remove: (name) => {
      removed.push(name)
      files.delete(name)
      return Promise.resolve()
    },
  }
  return port
}

/**
 * The store's own log lines are the only way a test can tell "deliberately
 * refused" apart from "threw and the catch swallowed it" — and under mutation
 * those two produce the SAME visible state (no file, nothing painted). Removing
 * the identity refusal left this suite green until the assertions read the
 * reason, which is the failure mode this repo has shipped twice.
 */
function loggedMessages(): readonly string[] {
  return useLogStore.getState().entries.map((e) => e.msg)
}

beforeEach(() => {
  useLogStore.getState().clear()
})

const URL_V2 = 'https://h/addon/snapshot/media/101.jpg?w=320&v=2000'
const HEADERS = Object.freeze({ Authorization: 'Bearer t' })

function ask(
  store: SnapshotFileStore,
  overrides?: {
    readonly remoteUrl?: string | null
    readonly enabled?: boolean
    readonly width?: number
  },
): Promise<void> {
  return store.request({
    deviceId: 101,
    width: overrides?.width ?? 320,
    remoteUrl: overrides?.remoteUrl === undefined ? URL_V2 : overrides.remoteUrl,
    headers: HEADERS,
    enabled: overrides?.enabled ?? true,
  })
}

describe('hydrate — the last real frame survives an app kill', () => {
  it('paints a file that is already on disk, with the age it states', async () => {
    const port = fakePort(['101_w320_101-1000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 5000)
    await store.hydrate()
    expect(store.get(101, 'w320')).toEqual({
      supported: true,
      uri: `${DIR}101_w320_101-1000-w320.jpg`,
      capturedAt: 1000,
      fetching: false,
      failed: false,
    })
  })

  it('sweeps superseded frames, temp leftovers and junk on the way in', async () => {
    const port = fakePort([
      '101_w320_101-1000-w320.jpg',
      '101_w320_101-3000-w320.jpg',
      '101_w320.tmp',
      'README',
    ])
    const store = new SnapshotFileStore(port, () => 5000)
    await store.hydrate()
    expect(port.removed.sort()).toEqual(['101_w320.tmp', '101_w320_101-1000-w320.jpg', 'README'])
    expect(store.get(101, 'w320').capturedAt).toBe(3000)
  })

  it('runs exactly once however many surfaces mount', async () => {
    const port = fakePort([])
    const list = vi.spyOn(port, 'list')
    const store = new SnapshotFileStore(port, () => 5000)
    await Promise.all([store.hydrate(), store.hydrate(), store.hydrate()])
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('fetch — the frame is promoted only once it has fully landed', () => {
  it('downloads to a temp name and renames on 200', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store)
    expect(port.downloads).toHaveLength(1)
    expect(port.downloads[0]?.target).toBe('101_w320.tmp')
    expect(port.files.has('101_w320_101-2000-w320.jpg')).toBe(true)
    expect(port.files.has('101_w320.tmp')).toBe(false)
    expect(store.get(101, 'w320')).toEqual({
      supported: true,
      uri: `${DIR}101_w320_101-2000-w320.jpg`,
      capturedAt: 2000,
      fetching: false,
      failed: false,
    })
  })

  it('carries the auth header the rest of the app uses', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store)
    expect(port.downloads[0]?.headers['Authorization']).toBe('Bearer t')
  })

  it('revalidates with the ETag of the file it already holds', async () => {
    // The fix at the root of every snapshot incident: on native NOTHING
    // revalidated, because `expo-image` does not. A conditional GET makes a
    // slow or stale server answer 304 (~200 bytes) and we keep our own frame
    // with its TRUE age, instead of unknowable bytes from an opaque cache.
    const port = fakePort(['101_w320_101-1000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 304, etag: '"101-1000-w320"' })
    await ask(store)
    expect(port.downloads[0]?.headers['If-None-Match']).toBe('"101-1000-w320"')
    expect(store.get(101, 'w320').capturedAt).toBe(1000)
    expect(port.files.has('101_w320_101-1000-w320.jpg')).toBe(true)
  })

  it('cleans up the temp file a 304 may have created', async () => {
    const port = fakePort(['101_w320_101-1000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 304, etag: '"101-1000-w320"' })
    await ask(store)
    expect(port.files.has('101_w320.tmp')).toBe(false)
  })

  it('deletes the frame it replaces — one file per surface, no LRU needed', async () => {
    const port = fakePort(['101_w320_101-1000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store)
    expect(port.removed).toContain('101_w320_101-1000-w320.jpg')
    expect([...port.files]).toEqual(['101_w320_101-2000-w320.jpg'])
  })

  it('keeps one file per width, so surfaces do not overwrite each other', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store, { width: 320 })
    port.respond({ status: 200, etag: '"101-2000-w960"' })
    await ask(store, { width: 960, remoteUrl: 'https://h/addon/snapshot/media/101.jpg?w=960&v=2000' })
    expect([...port.files].sort()).toEqual([
      '101_w320_101-2000-w320.jpg',
      '101_w960_101-2000-w960.jpg',
    ])
  })
})

describe('bytes with no stateable provenance are never painted', () => {
  it('discards a 200 whose ETag says nothing', async () => {
    // This is the whole class of bug: pixels on screen that nobody can date.
    // Without an identity we cannot badge the age, so we refuse the frame.
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: null })
    await ask(store)
    expect(store.get(101, 'w320').uri).toBeNull()
    expect(port.files.has('101_w320.tmp')).toBe(false)
    expect(loggedMessages()).toContain('snapshot bytes discarded (no capture identity)')
    expect(loggedMessages()).not.toContain('snapshot file cache fetch failed')
  })

  it('discards a 200 whose ETag names another device', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"999-2000-w320"' })
    await ask(store)
    expect(store.get(101, 'w320').uri).toBeNull()
    expect(loggedMessages()).toContain('snapshot bytes discarded (no capture identity)')
    expect(loggedMessages()).not.toContain('snapshot file cache fetch failed')
  })

  it('never lets a slow server repaint an OLDER frame over a newer one', async () => {
    // Observed live twice: a merely-slow server put a two-week-old JPEG back on
    // screen. A capture time that moves backwards is refused outright.
    const port = fakePort(['101_w320_101-5000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 9000)
    port.respond({ status: 200, etag: '"101-1000-w320"' })
    await ask(store)
    expect(store.get(101, 'w320').capturedAt).toBe(5000)
    expect(port.files.has('101_w320_101-1000-w320.jpg')).toBe(false)
    expect(loggedMessages()).toContain('snapshot bytes discarded (older than the frame on disk)')
    expect(loggedMessages()).not.toContain('snapshot file cache fetch failed')
  })
})

describe('offline and slow — paint the last good frame, never blank', () => {
  it('keeps the cached frame when the download throws', async () => {
    const port = fakePort(['101_w320_101-1000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond(new Error('offline'))
    await ask(store)
    const state = store.get(101, 'w320')
    expect(state.uri).toBe(`${DIR}101_w320_101-1000-w320.jpg`)
    expect(state.capturedAt).toBe(1000)
    expect(state.failed).toBe(false)
    expect(state.fetching).toBe(false)
  })

  it('reports failure only when there is nothing to show', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond(new Error('offline'))
    await ask(store)
    expect(store.get(101, 'w320')).toEqual({
      supported: true,
      uri: null,
      capturedAt: null,
      fetching: false,
      failed: true,
    })
  })

  it('keeps the cached frame on a server error status', async () => {
    const port = fakePort(['101_w320_101-1000-w320.jpg'])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 503, etag: null })
    await ask(store)
    expect(store.get(101, 'w320').capturedAt).toBe(1000)
  })
})

describe('budget — no timer of its own, one download per identity', () => {
  it('does not re-download an identity it already settled', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store)
    await ask(store)
    await ask(store)
    expect(port.downloads).toHaveLength(1)
  })

  it('downloads again as soon as the hub names a new frame', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store)
    port.respond({ status: 200, etag: '"101-3000-w320"' })
    await ask(store, { remoteUrl: 'https://h/addon/snapshot/media/101.jpg?w=320&v=3000' })
    expect(port.downloads).toHaveLength(2)
    expect(store.get(101, 'w320').capturedAt).toBe(3000)
  })

  it('coalesces concurrent surfaces onto one download', async () => {
    // A card and a grid tile can render the same camera at the same width in
    // the same frame; each must not pull its own copy of the bytes.
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await Promise.all([ask(store), ask(store), ask(store)])
    expect(port.downloads).toHaveLength(1)
  })

  it('asks for nothing while the surface is disabled or has no URL', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    await ask(store, { enabled: false })
    await ask(store, { remoteUrl: null })
    expect(port.downloads).toHaveLength(0)
  })
})

describe('subscribers', () => {
  it('notifies once a frame lands and returns a stable object between changes', async () => {
    const port = fakePort([])
    const store = new SnapshotFileStore(port, () => 5000)
    const seen = vi.fn()
    const unsubscribe = store.subscribe(seen)
    const before = store.get(101, 'w320')
    expect(store.get(101, 'w320')).toBe(before)
    port.respond({ status: 200, etag: '"101-2000-w320"' })
    await ask(store)
    expect(seen).toHaveBeenCalled()
    expect(store.get(101, 'w320')).not.toBe(before)
    const callsWhileSubscribed = seen.mock.calls.length
    unsubscribe()
    const after = store.get(101, 'w320')
    port.respond({ status: 200, etag: '"101-4000-w320"' })
    await ask(store, { remoteUrl: 'https://h/addon/snapshot/media/101.jpg?w=320&v=4000' })
    expect(seen).toHaveBeenCalledTimes(callsWhileSubscribed)
    expect(store.get(101, 'w320')).not.toBe(after)
  })
})
