import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldShowOverlayPlayPause } from '../overlay-play-pause.js'
import { resolveClipsSurface } from '../../../clips/clips-surface.js'

/**
 * Overlay play/pause is a FILL-only transport. The playback bar already
 * carries play/pause whenever it is on screen (portrait, wide, or fill with
 * the landscape drawer open). Two play buttons over the same stream was the
 * operator's report; hiding the overlay one while the bar is visible is the
 * fix. Fill with the drawer CLOSED still needs the overlay — that is the
 * only time the bar is off-screen.
 */

describe('shouldShowOverlayPlayPause', () => {
  it('hides the overlay control in portrait / wide (bar is docked)', () => {
    expect(shouldShowOverlayPlayPause({ fill: false, landscapeDrawerOpen: false })).toBe(false)
    expect(shouldShowOverlayPlayPause({ fill: false, landscapeDrawerOpen: true })).toBe(false)
  })

  it('shows the overlay control in fill while the drawer is closed', () => {
    expect(shouldShowOverlayPlayPause({ fill: true, landscapeDrawerOpen: false })).toBe(true)
  })

  it('hides the overlay control in fill once the drawer (and its bar) is open', () => {
    expect(shouldShowOverlayPlayPause({ fill: true, landscapeDrawerOpen: true })).toBe(false)
  })
})

describe('the overlay play/pause is parent-gated', () => {
  const overlay = readFileSync(
    join(process.cwd(), 'src/components/camera/StreamOverlayControls.tsx'),
    'utf8',
  )
  const screen = readFileSync(
    join(process.cwd(), 'src/screens/CameraDetailScreen.tsx'),
    'utf8',
  )

  it('the overlay accepts a showPlayPause gate rather than always drawing the disc', () => {
    expect(overlay).toContain('readonly showPlayPause:')
    expect(overlay).toMatch(/showPlayPause\s*(\?|&&)/)
  })

  it('the screen feeds the gate from shouldShowOverlayPlayPause', () => {
    expect(screen).toContain('shouldShowOverlayPlayPause')
    expect(screen).toContain('showPlayPause={')
  })
})

/**
 * A held battery camera always has a way to be woken — and since D606 the ONE
 * thing that guarantees it is that the playback band is drawn on every
 * surface.
 *
 * The history: the operator, after go-live finally left a clip — *"il go live
 * si va bene lo still, ma non è più presente a quel punto il tasto di play
 * manuale per svegliare la camera"*. The native clips surface withdrew the
 * transport band, and outside `fill` the band is the only other play, so that
 * camera had poster, no disc, no band, no way in. A `batteryHold`
 * short-circuit was added HERE, which made the same stopped camera show a disc
 * on the stream in one mode and a bar in another — *"È inconsistente."*
 *
 * The short-circuit is gone and its precondition is pinned instead: no surface
 * may withdraw the band. If one ever does, this fails on the day it is written
 * rather than on the day a battery camera cannot be started.
 */
describe('the disc is a layout question because the BAND is unconditional', () => {
  it('every clips surface keeps the transport band', () => {
    for (const clipsMode of [false, true]) {
      for (const derivation of ['derived', 'cap'] as const) {
        for (const clipHeld of [false, true]) {
          expect(
            resolveClipsSurface({ clipsMode, derivation, clipHeld }).transport,
            `${String(clipsMode)}/${derivation}/held=${String(clipHeld)}`,
          ).toBe(true)
        }
      }
    }
  })

  it('the gate reads only the two LAYOUT facts — no camera state', () => {
    // A third parameter here is how the inconsistency came back last time: the
    // rule is about WHERE the bar is, never about what the camera is doing.
    //
    // Comments STRIPPED first — the docblock explaining the deletion names the
    // battery hold, and a scan that reads prose would pass forever on the
    // explanation of the thing it is looking for.
    const rule = readFileSync(
      join(process.cwd(), 'src/screens/camera-detail/overlay-play-pause.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(rule).toMatch(/readonly fill: boolean/)
    expect(rule).toMatch(/readonly landscapeDrawerOpen: boolean/)
    // `\??:` — an OPTIONAL field is exactly how the state argument came back
    // last time, and a pattern that only matches required ones counts two and
    // passes with the third in place. This test was vacuous under its own
    // revert until that was fixed.
    expect(rule.match(/readonly \w+\??:/g)).toHaveLength(2)
  })
})
