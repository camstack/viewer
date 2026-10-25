import { describe, it, expect } from 'vitest'
import { resumeOffsetSec } from '../resume-offset'

describe('resumeOffsetSec', () => {
  it('returns the exact intra-window offset when the segment head precedes the target', () => {
    // window media-0 at T-3.2s, release at T → resume 3.2s into the window.
    const windowStartMs = 1_700_000_000_000
    const targetEpochMs = windowStartMs + 3_200
    expect(resumeOffsetSec(targetEpochMs, windowStartMs)).toBeCloseTo(3.2, 6)
  })

  it('is 0 when the target coincides with the window start (segment boundary)', () => {
    expect(resumeOffsetSec(1_700_000_000_000, 1_700_000_000_000)).toBe(0)
  })

  it('clamps to 0 when the window start is (impossibly) after the target', () => {
    expect(resumeOffsetSec(1_700_000_000_000, 1_700_000_005_000)).toBe(0)
  })

  it('collapses a non-finite window start (e.g. NaN getStartDate) to the window head', () => {
    expect(resumeOffsetSec(1_700_000_000_000, Number.NaN)).toBe(0)
  })

  it('handles sub-millisecond precision without drift', () => {
    const windowStartMs = 1_700_000_000_000
    expect(resumeOffsetSec(windowStartMs + 1, windowStartMs)).toBeCloseTo(0.001, 9)
  })
})
