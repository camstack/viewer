/**
 * The grids list card states facts about a grid. Each fact here has a way of
 * being WRONG that this suite holds shut:
 *
 *  • a camera list that has not answered yet is `null`, and a `null` list must
 *    never read as "these cameras are gone" — the list screen builds its map
 *    from a query whose `data` is `undefined` until the hub replies, and the
 *    old card silently dropped every unresolved id from its preview strip;
 *  • what the wall will SHOW is the member set minus the grid's hidden set, so
 *    every health count is taken over the visible members only;
 *  • the preview strip's thumb count is a function of the card's real width,
 *    not of a constant — the same card is full-viewport on a phone and a third
 *    of it on a desktop.
 */
import { describe, it, expect } from 'vitest'
import type { CameraInfo } from '../../data/use-cameras.js'
import type { Grid } from '../../store/grid-store.js'
import {
  GRID_CARD_MAX_COLUMNS,
  GRID_PREVIEW_MAX_THUMBS,
  GRID_PREVIEW_MIN_THUMBS,
  gridCardColumns,
  gridCardWidth,
  gridPreviewThumbCount,
  summarizeGrid,
} from '../grid-summary.js'

function cam(id: number, patch: Partial<CameraInfo> = {}): CameraInfo {
  return {
    id,
    name: `Cam ${id}`,
    type: 'camera',
    online: true,
    disabled: false,
    features: [],
    originalName: `Cam ${id}`,
    hidden: false,
    location: null,
    ...patch,
  }
}

function mapOf(cameras: readonly CameraInfo[]): ReadonlyMap<number, CameraInfo> {
  return new Map(cameras.map((c) => [c.id, c]))
}

function grid(patch: Partial<Grid> = {}): Grid {
  return { id: 'g1', name: 'Wall', cameraIds: [1, 2, 3], ...patch }
}

describe('summarizeGrid — an unanswered camera list is unknown, never missing', () => {
  it('reports health "unknown" and claims no counts while the list is null', () => {
    const s = summarizeGrid(grid(), null)
    expect(s.health).toBe('unknown')
    expect(s.unknownIds).toEqual([])
    expect(s.offlineCount).toBe(0)
    expect(s.disabledCount).toBe(0)
    // The membership count comes off the grid document itself, which IS known.
    expect(s.memberCount).toBe(3)
    expect(s.members).toEqual([])
  })

  it('an ANSWERED list that does not carry an id reports it missing', () => {
    const s = summarizeGrid(grid(), mapOf([cam(1), cam(2)]))
    expect(s.unknownIds).toEqual([3])
    expect(s.health).toBe('degraded')
  })

  it('an answered EMPTY list is not the same as an unanswered one', () => {
    const s = summarizeGrid(grid(), mapOf([]))
    expect(s.health).toBe('degraded')
    expect(s.unknownIds).toEqual([1, 2, 3])
  })
})

describe('summarizeGrid — membership', () => {
  it('keeps the grid document order and drops nothing resolvable', () => {
    const s = summarizeGrid(grid({ cameraIds: [3, 1, 2] }), mapOf([cam(1), cam(2), cam(3)]))
    expect(s.members.map((m) => m.id)).toEqual([3, 1, 2])
    expect(s.memberCount).toBe(3)
    expect(s.visibleCount).toBe(3)
    expect(s.health).toBe('ok')
  })

  it('an empty grid is "empty", not "ok" and not "degraded"', () => {
    expect(summarizeGrid(grid({ cameraIds: [] }), mapOf([])).health).toBe('empty')
    // …and it stays empty even before the camera list has answered.
    expect(summarizeGrid(grid({ cameraIds: [] }), null).health).toBe('empty')
  })

  it('counts the grid-hidden members and marks them, without dropping them', () => {
    const s = summarizeGrid(
      grid({ cameraIds: [1, 2, 3], hiddenCameraIds: [2] }),
      mapOf([cam(1), cam(2), cam(3)]),
    )
    expect(s.hiddenCount).toBe(1)
    expect(s.visibleCount).toBe(2)
    expect(s.members.map((m) => m.hidden)).toEqual([false, true, false])
    // Hiding a camera is a deliberate choice, not a fault.
    expect(s.health).toBe('ok')
  })

  it('ignores a hidden id that is no longer a member', () => {
    const s = summarizeGrid(grid({ cameraIds: [1], hiddenCameraIds: [9] }), mapOf([cam(1)]))
    expect(s.hiddenCount).toBe(0)
    expect(s.visibleCount).toBe(1)
  })
})

describe('summarizeGrid — health is about what the wall will SHOW', () => {
  it('counts offline and disabled separately', () => {
    const s = summarizeGrid(
      grid({ cameraIds: [1, 2, 3] }),
      mapOf([cam(1), cam(2, { online: false }), cam(3, { disabled: true })]),
    )
    expect(s.offlineCount).toBe(1)
    expect(s.disabledCount).toBe(1)
    expect(s.health).toBe('degraded')
  })

  it('a disabled camera is NOT also counted offline', () => {
    const s = summarizeGrid(grid({ cameraIds: [1] }), mapOf([cam(1, { online: false, disabled: true })]))
    expect(s.disabledCount).toBe(1)
    expect(s.offlineCount).toBe(0)
  })

  it('a member hidden from the wall does not degrade the wall', () => {
    const s = summarizeGrid(
      grid({ cameraIds: [1, 2], hiddenCameraIds: [2] }),
      mapOf([cam(1), cam(2, { online: false })]),
    )
    expect(s.offlineCount).toBe(0)
    expect(s.health).toBe('ok')
  })
})

describe('summarizeGrid — labels the card shows', () => {
  it('lists the visible members names in order, excluding hidden ones', () => {
    const s = summarizeGrid(
      grid({ cameraIds: [1, 2, 3], hiddenCameraIds: [2] }),
      mapOf([cam(1, { name: 'Front door' }), cam(2, { name: 'Garage' }), cam(3, { name: 'Garden' })]),
    )
    expect(s.visibleNames).toEqual(['Front door', 'Garden'])
  })

  it('collects distinct locations in first-seen order and ignores unset ones', () => {
    const s = summarizeGrid(
      grid({ cameraIds: [1, 2, 3] }),
      mapOf([
        cam(1, { location: 'Piano terra' }),
        cam(2, { location: null }),
        cam(3, { location: 'Piano terra' }),
      ]),
    )
    expect(s.locations).toEqual(['Piano terra'])
  })
})

describe('the card grid adapts to the viewport through the shared column rule', () => {
  it('caps the cameras-list column count so cards stay readable', () => {
    expect(gridCardColumns(1)).toBe(1)
    expect(gridCardColumns(3)).toBe(3)
    expect(gridCardColumns(6)).toBe(GRID_CARD_MAX_COLUMNS)
    expect(GRID_CARD_MAX_COLUMNS).toBeLessThan(6)
  })

  it('never returns less than one column, whatever it is handed', () => {
    expect(gridCardColumns(0)).toBe(1)
    expect(gridCardColumns(Number.NaN)).toBe(1)
  })

  it('a card width subtracts the list padding and the inter-column gaps', () => {
    // One column: the viewport minus the list's left+right padding.
    expect(gridCardWidth(400, 1)).toBeLessThan(400)
    // Three columns of the same viewport are each narrower than one.
    expect(gridCardWidth(1200, 3)).toBeLessThan(gridCardWidth(1200, 1))
    // …and narrower than a naive third, because the gaps are paid for.
    expect(gridCardWidth(1200, 3)).toBeLessThan(1200 / 3)
  })
})

describe('the preview strip shows as many thumbs as the card can hold', () => {
  it('grows with the card width, within bounds', () => {
    expect(gridPreviewThumbCount(120)).toBe(GRID_PREVIEW_MIN_THUMBS)
    expect(gridPreviewThumbCount(10_000)).toBe(GRID_PREVIEW_MAX_THUMBS)
    expect(gridPreviewThumbCount(700)).toBeGreaterThan(gridPreviewThumbCount(260))
  })

  it('is monotonic in the width', () => {
    let previous = 0
    for (let w = 100; w <= 1200; w += 25) {
      const count = gridPreviewThumbCount(w)
      expect(count).toBeGreaterThanOrEqual(previous)
      previous = count
    }
  })

  it('falls back to the minimum for a width nothing has measured yet', () => {
    expect(gridPreviewThumbCount(0)).toBe(GRID_PREVIEW_MIN_THUMBS)
    expect(gridPreviewThumbCount(Number.NaN)).toBe(GRID_PREVIEW_MIN_THUMBS)
  })
})
