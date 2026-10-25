/**
 * The glass pill behind the lit segment (`segment-pill.ts`) and its wiring: the
 * section selector slides the SAME `SlidingGlassPill` the tab bar uses, with
 * `RADIUS.md` corners, and the lit segment no longer paints a solid fill.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { segmentPillTarget } from '../segment-pill.js'

describe('segmentPillTarget', () => {
  it('places the pill in the lit slot, inside the padding and gaps', () => {
    // track 400, padding 2, gap 2, 4 segments -> slot (400-4-6)/4 = 97.5
    const first = segmentPillTarget(0, 4, 400, 2, 2)
    expect(first).toEqual({ x: 2, width: 97.5, visible: true })
    expect(segmentPillTarget(2, 4, 400, 2, 2).x).toBe(2 + 2 * 99.5)
  })
  it('is hidden until measured or when nothing is lit', () => {
    expect(segmentPillTarget(0, 4, 0, 2, 2).visible).toBe(false)
    expect(segmentPillTarget(-1, 4, 400, 2, 2).visible).toBe(false)
  })
})

describe('SegmentedControl glass wiring', () => {
  const src = readFileSync(join(__dirname, '..', 'SegmentedControl.tsx'), 'utf8')
  it('reuses the tab bar pill with a smaller radius', () => {
    expect(src).toContain('<SlidingGlassPill')
    expect(src).toContain('radius={RADIUS.md}')
    expect(src).toContain("active && !glass ? colors.primary : 'transparent'")
  })
})
