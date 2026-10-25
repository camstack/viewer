import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The on-video discs are ONE group. Every disc — mute, talk, history,
 * play/pause, PiP, fullscreen — hides, reappears, auto-hides and re-arms
 * from the same `visible` / `onRequestHide` / `edgePad` inputs.
 *
 * History used to be a sibling Pressable in `LandscapeTimelineOverlay` that
 * never received `controlsVisible`. Tap-to-hide chrome left it on screen
 * while the others vanished (operator, landscape mobile, 2026-08-23).
 */

const CAMERA = join(process.cwd(), 'src', 'components', 'camera')
const SCREEN = join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx')
const GROUP = join(CAMERA, 'OverlayDiscGroup.tsx')
const OVERLAY = join(CAMERA, 'StreamOverlayControls.tsx')
const DRAWER = join(CAMERA, 'theater', 'LandscapeTimelineOverlay.tsx')
const THEATER = join(CAMERA, 'theater', 'TheaterTimeline.tsx')

const read = (file: string): string => readFileSync(file, 'utf8')

describe('OverlayDiscGroup is the single on-video disc cluster', () => {
  it('exists as its own presentational component', () => {
    expect(existsSync(GROUP)).toBe(true)
  })

  it('unmounts the whole group when hidden — no leftover disc', () => {
    const src = read(GROUP)
    expect(src).toMatch(/if\s*\(\s*!visible\s*\)\s*return\s+null/)
    expect(src).toContain('readonly visible:')
    expect(src).toContain('readonly items:')
    expect(src).toContain('OverlayDiscCluster')
    expect(src).toContain("readonly cluster: OverlayDiscCluster")
  })

  it('auto-hides and re-arms from one timer, for every disc', () => {
    const src = read(GROUP)
    expect(src).toContain('onRequestHide')
    expect(src).toContain('AUTO_HIDE_MS')
    expect(src).toContain('holdOpen')
    // A press on ANY disc re-arms. A second timer in a sibling is how
    // History used to stay up after the others had asked to hide.
    expect(src).toMatch(/setTimeout\(\s*onRequestHide/)
  })

  it('the stream overlay is a composer, not a second hide path', () => {
    const overlay = read(OVERLAY)
    expect(overlay).toContain('<OverlayDiscGroup')
    expect(overlay).toContain('timelineToggle')
    expect(overlay).not.toMatch(/if\s*\(\s*!visible\s*\)\s*return\s+null/)
  })

  it('history is just another configured left-cluster disc', () => {
    const overlay = read(OVERLAY)
    expect(overlay).toContain('timelineDockDisc')
    expect(overlay).toContain("cluster: 'left'")
    expect(overlay).toMatch(/timelineToggle/)
  })
})

describe('the landscape drawer no longer owns a forever-visible toggle', () => {
  it('the drawer has no History disc and no overlayTogglePlacement', () => {
    const src = read(DRAWER)
    expect(src).not.toContain('History')
    expect(src).not.toContain('overlayTogglePlacement')
    expect(src).not.toContain('hasTwoWayAudio')
    expect(src).not.toContain('Pressable')
  })

  it('the drawer is controlled — open comes from the parent', () => {
    const src = read(DRAWER)
    expect(src).toContain('readonly open:')
    expect(src).not.toMatch(/useState\s*\(\s*false\s*\)/)
  })

  it('TheaterTimeline feeds the drawer the parent-owned expanded flag', () => {
    const src = read(THEATER)
    expect(src).toMatch(/open=\{props\.drawerExpanded/)
    expect(src).not.toContain('hasTwoWayAudio={')
  })
})

describe('fill mode configures the group; portrait does not', () => {
  it('the screen hands the group a timeline toggle only while fill', () => {
    const src = read(SCREEN)
    expect(src).toMatch(/timelineToggle=\{fill \?/)
    expect(src).toContain('drawerExpanded={landscapeDrawerOpen}')
  })
})
