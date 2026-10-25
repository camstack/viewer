import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * The speed menu must not open into the clip's own progress track, nor paint
 * beneath it.
 *
 * Operator, 2026-09-22: *"il selettore di velocità … renderizza sotto la barra
 * di seek"*. Two causes, and the second is the one that makes this a spec
 * rather than a one-line style change:
 *
 *  - the menu was `top: '100%'` — it opened DOWNWARD, which on a bar pinned to
 *    the bottom of the frame is straight into the clip's progress track;
 *  - `container` already carried `zIndex: 15` for exactly this class of bug,
 *    with a comment saying so. That rank beats the BODY, a later sibling
 *    OUTSIDE the container. `ClipProgressBar` is a later sibling INSIDE it,
 *    added when the clip transport was built, and the existing defence never
 *    reached it.
 *
 * A rank that was fixed once and then out-scoped by a new sibling is the shape
 * this pins: the ANCHOR carries its own, above anything the container holds.
 *
 * Structural, because this is a React Native stacking question: what matters
 * is the declared rank and direction, not what a jsdom renderer would say.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, '..', 'TimelinePlaybackBar.tsx'), 'utf8')
/** The menu itself lives in the popover; the bar keeps the anchor. On web it
 *  is portalled out of the bar altogether (`popover-placement.spec.ts`); the
 *  rules below are the in-bar (native) menu's. */
const popover = readFileSync(path.join(here, '..', 'PlaybackBarPopover.tsx'), 'utf8')

/** The body of a named entry in the `StyleSheet.create({ … })` block. */
function styleBlock(name: string, from: string = source): string {
  const at = from.indexOf(`  ${name}: {`)
  expect(at, `no style named ${name}`).toBeGreaterThan(-1)
  return from.slice(at, from.indexOf('\n  },', at))
}

describe('the speed menu stacks above the clip track, and opens away from it', () => {
  it('opens UPWARD', () => {
    const menu = styleBlock('inlineMenu', popover)
    expect(menu).toContain("bottom: '100%'")
    expect(menu).not.toContain("top: '100%'")
  })

  it('leaves its gap on the side it actually opens from', () => {
    // `marginTop` was the gap for a downward menu; kept, it would put the
    // space on the far side and let the menu touch the chip it hangs off.
    expect(popover).toContain('marginBottom: ui.space.xs')
    expect(popover).not.toContain('marginTop: ui.space.xs')
  })

  it('the ANCHOR outranks the clip progress track, not just the body', () => {
    // The container's rank is for siblings outside it. `ClipProgressBar`
    // renders inside, after the transport row, so only a rank on the anchor
    // puts the menu on top of it.
    const anchor = styleBlock('speedAnchor')
    const container = styleBlock('container')
    const rank = (block: string, key: string): number => {
      const m = block.match(new RegExp(key + ': (\\d+)'))
      return m ? Number(m[1]) : 0
    }
    expect(rank(anchor, 'zIndex')).toBeGreaterThan(rank(container, 'zIndex'))
    // Android needs `elevation` too — `zIndex` alone does not reorder there.
    expect(rank(anchor, 'elevation')).toBe(rank(anchor, 'zIndex'))
  })

  it('the clip track really is a later sibling inside the container', () => {
    // The premise of the two assertions above. If the progress bar ever moves
    // out of this component, the anchor's rank is no longer load-bearing and
    // whoever moved it should read this spec.
    const rowEnd = source.indexOf("{/* The clip's own track")
    expect(rowEnd, 'the clip track comment moved — re-check the stacking').toBeGreaterThan(-1)
    expect(source.indexOf('styles.speedAnchor')).toBeLessThan(rowEnd)
  })
})
