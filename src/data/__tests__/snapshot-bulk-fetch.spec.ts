/**
 * The two snapshot BATCH reads, and the difference between "this hub has no
 * snapshot cap" and "we could not reach it".
 *
 * ## The measurement
 *
 * Over 24h on the live hub, the two biggest consumers of `capQuery`'s
 * badge-sized deadline were `snapshot.getSnapshotLinks` (125 expiries) and
 * `snapshot.getSnapshotOverview` (110) — far ahead of anything else. Both are
 * BATCH reads (up to 24 link targets, up to 200 device ids), bounded by a
 * constant sized for a single camera's status probe.
 *
 * ## Why the swallow was worse here than elsewhere
 *
 * Both hooks map a null from `capQuery` to `supported: false`, and `capQuery`
 * returned null for BOTH an absent cap and a timeout. So a transient expiry did
 * not merely fail to answer — it OVERWROTE the cached truth with "this hub does
 * not support snapshots", flipping every tile in the app off the minted-link
 * path. React Query recorded it as a success, so `placeholderData` could not
 * protect the previous good answer either; only the next poll could undo it.
 *
 * With the failure propagating, React Query keeps the last successful value and
 * the tiles hold their last known state — which is what `resolveSnapshotUri`'s
 * `identityKnown: false` fallback was built for.
 */
import { describe, it, expect, vi } from 'vitest'
import { fetchSnapshotOverview } from '../use-snapshot-overview.js'
import { fetchSnapshotLinks } from '../use-snapshot-links.js'

vi.mock('../../lib/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** A tRPC-shaped client whose one snapshot procedure behaves as the test says. */
function snapshotClient(
  method: 'getSnapshotOverview' | 'getSnapshotLinks',
  query: () => Promise<unknown>,
): Record<string, unknown> {
  return { snapshot: { [method]: { query } } }
}

describe('fetchSnapshotOverview', () => {
  it('parses the rows a healthy hub returns', async () => {
    const client = snapshotClient('getSnapshotOverview', () =>
      Promise.resolve([{ deviceId: 104, lastCapturedAt: 1_700, cacheAgeMs: 12, etag: 'abc' }]),
    )
    const out = await fetchSnapshotOverview(client, [104])
    expect(out.supported).toBe(true)
    expect(out.byId[104]?.lastCapturedAt).toBe(1_700)
  })

  it('reports UNSUPPORTED for a hub that genuinely lacks the cap', async () => {
    // An older hub answering NOT_FOUND is a real answer, and degrading to the
    // stable-URL path is the correct response to it.
    const out = await fetchSnapshotOverview({}, [104])
    expect(out.supported).toBe(false)
  })

  it('THROWS when the call failed — a timeout is not "this hub has no snapshots"', async () => {
    const client = snapshotClient('getSnapshotOverview', () => Promise.reject(new Error('boom')))
    await expect(fetchSnapshotOverview(client, [104])).rejects.toThrow('boom')
  })

  it('does not let a slow batch inherit the per-camera badge deadline', async () => {
    // 200 device ids is not a status probe. Proven by the clock: the call never
    // settles, and the bound that ends it is the caller's, far above the 6 s
    // badge constant this used to inherit.
    const client = snapshotClient('getSnapshotOverview', () => new Promise(() => {}))
    const t0 = Date.now()
    await expect(fetchSnapshotOverview(client, [104], 15)).rejects.toBeDefined()
    expect(Date.now() - t0).toBeLessThan(1_000)
  })
})

describe('fetchSnapshotLinks', () => {
  const targets = [{ deviceId: 104, width: 320 }] as const

  it('parses a positional response back onto its targets', async () => {
    const client = snapshotClient('getSnapshotLinks', () =>
      Promise.resolve([{ deviceId: 104, url: '/snap/104.jpg', capturedAt: 42, width: 320 }]),
    )
    const out = await fetchSnapshotLinks(client, targets)
    expect(out.supported).toBe(true)
    expect(Object.keys(out.byTarget)).toHaveLength(1)
  })

  it('reports UNSUPPORTED for a hub that genuinely lacks the cap', async () => {
    const out = await fetchSnapshotLinks({}, targets)
    expect(out.supported).toBe(false)
  })

  it('THROWS when the mint failed, so the previous links survive the poll', async () => {
    // The hook's own catch/rethrow existed already and could NEVER run: it sat
    // outside `capQuery`, which swallowed everything to null first. Its warning
    // line had never once been emitted.
    const client = snapshotClient('getSnapshotLinks', () => Promise.reject(new Error('boom')))
    await expect(fetchSnapshotLinks(client, targets)).rejects.toThrow('boom')
  })
})
