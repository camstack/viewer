/**
 * The side navigation is not the tab navigator's private property.
 *
 * ## The report this closes (operator, 2026-08-20)
 *
 * "On large landscape screens (tablet and web) the side navigation must stay
 * visible ALWAYS, including in the single-camera view. Today it hides there."
 *
 * ## Why it hid
 *
 * `camera/[id]` is a STACK route pushed OVER the tabs (`app/(app)/_layout.tsx`),
 * so it is not inside `<Tabs>` at all and never saw the rail that lived inside
 * `TabsNavigator`. The rail moved to `SideNavRail`, the destinations to
 * `nav-items.ts`, and the detail screen mounts the same component under the same
 * `useSidebarLayout()` gate.
 *
 * What must NOT regress: deliberate fullscreen. The detail's `fill` layout mode
 * (explicit fullscreen, or a phone in landscape) still owns the whole window,
 * and on web the browser Fullscreen API elevates an element that does not
 * contain the rail — so that path needs no rule of its own.
 *
 * Source guards, because this repo has no way to drive a rotation or a browser
 * resize through a renderer: what they pin is the WIRING, which is exactly what
 * was missing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { activeNavSegment, isItemActive, navItems } from '../nav-items.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8')
}

describe('the side rail has ONE definition', () => {
  it('the tab navigator renders the shared rail rather than its own copy', () => {
    const src = read('src/navigation/TabsNavigator.tsx')
    expect(src).toContain('SideNavRail')
    // The hand-written rail is gone: no second BlurView with its own item list.
    expect(src).not.toContain('styles.sidebarItem')
    expect(src).not.toContain('const navItems')
  })

  it('the camera detail mounts the SAME rail', () => {
    const src = read('src/screens/CameraDetailScreen.tsx')
    expect(src).toContain("import { SideNavRail } from '../navigation/SideNavRail.js'")
    expect(src).toContain('<SideNavRail')
    // Gated on the app-wide rule, never a second breakpoint invented here.
    expect(src).toContain('useSidebarLayout()')
  })

  it('keeps deliberate fullscreen able to hide it', () => {
    const src = read('src/screens/CameraDetailScreen.tsx')
    // `fill` is explicit fullscreen OR a phone in landscape — the two cases
    // where the picture owns the window. The rail is gated on it.
    expect(src).toContain('showSideNav && !fill')
    // And it sits OUTSIDE the element the web Fullscreen API elevates, which is
    // what makes the browser path free.
    const railAt = src.indexOf('<SideNavRail')
    const fullscreenElementAt = src.indexOf('ref={fullscreenRef}')
    expect(railAt).toBeGreaterThan(0)
    expect(railAt).toBeLessThan(fullscreenElementAt)
  })
})

describe('activeNavSegment', () => {
  it('lights the tab a top-level route belongs to', () => {
    for (const item of navItems) {
      expect(activeNavSegment(item.segment)).toBe(item.segment)
    }
  })

  it('lights Cameras while a single camera is open', () => {
    // Without this the rail on the detail highlights nothing, which reads as
    // "you are nowhere" on the screen the operator spends the most time in.
    expect(activeNavSegment('/camera/102')).toBe('/cameras')
    expect(activeNavSegment('/grid/4')).toBe('/grids')
    expect(activeNavSegment('/grid/4/edit')).toBe('/grids')
  })

  it('lights nothing for a route that belongs to no destination', () => {
    expect(activeNavSegment('/login')).toBeNull()
  })

  it('does not confuse a sibling segment for a nested one', () => {
    expect(isItemActive('/cameras-archive', '/cameras')).toBe(false)
    expect(isItemActive('/cameras/manage', '/cameras')).toBe(true)
  })
})

describe('leaving a stacked detail does not stack another overlay', () => {
  it('the rail on a detail route dismisses to the tab, it does not navigate', () => {
    // Camera detail is `containedTransparentModal`. `router.navigate('/grids')`
    // from that stack PUSHES a second tab navigator on top of the camera — an
    // overlay over the app, and then the grid wall is a third overlay on top
    // of that (tablet report, 2026-08-23). `dismissTo` pops back to the
    // already-mounted `(tabs)` route, same as `backToCameras`.
    const src = read('src/navigation/SideNavRail.tsx')
    expect(src).toContain('router.dismissTo(item.href)')
    expect(src).not.toContain('router.navigate(item.href)')
  })
})
