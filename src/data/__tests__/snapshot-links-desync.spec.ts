/**
 * @vitest-environment jsdom
 *
 * The provider's links poll, observed on the wire: the first poll names every
 * tile, the polls after it name a slice.
 *
 * `snapshot-link-slices.spec.ts` proves the rule; this proves the provider
 * feeds it — the query key stays ONE key (one interval), the queryFn asks for
 * the slice, and a row the poll did not mention is carried forward rather than
 * dropped (`keepNewestSnapshotLinks`), so a tile never blanks between its
 * turns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { SnapshotOverviewProvider, useSnapshotLink } from '../SnapshotOverviewProvider.js'
import { SNAPSHOT_LINKS_POLL_MS } from '../use-snapshot-links.js'
import { SNAPSHOT_LINK_POLL_SLICES } from '../snapshot-link-slices.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const WIDTH = 384
const IDS = Array.from({ length: 24 }, (_, i) => 103 + i * 7)

interface LinkTargetInput {
  readonly deviceId: number
  readonly width?: number
}

const HUB = {
  'snapshot.getSnapshotLinks': (input?: unknown): unknown => {
    const targets = (input as { targets?: readonly LinkTargetInput[] } | undefined)?.targets ?? []
    const now = Date.now()
    return targets.map((target) => ({
      deviceId: target.deviceId,
      url: `/addon/snapshot/media/${String(target.deviceId)}.jpg?sig=stub`,
      capturedAt: now,
      ageMs: 400,
      width: target.width ?? null,
      neverCaptured: false,
      sleeping: false,
      stateReason: null,
      battery: false,
      expiresAt: now + 120_000,
    }))
  },
  'snapshot.getSnapshotOverview': (): unknown => [],
}

/** One tile's demand, and nothing else — the reel card minus the picture. */
function Tile({ deviceId }: { readonly deviceId: number }): React.ReactElement {
  const link = useSnapshotLink(deviceId, WIDTH, true)
  return React.createElement('span', { 'data-testid': `tile-${String(deviceId)}` }, link.row ? 'row' : '-')
}

function reel(): React.ReactElement {
  return React.createElement(
    SnapshotOverviewProvider,
    { deviceIds: IDS, enabled: true },
    ...IDS.map((deviceId) => React.createElement(Tile, { key: deviceId, deviceId })),
  )
}

function linkCalls(): readonly (readonly number[])[] {
  return hubCalls()
    .filter((call) => call.path === 'snapshot.getSnapshotLinks')
    .map((call) => {
      const targets = (call.input as { targets?: readonly LinkTargetInput[] } | undefined)?.targets ?? []
      return targets.map((t) => t.deviceId)
    })
}

async function nextPoll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SNAPSHOT_LINKS_POLL_MS + 50)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the links poll on the wire', () => {
  it('first poll: every tile; then a slice per poll; every tile within one cycle', async () => {
    const view = mountScreen(reel(), { hub: HUB })
    await waitFor(() => {
      expect(linkCalls().length).toBeGreaterThanOrEqual(1)
    })
    expect(linkCalls()[0]).toHaveLength(IDS.length)
    // Every tile got its row from the first poll.
    await waitFor(() => {
      for (const id of IDS) {
        expect(view.getByTestId(`tile-${String(id)}`).textContent).toBe('row')
      }
    })

    const named = new Set<number>()
    for (let poll = 0; poll < SNAPSHOT_LINK_POLL_SLICES; poll += 1) {
      const before = linkCalls().length
      await nextPoll()
      await waitFor(() => {
        expect(linkCalls().length).toBeGreaterThan(before)
      })
      const latest = linkCalls()[linkCalls().length - 1]
      // A slice, never the whole reel again.
      expect(latest.length).toBeLessThan(IDS.length)
      for (const id of latest) named.add(id)
    }
    expect([...named].sort((a, b) => a - b)).toEqual([...IDS].sort((a, b) => a - b))

    // Nothing blanked between turns: every tile still holds a row.
    for (const id of IDS) {
      expect(view.getByTestId(`tile-${String(id)}`).textContent).toBe('row')
    }
  })
})
