import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { planSnapshotLinkPoll } from '../snapshot-link-slices.js'
import {
  fetchSnapshotLinks,
  keepNewestSnapshotLinks,
  skippableSnapshotLinkKeys,
  snapshotLinksByTarget,
  snapshotLinkTargetKey,
  SNAPSHOT_LINKS_POLL_MS,
  SNAPSHOT_LINK_STATE_MAX_AGE_MS,
  type SnapshotLinkRow,
  type SnapshotLinkTarget,
} from '../use-snapshot-links.js'

/**
 * A `stateReason` is a claim about NOW, and the poll must never ration it.
 *
 * The incident (live hub, 2026-09-22, device 3628 — a battery camera the
 * operator opened, which woke and streamed):
 *
 *   16:08:04.597  provider-reolink  battery sleep state committed {sleeping: false}
 *   16:08:15.025  stream-broker     snapshot tile mount  to="…|sr=sleeping|…"
 *   16:08:59.033  stream-broker     snapshot tile mount  to="…|sr=sleeping|…"
 *   16:09:03.069  stream-broker     snapshot tile mount  to="…|sr=sleeping|…"
 *
 * The hub was right from 16:08:04 on. The app kept painting "asleep" over a
 * live camera for another 58 s, because `stateReason` rides on a row that the
 * poll leaves for its slice's turn — and, for a tile the viewport gate has
 * dropped, does not ask about at all, carrying it forward for as long as the
 * signed link lives (120 s).
 *
 * These drive the real planner, the real merge and the real skip rule over a
 * sequence. Nothing here asserts a fake's promise.
 */

const TARGET: SnapshotLinkTarget = { deviceId: 3628, width: 320 }
const KEY = snapshotLinkTargetKey(TARGET)

function row(overrides: Partial<SnapshotLinkRow> = {}): SnapshotLinkRow {
  return {
    deviceId: 3628,
    url: '/snapshot/3628.jpg?v=1',
    capturedAt: 1_000,
    ageMs: 500,
    width: 320,
    neverCaptured: false,
    sleeping: false,
    stateReason: null,
    battery: true,
    expiresAt: 10_000_000,
    observedAt: 0,
    ...overrides,
  }
}

describe('skippableSnapshotLinkKeys', () => {
  it('never lets a row that CLAIMS a state wait for its turn', () => {
    const rows = { [KEY]: row({ stateReason: 'sleeping', sleeping: true, observedAt: 1_000 }) }
    expect(skippableSnapshotLinkKeys(rows, 1_000)).not.toContain(KEY)
  })

  it('lets an ordinary, freshly observed row wait', () => {
    const rows = { [KEY]: row({ observedAt: 1_000 }) }
    expect(skippableSnapshotLinkKeys(rows, 1_000 + SNAPSHOT_LINKS_POLL_MS)).toContain(KEY)
  })

  it('stops letting a row wait once its answer is older than a rotation', () => {
    const rows = { [KEY]: row({ observedAt: 1_000 }) }
    expect(skippableSnapshotLinkKeys(rows, 1_000 + SNAPSHOT_LINK_STATE_MAX_AGE_MS)).not.toContain(
      KEY,
    )
  })

  it('drops an expired row, as the merge does', () => {
    const rows = { [KEY]: row({ expiresAt: 900, observedAt: 1_000 }) }
    expect(skippableSnapshotLinkKeys(rows, 1_000)).not.toContain(KEY)
  })
})

describe('a sleeping overlay is retired on the next poll, not the next turn', () => {
  it('names the camera on EVERY poll while it claims a state', () => {
    // The tile is on screen and holds a row saying "asleep". Whatever the
    // slice rotation says, the poll must ask again — retiring that claim is
    // the only thing that can, and the hub short-circuits before any capture
    // for a device in a named state, so it costs nothing.
    let accepted: Readonly<Record<string, SnapshotLinkRow>> = {
      [KEY]: row({ stateReason: 'sleeping', sleeping: true, observedAt: 0 }),
    }
    for (let tick = 0; tick < 8; tick += 1) {
      const named = planSnapshotLinkPoll({
        targets: [TARGET],
        keys: [KEY],
        minted: skippableSnapshotLinkKeys(accepted, tick * SNAPSHOT_LINKS_POLL_MS),
        tick,
      })
      expect(named).toEqual([TARGET])
    }

    // The camera wakes. One poll later the claim is gone.
    const awakeAt = 8 * SNAPSHOT_LINKS_POLL_MS
    accepted = keepNewestSnapshotLinks(
      accepted,
      { [KEY]: row({ stateReason: null, sleeping: false, observedAt: awakeAt }) },
      awakeAt,
    )
    expect(accepted[KEY]?.stateReason).toBeNull()

    // …and from then on it goes back to waiting its turn, so the capture
    // rationing the rotation exists for is intact.
    const turns = [0, 1, 2, 3].filter(
      (tick) =>
        planSnapshotLinkPoll({
          targets: [TARGET],
          keys: [KEY],
          minted: skippableSnapshotLinkKeys(accepted, awakeAt + SNAPSHOT_LINKS_POLL_MS),
          tick,
        }).length > 0,
    )
    expect(turns).toHaveLength(1)
  })

  it('re-asks a row the viewport gate stopped asking about', () => {
    // A tile scrolls away: `targets` no longer carries it, so no poll mentions
    // it and `keepNewestSnapshotLinks` carries the row forward untouched. This
    // is the 58 s: the row is still unexpired, so the old rule called it
    // minted and let it wait three more polls after the tile came back.
    const mountedAt = 0
    let accepted: Readonly<Record<string, SnapshotLinkRow>> = {
      [KEY]: row({ stateReason: 'sleeping', sleeping: true, observedAt: mountedAt }),
    }

    // 60 s off screen. The poll runs with an empty demand set; the merge must
    // keep the row (the frame is still paintable) …
    const offScreenUntil = 60_000
    accepted = keepNewestSnapshotLinks(accepted, {}, offScreenUntil)
    expect(accepted[KEY]).toBeDefined()
    expect(accepted[KEY]?.observedAt).toBe(mountedAt)

    // … and the very next poll after it comes back must name it.
    const named = planSnapshotLinkPoll({
      targets: [TARGET],
      keys: [KEY],
      minted: skippableSnapshotLinkKeys(accepted, offScreenUntil),
      // Deliberately a tick whose turn is NOT this key's slice, for every
      // slice: the rule must not depend on getting lucky with the rotation.
      tick: 0,
    })
    expect(named).toEqual([TARGET])
  })

  it('re-asks an ordinary row that went unasked, even with no state claim', () => {
    // Same gap, without the overlay: a mains camera whose tile was off screen
    // must not paint an answer nobody has refreshed in two minutes either.
    let accepted: Readonly<Record<string, SnapshotLinkRow>> = { [KEY]: row({ observedAt: 0 }) }
    accepted = keepNewestSnapshotLinks(accepted, {}, 60_000)
    for (let tick = 0; tick < 4; tick += 1) {
      expect(
        planSnapshotLinkPoll({
          targets: [TARGET],
          keys: [KEY],
          minted: skippableSnapshotLinkKeys(accepted, 60_000),
          tick,
        }),
      ).toEqual([TARGET])
    }
  })
})

describe('the row carries WHEN the hub answered', () => {
  it('stamps every parsed row with the observation clock', () => {
    const parsed = snapshotLinksByTarget([{ deviceId: 3628, width: 320 }], [TARGET], 4_242)
    expect(parsed.byTarget[KEY]?.observedAt).toBe(4_242)
  })

  it('stamps a real clock on the wire path, not a zero', async () => {
    // A stamp that is always 0 makes every row instantly un-skippable, which
    // looks like a fix and is a capture burst.
    const before = Date.now()
    const client: Record<string, unknown> = {
      snapshot: {
        getSnapshotLinks: {
          query: (): Promise<unknown> => Promise.resolve([{ deviceId: 3628, width: 320 }]),
        },
      },
    }
    const links = await fetchSnapshotLinks(client, [TARGET])
    const observedAt = links.byTarget[KEY]?.observedAt
    expect(observedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('the rule is WIRED', () => {
  it('is what the provider hands the poll', () => {
    // Three fixes in this repo have landed with the whole suite green because
    // nothing executed them. This suite cannot render the provider, so the
    // wiring is pinned here instead of being assumed.
    const here = dirname(fileURLToPath(import.meta.url))
    const provider = readFileSync(resolve(here, '../SnapshotOverviewProvider.tsx'), 'utf8')
    expect(provider).toContain('skippableSnapshotLinkKeys(acceptedRef.current, Date.now())')
    expect(provider).toMatch(/useSnapshotLinks\([\s\S]{0,120}skippableKeys,/)
  })
})
