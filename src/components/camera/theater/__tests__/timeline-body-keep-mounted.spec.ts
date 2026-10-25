import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A panel that opens over the timeline must never UNMOUNT it.
 *
 * The body used to be a ternary — panel OR timeline — so opening a track's
 * cluster detail (or any of the twelve panels) threw away the scroller's
 * scroll offset, the measured viewport and every thumb already decoded, and
 * closing it snapped the operator back to the live edge. Operator verbatim:
 * "l'apertura di una traccia fa perdere lo stato della timeline, tutti i
 * pannelli che si aprono sulla timeline non devono smontarla".
 *
 * The contract, asserted on the source because no rendered-tree test can
 * mount these at the sizes that matter (see panels-own-the-body.spec):
 *
 *  • the timeline layer renders UNCONDITIONALLY; the panel is an absolute
 *    overlay stacked on top of it (opaque host, so nothing shows through);
 *  • the covered timeline is frozen (`FreezeWhileCovered`) — instance and
 *    state survive, reconciliation stops while nobody can see it;
 *  • the covered layer takes no touches.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('a panel covers the timeline — it does not replace it', () => {
  const timeline = read('components/camera/theater/TheaterTimeline.tsx')

  it('the timeline layer is unconditional and the panel is the overlay', () => {
    // The base layer (TimelineView) must appear BEFORE the conditional panel
    // overlay in the body stack.
    const viewAt = timeline.indexOf('<TimelineView')
    const panelAt = timeline.indexOf('<TimelineBodyPanel')
    expect(viewAt).toBeGreaterThan(-1)
    expect(panelAt).toBeGreaterThan(-1)
    expect(viewAt).toBeLessThan(panelAt)
    // The old shape — panel OR timeline — must not come back.
    expect(timeline).not.toMatch(/body\.kind === 'panel'\s*\?\s*\(\s*<TimelineBodyPanel/)
    // The overlay layer is absolute, on top of the always-mounted timeline.
    expect(timeline).toContain('<View style={styles.panelLayer}>')
    expect(timeline).toMatch(
      /panelLayer:\s*\{\s*position: 'absolute',\s*top: 0,\s*left: 0,\s*right: 0,\s*bottom: 0,\s*\}/,
    )
  })

  it('the covered timeline is frozen, not unmounted', () => {
    // Two covers now, one rule: a panel over the body, and the grid page's
    // clock button hiding the whole chrome (2026-09-02). Both keep the subtree
    // MOUNTED and stop reconciling it; neither may unmount it.
    expect(timeline).toContain('<FreezeWhileCovered frozen={panelOpen || chromeHidden}>')
  })

  it('the covered layer takes no touches', () => {
    expect(timeline).toContain("pointerEvents={panelOpen ? 'none' : 'auto'}")
  })
})
