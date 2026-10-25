import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A source guard, because the property is STRUCTURAL and this repo has no
 * renderer to assert it any other way (roadmap: "the viewer cannot test a
 * component, and that is the gap under everything").
 *
 * What it protects, and what breaks if it goes:
 *
 *  1. The PORTRAIT stack hands the stream box to `TheaterTimeline`, which is
 *     the only reason one toolbar can sit above the picture. The obvious
 *     alternative — a second toolbar rendered by the screen — needs the panel
 *     union and the quality state lifted out of the timeline, and two unions
 *     that must agree about which panel is open is the exact defect the
 *     2026-08-01 panel consolidation removed.
 *
 *  2. The player has ONE parent, in every layout. Two shipped attempts got
 *     this wrong and both were caught by the operator, not by a test:
 *       - 1.0.263 handed `streamBox` to `TheaterTimeline` in portrait and
 *         rendered it under the screen in landscape. Sharing the binding is not
 *         enough — React keeps an instance only while it stays at the same
 *         position under the same parent chain — so rotation remounted the
 *         player and renegotiated the WebRTC session.
 *       - 1.0.265 hoisted it into one absolutely-positioned host at the screen
 *         root, offset by a spacer's `onLayout` y. `onLayout` is
 *         PARENT-relative, so the host sat an app-header too high: video above
 *         the toolbar, dead band below it.
 *     The structure now needs no measurement and no branch: `TheaterTimeline`
 *     owns the column and the picture is always the child at a fixed index of
 *     its root. The screen does not place the picture at all.
 *
 *  3. The layout decision is made in ONE place. A branch that recomputes
 *     `width > height` for itself is how one part of this tree ended up in
 *     landscape while another was still in portrait — a fault this file's
 *     history documents twice.
 */

const SRC = join(process.cwd(), 'src')
const DETAIL_SCREEN = join(SRC, 'screens', 'CameraDetailScreen.tsx')
const THEATER_TIMELINE = join(SRC, 'components', 'camera', 'theater', 'TheaterTimeline.tsx')

const screen = readFileSync(DETAIL_SCREEN, 'utf8')
const timeline = readFileSync(THEATER_TIMELINE, 'utf8')

describe('the portrait toolbar sits above the stream — by hosting, not by a copy', () => {
  it('the screen renders the timeline and nothing else — one call, no branch', () => {
    expect(screen).toMatch(/\{renderTimeline\(\)\}/)
    // The two forms that shipped a remount. Either one returning is the bug.
    expect(screen).not.toMatch(/renderTimeline\(\{\s*stream:\s*streamBox\s*\}\)/)
    expect(screen).not.toMatch(/renderTimeline\(\{\s*streamSpacer\s*\}\)/)
  })

  it('the screen no longer positions the picture at all', () => {
    // The 1.0.265 absolute host and its parent-relative offset.
    expect(screen).not.toMatch(/resolveStreamHostStyle/)
    expect(screen).not.toMatch(/streamHostStyle/)
    expect(screen).not.toMatch(/streamSlotY/)
  })

  it('the timeline hosts the player at a FIXED index, between toolbar and body', () => {
    expect(timeline).toMatch(/readonly stream\?: React\.ReactNode/)
    // Anchored on the BRANCH, not on the exact expression: the stack toolbar
    // is now wrapped in a TimelineScaleProvider (the density setting reads
    // nothing else), and the ordering invariant this test protects is
    // unchanged by that.
    const toolbarAt = timeline.indexOf("shape === 'stack' ? (")
    const slotAt = timeline.indexOf('{props.stream ?? null}')
    const chromeAt = timeline.indexOf("{shape === 'fill' ? (")
    expect(toolbarAt).toBeGreaterThan(-1)
    expect(slotAt).toBeGreaterThan(toolbarAt)
    expect(chromeAt).toBeGreaterThan(slotAt)
  })

  it('the drawer wraps the CHROME, never the picture', () => {
    // A drawer that clips and slides the player is why the picture cannot
    // simply live inside the landscape timeline.
    const overlayAt = timeline.indexOf('<LandscapeTimelineOverlay')
    const slotAt = timeline.indexOf('{props.stream ?? null}')
    expect(overlayAt).toBeGreaterThan(slotAt)
    expect(screen).not.toMatch(/<LandscapeTimelineOverlay/)
  })

  it('the screen never renders a SECOND toolbar of its own', () => {
    expect(screen).not.toMatch(/<TimelineToolbarInline/)
  })

  it('there is exactly ONE stream element, handed to exactly ONE parent', () => {
    expect(screen.match(/const streamBox = \(/g) ?? []).toHaveLength(1)
    // Since 2026-09-02 the slot takes one of TWO elements — the picture, or the
    // workspace wall that replaces it — but still exactly one expression, in
    // exactly one place. The alternative is what must never appear: a second
    // `stream=` prop, or a wall rendered as a sibling of the picture, either of
    // which would give the surface below it two parents.
    expect(screen.match(/stream=\{wallStage \?\? streamBox\}/g) ?? []).toHaveLength(1)
    expect(screen.match(/^\s*stream=/gm) ?? []).toHaveLength(1)
    // And neither is ever ALSO rendered inline somewhere.
    expect(screen).not.toMatch(/^\s*\{streamBox\}\s*$/m)
    expect(screen).not.toMatch(/^\s*\{wallStage\}\s*$/m)
  })

  it('the timeline renders the player in exactly one place', () => {
    expect(timeline.match(/\{props\.stream \?\? null\}/g) ?? []).toHaveLength(1)
  })
})

describe('one layout decision, taken by the pure resolver', () => {
  it('the screen resolves its mode through `resolveDetailLayoutMode`', () => {
    expect(screen).toMatch(/resolveDetailLayoutMode\(layoutInput\)/)
    expect(screen).toMatch(/toolbarPlacementFor\(layoutMode\)/)
  })

  it('`fill` and `wide` are DERIVED from that mode, never recomputed', () => {
    expect(screen).toMatch(/const fill = layoutMode === 'fill'/)
    expect(screen).toMatch(/const isWideDetail = layoutMode === 'wide'/)
    // The old inline formula. Its return would silently re-introduce the
    // landscape drawer on a phone the resolver now sends to the rail.
    expect(screen).not.toMatch(/fullscreen \|\| \(isLandscape && !isWideDetail\)/)
  })

  it('the landscape drawer is still mounted for the surfaces that FILL', () => {
    // Small phones in landscape and explicit fullscreen keep it — deleting it
    // with the phone-landscape change would leave them with no timeline at all.
    // It moved from the SCREEN into the timeline when the timeline took over
    // the column; what must not change is that `fill` still gets a drawer.
    expect(timeline).toMatch(/<LandscapeTimelineOverlay/)
  })
})
