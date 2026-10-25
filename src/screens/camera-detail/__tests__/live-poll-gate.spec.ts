/**
 * Live-only polls on camera detail. Recorded/scrub rides the same WebRTC
 * session; motion, doorbell and a snapshot poster must not keep asking the
 * hub for "now" while the picture is historical.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const screen = readFileSync(
  join(process.cwd(), 'src/screens/CameraDetailScreen.tsx'),
  'utf8',
)

describe('camera detail does not poll live surfaces during recorded/scrub', () => {
  it('motion highlight is gated on liveOverlaysVisible, not an unconditional true', () => {
    expect(screen).toContain('useMotionHighlight(deviceId, liveOverlaysVisible)')
    expect(screen).not.toContain('useMotionHighlight(deviceId, true)')
  })

  it('doorbell badge is live-only', () => {
    expect(screen).toContain(
      'enabled={hasDoorbell && liveOverlaysVisible}',
    )
  })

  it('PausedPoster does not enrol snapshot demand off the live edge', () => {
    expect(screen).toContain('<PausedPoster')
    expect(screen).toMatch(/PausedPoster[\s\S]*enabled=\{status\.isLive\}/)
    expect(screen).not.toContain('useSnapshot(deviceId, true, POSTER_SNAPSHOT_WIDTH)')
  })
})
