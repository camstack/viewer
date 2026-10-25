/**
 * @vitest-environment jsdom
 *
 * The mount window, on a real rendered tree.
 *
 * `timeline-window.spec.ts` proves the arithmetic. This proves the thing the
 * arithmetic was for, and it is the only place that can: the claim is about how
 * many components exist and how many of them re-render, and neither is visible
 * from a pure function.
 *
 * What the operator asked to see pinned:
 *
 *  1. a day's worth of cards mounts a SCREEN's worth of cards;
 *  2. the scroll↔time mapping is untouched — the content is exactly as tall as
 *     it was, so every offset still means the same instant;
 *  3. the live-edge tick, which re-renders the scroller once a second, does not
 *     reach a single card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { resetTestRenderTally, testRenderTally } from '../../../../testing/render-tally.js'
import { EXPO_IMAGE_TESTID_PREFIX } from '../../../../testing/native-stubs/expo-image.js'
import { TimelineScroller, type TimelineScrollerProps } from '../TimelineScroller.js'
import { MOUNT_MARGIN_PX } from '../timeline-window.js'
import { timelineContentHeightPx } from '../timeline-content-height.js'
import { epochToOffset } from '../timeline-geometry.js'
import type { ObjectEvent, PositionedCluster } from '../event-cluster.js'
import type { ActivityModel } from '../activity-view-types.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const T0 = 1_700_000_000_000
const DEVICE = 101
const CARD_PX = 90
const PITCH_PX = 120
const VIEWPORT_PX = 600
const SPACER_PX = 60
/** A busy camera-day, at the density this timeline actually reaches. */
const CARD_COUNT = 200

const EMPTY_ACTIVITY: ActivityModel = { recording: [], motion: [], audio: [] }

function clusterAt(index: number): PositionedCluster {
  const timestamp = T0 - index * 60_000
  const event: ObjectEvent = {
    id: `e${index}`,
    deviceId: DEVICE,
    timestamp,
    className: 'person',
    // A stamped snapshot: the card renders an image instead of asking the data
    // plane for one, so this spec measures rendering and not the wire.
    mediaUrl: `https://hub.test/snap/${index}.jpg`,
  }
  return {
    id: `c${index}`,
    events: [event],
    carouselEvents: [event],
    representative: event,
    anchorEvent: event,
    anchorMs: timestamp,
    importantEvent: event,
    classes: ['person'],
    labels: [],
    startMs: timestamp,
    endMs: timestamp,
    topPx: index * PITCH_PX,
    heightPx: CARD_PX,
  }
}

const CLUSTERS: readonly PositionedCluster[] = Array.from({ length: CARD_COUNT }, (_, i) =>
  clusterAt(i),
)

/** The handlers the theater holds behind `useCallback` — stable across the
 *  live-edge tick, exactly as they are in `TheaterTimeline`. */
const STABLE_PRESS = (): void => {}

function props(overrides: Partial<TimelineScrollerProps> = {}): TimelineScrollerProps {
  return {
    topMs: T0,
    zoomIndex: 2,
    dayWindow: { from: T0 - 24 * 3_600_000, to: T0 },
    clusters: CLUSTERS,
    activity: EMPTY_ACTIVITY,
    showMotionLane: false,
    showAudioLane: false,
    cardWidth: 200,
    viewportHeight: VIEWPORT_PX,
    indicatorOffsetPx: SPACER_PX,
    isLive: true,
    onScroll: () => {},
    onClusterPress: STABLE_PRESS,
    ...overrides,
  }
}

function mountedCards(container: HTMLElement): number {
  return container.querySelectorAll(`[data-testid^="${EXPO_IMAGE_TESTID_PREFIX}"]`).length
}

/**
 * A host that can swap the scroller's props WITHOUT remounting the provider
 * stack. RTL's own `rerender` replaces the root element, which throws away the
 * theme and the query client `mountScreen` put around it.
 */
interface HostHandle {
  readonly set: (next: TimelineScrollerProps) => void
}

function host(initial: TimelineScrollerProps): {
  readonly element: React.ReactElement
  readonly handle: HostHandle
} {
  const handle: { set: (next: TimelineScrollerProps) => void } = { set: () => {} }
  function Host(): React.ReactElement {
    const [current, setCurrent] = React.useState(initial)
    // Published after commit, not during render (react-hooks/immutability);
    // the mount runs inside `act`, so the handle is live before any `set`.
    React.useLayoutEffect(() => {
      handle.set = setCurrent
    }, [])
    return React.createElement(TimelineScroller, current)
  }
  return { element: React.createElement(Host), handle }
}

describe('a day of cards mounts a screen of cards', () => {
  it('renders what the band covers, not the 200 the day holds', () => {
    const { container } = mountScreen(React.createElement(TimelineScroller, props()))
    const mounted = mountedCards(container)

    // Enough to fill the viewport and its margins…
    const reachable = Math.ceil((VIEWPORT_PX + MOUNT_MARGIN_PX * 2) / PITCH_PX) + 2
    expect(mounted).toBeGreaterThan(VIEWPORT_PX / PITCH_PX - 1)
    // …and nowhere near the whole day. Before the window this was 200.
    expect(mounted).toBeLessThanOrEqual(reachable)
    expect(mounted).toBeLessThan(CARD_COUNT / 5)
  })

  it('leaves the CONTENT as tall as the whole day — the scrub reads offsets, not cards', () => {
    // The one invariant windowing must not touch, and the reason the scrub is
    // untouched by it: the scroll space spans the WHOLE day, whether or not
    // the cards inside it exist. Any change here would move every epoch the
    // scroller reports under a finger.
    //
    // Stated as a FLOOR plus the rule, rather than as a re-spelled formula.
    // It used to assert `SPACER + daySpan` exactly, and that broke the day the
    // content grew the trailing room that makes the oldest end reachable at
    // all (`timeline-content-height.ts`) — a correct fix failing a guard that
    // had pinned an expression instead of the property. The floor is the part
    // windowing could actually break: shrinking the content to the mounted
    // band.
    const p = props()
    const { container } = mountScreen(React.createElement(TimelineScroller, p))
    const daySpan = epochToOffset(p.dayWindow.from, p.topMs, p.zoomIndex)
    const heights = [...container.querySelectorAll('div')]
      .map((el) => Number.parseFloat((el as HTMLElement).style.height))
      .filter((h) => Number.isFinite(h))
    const content = Math.max(...heights)
    expect(content).toBeGreaterThanOrEqual(SPACER_PX + daySpan)
    expect(content).toBe(
      timelineContentHeightPx({
        indicatorOffsetPx: SPACER_PX,
        dayHeightPx: daySpan,
        contentBottomInsetPx: p.contentBottomInset ?? 0,
        viewportHeightPx: p.viewportHeight,
      }),
    )
  })
})

describe('the live-edge tick does not reach the cards', () => {
  it('re-rendering the scroller with the SAME cluster identities renders no card', () => {
    // What a tick does under the layout anchor: the epoch map and a handful of
    // scalars are new objects, `clusterByZoom` did NOT re-run (the anchor did
    // not move a whole pixel), so the same cluster objects arrive. Every card
    // must be skipped by its own memo.
    const { element, handle } = host(props())
    const { container } = mountScreen(element)
    const mounted = mountedCards(container)
    expect(mounted).toBeGreaterThan(0)

    resetTestRenderTally()
    // Exactly what one live-edge tick changes in production: `use-timeline-scrub`
    // re-mints `onScroll` (real `now` is in its deps) and clips mode re-mints
    // the epoch map. The CLUSTERS and the card handlers do not move, because
    // the layout anchor did not move a whole pixel.
    act(() =>
      handle.set(
        props({
          onScroll: () => {},
          epochMap: {
            epochToOffset: () => 0,
            offsetToEpoch: () => T0,
            contentSpanPx: 1_000,
          },
        }),
      ),
    )

    // ZERO cards. A cluster card's root is the subtree's only `Pressable`, so
    // this is not a proxy for the claim, it IS the claim.
    expect(testRenderTally('Pressable')).toBe(0)
    const tickCost = testRenderTally()

    // …and what is left does not SCALE with the day: the same tick over a list
    // a tenth the size costs exactly the same, because everything it re-renders
    // is the scroller's own chrome. That is the property; the number itself is
    // whatever the chrome happens to be.
    cleanup()
    const short = CLUSTERS.slice(0, 20)
    const second = host(props({ clusters: short }))
    mountScreen(second.element)
    resetTestRenderTally()
    act(() =>
      second.handle.set(
        props({
          clusters: short,
          onScroll: () => {},
          epochMap: {
            epochToOffset: () => 0,
            offsetToEpoch: () => T0,
            contentSpanPx: 1_000,
          },
        }),
      ),
    )
    expect(testRenderTally()).toBe(tickCost)
    expect(testRenderTally('Pressable')).toBe(0)
  })

  it('and the same re-render with NEW cluster objects costs the cards in full', () => {
    // The world before `layoutAnchorMs`: `clusterByZoom` re-ran on every
    // live-edge tick and re-minted every cluster, so this is what one second
    // used to cost — measured, so the fix cannot quietly regress into it.
    const { element, handle } = host(props())
    const { container } = mountScreen(element)
    const mounted = mountedCards(container)

    resetTestRenderTally()
    act(() => handle.set(props({ clusters: CLUSTERS.map((c) => ({ ...c })) })))

    // Every mounted card, once — and this is the WINDOWED number. Before the
    // window the same second re-rendered all 200 of the day's cards.
    expect(testRenderTally('Pressable')).toBe(mounted)
    expect(testRenderTally()).toBeGreaterThan(mounted * 2)
  })
})
