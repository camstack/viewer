/**
 * @vitest-environment jsdom
 *
 * What the events gallery costs while it scrolls — the "janky, as if it were not
 * virtualised" report, pinned.
 *
 * Three claims, each of which was false or unproven before:
 *  1. 500 loaded tracks mount a screenful of cells, not 500 (the list is the
 *     only scroller and hands out one ROW per item).
 *  2. A tile draws NO native effect view: a glass chip is a UIVisualEffectView
 *     on iOS, two to three per tile, over a hundred alive at once. Measured
 *     here as `GlassSurface` / `BlurView` mounts: 72 for 36 tiles before.
 *  3. A tile is a memo, so re-rendering its parent with the same props does not
 *     re-render its picture and chips.
 *
 * `FlashList` is the repo's stub (a `FlatList`, which windows by its own batch
 * rules), so the bound below is "far below the data", not a pixel figure; the
 * frame rate itself is a device measurement.
 */
import React, { useState } from 'react'
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountScreen } from '../../../../testing/mount.js'
import { setTestViewport } from '../../../../testing/viewport-control.js'
import type { EventsTrackRow } from '../../../../../shared/events/events-track-row.js'
import { EventsGallery, type EventsGalleryProps } from '../EventsGallery.js'
import { EventTile, type EventTileProps } from '../EventTile.js'
import { NO_TILE_DETAILS } from '../events-gallery-layout.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const counts = vi.hoisted(() => ({ glass: 0, blur: 0, hero: 0 }))
vi.mock('../../../ui/GlassSurface.js', () => ({
  GlassSurface: (p: { readonly children?: React.ReactNode }) => {
    counts.glass += 1
    return p.children
  },
}))
vi.mock('expo-blur', () => ({
  BlurView: (p: { readonly children?: React.ReactNode }) => {
    counts.blur += 1
    return p.children
  },
}))
vi.mock('../TileHero.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../TileHero.js')>()
  return {
    ...actual,
    TileHero: (props: React.ComponentProps<typeof actual.TileHero>) => {
      counts.hero += 1
      return React.createElement(actual.TileHero, props)
    },
  }
})

const NOW = Date.now()
const ROWS: readonly EventsTrackRow[] = Array.from({ length: 500 }, (_, i) => ({
  trackId: `t${i}`, deviceId: 1, cameraName: 'Cam', className: 'person', firstSeen: NOW - i * 1_000 - 5_000, lastSeen: NOW - i * 1_000,
  state: 'idle', active: false, zonesVisited: [], zoneNames: [], classes: ['person'], audioLabels: [], bestEventId: `e${i}`,
  hasUnassignedFace: i % 5 === 0,
}))

const feed = (rows: readonly EventsTrackRow[]): EventsGalleryProps['feed'] => ({
  rows, loading: false, loadingMore: false, error: null, tail: 'exhausted', mode: 'feed', semanticLoading: false,
  iconIds: new Map(), loadMore() {}, loadOlder() {}, refresh: async () => {}, retry() {},
})
const galleryProps = (rows: readonly EventsTrackRow[]): EventsGalleryProps => ({
  feed: feed(rows), density: 'medium', anchorMs: NOW, dayOffset: 0, filtered: false, showAdminFlags: false, canAssignFaces: true,
  labelMode: 'label', details: NO_TILE_DETAILS, onSelect() {},
})

beforeEach(() => {
  counts.glass = 0
  counts.blur = 0
  counts.hero = 0
  act(() => setTestViewport({ width: 390, height: 844 }))
})
afterEach(cleanup)

describe('the gallery under load', () => {
  it('500 tracks mount a window of tiles, not 500', async () => {
    const { container } = mountScreen(React.createElement(EventsGallery, galleryProps(ROWS)))
    await waitFor(() => expect(container.querySelectorAll('[aria-label*="Cam"]').length).toBeGreaterThan(0))
    const mounted = container.querySelectorAll('[aria-label*="Cam"]').length
    expect(mounted).toBeLessThan(100)
    expect(mounted).toBeLessThan(ROWS.length / 4)
  })

  it('draws no glass or blur view on any tile — chips are a plain wash', async () => {
    const { container } = mountScreen(React.createElement(EventsGallery, galleryProps(ROWS)))
    await waitFor(() => expect(container.querySelectorAll('[aria-label*="Cam"]').length).toBeGreaterThan(0))
    expect(counts.glass).toBe(0)
    expect(counts.blur).toBe(0)
  })
})

describe('EventTile', () => {
  const tileProps = (): EventTileProps => ({
    row: ROWS[0]!, edge: 120, imageUri: 'https://hub/t0.jpg', bearer: 'tok', anchorMs: NOW, details: NO_TILE_DETAILS,
    chipOptions: {
      labelMode: 'icon', showAdminFlags: false,
      kindLabels: new Map(), iconIds: new Map(), locale: 'en-GB', nowMs: NOW,
    },
    onPress() {}, onAssignFace() {},
  })

  it('is a memo: a parent re-render with the same props does not re-render the picture', async () => {
    const props = tileProps()
    let bump: () => void = () => {}
    function Parent(): React.ReactElement {
      const [, set] = useState(0)
      bump = () => set((n) => n + 1)
      return React.createElement(EventTile, props)
    }
    mountScreen(React.createElement(Parent))
    const before = counts.hero
    expect(before).toBeGreaterThan(0)
    act(() => bump())
    act(() => bump())
    expect(counts.hero).toBe(before)
  })

  it('re-renders when its track changes', () => {
    const props = tileProps()
    let show: (i: number) => void = () => {}
    function Parent(): React.ReactElement {
      const [i, set] = useState(0)
      show = set
      return React.createElement(EventTile, { ...props, row: ROWS[i]! })
    }
    mountScreen(React.createElement(Parent))
    const before = counts.hero
    act(() => show(1))
    expect(counts.hero).toBeGreaterThan(before)
  })
})
