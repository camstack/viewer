/**
 * Demand follows the VIEWPORT, not the mount tree.
 *
 * ## What was wrong
 *
 * `SnapshotOverviewProvider.registerDemand` is called from an effect that runs
 * while a surface is MOUNTED. In a `FlatList` that is not the same as on
 * screen: the list keeps a window of cells realised well beyond the visible
 * rows, and Expo's tabs keep every tab mounted, so the Cameras screen goes on
 * registering demand for thirty cameras while the operator reads Events.
 *
 * Demand is not free, and after [D108](../../../docs/decisions/adr-0108.md) it
 * is the *only* thing that costs anything on the hub: the snapshot addon runs
 * no timer, so every target named in a `getSnapshotLinks` call is one camera
 * capture, every five seconds, for as long as it is named. D108's headline
 * consequence — "a camera nobody is looking at costs exactly nothing" — was
 * true of the server and false of this client.
 *
 * ## The rule, and why it is subtractive
 *
 * A device is demandable unless a surface that owns it says it is off screen.
 * Nothing has to opt in; a surface that never reports visibility behaves
 * exactly as it does today. That direction matters — the failure mode of an
 * additive rule ("only what is declared visible") is a screen someone forgot to
 * wire showing permanently frozen thumbnails, which is precisely the D93
 * incident, and it would be silent.
 *
 * Two surfaces can disagree about the same camera (a grid tile is visible while
 * the same camera is scrolled off the Cameras list). Visible wins: one surface
 * painting it is reason enough to keep it warm.
 */
import { describe, it, expect } from 'vitest'

import {
  SnapshotViewportRegistry,
  type SnapshotViewportOwner,
} from '../snapshot-viewport.js'

const CAMERAS: SnapshotViewportOwner = 'cameras-list'
const GRID: SnapshotViewportOwner = 'grid-wall'

describe('SnapshotViewportRegistry', () => {
  it('treats an unmentioned device as demandable', () => {
    const registry = new SnapshotViewportRegistry()
    // The default for every surface that has not been wired, and for every
    // device no surface manages.
    expect(registry.isDemandable(101)).toBe(true)
  })

  it('drops a device its only owner reports off screen', () => {
    const registry = new SnapshotViewportRegistry()
    registry.report(CAMERAS, { visible: [101], hidden: [616, 102] })
    expect(registry.isDemandable(101)).toBe(true)
    expect(registry.isDemandable(616)).toBe(false)
    expect(registry.isDemandable(102)).toBe(false)
    // Still unmentioned by anyone.
    expect(registry.isDemandable(999)).toBe(true)
  })

  it('lets ANY owner that can see a device keep it', () => {
    const registry = new SnapshotViewportRegistry()
    registry.report(CAMERAS, { visible: [], hidden: [101] })
    registry.report(GRID, { visible: [101], hidden: [] })
    expect(registry.isDemandable(101)).toBe(true)
  })

  it('forgets an owner that unmounts, rather than freezing its last report', () => {
    const registry = new SnapshotViewportRegistry()
    registry.report(CAMERAS, { visible: [], hidden: [101] })
    expect(registry.isDemandable(101)).toBe(false)
    // A screen that goes away must not keep voting. Leaving its last report in
    // place is how a camera becomes permanently undemandable with nothing on
    // screen to explain why.
    registry.forget(CAMERAS)
    expect(registry.isDemandable(101)).toBe(true)
  })

  it('exposes a version that only moves when the set does', () => {
    // `useSyncExternalStore` needs a snapshot that is `Object.is`-stable
    // between real changes — returning a fresh array or object would re-render
    // the whole provider subtree on every read and loop.
    const registry = new SnapshotViewportRegistry()
    const first = registry.version
    expect(registry.version).toBe(first)

    registry.report(CAMERAS, { visible: [101], hidden: [] })
    const second = registry.version
    expect(second).not.toBe(first)

    registry.report(CAMERAS, { visible: [101], hidden: [] })
    expect(registry.version).toBe(second)

    registry.forget(CAMERAS)
    expect(registry.version).not.toBe(second)
  })

  it('an inactive screen votes on NOTHING rather than voting everything hidden', () => {
    // The trap this closes: the Cameras list stays mounted when the operator
    // opens one camera, so an inactive-but-mounted screen reporting its whole
    // list as hidden would vote AGAINST the very camera the detail screen is
    // painting — and the detail screen reports no viewport of its own, so
    // nothing outvotes it. The poster would blank.
    //
    // Reporting nothing is also not a loss. `shouldRequestSnapshot`
    // (`tile-snapshot-gate.ts`) is already `screenActive`, so an inactive
    // screen's cards pass `enabled: false` and register no demand at all. The
    // hidden vote bought nothing and cost a live surface.
    const registry = new SnapshotViewportRegistry()
    registry.report(CAMERAS, { visible: [101], hidden: [616] })
    expect(registry.isDemandable(616)).toBe(false)

    // Screen goes inactive → it withdraws, it does not vote hidden.
    registry.forget(CAMERAS)
    expect(registry.isDemandable(101)).toBe(true)
    expect(registry.isDemandable(616)).toBe(true)
  })

  it('notifies subscribers only when the demandable set actually changes', () => {
    const registry = new SnapshotViewportRegistry()
    let notifications = 0
    const off = registry.subscribe(() => {
      notifications += 1
    })

    registry.report(CAMERAS, { visible: [101], hidden: [616] })
    expect(notifications).toBe(1)

    // `onViewableItemsChanged` fires on every scroll frame. Re-publishing an
    // identical set would re-key the links query and blank the grid for a round
    // trip on every pixel of scrolling.
    registry.report(CAMERAS, { visible: [101], hidden: [616] })
    expect(notifications).toBe(1)

    registry.report(CAMERAS, { visible: [101, 616], hidden: [] })
    expect(notifications).toBe(2)

    off()
    registry.report(CAMERAS, { visible: [], hidden: [101, 616] })
    expect(notifications).toBe(2)
  })
})
