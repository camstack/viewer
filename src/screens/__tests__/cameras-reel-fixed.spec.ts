/**
 * @vitest-environment jsdom
 *
 * The "Recent" reel is PAGE CHROME, not the first row of the camera list.
 *
 * ## The report this closes (operator, 2026-08-20)
 *
 * "Il reel deve essere FISSO in alto — le camere scrollano SOTTO di esso."
 * It was not: `CamerasScreen` passed the reel as the FlatList's
 * `ListHeaderComponent`, which is a cell inside the scroll content. Scrolling
 * to the third row of cameras therefore scrolled the most recent events off the
 * top of the screen — the one thing on that page you want to keep looking at.
 *
 * ## And it must not move when its data arrives
 *
 * The block is reserved at its FINAL height from the first frame, whether or
 * not the hub has answered and whether or not there is anything to show. The
 * strip already reserved its own height (`reelRowHeight`); the caption above it
 * and the padding around it did not, and the whole block vanished entirely
 * while the connection was still dialling — so the camera grid jumped down by
 * the full block the moment the socket came up.
 *
 * These tests assert the two structural facts a style refactor could quietly
 * undo: the block is OUTSIDE the scroller, and it is rendered before the
 * scroller in document order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../testing/mount.js'
import { CamerasScreen } from '../CamerasScreen.js'
import { CamerasGridSkeleton } from '../../components/CameraCardSkeleton.js'
import { RecentReelBlock } from '../../components/events/track/RecentReelBlock.js'
import {
  RECENT_REEL_TEST_ID,
  reelBlockHeight,
} from '../../components/events/track/reel-layout.js'
import { CAMERAS_LIST_TEST_ID } from '../cameras-reel-placement.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const SCREEN_SRC = readFileSync(join(__dirname, '..', 'CamerasScreen.tsx'), 'utf8')

const CAMERAS = [
  { id: 1, name: 'Dispensa', type: 'Camera', isCamera: true, online: true, features: [] },
  { id: 2, name: 'Garage', type: 'Camera', isCamera: true, online: true, features: [] },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

const CARD_WIDTH = 80

afterEach(cleanup)

function mount(): HTMLElement {
  return mountScreen(React.createElement(CamerasScreen), { hub: HUB }).container
}

/** The reserved block, measured. react-native-web compiles the style to a
 *  class and jsdom resolves it, so this is the height the browser would use. */
function blockHeight(container: HTMLElement): string {
  const el = container.querySelector(`[data-testid="${RECENT_REEL_TEST_ID}"]`)
  if (!(el instanceof HTMLElement)) throw new Error('no reel block')
  return getComputedStyle(el).height
}

/**
 * Mount the screen and wait for the LOADED page — the camera list only exists
 * once `deviceManager.listAll` has answered. Before that the screen is the
 * cold-launch skeleton, which reserves the same reel block but has no list, so
 * asserting synchronously would test the wrong phase.
 */
async function reelAndList(): Promise<{
  readonly reel: HTMLElement
  readonly list: HTMLElement
}> {
  const container = mount()
  const find = (id: string): Element | null => container.querySelector(`[data-testid="${id}"]`)
  await waitFor(() => expect(find(CAMERAS_LIST_TEST_ID)).not.toBeNull())
  const reel = find(RECENT_REEL_TEST_ID)
  const list = find(CAMERAS_LIST_TEST_ID)
  if (!(reel instanceof HTMLElement) || !(list instanceof HTMLElement)) {
    throw new Error('reel/list markers are not elements')
  }
  return { reel, list }
}

describe('the Recent reel is fixed above the scrolling camera list', () => {
  it('is not a cell inside the list', async () => {
    // THE regression. `ListHeaderComponent` renders inside the scroll content,
    // so the reel scrolled away with the cameras.
    const { reel, list } = await reelAndList()
    expect(list.contains(reel)).toBe(false)
  })

  it('comes before the list in document order', async () => {
    // Fixed "at the top" is a claim about order, not just about containment:
    // a block appended after the scroller would also be outside it.
    const { reel, list } = await reelAndList()
    expect(reel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never goes back to being the list header', () => {
    expect(SCREEN_SRC).not.toContain('ListHeaderComponent=')
  })

  it('is drawn by the SAME branch as the list, so neither can appear alone', () => {
    // Two conditionals would drift the first time one of them grew a second
    // condition. There is one, and it asks about the FLEET — `allCameras`, what
    // the hub returned — not about `cameras`, which is whatever the location
    // chip selected. Branching on the filtered list is how choosing an empty
    // bucket took the reel and the selector off the page entirely (2026-09-16),
    // leaving no control to undo it with.
    expect(SCREEN_SRC).toContain('{allCameras.length > 0 ? (')
    expect(SCREEN_SRC).not.toContain('{cameras.length > 0 ? recentReel')
  })
})

describe('the reel block reserves its space before it has anything to show', () => {
  it('is exactly `reelBlockHeight` tall, live or not', () => {
    // THE anti-bounce claim. The placeholder and the loaded strip occupy the
    // same box, so the camera grid does not move when the embed paints.
    const expected = `${reelBlockHeight(CARD_WIDTH)}px`
    for (const live of [false, true]) {
      const { container } = mountScreen(
        React.createElement(RecentReelBlock, { cardWidth: CARD_WIDTH, live }),
        { hub: HUB },
      )
      expect(blockHeight(container)).toBe(expected)
      cleanup()
    }
  })

  it('grows with the reel-size preference and nothing else', () => {
    for (const cardWidth of [80, 106, 132]) {
      const { container } = mountScreen(
        React.createElement(RecentReelBlock, { cardWidth, live: false }),
        { hub: HUB },
      )
      expect(blockHeight(container)).toBe(`${reelBlockHeight(cardWidth)}px`)
      cleanup()
    }
  })

  it('the COLD-LAUNCH skeleton reserves the same block', () => {
    // The cameras page paints this before any query has settled. If it
    // reserved a different box the grid would shift once more, on the
    // hand-off from skeleton to list.
    const { container } = mountScreen(
      React.createElement(CamerasGridSkeleton, { numColumns: 2, reelCardWidth: CARD_WIDTH }),
    )
    expect(blockHeight(container)).toBe(`${reelBlockHeight(CARD_WIDTH)}px`)
  })

  it('the caption is drawn in both phases — the block is never a bare gap', () => {
    for (const live of [false, true]) {
      const { container } = mountScreen(
        React.createElement(RecentReelBlock, { cardWidth: CARD_WIDTH, live }),
        { hub: HUB },
      )
      expect(container.textContent).toContain('Recent')
      cleanup()
    }
  })
})
