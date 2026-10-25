import { describe, expect, it } from 'vitest'
import { zoomIndicesByRange } from '../mock-data.js'
import { stepZoomIndex } from '../timeline-zoom-step.js'

describe('stepZoomIndex walks the range presets, shortest first', () => {
  const ladder = zoomIndicesByRange()

  it('steps one preset at a time in both directions', () => {
    expect(stepZoomIndex(ladder[2]!, 'longer')).toBe(ladder[3])
    expect(stepZoomIndex(ladder[2]!, 'shorter')).toBe(ladder[1])
  })

  it('clamps at both ends (null = nothing to step to)', () => {
    expect(stepZoomIndex(ladder[0]!, 'shorter')).toBeNull()
    expect(stepZoomIndex(ladder[ladder.length - 1]!, 'longer')).toBeNull()
  })

  it('refuses an index that is not a preset', () => {
    expect(stepZoomIndex(99, 'longer')).toBeNull()
  })
})
