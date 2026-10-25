import { describe, it, expect } from 'vitest'
import { clampPercentage, stepPercentage, FAN_DEFAULT_STEP } from '../fan-logic.js'

describe('clampPercentage', () => {
  it('clamps to [0,100] and rounds', () => {
    expect(clampPercentage(-10)).toBe(0)
    expect(clampPercentage(150)).toBe(100)
    expect(clampPercentage(33.4)).toBe(33)
  })
})

describe('stepPercentage', () => {
  it('nudges up/down by the step and snaps to the grid', () => {
    expect(stepPercentage(50, 1, 25)).toBe(75)
    expect(stepPercentage(50, -1, 25)).toBe(25)
    // off-grid current snaps onto the grid in the nudge direction
    expect(stepPercentage(30, 1, 25)).toBe(50)
    expect(stepPercentage(30, -1, 25)).toBe(25)
  })
  it('clamps at the ends', () => {
    expect(stepPercentage(100, 1, 25)).toBe(100)
    expect(stepPercentage(0, -1, 25)).toBe(0)
  })
  it('treats null current as 0 and falls back to the default step', () => {
    expect(stepPercentage(null, 1, 0)).toBe(FAN_DEFAULT_STEP)
  })
})
