/**
 * Which cameras are actually on screen — the gate in front of snapshot demand.
 *
 * ## Why this exists
 *
 * After [D108](../../../docs/decisions/adr-0108.md) the hub runs no warm timer:
 * a frame is captured when, and only when, a client names that camera as a
 * target of `snapshot.getSnapshotLinks`. So the target list in that call is not
 * a request for information, it is a standing instruction to capture — one
 * camera hit every five seconds for as long as the name is in the list.
 *
 * `SnapshotOverviewProvider` built that list from MOUNTED surfaces, and mounted
 * is much broader than visible: a `FlatList` realises cells well past the fold,
 * and Expo Router keeps every tab mounted, so thirty cameras stayed enrolled
 * while the operator was reading Events. D108's stated consequence — "a camera
 * nobody is looking at costs exactly nothing" — held on the server and was
 * quietly untrue here.
 *
 * ## The rule is SUBTRACTIVE, on purpose
 *
 * A device is demandable unless some surface that owns it reports it off
 * screen. No surface has to opt in, and one that never reports behaves exactly
 * as it did before this file existed.
 *
 * The opposite rule — demand only what is declared visible — fails in the
 * dangerous direction. A screen nobody remembered to wire would declare
 * nothing, demand nothing, capture nothing, and paint frozen thumbnails with no
 * error anywhere: the D93 stale-frame incident, restored, and silent. Making
 * the default "keep it warm" means the worst a missing wire-up can do is cost
 * what today already costs.
 *
 * ## Disagreement resolves towards visible
 *
 * Two surfaces can own the same camera at once — a grid tile painting 101 while
 * 101 is scrolled off the Cameras list. One surface painting it is reason
 * enough to keep it warm, so any owner reporting it visible wins over every
 * owner reporting it hidden.
 */

/** A screen (not a tile) that can speak for a set of cameras. */
export type SnapshotViewportOwner = string

/**
 * One owner's view of the cameras it manages.
 *
 * Both halves are needed. `hidden` is the vote — `visible` alone could not
 * distinguish "101 is off screen" from "this owner has nothing to say about
 * 101", and those must not be the same, or the first owner to report would
 * silence every camera on every other screen.
 */
export interface SnapshotViewportReport {
  readonly visible: readonly number[]
  readonly hidden: readonly number[]
}

interface OwnerState {
  readonly visible: ReadonlySet<number>
  readonly hidden: ReadonlySet<number>
}

function sameSet(a: ReadonlySet<number>, b: readonly number[]): boolean {
  if (a.size !== new Set(b).size) return false
  for (const id of b) if (!a.has(id)) return false
  return true
}

export class SnapshotViewportRegistry {
  private readonly owners = new Map<SnapshotViewportOwner, OwnerState>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  /**
   * A snapshot for `useSyncExternalStore`: it must be `Object.is`-stable
   * between real changes. The demandable set itself cannot serve — deriving a
   * fresh Set or array per read re-renders the provider subtree every time
   * React checks, which is a render loop, not a subscription.
   */
  get version(): number {
    return this.revision
  }

  /** Subscribe to changes in the demandable set. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Publish what one screen can see.
   *
   * Identical reports are dropped without notifying. `onViewableItemsChanged`
   * fires on scroll frames, and re-publishing an unchanged set would re-key the
   * links query — which blanks every tile for a round trip — on every pixel of
   * scrolling.
   */
  report = (owner: SnapshotViewportOwner, report: SnapshotViewportReport): void => {
    const current = this.owners.get(owner)
    if (
      current !== undefined &&
      sameSet(current.visible, report.visible) &&
      sameSet(current.hidden, report.hidden)
    ) {
      return
    }
    this.owners.set(owner, {
      visible: new Set(report.visible),
      hidden: new Set(report.hidden),
    })
    this.notify()
  }

  /**
   * Drop an owner's vote when its screen goes away.
   *
   * A stale report is worse than no report: it would leave a camera
   * undemandable with nothing on screen that could explain, or undo, it.
   */
  forget = (owner: SnapshotViewportOwner): void => {
    if (!this.owners.delete(owner)) return
    this.notify()
  }

  /** May this camera be named as a link target right now? */
  isDemandable = (deviceId: number): boolean => {
    let mentioned = false
    for (const state of this.owners.values()) {
      if (state.visible.has(deviceId)) return true
      if (state.hidden.has(deviceId)) mentioned = true
    }
    return !mentioned
  }

  private notify(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

/** The app's single registry. One provider reads it; screens report into it. */
export const snapshotViewport = new SnapshotViewportRegistry()

/** The Cameras tab. Named here so the screen and any test agree on the string. */
export const CAMERAS_VIEWPORT_OWNER: SnapshotViewportOwner = 'cameras-list'

/**
 * How much of a card must be on screen before it counts as visible.
 *
 * A partially scrolled row is being LOOKED at, so the bar is low; the point of
 * the gate is the cells a `FlatList` realises past the fold and the whole tab
 * that is mounted behind another one, not the row half over the edge.
 *
 * `minimumViewTime` keeps a fling from enrolling every camera it flies past:
 * without it a fast scroll through thirty cards reports each of them visible
 * for one frame, and each report is a capture instruction to the hub.
 */
export const SNAPSHOT_VIEWABILITY_CONFIG = Object.freeze({
  itemVisiblePercentThreshold: 20,
  minimumViewTime: 250,
})

/**
 * A scrolling list's report, or `null` while it has nothing to report.
 *
 * `viewable` is `null` until the list has measured its viewport for the first
 * time, and a list that has not measured knows nothing about what is on screen:
 * it must not vote. Reporting "nothing viewable" there instead calls every
 * camera hidden, and on the hosted PWA react-native-web's `FlatList` took ~15 s
 * to report its first viewable items — so `getSnapshotLinks` was not sent at all
 * and no tile painted until then (2026-10-06). No vote keeps the subtractive
 * default above: every mounted tile stays demandable until the list knows
 * better. A measured EMPTY viewport is a real answer and still votes.
 *
 * `warm` is the opening sweep (`snapshot-rotation.ts`): cameras kept demandable
 * although they are off screen.
 */
export function listViewportReport(
  all: readonly number[],
  viewable: readonly number[] | null,
  warm: readonly number[],
): SnapshotViewportReport | null {
  if (viewable === null) return null
  const demanded = new Set([...viewable, ...warm])
  return {
    visible: all.filter((id) => demanded.has(id)),
    hidden: all.filter((id) => !demanded.has(id)),
  }
}
