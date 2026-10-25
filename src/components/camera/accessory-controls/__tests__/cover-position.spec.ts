/**
 * The cover percentage, and the one thing about it that is easy to get
 * backwards.
 *
 * `cover.cap.ts`: `position` is `0 = fully closed, 100 = fully open`, and
 * admin-ui prints it verbatim. Verified against the live hub on 2026-08-08 —
 * device 1453 "Tapparella hall" reported `state: 'closed'` with
 * `position: 0`. An inverted reading here would put the two surfaces in
 * disagreement about the same shutter.
 */
import { describe, it, expect } from 'vitest'
import { formatCoverPosition } from '../cover-position.js'

describe('formatCoverPosition', () => {
  it('reads 0 as fully CLOSED and 100 as fully OPEN', () => {
    // The direction test. Live: a closed shutter reports 0.
    expect(formatCoverPosition(0)).toBe('0%')
    expect(formatCoverPosition(100)).toBe('100%')
  })

  it('prints an intermediate position verbatim', () => {
    expect(formatCoverPosition(40)).toBe('40%')
  })

  it('renders NOTHING for a cover with no position surface', () => {
    // A shutter that only opens and closes, and most garage doors. Absent is
    // not zero: "0% open" would claim the thing is shut.
    expect(formatCoverPosition(null)).toBeNull()
    expect(formatCoverPosition(undefined)).toBeNull()
  })

  it('rounds a fractional report', () => {
    expect(formatCoverPosition(39.4)).toBe('39%')
    expect(formatCoverPosition(39.6)).toBe('40%')
  })

  it('clamps an out-of-range report instead of printing it', () => {
    // A provider reporting 105 is a provider bug; "105% open" on screen would
    // be a viewer bug.
    expect(formatCoverPosition(105)).toBe('100%')
    expect(formatCoverPosition(-5)).toBe('0%')
  })

  it('rejects a non-finite value', () => {
    expect(formatCoverPosition(Number.NaN)).toBeNull()
    expect(formatCoverPosition(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('the row only shows the percentage when there is one', () => {
  it('CoverControl gates the readout on a non-null format result', async () => {
    // Source guard — the viewer suite has no renderer. The gate is what keeps a
    // positionless shutter from rendering a bogus "0%".
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src/components/camera/accessory-controls/controls.tsx'), 'utf8')
    expect(src).toContain('formatCoverPosition(status.data?.position)')
    expect(src).toContain('openPct !== null ?')
  })
})
