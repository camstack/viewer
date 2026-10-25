import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The linked-devices button exists where it is unambiguous: one camera.
 *
 * It was removed from the timeline toolbar on 2026-09-02, deliberately and with
 * a good reason: that bar aggregates every camera in the view, so a control
 * that quietly acted on one of six — whichever happened to be in the picture —
 * is worse than no control. The removal noted that these controls "already live
 * where they are unambiguous, on the single stream".
 *
 * They do not. Those surfaces are the SHELF and the WALL TILE, both of which
 * pass `onCellPanel`; the single-camera player mounts neither, so after the
 * grid rework the operator had no way to reach a camera's linked devices at all.
 *
 * The fix follows the pattern the same decision established rather than
 * reverting it: `TimelineSingleCameraBindings` is the group of controls that
 * exist ONLY when the surface is one camera — the quality chip and the
 * view-options menu already work this way, and a bar over a wall renders
 * neither because the callbacks are absent. Linked devices joins that group,
 * so a wall still shows no button and a single camera does.
 */
const HERE = __dirname
const BODY_PANEL = readFileSync(join(HERE, '..', 'TimelineBodyPanel.tsx'), 'utf-8')
const TOOLBAR = readFileSync(join(HERE, '..', 'TimelineToolbarInline.tsx'), 'utf-8')
const THEATER = readFileSync(join(HERE, '..', 'TheaterTimeline.tsx'), 'utf-8')
const SCREEN = readFileSync(join(HERE, '..', '..', '..', '..', 'screens', 'CameraDetailScreen.tsx'), 'utf-8')

describe('linked devices on the single-camera player', () => {
  it('is declared in the SINGLE-CAMERA binding group, not on the shared bar', () => {
    const group = BODY_PANEL.slice(
      BODY_PANEL.indexOf('export interface TimelineSingleCameraBindings'),
      BODY_PANEL.indexOf('export interface TimelineBodyPanelProps'),
    )
    expect(group).toContain('onOpenLinkedDevices')
  })

  it('is OPTIONAL, so a wall renders no button rather than a disabled one', () => {
    const group = BODY_PANEL.slice(
      BODY_PANEL.indexOf('export interface TimelineSingleCameraBindings'),
      BODY_PANEL.indexOf('export interface TimelineBodyPanelProps'),
    )
    expect(group).toMatch(/onOpenLinkedDevices\?:/)
  })

  it('the toolbar draws it only when the callback is supplied', () => {
    expect(TOOLBAR).toContain('onOpenLinkedDevices')
  })

  it('the single-camera screen supplies it, so the button comes back', () => {
    expect(SCREEN).toContain('onOpenLinkedDevices')
  })
})

/**
 * The three defects the operator reported on 2026-09-04, each pinned by the
 * property that was actually wrong rather than by the presence of a name.
 *
 * The tests above assert SOURCE TEXT. They passed the whole time the button was
 * invisible-when-pressed, unlit, and wired to a provider that never ran — which
 * is precisely what a source-text assertion cannot see. These do not replace
 * them; they cover what they could not.
 */
describe('the toolbar chip acknowledges its panel', () => {
  it('takes the open state as a prop instead of hardcoding false', () => {
    // Every other chip on the bar derives `active` from the timeline's panel
    // union. This one's panel is hosted outside the timeline, so the state has
    // to arrive as a prop — it was `iconBtn(false)` / hardcoded selected={false},
    // making it the one control that never acknowledged a press. Glass capsules
    // use `selected=` instead of `iconBtn(…)`.
    expect(TOOLBAR).toMatch(/selected=\{props\.linkedDevicesOpen === true\}/)
    expect(TOOLBAR).not.toMatch(/selected=\{false\}/)
  })

  it('is fed from the SAME state the host renders from', () => {
    // "Lit" and "open" must not be able to disagree.
    expect(SCREEN).toMatch(/linkedDevicesOpen:\s*shelfPanel\?\.kind === 'devices'/)
  })
})

describe('the portrait toolbar is inside the scale provider', () => {
  it('wraps the stack-shape toolbar, not only fill and wide', () => {
    // The density setting moves a number that only the provider reads. `fill`
    // and `wide` wrapped their toolbar; `stack` — the ordinary portrait player
    // — did not, so choosing medium or large changed nothing on screen.
    const stackBranch = THEATER.slice(
      THEATER.indexOf("shape === 'stack' ? ("),
      THEATER.indexOf("index 1 — THE STREAM SLOT"),
    )
    // Via `MeasuredTimelineScale`, which provides the scale from the width it
    // MEASURES. The claim is unchanged: the stack toolbar is inside a
    // provider, so the density setting reaches the tokens it sizes from.
    expect(stackBranch).toContain('MeasuredTimelineScale')
    expect(stackBranch).toContain('density={toolbarDensity}')
  })
})
