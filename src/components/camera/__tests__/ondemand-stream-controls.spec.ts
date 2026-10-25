/**
 * The on-demand window's own picture carries the STREAM's controls — and
 * carries the app's, not a second set.
 *
 * The operator drives this overlay on a phone and asked for the audio, the
 * microphone and PiP it already has on the single-camera screen. The rule that
 * decides HOW is D62: a knob that disagrees with the one that owns the
 * function is worse than no knob. So every one of them is the same definition
 * (`stream-control-items.ts`), painted by the same cluster component
 * (`OverlayDiscGroup`), fed by the same session hooks (`useIntercom`,
 * `useSystemPip`). This window owns the LAYOUT decision and nothing else.
 *
 * Source text, because every claim here is about what this file REUSES. A
 * second copy would satisfy any behavioural test and still be the defect.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveOnDemandOnFocus } from '../../../live/ondemand-player.js'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
const PLAYER = 'src/components/camera/OnDemandPlayer.tsx'

describe('the window paints the shared disc cluster, not header buttons', () => {
  const src = read(PLAYER)

  it('mounts `OverlayDiscGroup` — the app\'s one on-video cluster', () => {
    expect(src).toContain('<OverlayDiscGroup')
    // Smaller, because the picture is 144pt tall on the narrowest panel. A
    // SIZE, not a second component.
    expect(src).toContain('discSize={ONDEMAND_DISC_SIZE}')
  })

  it('takes its mute / talk / PiP definitions from the shared builder', () => {
    expect(src).toContain("from './stream-control-items.js'")
    expect(src).toContain('muteDisc(')
    expect(src).toContain('talkDisc(')
    expect(src).toContain('systemPipDisc(')
  })

  it('keeps no hand-rolled audio button in its header', () => {
    expect(src).not.toContain("t(muted ? 'v2.gridView.cellAudioOn'")
  })
})

describe('talk-back and PiP are the shipped sessions, not new ones', () => {
  const src = read(PLAYER)

  it('drives the same intercom hook the single-camera screen drives', () => {
    expect(src).toContain("from '../../live/use-intercom.js'")
    expect(src).toContain('useIntercom(request.deviceId)')
  })

  it('asks for PiP through the shared sequence, which both surfaces now use', () => {
    expect(src).toContain("from '../../live/use-system-pip.js'")
    expect(src).toContain('useSystemPip(')
    expect(read('src/screens/CameraDetailScreen.tsx')).toContain('useSystemPip(')
  })

  it('and the PiP button is honest: the window HAS a LiveViewHandle', () => {
    // `startPip()` is on the handle this player already holds — the same
    // handle the screen's disc drives. A button that could not be wired would
    // be the padlock defect again.
    expect(read('src/live/live-view-types.ts')).toContain('startPip()')
    expect(src).toContain('liveRef.current?.startPip()')
  })

  it('the talk failure is surfaced, never swallowed', () => {
    expect(src).toContain('talkError')
    expect(src).toContain('notice(')
  })
})

describe('the resize grip wears the app\'s affordance tokens', () => {
  const src = read(PLAYER)

  it('is no longer the FULLSCREEN glyph — that sign is taken', () => {
    // `Maximize2` is what the single-camera screen's fullscreen disc wears
    // (`StreamOverlayControls`). On a resize grip it names the wrong action.
    expect(read('src/components/camera/StreamOverlayControls.tsx')).toContain('Maximize2')
    expect(src).not.toContain('Maximize2')
    expect(src).toContain('MoveDiagonal2')
  })

  it('uses the icon-button shape and the theme\'s own colours', () => {
    const handle = src.slice(src.indexOf('resizeHandle: {'))
    const block = handle.slice(0, handle.indexOf('},'))
    expect(block).toContain('borderRadius: RADIUS.md')
    expect(block).toContain('colors.surface')
    expect(block).toContain('colors.border')
    // A bespoke single-corner notch was the old look.
    expect(block).not.toContain('borderTopLeftRadius')
  })
})

/**
 * JOB 3. Opening the camera full screen needs no closing code HERE: the
 * arrival on the camera's own screen is what takes it out of the overlay, and
 * that rule already exists.
 */
describe('the open-camera button routes, and nothing else', () => {
  const src = read(PLAYER)

  it('pushes the camera detail route', () => {
    expect(src).toContain('router.push(`/camera/${request.deviceId}`)')
    expect(src).toContain('v2.onDemandPlayer.openCamera')
  })

  it('does not close the overlay itself — the focus rule already does', () => {
    expect(resolveOnDemandOnFocus({ deviceId: 7, atMs: 1 }, 7)).toBeNull()
    expect(resolveOnDemandOnFocus({ deviceId: 7, atMs: 1 }, 8)).not.toBeNull()
    expect(read('src/screens/CameraDetailScreen.tsx')).toContain('focusOnDemandCamera(deviceId)')
  })
})
