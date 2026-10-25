import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  drawerWidth,
  drawerPanelBox,
  DRAWER_OVERLAY_Z,
} from '../landscape-drawer-geometry.js'

describe('landscape timeline drawer geometry', () => {
  it('leaves most of a landscape screen to the video', () => {
    // The operator's complaint was that 46% "covers too much stream". A third
    // is the target; assert it stays comfortably under 40% on real widths.
    for (const w of [844, 926, 932, 1180, 1366]) {
      expect(drawerWidth(w) / w).toBeLessThan(0.4)
    }
  })

  it('clamps at both ends instead of scaling without limit', () => {
    expect(drawerWidth(400)).toBe(240) // floor — controls would wrap below this
    expect(drawerWidth(4000)).toBe(340) // ceiling — no half-screen panel on a tablet
  })

  it('never returns a width wider than the window itself', () => {
    expect(drawerWidth(200)).toBeLessThanOrEqual(200)
  })

  it('degrades to the floor on a nonsense width rather than NaN', () => {
    expect(drawerWidth(Number.NaN)).toBe(240)
    expect(drawerWidth(0)).toBe(240)
  })
})

/**
 * THE BLACK COLUMN — reported four rounds running, and each round the
 * safe-area inset was moved rather than removed.
 *
 * The panel is anchored `right: 0` and paints an opaque scrim over the video.
 * Every version before 2026-08-08 ALSO reserved `insets.right` inside it: first
 * as `paddingRight` taken out of the content (the content ended 59pt short of
 * the edge), then by widening the panel by the same amount and keeping the
 * padding, which changed how much timeline you got but not the fact that the
 * rightmost 59pt of the drawer was scrim with nothing on it.
 *
 * The rule stands: THE PANEL RESERVES NOTHING HORIZONTALLY. Its content width IS
 * its panel width. The notch overlaps a narrow band of the timeline's right edge
 * — which the operator asked for, in preference to the band.
 */
describe('the panel paints nothing its content does not fill', () => {
  it.each([844, 926, 932, 1180])('content fills the whole panel (%ipt window)', (windowWidth) => {
    const box = drawerPanelBox(windowWidth)
    expect(box.contentWidth).toBe(box.panelWidth)
    expect(box.panelWidth).toBe(drawerWidth(windowWidth))
  })
})

/**
 * THE OVERLAY-BUTTON TRIGGER — 2026-08-22, then 2026-08-23.
 *
 * The closed-state affordance used to be a vertical tab on the RIGHT edge
 * (vanished in the notch), then a sibling disc that sat after mute/talk via
 * `overlayTogglePlacement`. That sibling never received `controlsVisible`, so
 * tap-to-hide chrome left History on screen (operator, landscape mobile).
 *
 * History is now just another left-cluster item of `OverlayDiscGroup`. The
 * drawer owns the PANEL only. Placement is the flex row; there is no second
 * origin to keep in sync, and no leftover placement helper.
 */
describe('the history trigger lives in the overlay group', () => {
  it('the drawer never out-ranks the picture: overlay > stream slot', () => {
    // The drawer was once mounted and painted UNDER the opaque video box.
    expect(DRAWER_OVERLAY_Z).toBeGreaterThan(50)
  })

  it('the placement helper is gone — a second origin is the defect', () => {
    const geometry = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'landscape-drawer-geometry.ts'),
      'utf8',
    )
    expect(geometry).not.toContain('overlayTogglePlacement')
    expect(geometry).not.toContain('DRAWER_TOGGLE_Z')
    expect(geometry).not.toContain('TOGGLE_SIZE')
    expect(geometry).not.toContain('TOGGLE_GAP')
  })
})

/**
 * The component must not reintroduce a horizontal inset behind the geometry's
 * back — the whole black-column defect was a `paddingRight` that no pure test
 * could see. The history disc is no longer this module's business.
 */
describe('the overlay component takes its horizontal geometry from this module', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'components', 'camera', 'theater', 'LandscapeTimelineOverlay.tsx'),
    'utf8',
  )

  it('reads the panel box instead of composing widths inline', () => {
    expect(src).toContain('drawerPanelBox(winW)')
  })

  it('reserves NO horizontal safe-area on the panel', () => {
    expect(src).not.toContain('paddingRight')
    expect(src).not.toContain('paddingLeft')
    // The inset may only reach the layout THROUGH the helpers. A style property
    // fed the raw inset is the black column coming back, whatever it is called
    // this time.
    expect(src).not.toMatch(
      /(paddingRight|paddingLeft|paddingHorizontal|marginRight|marginLeft|width|right)\s*:\s*[^,\n}]*insets\.(right|left)/,
    )
  })

  it('owns the panel only — no right-edge tab, no sibling disc', () => {
    expect(src).not.toContain('overlayTogglePlacement')
    expect(src).not.toContain('toggleTranslateClosed')
    expect(src).not.toContain("top: '50%'")
    expect(src).not.toContain('History')
    expect(src).not.toContain('Pressable')
  })
})

describe('mute and talk sit on the same inset origin as the history disc', () => {
  const group = readFileSync(
    join(process.cwd(), 'src', 'components', 'camera', 'OverlayDiscGroup.tsx'),
    'utf8',
  )
  const screen = readFileSync(
    join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'),
    'utf8',
  )

  it('the overlay cluster takes an edge pad instead of a hardcoded SPACING.md origin', () => {
    // A hardcoded `left: SPACING.md, bottom: SPACING.md` is the un-inset
    // origin. History in a sibling then looks higher and further right.
    expect(group).toContain('edgePad')
    expect(group).toMatch(/left:\s*\(?edgePad/)
    expect(group).toMatch(/bottom:\s*\(?edgePad/)
    expect(group).not.toMatch(/bottomLeft:\s*\{[^}]*left:\s*SPACING\.md/)
  })

  it('fill mode feeds the overlay the same safe-area insets the history disc uses', () => {
    expect(screen).toContain('edgePad={')
    expect(screen).toMatch(/edgePad=\{fill \?/)
    expect(screen).toContain('insets.left')
    expect(screen).toContain('insets.bottom')
  })
})
