/**
 * Where the landscape drive overlay is MOUNTED, and on what it is gated
 * (operator, 2026-09-06: joystick + four buttons in landscape overlay).
 *
 * Three gates, all in the screen, all readable in source:
 *  - `fill` — the landscape / fullscreen picture; portrait keeps the panel;
 *  - `hasNavigation` — the camera is bound to the cap AND the session may
 *    actuate (the same `actuate`-grade gate the toolbar chip uses);
 *  - the stream is PLAYING — the robot moves only with its monitor open, so
 *    a stick over a poster, a paused live edge or a recorded playhead
 *    drives nothing. The fact is the picture's own (`playerStatus`), never
 *    a second flag.
 *
 * And the "…" opens the timeline's EXISTING controls panel — the `ptz`
 * kind the toolbar chip toggles — through an imperative handle, rather than
 * a second panel union or a `'drive'` kind.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (...parts: readonly string[]): string => readFileSync(join(SRC, ...parts), 'utf8')

const SCREEN = read('screens', 'CameraDetailScreen.tsx')
const THEATER = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
const LAYOUT = read('components', 'camera', 'theater', 'timeline-layout.ts')

describe('DriveOverlay is mounted by the camera screen', () => {
  it('only in fill, only with navigation, only while the picture is playing', () => {
    expect(SCREEN).toContain("import { DriveOverlay } from '../components/camera/navigation/DriveOverlay.js'")
    expect(SCREEN).toMatch(/const drivePlaying = liveOverlaysVisible && playerStatus\.state === 'playing'/)
    expect(SCREEN).toMatch(/\{fill && hasNavigation && drivePlaying \? \(\s*<DriveOverlay/)
  })

  it('shares the discs` visibility and safe-area, as a SIBLING of the disc group (auto-hide exception lives in the overlay)', () => {
    const mount = SCREEN.slice(SCREEN.indexOf('<DriveOverlay'))
    const block = mount.slice(0, mount.indexOf('/>'))
    expect(block).toContain('visible={controlsVisible}')
    expect(block).toContain('edgePad={{ left: insets.left, right: insets.right, bottom: insets.bottom }}')
    expect(block).toContain('onOpenControls={onOpenDriveControls}')
    // The drawer covers the right of the picture while open: the overlay is told (2026-09-06, screenshot).
    expect(block).toContain("drawer={{ open: timelineDock === 'overlay', width: drawerWidth(winWidth) }}")
    expect(SCREEN.indexOf('<DriveOverlay')).toBeGreaterThan(SCREEN.indexOf('<StreamOverlayControls'))
  })

  it('the "…" opens the drawer and the one controls panel — not a second panel', () => {
    expect(SCREEN).toContain("dock === 'off' ? 'overlay' : dock")
    expect(SCREEN).toContain('timelineRef.current?.openControls()')
    expect(SCREEN).toContain('ref={timelineRef}')
    expect(THEATER).toContain('export interface TheaterTimelineHandle')
    expect(THEATER).toContain('readonly ref?: React.Ref<TheaterTimelineHandle>')
    expect(THEATER).toContain("openControls: () => openPanel('ptz')")
    expect(LAYOUT).not.toContain("'drive'")
  })
})
