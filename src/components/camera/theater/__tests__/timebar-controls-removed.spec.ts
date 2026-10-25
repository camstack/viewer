/**
 * What the timebar is allowed to carry now that it belongs to a VIEW.
 *
 * The operator removed four controls on 2026-09-02 — PTZ, the linked-devices
 * panel, and the capture menu (snapshot + recording export) — because the
 * timeline under this bar aggregates every camera in the view, and a per-camera
 * control on a per-view bar acts on whichever camera happens to be in the
 * picture without saying so.
 *
 * Two halves of the same claim, and neither is enough alone:
 *
 *  - the BUTTONS are gone from the bar (a source check, because a control
 *    nobody renders is invisible to a mount test);
 *  - the PANELS they opened are gone from the union, so nothing else can reach
 *    them either. This is the half that survives someone re-adding a button:
 *    the type system refuses the panel kind.
 *
 * And the mirror claim: what STAYED has to act on every camera, which is
 * `workspace-playback.spec.ts` by value plus the wiring assert below.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (...parts: readonly string[]): string =>
  readFileSync(join(SRC, ...parts), 'utf8')

const TOOLBAR = read('components', 'camera', 'theater', 'TimelineToolbarInline.tsx')
const LAYOUT = read('components', 'camera', 'theater', 'timeline-layout.ts')
const BODY = read('components', 'camera', 'theater', 'TimelineBodyPanel.tsx')
const SCREEN = read('screens', 'CameraDetailScreen.tsx')

describe('a per-camera control appears only where there IS one camera', () => {
  /**
   * Revised 2026-09-04. The 2026-09-02 removal took FOUR controls off this bar
   * because the bar belongs to a VIEW, and a per-camera control on a per-view
   * bar acts on whichever camera happens to be in the picture without saying
   * so. That reasoning stands and is asserted below — what changed is that the
   * single-camera player mounts this same bar, and there the controls have
   * exactly one camera to mean. The operator lost PTZ and linked devices from
   * the player entirely, which the removal had assumed were covered elsewhere.
   *
   * So the claim is no longer "absent" but "GATED": the callback is the gate,
   * and a bar over a wall supplies none, so it draws none. The capture menu and
   * the export panel stay removed — nothing brought them back.
   */
  it('PTZ and linked devices are drawn only when a callback is supplied', () => {
    for (const gate of ['props.onOpenPtz ?', 'props.onOpenLinkedDevices ?']) {
      expect(TOOLBAR, gate).toContain(gate)
    }
  })

  it('and the theater supplies them only for a single camera', () => {
    const THEATER = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(THEATER).toContain('onOpenLinkedDevices={singleCamera ? toggleLinkedDevices : undefined}')
    // PTZ carries a second gate: the camera must HAVE the feature.
    // ...or a drive: the robot camera has `navigation` and no PTZ, and drew no chip (2026-09-06).
    expect(THEATER).toMatch(
      /onOpenPtz=\{\s*singleCamera && \(props\.deviceBinding\.hasPtz \|\| props\.deviceBinding\.hasNavigation\)/,
    )
  })

  it('their active state is DERIVED from the one panel union, like every other chip', () => {
    const THEATER = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(THEATER).toContain("linkedDevicesOpen={panel?.kind === 'linkedDevices'}")
    expect(THEATER).toContain("ptzOpen={panel?.kind === 'ptz'}")
  })

  it('the capture menu and the export panel stay gone', () => {
    for (const prop of [
      'exportMenuOpen',
      'onToggleExportMenu',
      'exportMenuLabel',
      'snapshotBusy',
    ]) {
      expect(TOOLBAR, prop).not.toContain(`readonly ${prop}`)
    }
    for (const icon of ['LayoutGrid', 'Camera']) {
      expect(TOOLBAR, icon).not.toMatch(new RegExp(`\\b${icon}\\b`))
    }
    for (const kind of ['captureActions', 'export']) {
      expect(LAYOUT, kind).not.toContain(`'${kind}'`)
      expect(BODY, kind).not.toContain(`case '${kind}':`)
    }
    for (const file of ['TimelineCapturePanel.tsx', 'TimelineExportPanel.tsx']) {
      expect(() => read('components', 'camera', 'theater', file), file).toThrow()
    }
  })
})

describe('what stayed acts on every camera in the view', () => {
  it('the screen hands the timeline the fanned-out transport, not the bare handlers', () => {
    for (const prop of [
      'onSeek={wallPlayback.onSeek}',
      'onScrubBegin={wallPlayback.onScrubBegin}',
      'onScrubMove={wallPlayback.onScrubMove}',
      'onScrubCommit={wallPlayback.onScrubCommit}',
      'onGoLive={wallPlayback.onGoLive}',
      'onTogglePlayPause={wallPlayback.onTogglePlayPause}',
      'onSelectRate={wallPlayback.onSelectRate}',
    ]) {
      expect(SCREEN, prop).toContain(prop)
    }
  })

  it('the fan-out is built from the SAME handlers that drive the picture', () => {
    // Not a second transport: the wrapper wraps, and the playback machine stays
    // the one owner of the playhead.
    expect(SCREEN).toContain('fanOutPlaybackToWall({')
    expect(SCREEN).toContain('broadcast: gridPlaybackBus.broadcast')
  })

  it('the charge and the link stay in the toolbar as glyphs, and the day arrows are gone for the camera switch (operator, 2026-10-17)', () => {
    expect(TOOLBAR).toContain('<BatteryBadge battery={props.battery} colors={colors} size={ICON} compact neutral="foreground" />')
    expect(TOOLBAR).toContain('<NetworkLinkBadge link={props.networkLink} colors={colors} size={ICON} compact neutral="foreground" />')
    expect(TOOLBAR).not.toContain('onPrevDay')
    expect(TOOLBAR).not.toContain('onNextDay')
    expect(TOOLBAR).toContain('props.onPickCamera')
    const SCREEN = read('screens', 'CameraDetailScreen.tsx')
    expect(SCREEN).not.toContain('overlay.status')
  })
})
